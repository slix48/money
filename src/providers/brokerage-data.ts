import { createDemoSnapshot } from "@/domain/demo-data";

export interface NormalizedHolding {
  accountExternalId: string;
  securityExternalId: string;
  ticker: string;
  name: string;
  securityType: "STOCK" | "ETF" | "MUTUAL_FUND" | "CASH" | "OTHER";
  quantity: number;
  costBasisCents?: number;
  priceCents: number;
  currentValueCents: number;
  currency: string;
  priceAsOf: Date;
  priceSource: string;
  priceIsDelayed: boolean;
}

export interface NormalizedInvestmentActivity {
  externalId: string;
  accountExternalId: string;
  securityExternalId?: string;
  ticker?: string;
  date: Date;
  type: "BUY" | "SELL" | "DIVIDEND" | "INTEREST" | "CONTRIBUTION" | "WITHDRAWAL" | "FEE";
  quantity?: number;
  priceCents?: number;
  amountCents: number;
  feesCents: number;
  costBasisCents?: number;
  realizedGainCents?: number;
  description?: string;
}

export interface BrokerageSyncRequest {
  accessToken: string;
  startDate: Date;
  endDate: Date;
}

export interface BrokerageSyncResult {
  holdings: NormalizedHolding[];
  activity: NormalizedInvestmentActivity[];
  asOf: Date;
  providerCalls: number;
}

export interface BrokerageDataProvider {
  readonly id: "plaid" | "mock";
  sync(request: BrokerageSyncRequest): Promise<BrokerageSyncResult>;
}

export class MockBrokerageDataProvider implements BrokerageDataProvider {
  readonly id = "mock" as const;

  async sync(request: BrokerageSyncRequest): Promise<BrokerageSyncResult> {
    if (request.accessToken !== "demo-access-token") {
      throw new Error("Brokerage connection not found");
    }
    const snapshot = createDemoSnapshot();
    return {
      holdings: snapshot.holdings.map((holding) => ({
        accountExternalId: holding.accountId,
        securityExternalId: holding.id,
        ticker: holding.ticker,
        name: holding.name,
        securityType: holding.securityType,
        quantity: holding.quantity,
        costBasisCents: holding.costBasisCents,
        priceCents: holding.priceCents,
        currentValueCents: holding.currentValueCents,
        currency: "USD",
        priceAsOf: holding.priceAsOf,
        priceSource: "DEMO",
        priceIsDelayed: true,
      })),
      activity: snapshot.investmentActivity.map((activity) => ({
        externalId: activity.id,
        accountExternalId: activity.accountId,
        ticker: activity.ticker,
        date: activity.date,
        type: activity.type,
        quantity: activity.quantity,
        priceCents: activity.priceCents,
        amountCents: activity.amountCents,
        feesCents: activity.feesCents,
        costBasisCents: activity.costBasisCents,
        realizedGainCents: activity.realizedGainCents,
      })),
      asOf: snapshot.generatedAt,
      providerCalls: 1,
    };
  }
}
