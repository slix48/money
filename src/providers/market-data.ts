export interface MarketQuote {
  ticker: string;
  priceCents: number;
  currency: string;
  asOf: Date;
  source: "DEMO" | "MANUAL" | "MARKET_PROVIDER";
  isDelayed: boolean;
}

export interface MarketDataProvider {
  readonly id: string;
  getQuotes(tickers: string[]): Promise<MarketQuote[]>;
}

const DEMO_QUOTES: Record<string, number> = {
  AAPL: 22_900,
  BND: 7_300,
  CASH: 100,
  VFFVX: 23_840.91,
  VTI: 28_500,
  VXUS: 6_600,
};

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock-market-data";

  async getQuotes(tickers: string[]): Promise<MarketQuote[]> {
    const asOf = new Date();
    return tickers.map((ticker) => {
      const priceCents = DEMO_QUOTES[ticker.toUpperCase()];
      if (priceCents === undefined) {
        throw new Error(`No demo quote is configured for ${ticker}`);
      }
      return {
        ticker: ticker.toUpperCase(),
        priceCents,
        currency: "USD",
        asOf,
        source: "DEMO",
        isDelayed: true,
      };
    });
  }
}
