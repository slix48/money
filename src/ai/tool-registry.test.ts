import { describe, expect, it } from "vitest";
import { askFinancialAssistant } from "@/ai/assistant";
import {
  createFinancialToolContext,
  executeFinancialTool,
  financialToolCatalog,
  type FinancialToolName,
} from "@/ai/tool-registry";
import { DemoFinancialRepository } from "@/data/demo-repository";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";

const anchor = new Date(2026, 7, 28, 12);

function context(userId = DEMO_USER_ID) {
  return createFinancialToolContext(
    userId,
    new DemoFinancialRepository(createDemoSnapshot(anchor)),
  );
}

describe("financial AI tools", () => {
  it("exposes only read actions", () => {
    expect(financialToolCatalog.length).toBeGreaterThan(10);
    expect(new Set(financialToolCatalog.map((tool) => tool.access))).toEqual(new Set(["READ"]));
    expect(financialToolCatalog.some((tool) => /transfer|trade|cancel/i.test(tool.name))).toBe(false);
  });

  it("returns deterministic net worth and cash-flow results", async () => {
    const netWorth = await executeFinancialTool(context(), "getNetWorth", {});
    const cashFlow = await executeFinancialTool(context(), "calculateCashFlow", { monthsAgo: 0 });

    expect(netWorth.data).toMatchObject({ current: { netWorthCents: 9_943_878 } });
    expect(cashFlow.data).toMatchObject({
      summary: { incomeCents: 739_500, investmentContributionsCents: 70_000 },
    });
  });

  it("removes internal user identifiers from structured tool results", async () => {
    const portfolio = await executeFinancialTool(context(), "getPortfolio", {});
    const goals = await executeFinancialTool(context(), "getGoals", {});
    const history = await executeFinancialTool(context(), "getNetWorthHistory", {});

    expect(JSON.stringify([portfolio.data, goals.data, history.data])).not.toContain(
      "userId",
    );
  });

  it("normalizes provider signs for contribution and dividend receipts", async () => {
    const snapshot = createDemoSnapshot(anchor);
    snapshot.investmentActivity = snapshot.investmentActivity.map((item) =>
      item.type === "CONTRIBUTION" || item.type === "DIVIDEND"
        ? { ...item, amountCents: -Math.abs(item.amountCents) }
        : item,
    );
    const signedContext = createFinancialToolContext(
      DEMO_USER_ID,
      new DemoFinancialRepository(snapshot),
    );
    const activity = await executeFinancialTool(
      signedContext,
      "getInvestmentActivity",
      { monthsAgo: 0 },
    );
    const dividends = await executeFinancialTool(signedContext, "getDividends", {
      monthsAgo: 0,
    });

    expect(activity.data).toMatchObject({ totalContributionsCents: 70_000 });
    expect(dividends.data).toMatchObject({ totalCents: 4_500 });
  });

  it("rejects tools outside the allowlist", async () => {
    await expect(
      executeFinancialTool(context(), "deleteTransactions" as FinancialToolName, {}),
    ).rejects.toThrow("not permitted");
  });

  it("preserves repository authorization through the tool context", async () => {
    await expect(executeFinancialTool(context("another-user"), "getNetWorth", {})).rejects.toThrow(
      "Record not found",
    );
  });

  it("answers dining questions from a declared calculation tool", async () => {
    const reply = await askFinancialAssistant("How much did I spend eating out?", context());

    expect(reply.answer).toContain("$356.70");
    expect(reply.toolsUsed).toEqual(["getSpendingByCategory"]);
    expect(reply.calculation).toContain("Dining: $356.70");
  });

  it("returns purchase trade-offs without making the decision", async () => {
    const reply = await askFinancialAssistant(
      "Can I afford a $7,000 purchase without using my emergency fund?",
      context(),
    );

    expect(reply.answer).toContain("$25,290.22");
    expect(reply.answer).toContain("$18,290.22");
    expect(reply.answer).toContain("$11,709.78 below");
    expect(reply.toolsUsed).toEqual(["calculatePurchaseScenario"]);
    expect(reply.note).toContain("does not decide affordability");
  });

  it.each([
    ["How much money do I have?", ["getAccounts", "getNetWorth"], "$99,438.78"],
    ["Where did most of my money go this month?", ["getSpendingByCategory"], "settled spending"],
    ["How much did I spend on food?", ["getSpendingByCategory"], "food and dining"],
    ["How much did I spend at Amazon?", ["searchTransactions"], "$128.00"],
    ["Why was my spending higher this month?", ["compareSpendingPeriods"], "largest increases"],
    ["What subscriptions do I have?", ["getSubscriptions"], "active subscriptions"],
    ["Did any subscription increase in price?", ["getSubscriptionChanges"], "Spotify increased"],
    ["How much recurring spending do I have?", ["getRecurringExpenses"], "active recurring expenses"],
    ["How much money did I make this month?", ["getIncome"], "$7,395.00"],
    ["What are my income streams?", ["getIncomeStreams"], "Primary salary"],
    ["How much did I actually save?", ["getCashFlow"], "Internal transfers"],
    ["What is my net worth?", ["getNetWorth"], "$99,438.78"],
    ["How has my net worth changed?", ["getNetWorth"], "previous snapshot"],
    ["How much money have I contributed to investments?", ["getInvestmentContributions"], "$3,700.00"],
    ["How much did my investments actually gain?", ["getInvestmentPerformance"], "$17,808.00"],
    ["How much dividend income have I received?", ["getDividends"], "$288.00"],
    ["What is my biggest stock position?", ["getPortfolio"], "largest position"],
    ["What percentage of my portfolio is Apple?", ["getHolding"], "11.0%"],
    ["Am I concentrated in a few investments?", ["getPortfolio"], "top five"],
    ["How close am I to my car goal?", ["getGoals"], "27.1%"],
    ["If I save $250/month, when will I reach my car goal?", ["calculateGoalScenario"], "70 months"],
  ] as const)(
    "grounds %s in the expected tool",
    async (question, expectedTools, expectedText) => {
      const reply = await askFinancialAssistant(question, context());

      expect(reply.toolsUsed).toEqual(expectedTools);
      expect(reply.answer).toContain(expectedText);
      expect(reply.dataSource).toBe("DEMO");
    },
  );

  it("searches normalized and raw merchant descriptions", async () => {
    const result = await executeFinancialTool(context(), "searchTransactions", {
      query: "SQ *CHIPOTLE",
      monthsAgo: 0,
      includePending: false,
      limit: 10,
    });

    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ merchant: "Chipotle", amountCents: -2_180 }),
      ]),
    );
  });

  it("calculates zero-return goal scenarios through an allowlisted tool", async () => {
    const result = await executeFinancialTool(context(), "calculateGoalScenario", {
      goalId: "goal-car",
      monthlyContributionCents: 25_000,
      annualReturnPercent: 0,
    });

    expect(result.data).toMatchObject({
      monthsRemaining: 70,
      annualReturnPercent: 0,
    });
  });

  it("explains retained savings without subtracting investment contributions twice", async () => {
    const reply = await askFinancialAssistant(
      "How much did I actually save?",
      context(),
    );
    const cashFlow = await executeFinancialTool(context(), "getCashFlow", {
      monthsAgo: 0,
    });
    const summary = (
      cashFlow.data as {
        summary: {
          incomeCents: number;
          spendingCents: number;
          debtPaymentsCents: number;
          netSavingsCents: number;
        };
      }
    ).summary;

    expect(summary.netSavingsCents).toBe(
      summary.incomeCents - summary.spendingCents - summary.debtPaymentsCents,
    );
    expect(reply.calculation).toEqual([
      "$7,395.00 income",
      "- $3,888.07 spending",
      "- $300.00 debt payments",
      "= $3,206.93 retained",
      "$700.00 of retained savings allocated to investments",
    ]);
  });
});
