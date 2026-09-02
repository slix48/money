import { describe, expect, it } from "vitest";
import { MockBrokerageDataProvider } from "@/providers/brokerage-data";
import { MockFinancialDataProvider } from "@/providers/financial-data";
import { MockMarketDataProvider } from "@/providers/market-data";

describe("provider contracts", () => {
  it("supports cursor-based financial and brokerage syncs", async () => {
    const financial = new MockFinancialDataProvider();
    const brokerage = new MockBrokerageDataProvider();
    const initial = await financial.syncTransactions({
      accessToken: "demo-access-token",
    }, "MoneyOS Demo Provider");
    const incremental = await financial.syncTransactions({
      accessToken: "demo-access-token",
      cursor: initial.cursor,
    }, "MoneyOS Demo Provider");
    const positions = await brokerage.sync({
      accessToken: "demo-access-token",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2026-12-31"),
    });

    expect(initial.addedTransactions.length).toBeGreaterThan(50);
    expect(incremental.addedTransactions).toEqual([]);
    expect(positions.holdings.length).toBeGreaterThan(1);
  });

  it("keeps provider records isolated by authenticated user", async () => {
    const financial = new MockFinancialDataProvider();
    const brokerage = new MockBrokerageDataProvider();

    await expect(
      financial.createConnectionSession({ userId: "another-user" }),
    ).rejects.toThrow("not found");
    await expect(
      brokerage.sync({
        accessToken: "wrong-token",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2026-12-31"),
      }),
    ).rejects.toThrow("not found");
  });

  it("marks mock quotes as delayed demo data", async () => {
    const quotes = await new MockMarketDataProvider().getQuotes(["AAPL"]);

    expect(quotes[0]).toMatchObject({
      ticker: "AAPL",
      source: "DEMO",
      isDelayed: true,
    });
  });
});
