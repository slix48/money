import { differenceInCalendarDays } from "date-fns";
import { describe, expect, it } from "vitest";
import { createDemoSnapshot } from "@/domain/demo-data";
import {
  calculateCashFlow,
  calculateGoalProgress,
  calculateIncome,
  calculateInvestmentPerformance,
  calculateMonthlySeries,
  calculateNetWorth,
  calculatePortfolio,
  calculatePurchaseScenario,
  calculateGoalScenario,
  calculateSpendingByCategory,
  comparePeriods,
  detectRecurringTransactions,
  getMonthRange,
  getSubscriptionPriceChanges,
  normalizeMerchant,
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
    expect(shopping?.amountCents).toBe(96_200);
    expect(spending.byCategory.some((entry) => entry.category === "Transfers")).toBe(false);
  });

  it("does not overstate total spending when refunds exceed one category", () => {
    const snapshot = createDemoSnapshot(anchor);
    const range = getMonthRange(anchor);
    const baseline = calculateSpendingByCategory(snapshot.transactions, range);
    const refund = {
      ...snapshot.transactions.find((transaction) => transaction.transactionType === "REFUND")!,
      id: "refund-over-category",
      category: "Other" as const,
      amountCents: 20_000,
    };
    const adjusted = calculateSpendingByCategory(
      [...snapshot.transactions, refund],
      range,
    );

    expect(adjusted.totalCents).toBe(baseline.totalCents - 20_000);
    expect(adjusted.byCategory.find((entry) => entry.category === "Other")?.amountCents).toBe(-20_000);
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

  it("does not double-count transfer legs, card payments, or investment cash flows", () => {
    const snapshot = createDemoSnapshot(anchor);
    const base = snapshot.transactions.find(
      (transaction) => !transaction.isPending,
    )!;
    const transaction = (
      id: string,
      transactionType: typeof base.transactionType,
      amountCents: number,
    ) => ({
      ...base,
      id,
      date: new Date(2026, 7, 12, 12),
      transactionType,
      amountCents,
      isPending: false,
    });
    snapshot.transactions = [
      {
        ...transaction("transfer-out", "TRANSFER", -50_000),
        accountId: "acct-checking",
        linkedAccountId: "acct-savings",
        category: "Transfers",
      },
      {
        ...transaction("transfer-in", "TRANSFER", 50_000),
        accountId: "acct-savings",
        linkedAccountId: "acct-checking",
        category: "Transfers",
      },
      {
        ...transaction("card-payment", "DEBT_PAYMENT", -25_000),
        accountId: "acct-checking",
        linkedAccountId: "acct-credit",
        category: "Transfers",
      },
      {
        ...transaction(
          "investment-contribution",
          "INVESTMENT_CONTRIBUTION",
          -30_000,
        ),
        accountId: "acct-checking",
        linkedAccountId: "acct-brokerage",
        category: "Investments",
      },
    ];

    const range = getMonthRange(anchor);
    const income = calculateIncome(snapshot.transactions, range);
    const spending = calculateSpendingByCategory(snapshot.transactions, range);
    const summary = calculateCashFlow(snapshot, range);
    const performance = calculateInvestmentPerformance(
      snapshot.holdings,
      snapshot.investmentActivity.filter(
        (activity) => activity.type === "WITHDRAWAL",
      ),
    );

    expect(income.totalCents).toBe(0);
    expect(spending.totalCents).toBe(0);
    expect(summary.debtCents).toBe(25_000);
    expect(summary.cashSavingsCents).toBe(50_000);
    expect(summary.investmentsCents).toBe(30_000);
    expect(performance.withdrawalsCents).toBe(10_000);
    expect(performance.contributionsCents).toBe(0);
  });

  it("calculates assets, liabilities, and net worth from account semantics", () => {
    const summary = calculateNetWorth(createDemoSnapshot(anchor).accounts);

    expect(summary.cashCents).toBe(2_529_022);
    expect(summary.investmentsCents).toBe(8_773_000);
    expect(summary.debtCents).toBe(1_358_144);
    expect(summary.netWorthCents).toBe(9_943_878);
  });

  it("treats provider-positive liability balances as debt", () => {
    const accounts = createDemoSnapshot(anchor).accounts.map((account) =>
      account.id === "acct-credit"
        ? { ...account, balanceCents: Math.abs(account.balanceCents), isLiability: true }
        : account,
    );
    const summary = calculateNetWorth(accounts);

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
    expect(portfolio.topFiveWeight).toBeGreaterThan(0.98);
    expect(portfolio.individualStockWeight).toBeCloseTo(961_800 / 8_773_000);
  });

  it("never treats provider cash without cost basis as an investment gain", () => {
    const snapshot = createDemoSnapshot(anchor);
    const holdings = snapshot.holdings.map((holding) =>
      holding.securityType === "CASH"
        ? { ...holding, costBasisCents: undefined }
        : holding,
    );
    const portfolio = calculatePortfolio(holdings);
    const performance = calculateInvestmentPerformance(
      holdings,
      snapshot.investmentActivity,
    );

    expect(portfolio.positions.find((position) => position.securityType === "CASH")).toMatchObject({
      gainCents: 0,
      gainPercent: 0,
      hasReliableCostBasis: true,
    });
    expect(portfolio.gainCents).toBe(1_778_900);
    expect(performance.unrealizedGainCents).toBe(1_778_900);
  });

  it("separates contributions, withdrawals, income, fees, and market gains", () => {
    const snapshot = createDemoSnapshot(anchor);
    const performance = calculateInvestmentPerformance(
      snapshot.holdings,
      snapshot.investmentActivity,
    );

    expect(performance.contributionsCents).toBe(370_000);
    expect(performance.withdrawalsCents).toBe(10_000);
    expect(performance.dividendsCents).toBe(28_800);
    expect(performance.feesCents).toBe(600);
    expect(performance.realizedGainCents).toBe(2_500);
    expect(performance.unrealizedGainCents).toBe(1_778_900);
    expect(performance.investmentGainLossCents).toBe(1_780_800);
  });

  it("reports incomplete performance instead of fabricating sell cost basis", () => {
    const snapshot = createDemoSnapshot(anchor);
    const activity = snapshot.investmentActivity.map((entry) =>
      entry.type === "SELL" ? { ...entry, realizedGainCents: undefined } : entry,
    );
    const performance = calculateInvestmentPerformance(snapshot.holdings, activity);

    expect(performance.realizedGainCents).toBeNull();
    expect(performance.totalReturnCents).toBeNull();
    expect(performance.notes[0]).toContain("unavailable");
  });

  it("does not report current unrealized gains as selected-period performance", () => {
    const snapshot = createDemoSnapshot(anchor);
    const performance = calculateInvestmentPerformance(
      snapshot.holdings,
      snapshot.investmentActivity,
      getMonthRange(anchor),
    );

    expect(performance.contributionsCents).toBe(70_000);
    expect(performance.unrealizedGainCents).toBeNull();
    expect(performance.investmentGainLossCents).toBeNull();
    expect(performance.notes).toContain(
      "Period investment gain/loss is unavailable without an opening portfolio valuation.",
    );
  });

  it("estimates goal completion using contributions only, without assumed returns", () => {
    const goal = createDemoSnapshot(anchor).goals.find((entry) => entry.id === "goal-emergency")!;
    const progress = calculateGoalProgress(goal, anchor);

    expect(progress.progress).toBeCloseTo(0.615);
    expect(progress.remainingCents).toBe(1_155_000);
    expect(progress.monthsRemaining).toBe(24);
  });

  it("uses contribution history for goal pace and supports zero-return scenarios", () => {
    const snapshot = createDemoSnapshot(anchor);
    const car = snapshot.goals.find((goal) => goal.id === "goal-car")!;
    const progress = calculateGoalProgress(car, anchor, snapshot.goalContributions);
    const scenario = calculateGoalScenario(car, 25_000, anchor);

    expect(progress.averageContributionCents).toBe(12_500);
    expect(progress.paceSource).toBe("HISTORY");
    expect(progress.monthsRemaining).toBe(140);
    expect(scenario.monthsRemaining).toBe(70);
    expect(scenario.annualReturnPercent).toBe(0);
  });

  it("includes skipped months in historical goal contribution pace", () => {
    const snapshot = createDemoSnapshot(anchor);
    const car = snapshot.goals.find((goal) => goal.id === "goal-car")!;
    const contribution = snapshot.goalContributions.find(
      (entry) => entry.goalId === car.id,
    )!;
    const progress = calculateGoalProgress(car, new Date(2026, 2, 28, 12), [
      { ...contribution, id: "jan", date: new Date(2026, 0, 10, 12), amountCents: 12_000 },
      { ...contribution, id: "mar", date: new Date(2026, 2, 10, 12), amountCents: 12_000 },
    ]);

    expect(progress.averageContributionCents).toBe(8_000);
  });

  it("returns a transparent purchase scenario without making the decision", () => {
    const scenario = calculatePurchaseScenario(
      createDemoSnapshot(anchor),
      700_000,
      anchor,
    );

    expect(scenario.cashBeforeCents).toBe(2_529_022);
    expect(scenario.cashAfterCents).toBe(1_829_022);
    expect(scenario.emergencyTargetCents).toBe(3_000_000);
    expect(scenario.remainingAboveEmergencyTargetCents).toBe(-1_170_978);
    expect(scenario.status).toBe("BELOW_EMERGENCY_TARGET");
  });

  it("detects recurring merchants from settled transaction intervals", () => {
    const detected = detectRecurringTransactions(createDemoSnapshot(anchor).transactions);

    expect(detected.find((item) => item.merchant === "MetroNet Fiber")).toMatchObject({
      frequency: "MONTHLY",
      status: "ACTIVE",
    });
    expect(detected.some((item) => item.merchant === "Nobu")).toBe(false);
  });

  it("normalizes processor noise and estimates non-monthly renewal dates", () => {
    expect(normalizeMerchant("SQ *CHIPOTLE 1234")).toBe("chipotle");
    expect(normalizeMerchant("CHIPOTLE #2938")).toBe("chipotle");
    const base = createDemoSnapshot(anchor).transactions.find(
      (transaction) => transaction.transactionType === "EXPENSE",
    )!;
    const weekly = [0, 7, 14].map((day, index) => ({
      ...base,
      id: "weekly-" + index,
      date: new Date(2026, 7, 1 + day, 12),
      merchant: "Fresh Meal Kit",
      rawMerchant: "FRESH MEAL KIT " + index,
      normalizedMerchant: "fresh meal kit",
      amountCents: -5_000,
      isPending: false,
    }));
    const detected = detectRecurringTransactions(weekly)[0];

    expect(detected.frequency).toBe("WEEKLY");
    expect(detected.averageAmountCents).toBe(5_000);
    expect(differenceInCalendarDays(detected.nextEstimatedDate!, detected.lastChargeDate)).toBe(7);
  });

  it("aligns normalized merchants across periods and keeps recurrence ids unique by account", () => {
    const snapshot = createDemoSnapshot(anchor);
    const base = snapshot.transactions.find(
      (transaction) => transaction.transactionType === "EXPENSE",
    )!;
    snapshot.transactions = [
      {
        ...base,
        id: "chipotle-previous",
        date: new Date(2026, 6, 12, 12),
        merchant: "SQ *CHIPOTLE 1234",
        normalizedMerchant: "chipotle",
        amountCents: -1_000,
        isPending: false,
      },
      {
        ...base,
        id: "chipotle-current",
        date: new Date(2026, 7, 12, 12),
        merchant: "CHIPOTLE #2938",
        normalizedMerchant: "chipotle",
        amountCents: -4_000,
        isPending: false,
      },
    ];
    const comparison = comparePeriods(
      snapshot,
      getMonthRange(anchor),
      getMonthRange(anchor, 1),
    );
    const recurringInput = ["account-a", "account-b"].flatMap((accountId) =>
      [0, 1, 2].map((month) => ({
        ...base,
        id: accountId + "-" + month,
        accountId,
        date: new Date(2026, 5 + month, 5, 12),
        merchant: "Example Service",
        normalizedMerchant: "example service",
        amountCents: -2_000,
        isPending: false,
      })),
    );
    const detected = detectRecurringTransactions(recurringInput);

    expect(comparison.merchantChanges).toEqual([
      expect.objectContaining({ merchant: "CHIPOTLE #2938", changeCents: 3_000 }),
    ]);
    expect(new Set(detected.map((item) => item.id)).size).toBe(2);
  });

  it("flags material recurring price increases", () => {
    const changes = getSubscriptionPriceChanges(createDemoSnapshot(anchor).recurring);

    expect(changes.map((change) => change.merchant)).toEqual([
      "MetroNet Fiber",
      "Streambox",
      "Spotify",
    ]);
    expect(changes[0]).toMatchObject({ increaseCents: 1_800, previousAmountCents: 6_500 });
    expect(changes[2]).toMatchObject({ increaseCents: 100, annualImpactCents: 1_200 });
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
