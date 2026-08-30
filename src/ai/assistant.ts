import type { FinancialChange } from "@/domain/insights";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";
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
  | "MONEY"
  | "CATEGORY"
  | "MERCHANT"
  | "SPENDING_COMPARE"
  | "SUBSCRIPTIONS"
  | "PRICE_CHANGES"
  | "RECURRING"
  | "SAVINGS"
  | "INCOME"
  | "INCOME_STREAMS"
  | "INCOME_COMPARE"
  | "CONTRIBUTIONS"
  | "PERFORMANCE"
  | "DIVIDENDS"
  | "HOLDING"
  | "PORTFOLIO"
  | "EXPENSES"
  | "PURCHASE"
  | "NET_WORTH"
  | "GOAL"
  | "GOAL_SCENARIO"
  | "CHANGES";

export interface AssistantPlan {
  intent: AssistantIntent;
  calls: PlannedToolCall[];
  category?: string;
  merchant?: string;
  purchaseAmountCents?: number;
  goalName?: string;
  monthlyContributionCents?: number;
}

export interface AssistantPlanner {
  plan(question: string, context: FinancialToolContext): Promise<AssistantPlan>;
}

function parseCurrency(question: string): number | undefined {
  const match = question.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined;
}

function yearRange(date: Date) {
  return {
    from: new Date(date.getFullYear(), 0, 1).toISOString(),
    to: date.toISOString(),
  };
}

function parseMerchant(question: string): string | undefined {
  const known = ["amazon", "chipotle", "spotify", "netflix", "costco"];
  const match = known.find((merchant) => question.toLowerCase().includes(merchant));
  return match ? match.charAt(0).toUpperCase() + match.slice(1) : undefined;
}

