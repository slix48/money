import { describe, expect, it } from "vitest";
import { DEMO_USER_ID } from "@/domain/demo-data";
import { MockBrokerageDataProvider } from "@/providers/brokerage-data";
import { MockFinancialDataProvider } from "@/providers/financial-data";
import { MockMarketDataProvider } from "@/providers/market-data";

describe("provider contracts", () => {
  it("supports cursor-based financial and brokerage syncs", async () => {
    const financial = new MockFinancialDataProvider();
    const brokerage = new MockBrokerageDataProvider();
    const initial = await financial.sync(DEMO_USER_ID, {
      connectionId: "demo-connection",
    });
    const incremental = await financial.sync(DEMO_USER_ID, {
      connectionId: "demo-connection",
      cursor: initial.cursor,
    });
    const positions = await brokerage.sync(DEMO_USER_ID, {
      connectionId: "demo-brokerage",
    });

    expect(initial.addedOrUpdatedTransactions.length).toBeGreaterThan(50);
    expect(incremental.addedOrUpdatedTransactions).toEqual([]);
    expect(positions.holdings.length).toBeGreaterThan(1);
  });

  it("keeps provider records isolated by authenticated user", async () => {
    const financial = new MockFinancialDataProvider();
    const brokerage = new MockBrokerageDataProvider();

    await expect(
      financial.sync("another-user", { connectionId: "demo-connection" }),
    ).rejects.toThrow("not found");
    await expect(
      brokerage.sync("another-user", { connectionId: "demo-brokerage" }),
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
