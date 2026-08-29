import type { FinancialChange } from "@/domain/insights";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  executeFinancialTool,
  type FinancialToolContext,
  type FinancialToolName,
} from "@/ai/tool-registry";

export interface PlannedToolCall {
  name: FinancialToolName;
  input: Record<string, unknown>;
}

type AssistantIntent =
  | "CHANGES"
  | "DINING"
  | "SUBSCRIPTIONS"
  | "BILL_CHANGES"
  | "SAVINGS"
  | "INCOME"
  | "CONTRIBUTIONS"
  | "PORTFOLIO"
  | "EXPENSES"
  | "PURCHASE"
  | "NET_WORTH";

export interface AssistantPlan {
  intent: AssistantIntent;
  calls: PlannedToolCall[];
  purchaseAmountCents?: number;
}

export interface AssistantPlanner {
  plan(question: string, context: FinancialToolContext): Promise<AssistantPlan>;
}

function parsePurchaseAmount(question: string): number | undefined {
  const match = question.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined;
}

export class DeterministicToolPlanner implements AssistantPlanner {
  async plan(question: string, context: FinancialToolContext): Promise<AssistantPlan> {
    const normalized = question.toLowerCase();
    const purchaseAmountCents = parsePurchaseAmount(question);

    if (purchaseAmountCents && /afford|purchase|buy/.test(normalized)) {
      return {
        intent: "PURCHASE",
        purchaseAmountCents,
        calls: [
          { name: "getAccountBalances", input: {} },
          { name: "getGoals", input: {} },
          { name: "calculateCashFlow", input: { monthsAgo: 0 } },
        ],
      };
    }
    if (/subscription|recurring charge/.test(normalized)) {
      return {
        intent: "SUBSCRIPTIONS",
        calls: [{ name: "getRecurringExpenses", input: { status: "ACTIVE" } }],
      };
    }
    if (/bill.*(increase|change)|price increase|cost more/.test(normalized)) {
      return {
        intent: "BILL_CHANGES",
        calls: [{ name: "getSubscriptionChanges", input: {} }],
      };
    }
    if (/eat(ing)? out|dining|restaurant/.test(normalized)) {
      return {
        intent: "DINING",
        calls: [{ name: "getSpendingByCategory", input: { monthsAgo: 0 } }],
      };
    }
    if (/actually save|saved|savings rate|cash flow/.test(normalized)) {
      return {
        intent: "SAVINGS",
        calls: [{ name: "calculateCashFlow", input: { monthsAgo: 0 } }],
      };
    }
    if (/income|salary|freelance|side income|earn/.test(normalized)) {
      return {
        intent: "INCOME",
        calls: [{ name: "getIncome", input: { monthsAgo: 0 } }],
      };
    }
    if (/contribut|investment activity|invested this year/.test(normalized)) {
      const snapshot = await context.getSnapshot();
      const from = new Date(snapshot.generatedAt.getFullYear(), 0, 1).toISOString();
      return {
        intent: "CONTRIBUTIONS",
        calls: [
          {
            name: "getInvestmentActivity",
            input: { from, to: snapshot.generatedAt.toISOString(), type: "CONTRIBUTION" },
          },
        ],
      };
    }
    if (/portfolio|apple|aapl|allocation|largest position|concentration/.test(normalized)) {
      return {
        intent: "PORTFOLIO",
        calls: [{ name: "getPortfolioAllocation", input: {} }],
      };
    }
    if (/biggest expense|largest expense|top merchant|spent the most/.test(normalized)) {
      return {
        intent: "EXPENSES",
        calls: [{ name: "getSpendingByMerchant", input: { monthsAgo: 0 } }],
      };
    }
    if (/net worth|where.*money|assets|liabilities/.test(normalized)) {
      return {
        intent: "NET_WORTH",
        calls: [{ name: "getNetWorth", input: {} }],
      };
    }
    return {
      intent: "CHANGES",
      calls: [{ name: "getWhatChanged", input: {} }],
    };
  }
}

export interface AssistantReply {
  answer: string;
  calculation?: string[];
  toolsUsed: FinancialToolName[];
  dataSource: "DEMO" | "DATABASE";
  note?: string;
}

interface SpendingResult {
  totalCents: number;
  byCategory: Array<{ category: string; amountCents: number; share: number }>;
}

interface IncomeResult {
  totalCents: number;
  recurringCents: number;
  sideIncomeCents: number;
  investmentIncomeCents: number;
  bySource: Array<{ source: string; type: string; amountCents: number; share: number }>;
}

interface CashFlowResult {
  summary: {
    incomeCents: number;
    spendingCents: number;
    debtPaymentsCents: number;
    netSavingsCents: number;
    savingsRate: number;
  };
}

interface AccountResult {
  name: string;
  type: string;
  balanceCents: number;
  availableBalanceCents?: number;
}

interface GoalResult {
  type: string;
  name: string;
  currentAmountCents: number;
}

