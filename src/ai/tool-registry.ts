import { z } from "zod";
import type { FinancialRepository } from "@/data/financial-repository";
import {
  calculateCashFlow,
  calculateGoalScenario,
  calculateGoalProgress,
  calculateIncome,
  calculateInvestmentPerformance,
  calculateNetWorth,
  calculatePeriodSummary,
  calculatePortfolio,
  calculatePurchaseScenario,
  calculateSpendingByCategory,
  calculateSpendingByMerchant,
  comparePeriods,
  compareIncomePeriods,
  getMonthRange,
  getSubscriptionPriceChanges,
  inRange,
} from "@/domain/calculations";
import { getWhatChanged } from "@/domain/insights";
import type { DateRange, FinancialSnapshot } from "@/domain/types";

export const FINANCIAL_TOOL_NAMES = [
  "getAccountBalances",
  "getAccounts",
  "getNetWorth",
  "getNetWorthHistory",
  "getTransactions",
  "searchTransactions",
  "getSpendingByCategory",
  "getSpendingByMerchant",
  "getLargestExpenses",
  "compareSpendingPeriods",
  "getIncome",
  "getIncomeStreams",
  "compareIncomePeriods",
  "getRecurringExpenses",
  "getSubscriptions",
  "getSubscriptionChanges",
  "getPortfolio",
  "getHolding",
  "getPortfolioAllocation",
  "getInvestmentActivity",
  "getInvestmentContributions",
  "getInvestmentPerformance",
  "getDividends",
  "getGoals",
  "calculateGoalScenario",
  "calculateCashFlow",
  "getCashFlow",
  "calculatePurchaseScenario",
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

function minimizeToolResult(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(minimizeToolResult);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "userId")
        .map(([key, nestedValue]) => [key, minimizeToolResult(nestedValue)]),
    );
  }
  return value;
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
  getAccounts: {
    access: "READ",
    description: "Return user-owned accounts with type, balance, liability, source, and connection metadata.",
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
        isLiability: account.isLiability,
        currency: account.currency,
        source: account.source,
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
  getNetWorthHistory: {
    access: "READ",
    description: "Return stored historical net-worth snapshots without recalculating past balances.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(120).default(24),
    }),
    execute(input, snapshot) {
      const value = z
        .object({ limit: z.number().int().min(1).max(120).default(24) })
        .parse(input);
      return snapshot.netWorthHistory.slice(-value.limit).map((item) => ({
        ...item,
        date: item.date.toISOString(),
      }));
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
  searchTransactions: {
    access: "READ",
    description: "Search user-owned transactions across normalized and original provider text with bounded filters.",
    inputSchema: rangeSchema.extend({
      query: z.string().trim().min(1).max(120),
      accountId: z.string().max(100).optional(),
      category: z.string().max(40).optional(),
      type: z
        .enum([
          "EXPENSE",
          "INCOME",
          "TRANSFER",
          "REFUND",
          "INVESTMENT_CONTRIBUTION",
          "INVESTMENT_ACTIVITY",
          "DEBT_PAYMENT",
          "ADJUSTMENT",
        ])
        .optional(),
      includePending: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        query: z.string().trim().min(1).max(120),
        accountId: z.string().max(100).optional(),
        category: z.string().max(40).optional(),
        type: z
          .enum([
            "EXPENSE",
            "INCOME",
            "TRANSFER",
            "REFUND",
            "INVESTMENT_CONTRIBUTION",
            "INVESTMENT_ACTIVITY",
            "DEBT_PAYMENT",
            "ADJUSTMENT",
          ])
          .optional(),
        includePending: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
      });
      const value = schema.parse(input);
      const query = value.query.toLowerCase();
      const range = resolveRange(value, snapshot);
      return snapshot.transactions
        .filter((transaction) => {
          const searchable = [
            transaction.merchant,
            transaction.rawMerchant,
            transaction.description,
            transaction.rawDescription,
            transaction.notes,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return (
            inRange(transaction.date, range) &&
            (value.includePending || !transaction.isPending) &&
            (!value.accountId || transaction.accountId === value.accountId) &&
            (!value.category ||
              transaction.category.toLowerCase() === value.category.toLowerCase()) &&
            (!value.type || transaction.transactionType === value.type) &&
            searchable.includes(query)
          );
        })
        .slice(0, value.limit)
        .map((transaction) => ({
          id: transaction.id,
          date: transaction.date.toISOString(),
          merchant: transaction.merchant,
          description: transaction.description,
          amountCents: transaction.amountCents,
          type: transaction.transactionType,
          category: transaction.category,
          pending: transaction.isPending,
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
  getLargestExpenses: {
    access: "READ",
    description: "Return the largest individual settled expense transactions for a period.",
    inputSchema: rangeSchema.extend({
      limit: z.number().int().min(1).max(25).default(10),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        limit: z.number().int().min(1).max(25).default(10),
      });
      const value = schema.parse(input);
      const range = resolveRange(value, snapshot);
      return snapshot.transactions
        .filter(
          (transaction) =>
            !transaction.isPending &&
            transaction.transactionType === "EXPENSE" &&
            inRange(transaction.date, range),
        )
        .sort((left, right) => Math.abs(right.amountCents) - Math.abs(left.amountCents))
        .slice(0, value.limit)
        .map((transaction) => ({
          id: transaction.id,
          date: transaction.date.toISOString(),
          merchant: transaction.merchant,
          description: transaction.description,
          amountCents: Math.abs(transaction.amountCents),
          category: transaction.category,
        }));
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
  compareIncomePeriods: {
    access: "READ",
    description: "Compare deterministic income totals and sources for adjacent monthly periods.",
    inputSchema: z.object({
      monthsAgo: z.number().int().min(0).max(59).default(0),
    }),
    execute(input, snapshot) {
      const value = z
        .object({ monthsAgo: z.number().int().min(0).max(59).default(0) })
        .parse(input);
      return compareIncomePeriods(
        snapshot.transactions,
        getMonthRange(snapshot.generatedAt, value.monthsAgo),
        getMonthRange(snapshot.generatedAt, value.monthsAgo + 1),
      );
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
  getSubscriptions: {
    access: "READ",
    description: "Return confirmed or possible subscription records, excluding ordinary recurring bills.",
    inputSchema: z.object({
      status: z
        .enum(["ACTIVE", "POSSIBLE", "CANCELLED", "IGNORED"])
        .default("ACTIVE"),
    }),
    execute(input, snapshot) {
      const value = z
        .object({
          status: z
            .enum(["ACTIVE", "POSSIBLE", "CANCELLED", "IGNORED"])
            .default("ACTIVE"),
        })
        .parse(input);
      return snapshot.recurring
        .filter(
          (item) => item.isSubscription && item.status === value.status,
        )
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
  getHolding: {
    access: "READ",
    description: "Return a single tracked holding and its deterministic portfolio analytics.",
    inputSchema: z.object({
      ticker: z.string().trim().min(1).max(16),
    }),
    execute(input, snapshot) {
      const value = z
        .object({ ticker: z.string().trim().min(1).max(16) })
        .parse(input);
      const portfolio = calculatePortfolio(snapshot.holdings);
      return (
        portfolio.positions.find(
          (position) =>
            position.ticker.toLowerCase() === value.ticker.toLowerCase(),
        ) ?? null
      );
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
      type: z.enum(["BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "WITHDRAWAL", "FEE"]).optional(),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        type: z.enum(["BUY", "SELL", "DIVIDEND", "INTEREST", "CONTRIBUTION", "WITHDRAWAL", "FEE"]).optional(),
      });
      const value = schema.parse(input);
      const range = resolveRange(value, snapshot);
      const activity = snapshot.investmentActivity.filter(
        (item) => inRange(item.date, range) && (!value.type || item.type === value.type),
      );
      return {
        totalContributionsCents: activity
          .filter((item) => item.type === "CONTRIBUTION")
          .reduce((sum, item) => sum + Math.abs(item.amountCents), 0),
        activity: activity.map((item) => ({ ...item, date: item.date.toISOString() })),
      };
    },
  },
  getInvestmentContributions: {
    access: "READ",
    description: "Calculate investment contributions for a period without treating them as returns.",
    inputSchema: rangeSchema,
    execute(input, snapshot) {
      const value = rangeSchema.parse(input);
      const range = resolveRange(value, snapshot);
      const contributions = snapshot.investmentActivity.filter(
        (item) => item.type === "CONTRIBUTION" && inRange(item.date, range),
      );
      return {
        totalCents: contributions.reduce(
          (sum, item) => sum + Math.abs(item.amountCents),
          0,
        ),
        activity: contributions.map((item) => ({
          ...item,
          date: item.date.toISOString(),
        })),
      };
    },
  },
  getInvestmentPerformance: {
    access: "READ",
    description: "Separate contributions and withdrawals from realized/unrealized gain, dividends, interest, and fees.",
    inputSchema: rangeSchema.extend({
      allTime: z.boolean().default(true),
    }),
    execute(input, snapshot) {
      const schema = rangeSchema.extend({
        allTime: z.boolean().default(true),
      });
      const value = schema.parse(input);
      const range =
        value.allTime && !value.from && !value.to
          ? undefined
          : resolveRange(value, snapshot);
      return calculateInvestmentPerformance(
        snapshot.holdings,
        snapshot.investmentActivity,
        range,
      );
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
        totalCents: dividends.reduce(
          (sum, item) => sum + Math.abs(item.amountCents),
          0,
        ),
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
        const progress = calculateGoalProgress(
          goal,
          snapshot.generatedAt,
          snapshot.goalContributions,
        );
        return {
          ...progress,
          targetDate: progress.targetDate?.toISOString(),
          estimatedCompletion: progress.estimatedCompletion?.toISOString(),
        };
      });
    },
  },
  calculateGoalScenario: {
    access: "READ",
    description: "Project a goal completion date using an explicit monthly contribution and optional disclosed return assumption.",
    inputSchema: z.object({
      goalId: z.string().trim().min(1).max(100),
      monthlyContributionCents: z.number().int().positive().max(100_000_000_00),
      annualReturnPercent: z.number().min(0).max(20).default(0),
    }),
    execute(input, snapshot) {
      const value = z
        .object({
          goalId: z.string().trim().min(1).max(100),
          monthlyContributionCents: z
            .number()
            .int()
            .positive()
            .max(100_000_000_00),
          annualReturnPercent: z.number().min(0).max(20).default(0),
        })
        .parse(input);
      const goal = snapshot.goals.find((item) => item.id === value.goalId);
      if (!goal) return null;
      const result = calculateGoalScenario(
        goal,
        value.monthlyContributionCents,
        snapshot.generatedAt,
        value.annualReturnPercent,
      );
      return {
        goal: {
          id: goal.id,
          name: goal.name,
          targetAmountCents: goal.targetAmountCents,
          currentAmountCents: goal.currentAmountCents,
        },
        ...result,
        estimatedCompletion: result.estimatedCompletion?.toISOString(),
      };
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
  getCashFlow: {
    access: "READ",
    description: "Return deterministic cash flow with transfers, card payments, pending items, and investment contributions separated.",
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
  calculatePurchaseScenario: {
    access: "READ",
    description: "Calculate cash before and after a proposed purchase with emergency-target and baseline context, without making the decision.",
    inputSchema: z.object({
      purchaseAmountCents: z.number().int().positive().max(100_000_000_00),
      baselineMonths: z.number().int().min(1).max(12).default(3),
    }),
    execute(input, snapshot) {
      const value = z
        .object({
          purchaseAmountCents: z
            .number()
            .int()
            .positive()
            .max(100_000_000_00),
          baselineMonths: z.number().int().min(1).max(12).default(3),
        })
        .parse(input);
      return calculatePurchaseScenario(
        snapshot,
        value.purchaseAmountCents,
        snapshot.generatedAt,
        value.baselineMonths,
      );
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
    data: minimizeToolResult(tool.execute(parsedInput, snapshot)),
    computedAt: snapshot.generatedAt.toISOString(),
    dataSource: snapshot.dataSource,
  };
}
