import "server-only";
import { format } from "date-fns";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type Holding,
  type InvestmentTransaction,
  type Security,
} from "plaid";
import { env } from "@/lib/env";
import type {
  BrokerageDataProvider,
  BrokerageSyncRequest,
  BrokerageSyncResult,
  NormalizedHolding,
  NormalizedInvestmentActivity,
} from "@/providers/brokerage-data";

type PlaidInvestmentClient = Pick<
  PlaidApi,
  "investmentsHoldingsGet" | "investmentsTransactionsGet"
>;

function createClient(): PlaidInvestmentClient {
  if (!env.plaidConfigured || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new Error("Plaid is not configured");
  }
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env.PLAID_ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
        "PLAID-SECRET": env.PLAID_SECRET,
      },
    },
  }));
}

function priceAsOf(
  holding: Holding,
  security: Security | undefined,
  fallback: Date,
): Date {
  const timestamp =
    holding.institution_price_datetime ??
    holding.institution_price_as_of ??
    security?.update_datetime ??
    security?.close_price_as_of;
  if (!timestamp) return fallback;
  return new Date(timestamp.length === 10 ? `${timestamp}T12:00:00.000Z` : timestamp);
}

function securityType(security: Security | undefined): NormalizedHolding["securityType"] {
  if (security?.is_cash_equivalent || security?.type === "cash") return "CASH";
  if (security?.type === "equity") return "STOCK";
  if (security?.type === "etf") return "ETF";
  if (security?.type === "mutual fund") return "MUTUAL_FUND";
  return "OTHER";
}

export function normalizePlaidHolding(
  holding: Holding,
  security: Security | undefined,
  syncedAt = new Date(),
): NormalizedHolding {
  const type = securityType(security);
  const fallbackTicker = type === "CASH"
    ? "CASH"
    : `UNLISTED-${holding.security_id.slice(-6).toUpperCase()}`;
  return {
    accountExternalId: holding.account_id,
    securityExternalId: holding.security_id,
    ticker: security?.ticker_symbol ?? fallbackTicker,
    name: security?.name ?? "Unlisted security",
    securityType: type,
    quantity: holding.quantity,
    costBasisCents:
      holding.cost_basis === null
        ? undefined
        : Math.round(holding.cost_basis * 100),
    priceCents: Math.round(holding.institution_price * 100),
    currentValueCents: Math.round(holding.institution_value * 100),
    currency:
      holding.iso_currency_code ??
      holding.unofficial_currency_code ??
      security?.iso_currency_code ??
      security?.unofficial_currency_code ??
      "USD",
    priceAsOf: priceAsOf(holding, security, syncedAt),
    priceSource: "PLAID_INSTITUTION",
    // Institution-reported values must never be presented as live exchange quotes.
    priceIsDelayed: true,
  };
}

function activityType(
  transaction: InvestmentTransaction,
): NormalizedInvestmentActivity["type"] | undefined {
  const subtype = String(transaction.subtype).toLowerCase();
  if (subtype.includes("dividend") || subtype.includes("capital gain")) return "DIVIDEND";
  if (subtype.includes("interest")) return "INTEREST";
  if (subtype.includes("contribution") || subtype === "deposit") return "CONTRIBUTION";
  if (["withdrawal", "distribution", "send"].some((value) => subtype.includes(value))) {
    return "WITHDRAWAL";
  }
  if (subtype.includes("fee") || subtype === "tax" || subtype === "tax withheld") return "FEE";
  if (transaction.type === "buy") return "BUY";
  if (transaction.type === "sell") return "SELL";
  // Ambiguous transfers and cancellations are intentionally not reclassified.
  return undefined;
}

export function normalizePlaidInvestmentActivity(
  transaction: InvestmentTransaction,
  security: Security | undefined,
): NormalizedInvestmentActivity | undefined {
  const type = activityType(transaction);
  if (!type) return undefined;
  return {
    externalId: transaction.investment_transaction_id,
    accountExternalId: transaction.account_id,
    securityExternalId: transaction.security_id ?? undefined,
    ticker: security?.ticker_symbol ?? undefined,
    date: transaction.transaction_datetime
      ? new Date(transaction.transaction_datetime)
      : new Date(`${transaction.date}T12:00:00.000Z`),
    type,
    quantity: transaction.quantity || undefined,
    priceCents: transaction.price ? Math.round(transaction.price * 100) : undefined,
    amountCents: Math.abs(Math.round(transaction.amount * 100)),
    feesCents: Math.abs(Math.round((transaction.fees ?? 0) * 100)),
    // Plaid does not provide realized gain or transaction-level basis here.
    costBasisCents: undefined,
    realizedGainCents: undefined,
    description: transaction.name,
  };
}

export class PlaidBrokerageDataProvider implements BrokerageDataProvider {
  readonly id = "plaid" as const;

  constructor(private readonly client: PlaidInvestmentClient = createClient()) {}

  async sync(request: BrokerageSyncRequest): Promise<BrokerageSyncResult> {
    const holdingsResponse = await this.client.investmentsHoldingsGet({
      access_token: request.accessToken,
    });
    const syncedAt = new Date();
    const securities = new Map(
      holdingsResponse.data.securities.map((security) => [security.security_id, security]),
    );
    const activity: NormalizedInvestmentActivity[] = [];
    let offset = 0;
    let providerCalls = 1;
    let total = 1;
    while (offset < total) {
      const response = await this.client.investmentsTransactionsGet({
        access_token: request.accessToken,
        start_date: format(request.startDate, "yyyy-MM-dd"),
        end_date: format(request.endDate, "yyyy-MM-dd"),
        options: { count: 500, offset },
      });
      providerCalls += 1;
      total = response.data.total_investment_transactions;
      for (const security of response.data.securities) {
        securities.set(security.security_id, security);
      }
      for (const transaction of response.data.investment_transactions) {
        const normalized = normalizePlaidInvestmentActivity(
          transaction,
          transaction.security_id
            ? securities.get(transaction.security_id)
            : undefined,
        );
        if (normalized) activity.push(normalized);
      }
      offset += response.data.investment_transactions.length;
      if (response.data.investment_transactions.length === 0) break;
    }
    return {
      holdings: holdingsResponse.data.holdings.map((holding) =>
        normalizePlaidHolding(
          holding,
          securities.get(holding.security_id),
          syncedAt,
        ),
      ),
      activity,
      asOf: syncedAt,
      providerCalls,
    };
  }
}