interface PortfolioResult {
  valueCents: number;
  positions: Array<{
    ticker: string;
    name: string;
    currentValueCents: number;
    weight: number;
    gainCents: number;
  }>;
}

interface RecurringResult {
  merchant: string;
  amountCents: number;
  annualizedCents: number;
  category: string;
  isSubscription: boolean;
}

interface PriceChangeResult {
  merchant: string;
  previousAmountCents: number;
  amountCents: number;
  increaseCents: number;
  increasePercent: number;
}

interface MerchantResult {
  merchant: string;
  amountCents: number;
  transactionCount: number;
}

interface NetWorthResult {
  current: {
    assetsCents: number;
    liabilitiesCents: number;
    netWorthCents: number;
    cashCents: number;
    investmentsCents: number;
  };
  history: Array<{ netWorthCents: number }>;
}

function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export async function askFinancialAssistant(
  question: string,
  context: FinancialToolContext,
  planner: AssistantPlanner = new DeterministicToolPlanner(),
): Promise<AssistantReply> {
  const plan = await planner.plan(question, context);
  const results = await Promise.all(
    plan.calls.map((call) => executeFinancialTool(context, call.name, call.input)),
  );
  const toolsUsed = results.map((result) => result.tool);
  const dataSource = results[0]?.dataSource ?? "DEMO";

  switch (plan.intent) {
    case "DINING": {
      const spending = results[0].data as SpendingResult;
      const dining = spending.byCategory.find((item) => item.category === "Dining");
      const amount = dining?.amountCents ?? 0;
      return {
        answer: `You spent ${formatCurrency(amount)} on dining this month. Pending charges are excluded, and refunds are netted against their original categories.`,
        calculation: [`Dining transactions: ${formatCurrency(amount)}`, `Share of spending: ${formatPercent(dining?.share ?? 0)}`],
        toolsUsed,
        dataSource,
      };
    }
    case "SUBSCRIPTIONS": {
      const recurring = (results[0].data as RecurringResult[]).filter((item) => item.isSubscription);
      const monthlyCents = recurring.reduce((sum, item) => sum + item.annualizedCents / 12, 0);
      return {
        answer: `You have ${recurring.length} active subscriptions totaling about ${formatCurrency(monthlyCents)} per month: ${joinNames(recurring.map((item) => item.merchant))}.`,
        calculation: recurring.map((item) => `${item.merchant}: ${formatCurrency(item.amountCents)}`),
        toolsUsed,
        dataSource,
      };
    }
    case "BILL_CHANGES": {
      const changes = results[0].data as PriceChangeResult[];
      if (changes.length === 0) {
        return { answer: "No material recurring price increases were detected.", toolsUsed, dataSource };
      }
      return {
        answer: changes
          .map(
            (change) =>
              `${change.merchant} increased from ${formatCurrency(change.previousAmountCents)} to ${formatCurrency(change.amountCents)}.`,
          )
          .join(" "),
        calculation: changes.map(
          (change) =>
            `${change.merchant}: +${formatCurrency(change.increaseCents)} (${formatPercent(change.increasePercent)})`,
        ),
        toolsUsed,
        dataSource,
      };
    }
    case "SAVINGS": {
      const cashFlow = results[0].data as CashFlowResult;
      const summary = cashFlow.summary;
      return {
        answer: `You retained ${formatCurrency(summary.netSavingsCents)} this month after settled spending and debt payments, a ${formatPercent(summary.savingsRate)} savings rate. Transfers between your own accounts and credit-card payments are not double-counted.`,
        calculation: [
          `${formatCurrency(summary.incomeCents)} income`,
          `- ${formatCurrency(summary.spendingCents)} spending`,
          `- ${formatCurrency(summary.debtPaymentsCents)} debt payments`,
          `= ${formatCurrency(summary.netSavingsCents)} retained`,
        ],
        toolsUsed,
        dataSource,
      };
    }
    case "INCOME": {
      const income = results[0].data as IncomeResult;
      return {
        answer: `You received ${formatCurrency(income.totalCents)} this month. ${formatCurrency(income.recurringCents)} came from recurring income, ${formatCurrency(income.sideIncomeCents)} from side income, and ${formatCurrency(income.investmentIncomeCents)} from investments.`,
        calculation: income.bySource.map(
          (source) => `${source.source} (${source.type.toLowerCase()}): ${formatCurrency(source.amountCents)}`,
        ),
        toolsUsed,
        dataSource,
      };
    }
    case "CONTRIBUTIONS": {
      const activity = results[0].data as { totalContributionsCents: number };
      return {
        answer: `You contributed ${formatCurrency(activity.totalContributionsCents)} to investments this year. That figure is contributions only; dividends and market gains are excluded.`,
        toolsUsed,
        dataSource,
      };
    }
    case "PORTFOLIO": {
      const portfolio = results[0].data as PortfolioResult;
      const apple = portfolio.positions.find((position) => position.ticker === "AAPL");
      const largest = portfolio.positions[0];
      return {
        answer: apple
          ? `Apple is ${formatPercent(apple.weight)} of your ${formatCurrency(portfolio.valueCents)} portfolio, worth ${formatCurrency(apple.currentValueCents)}. Your largest position is ${largest.name} at ${formatPercent(largest.weight)}.`
          : `Apple is not currently in the tracked portfolio. Your largest position is ${largest.name} at ${formatPercent(largest.weight)}.`,
        calculation: portfolio.positions.slice(0, 5).map(
          (position) => `${position.ticker}: ${formatCurrency(position.currentValueCents)} (${formatPercent(position.weight)})`,
        ),
        toolsUsed,
        dataSource,
        note: "Portfolio values use tracked prices; demo prices are not live market quotes.",
      };
    }
    case "EXPENSES": {
      const merchants = results[0].data as MerchantResult[];
      const top = merchants.slice(0, 5);
      return {
        answer: `Your biggest settled expenses this month were ${joinNames(top.slice(0, 3).map((item) => item.merchant))}.`,
        calculation: top.map(
          (merchant) => `${merchant.merchant}: ${formatCurrency(merchant.amountCents)} across ${merchant.transactionCount} transaction${merchant.transactionCount === 1 ? "" : "s"}`,
        ),
        toolsUsed,
        dataSource,
      };
    }
    case "PURCHASE": {
      const accounts = results[0].data as AccountResult[];
      const goals = results[1].data as GoalResult[];
      const cashFlow = results[2].data as CashFlowResult;
      const checkingCents = accounts
        .filter((account) => account.type === "CHECKING" || account.type === "CASH")
        .reduce(
          (sum, account) => sum + (account.availableBalanceCents ?? account.balanceCents),
          0,
        );
      const savingsCents = accounts
        .filter((account) => account.type === "SAVINGS")
        .reduce((sum, account) => sum + account.balanceCents, 0);
      const emergencyReserveCents = goals
        .filter((goal) => goal.type === "EMERGENCY_FUND")
        .reduce((sum, goal) => sum + goal.currentAmountCents, 0);
      const usableCashCents = checkingCents + Math.max(0, savingsCents - emergencyReserveCents);
      const purchaseAmountCents = plan.purchaseAmountCents ?? 0;
      const remainingCents = usableCashCents - purchaseAmountCents;
      const canAfford = remainingCents >= 0;
      return {
        answer: canAfford
          ? `Based on current liquid cash, you could cover ${formatCurrency(purchaseAmountCents)} without using the amount currently assigned to your emergency fund, leaving about ${formatCurrency(remainingCents)} outside that reserve.`
          : `Based on current liquid cash, a ${formatCurrency(purchaseAmountCents)} purchase would require about ${formatCurrency(Math.abs(remainingCents))} from the amount currently assigned to your emergency fund or another source.`,
        calculation: [
          `${formatCurrency(checkingCents)} available checking and cash`,
          `+ ${formatCurrency(savingsCents)} savings`,
          `- ${formatCurrency(emergencyReserveCents)} assigned emergency reserve`,
          `= ${formatCurrency(usableCashCents)} available without that reserve`,
          `Current monthly retained cash flow: ${formatCurrency(cashFlow.summary.netSavingsCents)}`,
        ],
        toolsUsed,
        dataSource,
        note: "This is a cash-position calculation, not financial advice. It does not forecast emergencies or future income.",
      };
    }
    case "NET_WORTH": {
      const worth = results[0].data as NetWorthResult;
      const previous = worth.history.at(-2)?.netWorthCents;
      const change = previous === undefined ? undefined : worth.current.netWorthCents - previous;
      return {
        answer: `Your net worth is ${formatCurrency(worth.current.netWorthCents)}: ${formatCurrency(worth.current.assetsCents)} in assets less ${formatCurrency(worth.current.liabilitiesCents)} in liabilities.${change === undefined ? "" : ` It changed ${change >= 0 ? "up" : "down"} ${formatCurrency(Math.abs(change))} from the previous snapshot.`}`,
        calculation: [
          `Cash: ${formatCurrency(worth.current.cashCents)}`,
          `Investments: ${formatCurrency(worth.current.investmentsCents)}`,
          `Liabilities: ${formatCurrency(worth.current.liabilitiesCents)}`,
        ],
        toolsUsed,
        dataSource,
      };
    }
    case "CHANGES":
    default: {
      const changes = results[0].data as FinancialChange[];
      const top = changes.slice(0, 3);
      return {
        answer:
          top.length === 0
            ? "No material financial changes were detected for the current comparison period."
            : `The most meaningful changes this month: ${top.map((change) => change.title).join("; ")}.`,
        calculation: top.map((change) => change.detail),
        toolsUsed,
        dataSource,
      };
    }
  }
}