export class DeterministicToolPlanner implements AssistantPlanner {
  async plan(question: string, context: FinancialToolContext): Promise<AssistantPlan> {
    const normalized = question.toLowerCase();
    const amountCents = parseCurrency(question);

    if (amountCents && /afford|purchase|buy/.test(normalized)) {
      return {
        intent: "PURCHASE",
        purchaseAmountCents: amountCents,
        calls: [{
          name: "calculatePurchaseScenario",
          input: { purchaseAmountCents: amountCents, baselineMonths: 3 },
        }],
      };
    }
    if (/subscription|bill/.test(normalized) && /increase|price|more|change/.test(normalized)) {
      return {
        intent: "PRICE_CHANGES",
        calls: [{ name: "getSubscriptionChanges", input: {} }],
      };
    }
    if (/subscription/.test(normalized)) {
      return {
        intent: "SUBSCRIPTIONS",
        calls: [{ name: "getSubscriptions", input: { status: "ACTIVE" } }],
      };
    }
    if (/recurring/.test(normalized)) {
      return {
        intent: "RECURRING",
        calls: [{ name: "getRecurringExpenses", input: { status: "ACTIVE" } }],
      };
    }
    if (/why.*spend|spending higher|spend more|compared.*spend/.test(normalized)) {
      return {
        intent: "SPENDING_COMPARE",
        calls: [{ name: "compareSpendingPeriods", input: { monthsAgo: 0 } }],
      };
    }

    const merchant = parseMerchant(question);
    if (merchant && /spend|spent|transaction/.test(normalized)) {
      return {
        intent: "MERCHANT",
        merchant,
        calls: [{
          name: "searchTransactions",
          input: { query: merchant, monthsAgo: 0, includePending: false, limit: 100 },
        }],
      };
    }
    if (/food|dining|eat(ing)? out|restaurant/.test(normalized)) {
      return {
        intent: "CATEGORY",
        category: /food/.test(normalized) ? "Food and dining" : "Dining",
        calls: [{ name: "getSpendingByCategory", input: { monthsAgo: 0 } }],
      };
    }
    if (/where.*money go|where did most|spending categor/.test(normalized)) {
      return {
        intent: "CATEGORY",
        calls: [{ name: "getSpendingByCategory", input: { monthsAgo: 0 } }],
      };
    }
    if (/biggest expense|largest expense|top expense/.test(normalized)) {
      return {
        intent: "EXPENSES",
        calls: [{ name: "getLargestExpenses", input: { monthsAgo: 0, limit: 5 } }],
      };
    }
    if (/actually save|saved|savings rate|cash flow/.test(normalized)) {
      return {
        intent: "SAVINGS",
        calls: [{ name: "getCashFlow", input: { monthsAgo: 0 } }],
      };
    }
    if (/dividend/.test(normalized)) {
      const snapshot = await context.getSnapshot();
      return {
        intent: "DIVIDENDS",
        calls: [{ name: "getDividends", input: yearRange(snapshot.generatedAt) }],
      };
    }
    if (/income stream|where.*money come|income source|recurring income|variable income/.test(normalized)) {
      return {
        intent: "INCOME_STREAMS",
        calls: [{ name: "getIncomeStreams", input: {} }],
      };
    }
    if (/income.*change|income.*compared|make more|made more/.test(normalized)) {
      return {
        intent: "INCOME_COMPARE",
        calls: [{ name: "compareIncomePeriods", input: { monthsAgo: 0 } }],
      };
    }
    if (/income|salary|freelance|side income|money did i make|earn/.test(normalized)) {
      return {
        intent: "INCOME",
        calls: [{ name: "getIncome", input: { monthsAgo: 0 } }],
      };
    }

    const snapshot = await context.getSnapshot();
    if (/contribut|deposited.*invest/.test(normalized)) {
      return {
        intent: "CONTRIBUTIONS",
        calls: [{ name: "getInvestmentContributions", input: yearRange(snapshot.generatedAt) }],
      };
    }
    if (/actually gain|investment return|performance|market gain|gain.*invest/.test(normalized)) {
      return {
        intent: "PERFORMANCE",
        calls: [{
          name: "getInvestmentPerformance",
          input: { monthsAgo: 0, allTime: true },
        }],
      };
    }
    if (/apple|aapl/.test(normalized)) {
      return {
        intent: "HOLDING",
        calls: [{ name: "getHolding", input: { ticker: "AAPL" } }],
      };
    }
    if (/portfolio|(largest|biggest).*(stock|position|holding)|concentrat|allocation/.test(normalized)) {
      return {
        intent: "PORTFOLIO",
        calls: [{ name: "getPortfolio", input: {} }],
      };
    }
    if (/goal|emergency fund|car goal/.test(normalized)) {
      const matchedGoal =
        snapshot.goals.find((goal) => normalized.includes(goal.name.toLowerCase())) ??
        snapshot.goals.find((goal) => goal.type === "CAR" && /car/.test(normalized));
      if (amountCents && /month|monthly|contribute|save/.test(normalized) && matchedGoal) {
        return {
          intent: "GOAL_SCENARIO",
          goalName: matchedGoal.name,
          monthlyContributionCents: amountCents,
          calls: [{
            name: "calculateGoalScenario",
            input: {
              goalId: matchedGoal.id,
              monthlyContributionCents: amountCents,
              annualReturnPercent: 0,
            },
          }],
        };
      }
      return {
        intent: "GOAL",
        goalName: matchedGoal?.name,
        calls: [{ name: "getGoals", input: {} }],
      };
    }
    if (/how much money do i have|where.*money|account balance/.test(normalized)) {
      return {
        intent: "MONEY",
        calls: [{ name: "getAccounts", input: {} }, { name: "getNetWorth", input: {} }],
      };
    }
    if (/net worth|assets|liabilit/.test(normalized)) {
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

interface CategoryResult {
  totalCents: number;
  byCategory: Array<{ category: string; amountCents: number; share: number }>;
}

interface CashFlowResult {
  summary: {
    incomeCents: number;
    spendingCents: number;
    debtPaymentsCents: number;
    investmentContributionsCents: number;
    netSavingsCents: number;
    savingsRate: number;
  };
}

interface IncomeResult {
  totalCents: number;
  recurringCents: number;
  sideIncomeCents: number;
  investmentIncomeCents: number;
  bySource: Array<{ source: string; type: string; amountCents: number }>;
}

interface RecurringResult {
  merchant: string;
  amountCents: number;
  averageAmountCents: number;
  annualizedCents: number;
  frequency: string;
  confidence: number;
}

interface PortfolioPosition {
  ticker: string;
  name: string;
  currentValueCents: number;
  weight: number;
}

function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items.at(-1);
}

function signedDirection(cents: number): string {
  return cents >= 0 ? "up" : "down";
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
  const reply = (
    answer: string,
    calculation?: string[],
    note?: string,
  ): AssistantReply => ({ answer, calculation, toolsUsed, dataSource, note });

  switch (plan.intent) {
    case "MONEY": {
      const accounts = results[0].data as Array<{
        name: string;
        balanceCents: number;
        isLiability: boolean;
      }>;
      const worth = results[1].data as {
        current: {
          cashCents: number;
          investmentsCents: number;
          liabilitiesCents: number;
          netWorthCents: number;
        };
      };
      return reply(
        "You have " +
          formatCurrency(worth.current.cashCents) +
          " in tracked cash and " +
          formatCurrency(worth.current.investmentsCents) +
          " in investments. After " +
          formatCurrency(worth.current.liabilitiesCents) +
          " of liabilities, your net worth is " +
          formatCurrency(worth.current.netWorthCents) +
          ".",
        accounts.map(
          (account) =>
            account.name +
            ": " +
            formatCurrency(account.balanceCents) +
            (account.isLiability ? " liability" : ""),
        ),
      );
    }
    case "CATEGORY": {
      const spending = results[0].data as CategoryResult;
      let selected = spending.byCategory;
      if (plan.category === "Dining") {
        selected = selected.filter((item) => item.category === "Dining");
      }
      if (plan.category === "Food and dining") {
        selected = selected.filter(
          (item) => item.category === "Food" || item.category === "Dining",
        );
      }
      if (!plan.category) {
        const top = spending.byCategory.slice(0, 3);
        return reply(
          "Most of your settled spending this month went to " +
            joinNames(top.map((item) => item.category)) +
            ". Total spending net of refunds was " +
            formatCurrency(spending.totalCents) +
            ".",
          top.map(
            (item) =>
              item.category +
              ": " +
              formatCurrency(item.amountCents) +
              " (" +
              formatPercent(item.share) +
              ")",
          ),
        );
      }
      const amount = selected.reduce((sum, item) => sum + item.amountCents, 0);
      return reply(
        "You spent " +
          formatCurrency(amount) +
          " on " +
          plan.category.toLowerCase() +
          " this month. Pending transactions are excluded and refunds reduce spending.",
        selected.map(
          (item) => item.category + ": " + formatCurrency(item.amountCents),
        ),
      );
    }
    case "MERCHANT": {
      const transactions = results[0].data as Array<{
        merchant: string;
        amountCents: number;
        type: string;
      }>;
      const amount = transactions.reduce(
        (sum, transaction) =>
          sum +
          (transaction.type === "REFUND"
            ? -Math.abs(transaction.amountCents)
            : Math.abs(transaction.amountCents)),
        0,
      );
      return reply(
        "You spent " +
          formatCurrency(Math.max(0, amount)) +
          " at " +
          plan.merchant +
          " this month across " +
          transactions.length +
          " settled transaction" +
          (transactions.length === 1 ? "" : "s") +
          ".",
        transactions.map(
          (transaction) =>
            transaction.merchant + ": " + formatCurrency(transaction.amountCents),
        ),
      );
    }
    case "SPENDING_COMPARE": {
      const comparison = results[0].data as {
        current: { spendingCents: number };
        previous: { spendingCents: number };
        spendingChangeCents: number;
        spendingChangePercent: number;
        categoryChanges: Array<{ category: string; changeCents: number }>;
      };
      const drivers = comparison.categoryChanges
        .filter((item) => item.changeCents > 0)
        .slice(0, 3);
      return reply(
        "Spending was " +
          signedDirection(comparison.spendingChangeCents) +
          " " +
          formatCurrency(Math.abs(comparison.spendingChangeCents)) +
          " this month (" +
          formatPercent(Math.abs(comparison.spendingChangePercent)) +
          "). The largest increases were " +
          (drivers.length
            ? joinNames(drivers.map((item) => item.category))
            : "not material enough to rank") +
          ".",
        [
          "Current: " + formatCurrency(comparison.current.spendingCents),
          "Previous: " + formatCurrency(comparison.previous.spendingCents),
          ...drivers.map(
            (item) => item.category + ": " + formatSignedCurrency(item.changeCents),
          ),
        ],
      );
    }
    case "SUBSCRIPTIONS":
    case "RECURRING": {
      const recurring = results[0].data as RecurringResult[];
      const annual = recurring.reduce(
        (sum, item) => sum + item.annualizedCents,
        0,
      );
      const noun =
        plan.intent === "SUBSCRIPTIONS"
          ? "active subscriptions"
          : "active recurring expenses";
      return reply(
        "You have " +
          recurring.length +
          " " +
          noun +
          " totaling about " +
          formatCurrency(Math.round(annual / 12)) +
          " per month (" +
          formatCurrency(annual) +
          " annualized).",
        recurring.map(
          (item) =>
            item.merchant +
            ": " +
            formatCurrency(item.averageAmountCents || item.amountCents) +
            " " +
            item.frequency.toLowerCase() +
            ", " +
            formatPercent(item.confidence) +
            " confidence",
        ),
      );
    }
    case "PRICE_CHANGES": {
      const changes = results[0].data as Array<{
        merchant: string;
        previousAmountCents: number;
        amountCents: number;
        increaseCents: number;
        increasePercent: number;
        annualImpactCents: number;
      }>;
      if (!changes.length) {
        return reply("No material recurring price increases were detected.");
      }
      return reply(
        changes
          .map(
            (item) =>
              item.merchant +
              " increased from " +
              formatCurrency(item.previousAmountCents) +
              " to " +
              formatCurrency(item.amountCents) +
              ".",
          )
          .join(" "),
        changes.map(
          (item) =>
            item.merchant +
            ": +" +
            formatCurrency(item.increaseCents) +
            " (" +
            formatPercent(item.increasePercent) +
            "), about +" +
            formatCurrency(item.annualImpactCents) +
            "/year",
        ),
      );
    }
    case "SAVINGS": {
      const summary = (results[0].data as CashFlowResult).summary;
      return reply(
        "You retained " +
          formatCurrency(summary.netSavingsCents) +
          " this month after settled spending and debt payments, a " +
          formatPercent(summary.savingsRate) +
          " savings rate. Of that retained amount, " +
          formatCurrency(summary.investmentContributionsCents) +
          " was allocated to investments. Internal transfers and credit-card payments are not double-counted.",
        [
          formatCurrency(summary.incomeCents) + " income",
          "- " + formatCurrency(summary.spendingCents) + " spending",
          "- " + formatCurrency(summary.debtPaymentsCents) + " debt payments",
          "= " + formatCurrency(summary.netSavingsCents) + " retained",
          formatCurrency(summary.investmentContributionsCents) +
            " of retained savings allocated to investments",
        ],
      );
    }
    case "INCOME": {
      const income = results[0].data as IncomeResult;
      return reply(
        "You received " +
          formatCurrency(income.totalCents) +
          " this month: " +
          formatCurrency(income.recurringCents) +
          " recurring, " +
          formatCurrency(income.sideIncomeCents) +
          " side income, and " +
          formatCurrency(income.investmentIncomeCents) +
          " investment income.",
        income.bySource.map(
          (source) =>
            source.source +
            " (" +
            source.type.toLowerCase() +
            "): " +
            formatCurrency(source.amountCents),
        ),
      );
    }
    case "INCOME_STREAMS": {
      const streams = results[0].data as Array<{
        name: string;
        type: string;
        averageAmountCents: number;
        isRecurring: boolean;
      }>;
      if (!streams.length) {
        return reply("No income streams are currently detected.");
      }
      return reply(
        "Your tracked income comes from " +
          joinNames(streams.map((stream) => stream.name)) +
          ". " +
          streams.filter((stream) => stream.isRecurring).length +
          " of " +
          streams.length +
          " streams are recurring.",
        streams.map(
          (stream) =>
            stream.name +
            " (" +
            stream.type.toLowerCase() +
            "): average " +
            formatCurrency(stream.averageAmountCents) +
            (stream.isRecurring ? ", recurring" : ", variable"),
        ),
      );
    }
    case "INCOME_COMPARE": {
      const comparison = results[0].data as {
        current: { totalCents: number };
        previous: { totalCents: number };
        changeCents: number;
        changePercent: number;
      };
      return reply(
        "Income was " +
          signedDirection(comparison.changeCents) +
          " " +
          formatCurrency(Math.abs(comparison.changeCents)) +
          " this month (" +
          formatPercent(Math.abs(comparison.changePercent)) +
          ").",
        [
          "Current: " + formatCurrency(comparison.current.totalCents),
          "Previous: " + formatCurrency(comparison.previous.totalCents),
        ],
      );
    }
    case "CONTRIBUTIONS": {
      const result = results[0].data as { totalCents: number };
      return reply(
        "You contributed " +
          formatCurrency(result.totalCents) +
          " to investments this year. Contributions are deposits, not investment returns.",
      );
    }
    case "PERFORMANCE": {
      const result = results[0].data as {
        investmentGainLossCents: number | null;
        realizedGainCents: number | null;
        unrealizedGainCents: number | null;
        dividendsCents: number;
        feesCents: number;
        contributionsCents: number;
        notes: string[];
      };
      if (result.investmentGainLossCents === null) {
        return reply(
          "Investment gain/loss cannot be calculated reliably because cost-basis data is incomplete.",
          result.notes,
          "MoneyOS does not fabricate missing cost basis.",
        );
      }
      return reply(
        "Your tracked investments gained " +
          formatCurrency(result.investmentGainLossCents) +
          " excluding contributions and dividends.",
        [
          "Contributions: " + formatCurrency(result.contributionsCents),
          "Realized gain/loss: " + formatCurrency(result.realizedGainCents ?? 0),
          "Unrealized gain/loss: " +
            formatCurrency(result.unrealizedGainCents ?? 0),
          "Fees: -" + formatCurrency(result.feesCents),
        ],
        "Tracked prices may be demo prices and are not live quotes.",
      );
    }
    case "DIVIDENDS": {
      const result = results[0].data as {
        totalCents: number;
        activity: unknown[];
      };
      return reply(
        "You received " +
          formatCurrency(result.totalCents) +
          " in dividends and investment interest this year across " +
          result.activity.length +
          " payment" +
          (result.activity.length === 1 ? "" : "s") +
          ".",
      );
    }
    case "HOLDING": {
      const holding = results[0].data as PortfolioPosition | null;
      if (!holding) {
        return reply("Apple is not present in the tracked portfolio.");
      }
      return reply(
        holding.name +
          " (" +
          holding.ticker +
          ") is " +
          formatPercent(holding.weight) +
          " of your portfolio, worth " +
          formatCurrency(holding.currentValueCents) +
          ".",
        undefined,
        "This is descriptive portfolio analytics, not a recommendation.",
      );
    }
    case "PORTFOLIO": {
      const portfolio = results[0].data as {
        valueCents: number;
        positions: PortfolioPosition[];
        largestPosition?: PortfolioPosition;
        topFiveWeight: number;
        individualStockWeight: number;
        cashWeight: number;
        concentration: string;
      };
      if (!portfolio.positions.length) {
        return reply("No tracked portfolio positions are available.");
      }
      const largest = portfolio.largestPosition ?? portfolio.positions[0];
      return reply(
        "Your largest position is " +
          largest.name +
          " at " +
          formatPercent(largest.weight) +
          ". Your top five positions represent " +
          formatPercent(portfolio.topFiveWeight) +
          ", so the tracked portfolio is classified as " +
          portfolio.concentration.toLowerCase() +
          ".",
        [
          "Portfolio value: " + formatCurrency(portfolio.valueCents),
          "Individual stocks: " + formatPercent(portfolio.individualStockWeight),
          "Cash: " + formatPercent(portfolio.cashWeight),
        ],
        "Concentration is descriptive and is not advice to buy or sell.",
      );
    }
    case "EXPENSES": {
      const expenses = results[0].data as Array<{
        merchant: string;
        amountCents: number;
      }>;
      if (!expenses.length) {
        return reply("No settled expenses were found for this month.");
      }
      return reply(
        "Your largest settled expense this month was " +
          expenses[0].merchant +
          " at " +
          formatCurrency(expenses[0].amountCents) +
          ".",
        expenses.map(
          (item) => item.merchant + ": " + formatCurrency(item.amountCents),
        ),
      );
    }
    case "PURCHASE": {
      const scenario = results[0].data as {
        purchaseCents: number;
        cashBeforeCents: number;
        cashAfterCents: number;
        emergencyTargetCents: number;
        remainingAboveEmergencyTargetCents: number;
        averageMonthlyIncomeCents: number;
        averageMonthlySpendingCents: number;
        averageMonthlyDebtPaymentsCents: number;
        currentDebtCents: number;
        assumptions: string[];
      };
      const reservePosition =
        scenario.remainingAboveEmergencyTargetCents >= 0
          ? formatCurrency(scenario.remainingAboveEmergencyTargetCents) + " above"
          : formatCurrency(
              Math.abs(scenario.remainingAboveEmergencyTargetCents),
            ) + " below";
      return reply(
        "A " +
          formatCurrency(scenario.purchaseCents) +
          " purchase would move tracked cash from " +
          formatCurrency(scenario.cashBeforeCents) +
          " to " +
          formatCurrency(scenario.cashAfterCents) +
          ". That leaves you " +
          reservePosition +
          " your " +
          formatCurrency(scenario.emergencyTargetCents) +
          " emergency-fund target.",
        [
          "Average monthly income: " +
            formatCurrency(scenario.averageMonthlyIncomeCents),
          "Average monthly spending: " +
            formatCurrency(scenario.averageMonthlySpendingCents),
          "Average monthly debt payments: " +
            formatCurrency(scenario.averageMonthlyDebtPaymentsCents),
          "Current debt: " + formatCurrency(scenario.currentDebtCents),
        ],
        "This scenario does not decide affordability or forecast future income. " +
          scenario.assumptions.join(" "),
      );
    }
    case "NET_WORTH": {
      const worth = results[0].data as {
        current: {
          assetsCents: number;
          liabilitiesCents: number;
          netWorthCents: number;
          cashCents: number;
          investmentsCents: number;
        };
        history: Array<{ netWorthCents: number }>;
      };
      const previous = worth.history.at(-2)?.netWorthCents;
      const change =
        previous === undefined
          ? undefined
          : worth.current.netWorthCents - previous;
      return reply(
        "Your net worth is " +
          formatCurrency(worth.current.netWorthCents) +
          ": " +
          formatCurrency(worth.current.assetsCents) +
          " in assets less " +
          formatCurrency(worth.current.liabilitiesCents) +
          " in liabilities." +
          (change === undefined
            ? ""
            : " It is " +
              signedDirection(change) +
              " " +
              formatCurrency(Math.abs(change)) +
              " from the previous snapshot."),
        [
          "Cash: " + formatCurrency(worth.current.cashCents),
          "Investments: " + formatCurrency(worth.current.investmentsCents),
          "Liabilities: " + formatCurrency(worth.current.liabilitiesCents),
        ],
      );
    }
    case "GOAL": {
      const goals = results[0].data as Array<{
        name: string;
        currentAmountCents: number;
        targetAmountCents: number;
        remainingCents: number;
        progress: number;
        averageContributionCents: number;
        estimatedCompletion?: string;
      }>;
      const goal = goals.find(
        (item) => !plan.goalName || item.name === plan.goalName,
      );
      if (!goal) {
        return reply("No matching goal was found in your MoneyOS data.");
      }
      return reply(
        goal.name +
          " is " +
          formatPercent(goal.progress) +
          " complete: " +
          formatCurrency(goal.currentAmountCents) +
          " of " +
          formatCurrency(goal.targetAmountCents) +
          ", with " +
          formatCurrency(goal.remainingCents) +
          " remaining.",
        [
          "Average recorded contribution: " +
            formatCurrency(goal.averageContributionCents) +
            "/month",
          "Estimated completion: " +
            (goal.estimatedCompletion
              ? new Date(goal.estimatedCompletion).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })
              : "not available"),
        ],
      );
    }
    case "GOAL_SCENARIO": {
      const scenario = results[0].data as {
        goal: {
          name: string;
          currentAmountCents: number;
          targetAmountCents: number;
        };
        monthlyContributionCents: number;
        monthsRemaining: number | null;
        estimatedCompletion?: string;
        annualReturnPercent: number;
      } | null;
      if (!scenario || scenario.monthsRemaining === null) {
        return reply(
          "That goal scenario cannot be calculated from the available data.",
        );
      }
      const completion = scenario.estimatedCompletion
        ? new Date(scenario.estimatedCompletion).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
        : "an unknown date";
      return reply(
        "At " +
          formatCurrency(scenario.monthlyContributionCents) +
          " per month, you would reach " +
          scenario.goal.name +
          " in about " +
          scenario.monthsRemaining +
          " months, around " +
          completion +
          ".",
        [
          formatCurrency(
            scenario.goal.targetAmountCents - scenario.goal.currentAmountCents,
          ) + " remaining",
          formatCurrency(scenario.monthlyContributionCents) + "/month",
          "Assumed return: " +
            scenario.annualReturnPercent.toFixed(1) +
            "%",
        ],
        "This is a zero-return savings projection unless a return assumption is explicitly selected.",
      );
    }
    case "CHANGES":
    default: {
      const changes = results[0].data as FinancialChange[];
      const top = changes.slice(0, 5);
      return reply(
        top.length
          ? "The most meaningful changes this month: " +
              top.map((change) => change.title).join("; ") +
              "."
          : "No material financial changes were detected for the current comparison period.",
        top.map((change) => change.detail),
      );
    }
  }
}
