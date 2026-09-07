import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
} from "plaid";

const DATABASE_PREFIX = "moneyos_sandbox_e2e_";
const MAX_WAIT_MS = 3 * 60 * 1_000;

interface SandboxConfiguration {
  databaseUrl: string;
  clientId: string;
  secret: string;
  webhookUrl?: string;
}

function databaseIdentity(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  return url.hostname + ":" + (url.port || "5432") + "/" + database;
}

export function readSandboxConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): SandboxConfiguration | undefined {
  if (environment.RUN_PLAID_SANDBOX_E2E !== "true") return undefined;
  if (environment.NODE_ENV === "production") {
    throw new Error("Plaid Sandbox E2E must never run with NODE_ENV=production");
  }
  if (environment.PLAID_ENV !== "sandbox") {
    throw new Error("PLAID_ENV must exactly equal sandbox");
  }
  const databaseUrl = environment.DATABASE_URL;
  const clientId = environment.PLAID_CLIENT_ID;
  const secret = environment.PLAID_SECRET;
  if (!databaseUrl || !clientId || !secret) {
    throw new Error("DATABASE_URL, PLAID_CLIENT_ID, and PLAID_SECRET are required");
  }
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must be PostgreSQL");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database.startsWith(DATABASE_PREFIX)) {
    throw new Error("Sandbox E2E database name must start with " + DATABASE_PREFIX);
  }
  const identity = databaseIdentity(databaseUrl);
  if (environment.PLAID_SANDBOX_DATABASE_CONFIRM !== identity) {
    throw new Error("PLAID_SANDBOX_DATABASE_CONFIRM must exactly equal " + identity);
  }
  if (!environment.PROVIDER_TOKEN_ENCRYPTION_KEY && !environment.PROVIDER_TOKEN_ENCRYPTION_KEYS) {
    throw new Error("Provider-token encryption must be configured");
  }
  return {
    databaseUrl,
    clientId,
    secret,
    webhookUrl: environment.PLAID_WEBHOOK_URL || undefined,
  };
}

