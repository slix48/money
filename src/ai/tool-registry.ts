import { z } from "zod";
import type { FinancialRepository } from "@/data/financial-repository";
import {
  calculateCashFlow,
  calculateGoalProgress,
  calculateIncome,
  calculateNetWorth,
  calculatePeriodSummary,
  calculatePortfolio,
  calculateSpendingByCategory,
  calculateSpendingByMerchant,
  comparePeriods,
  getMonthRange,
  getSubscriptionPriceChanges,
  inRange,
} from "@/domain/calculations";
import { getWhatChanged } from "@/domain/insights";
import type { DateRange, FinancialSnapshot } from "@/domain/types";

export const FINANCIAL_TOOL_NAMES = [
  "getAccountBalances",
  "getNetWorth",
  "getTransactions",
  "getSpendingByCategory",
  "getSpendingByMerchant",
  "compareSpendingPeriods",
  "getIncome",
  "getIncomeStreams",
  "getRecurringExpenses",
  "getSubscriptionChanges",
  "getPortfolio",
  "getPortfolioAllocation",
  "getInvestmentActivity",
  "getDividends",
  "getGoals",
  "calculateCashFlow",
  "getWhatChanged",
] as const;

export type FinancialToolName = (typeof FINANCIAL_TOOL_NAMES)[number];

export interface FinancialToolContext {
  readonly userId: string;
  getSnapshot(): Promise<FinancialSnapshot>;
}

export function createFinancialToolContext(
  userId: string,
  repository: FinancialRepository,
): FinancialToolContext {
  let snapshotPromise: Promise<FinancialSnapshot> | undefined;
  return {
    userId,
    getSnapshot() {
      snapshotPromise ??= repository.getSnapshot(userId);
      return snapshotPromise;
    },
  };
}

interface ToolDefinition {
  access: "READ";
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, snapshot: FinancialSnapshot): unknown;
}

const emptySchema = z.object({}).strict();
const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  monthsAgo: z.number().int().min(0).max(60).default(0),
});

function resolveRange(
  value: z.infer<typeof rangeSchema>,
  snapshot: FinancialSnapshot,
): DateRange {
  if (value.from && value.to) {
    const from = new Date(value.from);
    const to = new Date(value.to);
    if (from > to) throw new Error("The start date must be before the end date");
    return { from, to };
  }
  return getMonthRange(snapshot.generatedAt, value.monthsAgo);
}

