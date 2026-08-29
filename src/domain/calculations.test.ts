import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "@/domain/demo-data";
import {
  calculateCashFlow,
  calculateGoalProgress,
  calculateIncome,
  calculateMonthlySeries,
  calculateNetWorth,
  calculatePortfolio,
  calculateSpendingByCategory,
  comparePeriods,
  detectRecurringTransactions,
  getMonthRange,
  getSubscriptionPriceChanges,
} from "@/domain/calculations";

const anchor = new Date(2026, 7, 28, 12);

describe("financial calculations", () => {
  it("calculates income without transfers, refunds, or card payments", () => {
    const snapshot = createDemoSnapshot(anchor);
    const income = calculateIncome(snapshot.transactions, getMonthRange(anchor));

    expect(income.totalCents).toBe(739_500);
    expect(income.sideIncomeCents).toBe(85_000);
    expect(income.investmentIncomeCents).toBe(4_500);
    expect(income.bySource[0]).toMatchObject({ source: "Northstar Labs", amountCents: 650_000 });
  });

  it("excludes pending charges and nets refunds against the original category", () => {
    const snapshot = createDemoSnapshot(anchor);
    const spending = calculateSpendingByCategory(snapshot.transactions, getMonthRange(anchor));
    const dining = spending.byCategory.find((entry) => entry.category === "Dining");
    const shopping = spending.byCategory.find((entry) => entry.category === "Shopping");

    expect(dining?.amountCents).toBe(35_670);
    expect(shopping?.amountCents).toBe(83_400);
    expect(spending.byCategory.some((entry) => entry.category === "Transfers")).toBe(false);
  });

  it("separates cash savings, debt payments, and investment contributions", () => {
    const snapshot = createDemoSnapshot(anchor);
    const flow = calculateCashFlow(snapshot, getMonthRange(anchor));

    expect(flow.incomeCents).toBe(739_500);
    expect(flow.cashSavingsCents).toBe(50_000);
    expect(flow.investmentsCents).toBe(70_000);
    expect(flow.debtCents).toBe(30_000);
    expect(flow.branches.reduce((sum, branch) => sum + branch.amountCents, 0)).toBe(flow.incomeCents);
  });

  it("calculates assets, liabilities, and net worth from account semantics", () => {
    const summary = calculateNetWorth(createDemoSnapshot(anchor).accounts);

    expect(summary.cashCents).toBe(2_529_022);
    expect(summary.investmentsCents).toBe(8_773_000);
    expect(summary.debtCents).toBe(1_358_144);
    expect(summary.netWorthCents).toBe(9_943_878);
  });

  it("calculates portfolio gain and weights independently of contributions", () => {
    const portfolio = calculatePortfolio(createDemoSnapshot(anchor).holdings);

    expect(portfolio.valueCents).toBe(8_773_000);
    expect(portfolio.costBasisCents).toBe(6_994_100);
    expect(portfolio.gainCents).toBe(1_778_900);
    expect(portfolio.positions.reduce((sum, position) => sum + position.weight, 0)).toBeCloseTo(1);
    expect(portfolio.largestPosition?.ticker).toBe("VFFVX");
    expect(portfolio.concentration).toBe("CONCENTRATED");
  });

  it("estimates goal completion using contributions only, without assumed returns", () => {
    const goal = createDemoSnapshot(anchor).goals.find((entry) => entry.id === "goal-emergency")!;
    const progress = calculateGoalProgress(goal, anchor);

    expect(progress.progress).toBeCloseTo(0.615);
    expect(progress.remainingCents).toBe(1_155_000);
    expect(progress.monthsRemaining).toBe(24);
  });

  it("detects recurring merchants from settled transaction intervals", () => {
    const detected = detectRecurringTransactions(createDemoSnapshot(anchor).transactions);

    expect(detected.find((item) => item.merchant === "MetroNet Fiber")).toMatchObject({
      frequency: "MONTHLY",
      status: "ACTIVE",
    });
    expect(detected.some((item) => item.merchant === "Nobu")).toBe(false);
  });

  it("flags material recurring price increases", () => {
    const changes = getSubscriptionPriceChanges(createDemoSnapshot(anchor).recurring);

    expect(changes.map((change) => change.merchant)).toEqual([
      "MetroNet Fiber",
      "Streambox",
    ]);
    expect(changes[0]).toMatchObject({ increaseCents: 1_800, previousAmountCents: 6_500 });
  });

  it("compares periods and produces a stable monthly series", () => {
    const snapshot = createDemoSnapshot(anchor);
    const comparison = comparePeriods(
      snapshot,
      getMonthRange(anchor),
      getMonthRange(anchor, 1),
    );
    const series = calculateMonthlySeries(snapshot, 6);

    expect(comparison.incomeChangeCents).toBeGreaterThan(100_000);
    expect(comparison.categoryChanges[0].category).toBe("Shopping");
    expect(series).toHaveLength(6);
    expect(series.at(-1)?.investmentContributionsCents).toBe(70_000);
  });
});
