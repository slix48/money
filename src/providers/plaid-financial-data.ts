import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type JWKPublicKey,
  type Transaction,
} from "plaid";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { z } from "zod";
import type {
  ConnectionSession,
  ConnectionSessionRequest,
  ExchangedConnection,
  FinancialDataProvider,
  FinancialDataSyncRequest,
  FinancialDataSyncResult,
  NormalizedProviderAccount,
  NormalizedProviderTransaction,
  VerifiedFinancialDataWebhook,
} from "@/providers/financial-data";
import { env } from "@/lib/env";

const webhookPayloadSchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().optional(),
}).passthrough();

type PlaidClient = Pick<
  PlaidApi,
  | "accountsGet"
  | "itemGet"
  | "itemPublicTokenExchange"
  | "itemRemove"
  | "linkTokenCreate"
  | "transactionsSync"
  | "webhookVerificationKeyGet"
>;

const globalForWebhookKeys = globalThis as typeof globalThis & {
  moneyOsPlaidWebhookKeys?: Map<string, { key: JWKPublicKey; cachedUntil: number }>;
};
const webhookKeys =
  globalForWebhookKeys.moneyOsPlaidWebhookKeys ??
  new Map<string, { key: JWKPublicKey; cachedUntil: number }>();
globalForWebhookKeys.moneyOsPlaidWebhookKeys = webhookKeys;

const MAX_WEBHOOK_SIGNATURE_BYTES = 4_096;
const MAX_WEBHOOK_KEY_ID_BYTES = 256;
const MAX_CACHED_WEBHOOK_KEYS = 32;

function cacheWebhookKey(keyId: string, key: JWKPublicKey): void {
  const now = Date.now();
  for (const [cachedId, cached] of webhookKeys) {
    if (cached.cachedUntil <= now) webhookKeys.delete(cachedId);
  }
  if (!webhookKeys.has(keyId) && webhookKeys.size >= MAX_CACHED_WEBHOOK_KEYS) {
    const oldest = webhookKeys.keys().next().value as string | undefined;
    if (oldest) webhookKeys.delete(oldest);
  }
  webhookKeys.set(keyId, { key, cachedUntil: now + 10 * 60 * 1_000 });
}

function requirePlaidConfiguration() {
  if (!env.plaidConfigured || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new Error("Plaid is not configured");
  }
}

function createPlaidClient(): PlaidClient {
  requirePlaidConfiguration();
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
          "PLAID-SECRET": env.PLAID_SECRET,
        },
      },
    }),
  );
}

function plaidErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object") return undefined;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : undefined;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function nullableCents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

export function normalizePlaidAccount(
  account: AccountBase,
  institutionName: string,
  asOf = new Date(),
): NormalizedProviderAccount {
  const isLiability = account.type === "credit" || account.type === "loan";
  const subtype = String(account.subtype ?? "");
  const type: NormalizedProviderAccount["type"] =
    account.type === "depository"
      ? subtype === "savings"
        ? "SAVINGS"
        : "CHECKING"
      : account.type === "credit"
        ? "CREDIT_CARD"
        : account.type === "loan"
          ? "LOAN"
          : account.type === "investment" || account.type === "brokerage"
            ? /401|403|ira|retirement|pension/i.test(subtype)
              ? "RETIREMENT"
              : "BROKERAGE"
            : "OTHER";
  const rawBalance = nullableCents(account.balances.current);
  return {
    externalId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? undefined,
    institutionName,
    type,
    balanceCents: rawBalance,
    availableBalanceCents:
      account.balances.available === null
        ? undefined
        : Math.round(account.balances.available * 100),
    currency:
      account.balances.iso_currency_code ??
      account.balances.unofficial_currency_code ??
      "USD",
    isLiability,
    maskLast4: account.mask?.slice(-4),
    balanceAsOf: account.balances.last_updated_datetime
      ? new Date(account.balances.last_updated_datetime)
      : asOf,
  };
}