const toolRegistry: Record<FinancialToolName, ToolDefinition> = {
  getAccountBalances: {
    access: "READ",
    description: "Return the user's account balances grouped by account type.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return snapshot.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        institution: account.institution,
        type: account.type,
        balanceCents: account.balanceCents,
        availableBalanceCents: account.availableBalanceCents,
        currency: account.currency,
        status: account.connectionStatus,
        lastUpdatedAt: account.lastUpdatedAt.toISOString(),
      }));
    },
  },
  getNetWorth: {
    access: "READ",
    description: "Calculate current assets, liabilities, and net worth and return history.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return {
        current: calculateNetWorth(snapshot.accounts),
        history: snapshot.netWorthHistory.map((item) => ({
          ...item,
          date: item.date.toISOString(),
        })),
      };
    },
  },
  getTransactions: {
    access: "READ",
    description: "Return settled or pending transactions using explicit filters.",
    inputSchema: rangeSchema.extend({
      category: z.string().max(40).optional(),
      merchant: z.string().max(120).optional(),
      includePending: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        category: z.string().max(40).optional(),
        merchant: z.string().max(120).optional(),
        includePending: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      });
      const value = schema.parse(input);
      const range = resolveRange(value, snapshot);
      return snapshot.transactions
        .filter(
          (transaction) =>
            inRange(transaction.date, range) &&
            (value.includePending || !transaction.isPending) &&
            (!value.category || transaction.category.toLowerCase() === value.category.toLowerCase()) &&
            (!value.merchant ||
              transaction.merchant.toLowerCase().includes(value.merchant.toLowerCase())),
        )
        .slice(0, value.limit)
        .map((transaction) => ({
          id: transaction.id,
          date: transaction.date.toISOString(),
          merchant: transaction.merchant,
          description: transaction.description,
          amountCents: transaction.amountCents,
          type: transaction.transactionType,
          category: transaction.category,
          subcategory: transaction.subcategory,
          pending: transaction.isPending,
          recurring: transaction.isRecurring,
        }));
    },
  },
  getSpendingByCategory: {
    access: "READ",
    description: "Calculate settled spending net of refunds, grouped by category.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      return calculateSpendingByCategory(snapshot.transactions, resolveRange(value, snapshot));
    },
  },
  getSpendingByMerchant: {
    access: "READ",
    description: "Calculate settled spending net of refunds, grouped by merchant.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      return calculateSpendingByMerchant(snapshot.transactions, resolveRange(value, snapshot));
    },
  },
  compareSpendingPeriods: {
    access: "READ",
    description: "Compare income, spending, categories, and merchants for two monthly periods.",
    inputSchema: z.object({ monthsAgo: z.number().int().min(0).max(59).default(0) }),
    execute(input, snapshot) {
      const value = z
        .object({ monthsAgo: z.number().int().min(0).max(59).default(0) })
        .parse(input);
      return comparePeriods(
        snapshot,
        getMonthRange(snapshot.generatedAt, value.monthsAgo),
        getMonthRange(snapshot.generatedAt, value.monthsAgo + 1),
      );
    },
  },
  getIncome: {
    access: "READ",
    description: "Calculate income by payer and type, with side and investment income separated.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      return calculateIncome(snapshot.transactions, resolveRange(value, snapshot));
    },
  },
  getIncomeStreams: {
    access: "READ",
    description: "Return detected income streams and recurrence metadata.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return snapshot.incomeStreams.map((stream) => ({
        ...stream,
        lastReceivedAt: stream.lastReceivedAt.toISOString(),
        nextExpectedAt: stream.nextExpectedAt?.toISOString(),
      }));
    },
  },
  getRecurringExpenses: {
    access: "READ",
    description: "Return recurring bills and subscriptions with annualized costs.",
    inputSchema: z.object({ status: z.enum(["ACTIVE", "POSSIBLE", "CANCELLED", "IGNORED"]).optional() }),
    execute(input, snapshot) {
      const value = z
        .object({ status: z.enum(["ACTIVE", "POSSIBLE", "CANCELLED", "IGNORED"]).optional() })
        .parse(input);
      return snapshot.recurring
        .filter((item) => !value.status || item.status === value.status)
        .map((item) => ({
          ...item,
          nextEstimatedDate: item.nextEstimatedDate?.toISOString(),
          lastChargeDate: item.lastChargeDate.toISOString(),
        }));
    },
  },
  getSubscriptionChanges: {
    access: "READ",
    description: "Return deterministic bill and subscription price increases.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return getSubscriptionPriceChanges(snapshot.recurring);
    },
  },
  getPortfolio: {
    access: "READ",
    description: "Calculate portfolio value, cost basis, gain/loss, position weights, and concentration.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return calculatePortfolio(snapshot.holdings);
    },
  },
  getPortfolioAllocation: {
    access: "READ",
    description: "Return allocation by asset type and by position.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      const portfolio = calculatePortfolio(snapshot.holdings);
      return { valueCents: portfolio.valueCents, allocation: portfolio.allocation, positions: portfolio.positions };
    },
  },
  getInvestmentActivity: {
    access: "READ",
    description: "Return contributions, buys, sells, dividends, interest, and withdrawals for a period.",
    inputSchema: rangeSchema.extend({
      type: z.enum(["BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "WITHDRAWAL"]).optional(),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        type: z.enum(["BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "WITHDRAWAL"]).optional(),
      });
      const value = schema.parse(input);
      const range = resolveRange(value, snapshot);
      const activity = snapshot.investmentActivity.filter(
        (item) => inRange(item.date, range) && (!value.type || item.type === value.type),
      );
      return {
        totalContributionsCents: activity
          .filter((item) => item.type === "CONTRIBUTION")
          .reduce((sum, item) => sum + item.amountCents, 0),
        activity: activity.map((item) => ({ ...item, date: item.date.toISOString() })),
      };
    },
  },
  getDividends: {
    access: "READ",
    description: "Calculate dividend and interest investment activity for a period.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      const range = resolveRange(value, snapshot);
      const dividends = snapshot.investmentActivity.filter(
        (item) => inRange(item.date, range) && ["DIVIDEND", "INTEREST"].includes(item.type),
      );
      return {
        totalCents: dividends.reduce((sum, item) => sum + item.amountCents, 0),
        activity: dividends.map((item) => ({ ...item, date: item.date.toISOString() })),
      };
    },
  },
  getGoals: {
    access: "READ",
    description: "Calculate goal progress and completion estimates without assumed investment returns.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return snapshot.goals.map((goal) => {
        const progress = calculateGoalProgress(goal, snapshot.generatedAt);
        return {
          ...progress,
          targetDate: progress.targetDate?.toISOString(),
          estimatedCompletion: progress.estimatedCompletion?.toISOString(),
        };
      });
    },
  },
  calculateCashFlow: {
    access: "READ",
    description: "Calculate income allocation across spending, debt, cash savings, and investment contributions.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      const range = resolveRange(value, snapshot);
      return {
        summary: calculatePeriodSummary(snapshot, range),
        flow: calculateCashFlow(snapshot, range),
      };
    },
  },
  getWhatChanged: {
    access: "READ",
    description: "Return the most material financial changes for the current month.",
    inputSchema: emptySchema,
    execute(input, snapshot) {
      emptySchema.parse(input);
      return getWhatChanged(snapshot);
    },
  },
};

export const financialToolCatalog = FINANCIAL_TOOL_NAMES.map((name) => ({
  name,
  access: toolRegistry[name].access,
  description: toolRegistry[name].description,
}));

export async function executeFinancialTool(
  context: FinancialToolContext,
  name: FinancialToolName,
  input: unknown,
) {
  const tool = toolRegistry[name];
  if (!tool || tool.access !== "READ") {
    throw new Error("Tool is not permitted");
  }
  const snapshot = await context.getSnapshot();
  const parsedInput = tool.inputSchema.parse(input);
  return {
    tool: name,
    access: "READ" as const,
    data: tool.execute(parsedInput, snapshot),
    computedAt: snapshot.generatedAt.toISOString(),
    dataSource: snapshot.dataSource,
  };
}