function safeFailure(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response
  ) {
    const data = error.response.data;
    if (data && typeof data === "object") {
      const code = "error_code" in data && typeof data.error_code === "string"
        ? data.error_code
        : "UNKNOWN_PROVIDER_ERROR";
      const type = "error_type" in data && typeof data.error_type === "string"
        ? data.error_type
        : "PROVIDER";
      return type + ":" + code;
    }
  }
  return error instanceof Error ? error.name : "UnknownError";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const configuration = readSandboxConfiguration(process.env);
  if (!configuration) {
    console.info("Plaid Sandbox E2E skipped: set RUN_PLAID_SANDBOX_E2E=true to opt in.");
    return;
  }

  const [{ prisma }, { DEFAULT_CATEGORIES }, connectionService, syncQueue] = await Promise.all([
    import("@/lib/db"),
    import("@/domain/demo-data"),
    import("@/sync/connection-service"),
    import("@/sync/sync-queue"),
  ]);
  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": configuration.clientId,
        "PLAID-SECRET": configuration.secret,
      },
    },
  }));
  let userId: string | undefined;
  let connectionId: string | undefined;
  let cleanupToken: string | undefined;
  let primaryFailure: unknown;

  try {
    const user = await prisma.user.create({
      data: {
        email: "plaid-sandbox-" + randomUUID() + "@example.invalid",
        name: "Plaid Sandbox E2E",
        categories: {
          create: DEFAULT_CATEGORIES.map((category) => ({
            name: category.name,
            kind: category.kind,
            color: category.color,
            icon: "Circle",
            isDefault: true,
          })),
        },
      },
      select: { id: true },
    });
    userId = user.id;

    const linkSession = await connectionService.createPlaidLinkSession(userId);
    if (!linkSession.sessionToken || linkSession.expiresAt <= new Date()) {
      throw new Error("Plaid did not return a valid Link session");
    }

    const publicTokenResponse = await plaid.sandboxPublicTokenCreate({
      institution_id: process.env.PLAID_SANDBOX_INSTITUTION_ID || "ins_109508",
      initial_products: [Products.Transactions],
      options: {
        override_username: process.env.PLAID_SANDBOX_USERNAME || "user_good",
        override_password: process.env.PLAID_SANDBOX_PASSWORD || "pass_good",
        ...(configuration.webhookUrl ? { webhook: configuration.webhookUrl } : {}),
      },
    });
    const connected = await connectionService.exchangePlaidPublicToken(
      userId,
      publicTokenResponse.data.public_token,
    );
    connectionId = connected.connectionId;

    const deadline = Date.now() + MAX_WAIT_MS;
    let jobStatus = "QUEUED";
    while (Date.now() < deadline) {
      const job = await prisma.syncJob.findFirst({
        where: { id: connected.jobId, userId },
        select: { status: true, availableAt: true, lastErrorCategory: true },
      });
      if (!job) throw new Error("MoneyOS did not persist the initial synchronization job");
      jobStatus = job.status;
      if (job.status === "SUCCEEDED") break;
      if (job.status === "FAILED") {
        throw new Error("Initial synchronization failed: " + (job.lastErrorCategory || "UNKNOWN"));
      }
      if (job.status === "QUEUED" && job.availableAt <= new Date()) {
        await syncQueue.processNextSyncJob(connected.jobId);
      } else {
        await delay(1_000);
      }
    }
    if (jobStatus !== "SUCCEEDED") {
      throw new Error("Initial synchronization exceeded the three-minute timeout");
    }

    const storedConnection = await prisma.financialConnection.findFirst({
      where: { id: connectionId, userId },
      select: {
        status: true,
        accessTokenEncrypted: true,
        tokenKeyVersion: true,
        tokenEncryptionScheme: true,
      },
    });
    if (!storedConnection?.accessTokenEncrypted || storedConnection.status !== "CONNECTED") {
      throw new Error("MoneyOS did not persist a connected, encrypted provider connection");
    }
    const { decryptProviderAccessToken } = await import("@/sync/provider-token-service");
    cleanupToken = await decryptProviderAccessToken({
      userId,
      connectionId,
      ciphertext: storedConnection.accessTokenEncrypted,
      keyVersion: storedConnection.tokenKeyVersion,
      encryptionScheme: storedConnection.tokenEncryptionScheme,
    });

    const [accountCount, transactionCount] = await Promise.all([
      prisma.account.count({ where: { userId, providerAccount: { isNot: null } } }),
      prisma.transaction.count({
        where: { userId, financialConnectionId: connectionId, isRemoved: false },
      }),
    ]);
    if (accountCount < 1 || transactionCount < 1) {
      throw new Error("Sandbox sync completed without representative normalized data");
    }

    const [{ getFinancialRepository }, tools] = await Promise.all([
      import("@/data/get-repository"),
      import("@/ai/tool-registry"),
    ]);
    const repository = await getFinancialRepository();
    const snapshot = await repository.getSnapshot(userId);
    const balances = await tools.executeFinancialTool(
      tools.createFinancialToolContext(userId, repository),
      "getAccountBalances",
      {},
    );
    if (snapshot.accounts.length < 1 || snapshot.transactions.length < 1) {
      throw new Error("Normalized data was not visible through the financial repository");
    }
    if (!JSON.stringify(balances.data).includes("balanceCents")) {
      throw new Error("AI financial tools did not receive normalized account balances");
    }

    if (process.env.PLAID_SANDBOX_FIRE_WEBHOOK === "true") {
      if (!configuration.webhookUrl) {
        throw new Error("PLAID_WEBHOOK_URL is required to fire the Sandbox webhook");
      }
      const fired = await plaid.sandboxItemFireWebhook({
        access_token: cleanupToken,
        webhook_code: SandboxItemFireWebhookRequestWebhookCodeEnum.SyncUpdatesAvailable,
      });
      if (!fired.data.webhook_fired) throw new Error("Plaid did not fire the Sandbox webhook");
    }

    console.info(JSON.stringify({
      event: "plaid_sandbox_e2e_succeeded",
      accountsImported: accountCount,
      transactionsImported: transactionCount,
      repositoryAccounts: snapshot.accounts.length,
      repositoryTransactions: snapshot.transactions.length,
      webhookFired: process.env.PLAID_SANDBOX_FIRE_WEBHOOK === "true",
    }));
  } catch (error) {
    primaryFailure = error;
    console.error("Plaid Sandbox E2E failed: " + safeFailure(error));
  } finally {
    let cleanupFailure: unknown;
    if (userId && connectionId) {
      try {
        await connectionService.disconnectFinancialConnection(userId, connectionId);
      } catch (error) {
        cleanupFailure = error;
        if (cleanupToken) {
          try {
            await plaid.itemRemove({ access_token: cleanupToken });
            cleanupFailure = undefined;
          } catch (fallbackError) {
            cleanupFailure = fallbackError;
          }
        }
      }
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    if (cleanupFailure) {
      throw new Error("Sandbox cleanup failed: " + safeFailure(cleanupFailure));
    }
  }
  if (primaryFailure) throw new Error("Plaid Sandbox E2E validation failed");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Plaid Sandbox E2E failed");
    process.exitCode = 1;
  });
}