export function normalizePlaidTransaction(
  transaction: Transaction,
): NormalizedProviderTransaction {
  const category = transaction.personal_finance_category;
  return {
    externalId: transaction.transaction_id,
    pendingExternalId: transaction.pending_transaction_id ?? undefined,
    accountExternalId: transaction.account_id,
    date: dateOnly(transaction.date),
    authorizedDate: transaction.authorized_date
      ? dateOnly(transaction.authorized_date)
      : undefined,
    rawName: transaction.name ?? transaction.original_description ?? "Transaction",
    providerMerchantName: transaction.merchant_name ?? undefined,
    originalDescription: transaction.original_description ?? undefined,
    // Plaid uses positive for outflow; MoneyOS uses negative for outflow.
    amountCents: -Math.round(transaction.amount * 100),
    currency:
      transaction.iso_currency_code ??
      transaction.unofficial_currency_code ??
      "USD",
    isPending: transaction.pending,
    categoryHint: category
      ? {
          primary: category.primary,
          detailed: category.detailed,
          confidence: category.confidence_level ?? undefined,
        }
      : undefined,
    paymentChannel: transaction.payment_channel,
  };
}

function webhookEvent(
  webhookType: string,
  webhookCode: string,
): VerifiedFinancialDataWebhook["event"] {
  if (webhookType === "TRANSACTIONS") return "SYNC_AVAILABLE";
  if (webhookType === "INVESTMENTS") return "INVESTMENTS_AVAILABLE";
  if (webhookType === "ITEM" && webhookCode === "ERROR") {
    return "CONNECTION_ERROR";
  }
  if (webhookType === "ITEM" && webhookCode === "PENDING_EXPIRATION") {
    return "CONSENT_EXPIRING";
  }
  if (
    webhookType === "ITEM" &&
    ["USER_PERMISSION_REVOKED", "PENDING_DISCONNECT"].includes(webhookCode)
  ) {
    return "CONNECTION_REMOVED";
  }
  return "IGNORED";
}

export class PlaidFinancialDataProvider implements FinancialDataProvider {
  readonly id = "plaid" as const;
  readonly displayName = "Plaid";

  constructor(private readonly client: PlaidClient = createPlaidClient()) {}

