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
    expect(reply.calculation).toContain("Dining transactions: $356.70");
  });

  it("assesses a purchase without consuming the emergency-fund allocation", async () => {
    const reply = await askFinancialAssistant(
      "Can I afford a $7,000 purchase without using my emergency fund?",
      context(),
    );

    expect(reply.answer).toContain("would require");
    expect(reply.answer).toContain("$285.78");
    expect(reply.toolsUsed).toEqual([
      "getAccountBalances",
      "getGoals",
      "calculateCashFlow",
    ]);
    expect(reply.note).toContain("not financial advice");
  });
});