  async createConnectionSession(
    request: ConnectionSessionRequest,
  ): Promise<ConnectionSession> {
    const response = await this.client.linkTokenCreate({
      client_name: "MoneyOS",
      country_codes: [CountryCode.Us],
      language: "en",
      user: {
        client_user_id: createHash("sha256")
          .update(`moneyos:${request.userId}`)
          .digest("hex"),
      },
      ...(request.accessToken
        ? { access_token: request.accessToken }
        : {
            products: [Products.Transactions],
            optional_products: [Products.Investments],
          }),
      ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
      ...(request.redirectUri || env.PLAID_REDIRECT_URI
        ? { redirect_uri: request.redirectUri ?? env.PLAID_REDIRECT_URI }
        : {}),
    });
    return {
      sessionToken: response.data.link_token,
      expiresAt: new Date(response.data.expiration),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangedConnection> {
    const exchanged = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const item = await this.client.itemGet({
      access_token: exchanged.data.access_token,
    });
    return {
      accessToken: exchanged.data.access_token,
      providerItemId: exchanged.data.item_id,
      providerInstitutionId: item.data.item.institution_id ?? undefined,
      institutionName: item.data.item.institution_name ?? "Connected institution",
      consentExpiresAt: item.data.item.consent_expiration_time
        ? new Date(item.data.item.consent_expiration_time)
        : undefined,
    };
  }

  async getAccounts(
    accessToken: string,
    institutionName: string,
  ): Promise<NormalizedProviderAccount[]> {
    const response = await this.client.accountsGet({ access_token: accessToken });
    const asOf = new Date();
    return response.data.accounts.map((account) =>
      normalizePlaidAccount(account, institutionName, asOf),
    );
  }

  async syncTransactions(
    request: FinancialDataSyncRequest,
    institutionName: string,
  ): Promise<FinancialDataSyncResult> {
    const response = await this.client.transactionsSync({
      access_token: request.accessToken,
      cursor: request.cursor,
      count: Math.min(Math.max(request.pageSize ?? 500, 1), 500),
      options: { include_original_description: true },
    });
    const syncedAt = new Date();
    return {
      cursor: response.data.next_cursor,
      hasMore: response.data.has_more,
      accounts: response.data.accounts.map((account) =>
        normalizePlaidAccount(account, institutionName, syncedAt),
      ),
      addedTransactions: response.data.added.map(normalizePlaidTransaction),
      modifiedTransactions: response.data.modified.map(normalizePlaidTransaction),
      removedExternalTransactionIds: response.data.removed.map(
        (transaction) => transaction.transaction_id,
      ),
      providerRequestId: response.data.request_id,
      syncedAt,
    };
  }

  async verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedFinancialDataWebhook> {
    const signed = headers["plaid-verification"] ?? headers["Plaid-Verification"];
    if (!signed) throw new Error("Missing Plaid webhook signature");
    if (Buffer.byteLength(signed, "utf8") > MAX_WEBHOOK_SIGNATURE_BYTES) {
      throw new Error("Invalid Plaid webhook signature header");
    }
    const protectedHeader = decodeProtectedHeader(signed);
    if (
      protectedHeader.alg !== "ES256" ||
      !protectedHeader.kid ||
      Buffer.byteLength(protectedHeader.kid, "utf8") > MAX_WEBHOOK_KEY_ID_BYTES ||
      !/^[A-Za-z0-9._:-]+$/.test(protectedHeader.kid)
    ) {
      throw new Error("Invalid Plaid webhook signature header");
    }
    const cached = webhookKeys.get(protectedHeader.kid);
    const key = cached && cached.cachedUntil > Date.now()
      ? cached.key
      : (await this.client.webhookVerificationKeyGet({
          key_id: protectedHeader.kid,
        })).data.key;
    if (
      key.alg !== "ES256" ||
      key.kid !== protectedHeader.kid ||
      key.expired_at !== null
    ) {
      throw new Error("Invalid Plaid webhook verification key");
    }
    cacheWebhookKey(protectedHeader.kid, key);
    const verificationKey = await importJWK({
      alg: key.alg,
      crv: key.crv,
      kid: key.kid,
      kty: key.kty,
      use: key.use,
      x: key.x,
      y: key.y,
    }, "ES256");
    const verified = await jwtVerify(signed, verificationKey, {
      algorithms: ["ES256"],
    });
    const issuedAt = verified.payload.iat;
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      typeof issuedAt !== "number" ||
      issuedAt < nowSeconds - 5 * 60 ||
      issuedAt > nowSeconds + 30
    ) {
      throw new Error("Stale Plaid webhook signature");
    }
    const expectedHash = verified.payload.request_body_sha256;
    const actualHash = createHash("sha256").update(rawBody).digest("hex");
    const expectedHashBytes = typeof expectedHash === "string" && /^[a-f\d]{64}$/i.test(expectedHash)
      ? Buffer.from(expectedHash, "hex")
      : Buffer.alloc(0);
    const actualHashBytes = Buffer.from(actualHash, "hex");
    if (
      expectedHashBytes.length !== actualHashBytes.length ||
      !timingSafeEqual(expectedHashBytes, actualHashBytes)
    ) {
      throw new Error("Plaid webhook body verification failed");
    }
    const parsed = webhookPayloadSchema.safeParse(
      JSON.parse(Buffer.from(rawBody).toString("utf8")),
    );
    if (!parsed.success) throw new Error("Invalid Plaid webhook payload");
    return {
      providerItemId: parsed.data.item_id,
      event: webhookEvent(parsed.data.webhook_type, parsed.data.webhook_code),
      // The body can be identical across legitimate notifications. Hash the
      // verified signed envelope so only an exact delivery replay is deduped.
      providerEventId: createHash("sha256").update(signed).digest("hex"),
      occurredAt: new Date(issuedAt * 1_000),
    };
  }

  async disconnect(accessToken: string): Promise<void> {
    try {
      await this.client.itemRemove({ access_token: accessToken });
    } catch (error) {
      // A previous successful removal can be followed by a local commit failure.
      // An invalid token no longer grants provider access, so retry is complete.
      if (plaidErrorCode(error) === "INVALID_ACCESS_TOKEN") return;
      throw error;
    }
  }
}
