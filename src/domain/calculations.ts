import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  isWithinInterval,
  startOfMonth,
  subMonths,
} from "date-fns";
import type {
  AccountRecord,
  CategoryName,
  DateRange,
  FinancialSnapshot,
  GoalContributionRecord,
  GoalRecord,
  HoldingRecord,
  InvestmentActivityRecord,
  RecurringFrequency,
  RecurringRecord,
  TransactionRecord,
} from "@/domain/types";

const NECESSITY_CATEGORIES = new Set<CategoryName>([
  "Housing",
  "Food",
  "Transportation",
  "Health",
  "Education",
  "Utilities",
  "Insurance",
]);

const WANT_CATEGORIES = new Set<CategoryName>([
  "Dining",
  "Shopping",
  "Entertainment",
  "Travel",
  "Subscriptions",
]);

export function getMonthRange(anchor = new Date(), monthsAgo = 0): DateRange {
  const date = subMonths(anchor, monthsAgo);
  return { from: startOfMonth(date), to: endOfMonth(date) };
}

export function inRange(date: Date, range: DateRange): boolean {
  return isWithinInterval(date, { start: range.from, end: range.to });
}

export function settledTransactions(
  transactions: TransactionRecord[],
  range?: DateRange,
): TransactionRecord[] {
  return transactions.filter(
    (transaction) =>
      !transaction.isPending && (!range || inRange(transaction.date, range)),
  );
}

export interface SpendingBreakdown {
  totalCents: number;
  byCategory: Array<{ category: CategoryName; amountCents: number; share: number }>;
}

export function calculateSpendingByCategory(
  transactions: TransactionRecord[],
  range: DateRange,
): SpendingBreakdown {
  const totals = new Map<CategoryName, number>();

  for (const transaction of settledTransactions(transactions, range)) {
    let effect = 0;
    if (transaction.transactionType === "EXPENSE") {
      effect = Math.abs(transaction.amountCents);
    } else if (transaction.transactionType === "REFUND") {
      effect = -Math.abs(transaction.amountCents);
    }

    if (effect !== 0) {
      totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + effect);
    }
  }

  // Refunds remain signed at the category level. Clamping each category before
  // summing would overstate total spending when a refund exceeds purchases.
  const totalCents = Math.max(
    0,
    [...totals.values()].reduce((sum, value) => sum + value, 0),
  );
  const byCategory = [...totals.entries()]
    .map(([category, amountCents]) => ({
      category,
      amountCents,
      share: totalCents === 0 ? 0 : amountCents / totalCents,
    }))
    .filter((entry) => entry.amountCents !== 0)
    .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));

  return { totalCents, byCategory };
}

export function calculateSpendingByMerchant(
  transactions: TransactionRecord[],
  range: DateRange,
): Array<{
  merchant: string;
  normalizedMerchant: string;
  amountCents: number;
  transactionCount: number;
}> {
  const totals = new Map<
    string,
    {
      merchant: string;
      normalizedMerchant: string;
      amountCents: number;
      transactionCount: number;
    }
  >();

  for (const transaction of settledTransactions(transactions, range)) {
    if (transaction.transactionType !== "EXPENSE" && transaction.transactionType !== "REFUND") {
      continue;
    }
    const key = transaction.normalizedMerchant || normalizeMerchant(transaction.merchant);
    const current = totals.get(key) ?? {
      merchant: transaction.merchant,
      normalizedMerchant: key,
      amountCents: 0,
      transactionCount: 0,
    };
    const effect =
      transaction.transactionType === "REFUND"
        ? -Math.abs(transaction.amountCents)
        : Math.abs(transaction.amountCents);
    totals.set(key, {
      merchant: current.merchant,
      normalizedMerchant: current.normalizedMerchant,
      amountCents: current.amountCents + effect,
      transactionCount: current.transactionCount + 1,
    });
  }

  return [...totals.values()]
    .filter((entry) => entry.amountCents !== 0)
    .sort((a, b) => b.amountCents - a.amountCents);
}

export interface IncomeSummary {
  totalCents: number;
  recurringCents: number;
  sideIncomeCents: number;
  investmentIncomeCents: number;
  bySource: Array<{
    source: string;
    type: string;
    amountCents: number;
    share: number;
  }>;
}

export interface IncomeComparison {
  current: IncomeSummary;
  previous: IncomeSummary;
  changeCents: number;
  changePercent: number;
}

export function calculateIncome(
  transactions: TransactionRecord[],
  range: DateRange,
): IncomeSummary {
  const incomes = settledTransactions(transactions, range).filter(
    (transaction) => transaction.transactionType === "INCOME" && transaction.amountCents > 0,
  );
  const sources = new Map<string, { type: string; amountCents: number }>();

  for (const income of incomes) {
    const key = `${income.merchant}:${income.incomeType ?? "OTHER"}`;
    const current = sources.get(key) ?? {
      type: income.incomeType ?? "OTHER",
      amountCents: 0,
    };
    current.amountCents += income.amountCents;
    sources.set(key, current);
  }

  const totalCents = incomes.reduce((sum, income) => sum + income.amountCents, 0);
  const recurringCents = incomes
    .filter((income) => income.isRecurring)
    .reduce((sum, income) => sum + income.amountCents, 0);
  const sideIncomeCents = incomes
    .filter((income) => ["FREELANCE", "BUSINESS", "RENTAL", "OTHER"].includes(income.incomeType ?? ""))
    .reduce((sum, income) => sum + income.amountCents, 0);
  const investmentIncomeCents = incomes
    .filter((income) =>
      ["DIVIDENDS", "INTEREST", "INVESTMENT_INCOME"].includes(income.incomeType ?? ""),
    )
    .reduce((sum, income) => sum + income.amountCents, 0);

  return {
    totalCents,
    recurringCents,
    sideIncomeCents,
    investmentIncomeCents,
    bySource: [...sources.entries()]
      .map(([key, value]) => ({
        source: key.split(":")[0],
        type: value.type,
        amountCents: value.amountCents,
        share: totalCents === 0 ? 0 : value.amountCents / totalCents,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

export function compareIncomePeriods(
  transactions: TransactionRecord[],
  currentRange: DateRange,
  previousRange: DateRange,
): IncomeComparison {
  const current = calculateIncome(transactions, currentRange);
  const previous = calculateIncome(transactions, previousRange);
  return {
    current,
    previous,
    changeCents: current.totalCents - previous.totalCents,
    changePercent: percentChange(current.totalCents, previous.totalCents),
  };
}

export interface PeriodSummary {
  incomeCents: number;
  spendingCents: number;
  refundsCents: number;
  debtPaymentsCents: number;
  investmentContributionsCents: number;
  cashSavingsCents: number;
  netSavingsCents: number;
  savingsRate: number;
}

export function calculatePeriodSummary(
  snapshot: FinancialSnapshot,
  range: DateRange,
): PeriodSummary {
  const settled = settledTransactions(snapshot.transactions, range);
  const incomeCents = calculateIncome(snapshot.transactions, range).totalCents;
  const spendingCents = calculateSpendingByCategory(snapshot.transactions, range).totalCents;
  const refundsCents = settled
    .filter((transaction) => transaction.transactionType === "REFUND")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
  const debtPaymentsCents = settled
    .filter((transaction) => transaction.transactionType === "DEBT_PAYMENT")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
  const investmentContributionsCents = settled
    .filter((transaction) => transaction.transactionType === "INVESTMENT_CONTRIBUTION")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
  const accountById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const cashSavingsCents = settled
    .filter(
      (transaction) =>
        transaction.transactionType === "TRANSFER" &&
        transaction.amountCents < 0 &&
        transaction.linkedAccountId &&
        accountById.get(transaction.linkedAccountId)?.type === "SAVINGS",
    )
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);
  const netSavingsCents = incomeCents - spendingCents - debtPaymentsCents;

  return {
    incomeCents,
    spendingCents,
    refundsCents,
    debtPaymentsCents,
    investmentContributionsCents,
    cashSavingsCents,
    netSavingsCents,
    savingsRate: incomeCents === 0 ? 0 : netSavingsCents / incomeCents,
  };
}

export interface MoneyFlow {
  incomeCents: number;
  necessitiesCents: number;
  wantsCents: number;
  otherSpendingCents: number;
  debtCents: number;
  cashSavingsCents: number;
  investmentsCents: number;
  unallocatedCents: number;
  branches: Array<{
    key: "necessities" | "wants" | "other-spending" | "debt" | "cash-savings" | "investments" | "unallocated";
    label: string;
    amountCents: number;
    share: number;
  }>;
}

export function calculateCashFlow(snapshot: FinancialSnapshot, range: DateRange): MoneyFlow {
  const summary = calculatePeriodSummary(snapshot, range);
  const spending = calculateSpendingByCategory(snapshot.transactions, range);
  const necessitiesCents = spending.byCategory
    .filter((entry) => NECESSITY_CATEGORIES.has(entry.category))
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  const wantsCents = spending.byCategory
    .filter((entry) => WANT_CATEGORIES.has(entry.category))
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  const categorizedSpending = necessitiesCents + wantsCents;
  const otherSpending = Math.max(0, summary.spendingCents - categorizedSpending);
  const baseUnallocated =
    summary.incomeCents -
    necessitiesCents -
    wantsCents -
    otherSpending -
    summary.debtPaymentsCents -
    summary.cashSavingsCents -
    summary.investmentContributionsCents;
  const unallocatedCents = baseUnallocated;
  const base = summary.incomeCents || 1;
  const branches: MoneyFlow["branches"] = [
    { key: "necessities", label: "Necessities", amountCents: necessitiesCents, share: necessitiesCents / base },
    { key: "wants", label: "Wants", amountCents: wantsCents, share: wantsCents / base },
    { key: "other-spending", label: "Other spending", amountCents: otherSpending, share: otherSpending / base },
    { key: "debt", label: "Debt repayment", amountCents: summary.debtPaymentsCents, share: summary.debtPaymentsCents / base },
    { key: "cash-savings", label: "Cash savings", amountCents: summary.cashSavingsCents, share: summary.cashSavingsCents / base },
    { key: "investments", label: "Investment contributions", amountCents: summary.investmentContributionsCents, share: summary.investmentContributionsCents / base },
    { key: "unallocated", label: unallocatedCents >= 0 ? "Cash remaining" : "Cash flow gap", amountCents: unallocatedCents, share: unallocatedCents / base },
  ];

  return {
    incomeCents: summary.incomeCents,
    necessitiesCents,
    wantsCents,
    otherSpendingCents: otherSpending,
    debtCents: summary.debtPaymentsCents,
    cashSavingsCents: summary.cashSavingsCents,
    investmentsCents: summary.investmentContributionsCents,
    unallocatedCents,
    branches,
  };
}

export interface NetWorthSummary {
  cashCents: number;
  investmentsCents: number;
  debtCents: number;
  otherAssetsCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

export function calculateNetWorth(accounts: AccountRecord[]): NetWorthSummary {
  let cashCents = 0;
  let investmentsCents = 0;
  let debtCents = 0;
  let otherAssetsCents = 0;

  for (const account of accounts) {
    if (account.isLiability || account.balanceCents < 0) {
      debtCents += Math.abs(account.balanceCents);
      continue;
    }
    if (account.type === "CHECKING" || account.type === "SAVINGS" || account.type === "CASH") {
      cashCents += account.balanceCents;
    } else if (account.type === "BROKERAGE" || account.type === "RETIREMENT") {
      investmentsCents += account.balanceCents;
    } else {
      otherAssetsCents += account.balanceCents;
    }
  }

  const assetsCents = cashCents + investmentsCents + otherAssetsCents;
  return {
    cashCents,
    investmentsCents,
    debtCents,
    otherAssetsCents,
    assetsCents,
    liabilitiesCents: debtCents,
    netWorthCents: assetsCents - debtCents,
  };
}

export interface PortfolioSummary {
  valueCents: number;
  costBasisCents: number;
  gainCents: number;
  gainPercent: number;
  positions: Array<HoldingRecord & {
    weight: number;
    averageCostBasisCents?: number;
    gainCents: number;
    gainPercent: number;
    hasReliableCostBasis: boolean;
  }>;
  allocation: Array<{ type: HoldingRecord["securityType"]; valueCents: number; weight: number }>;
  largestPosition?: PortfolioSummary["positions"][number];
  topFiveWeight: number;
  individualStockWeight: number;
  cashWeight: number;
  concentration: "DIVERSIFIED" | "MODERATE" | "CONCENTRATED";
}

export function calculatePortfolio(holdings: HoldingRecord[]): PortfolioSummary {
  const valueCents = holdings.reduce((sum, holding) => sum + holding.currentValueCents, 0);
  // Cash does not appreciate. Some providers omit its cost basis, so its
  // current value is the only honest effective basis for return calculations.
  const effectiveCostBasis = (holding: HoldingRecord) =>
    holding.securityType === "CASH"
      ? holding.currentValueCents
      : holding.costBasisCents;
  const costBasisCents = holdings.reduce(
    (sum, holding) => sum + effectiveCostBasis(holding),
    0,
  );
  const positions = holdings
    .map((holding) => {
      const positionCostBasisCents = effectiveCostBasis(holding);
      const gainCents = holding.currentValueCents - positionCostBasisCents;
      return {
        ...holding,
        weight: valueCents === 0 ? 0 : holding.currentValueCents / valueCents,
        averageCostBasisCents:
          holding.quantity > 0 && holding.securityType !== "CASH"
            ? Math.round(holding.costBasisCents / holding.quantity)
            : undefined,
        gainCents,
        gainPercent:
          positionCostBasisCents === 0 ? 0 : gainCents / positionCostBasisCents,
        hasReliableCostBasis:
          holding.securityType === "CASH" || holding.costBasisCents > 0,
      };
    })
    .sort((a, b) => b.currentValueCents - a.currentValueCents);
  const allocationMap = new Map<HoldingRecord["securityType"], number>();
  for (const holding of holdings) {
    allocationMap.set(
      holding.securityType,
      (allocationMap.get(holding.securityType) ?? 0) + holding.currentValueCents,
    );
  }
  const largestWeight = positions[0]?.weight ?? 0;
  const topFiveWeight = positions
    .slice(0, 5)
    .reduce((sum, position) => sum + position.weight, 0);
  const individualStockWeight = positions
    .filter((position) => position.securityType === "STOCK")
    .reduce((sum, position) => sum + position.weight, 0);
  const cashWeight = positions
    .filter((position) => position.securityType === "CASH")
    .reduce((sum, position) => sum + position.weight, 0);

  return {
    valueCents,
    costBasisCents,
    gainCents: valueCents - costBasisCents,
    gainPercent: costBasisCents === 0 ? 0 : (valueCents - costBasisCents) / costBasisCents,
    positions,
    allocation: [...allocationMap.entries()]
      .map(([type, allocationValue]) => ({
        type,
        valueCents: allocationValue,
        weight: valueCents === 0 ? 0 : allocationValue / valueCents,
      }))
      .sort((a, b) => b.valueCents - a.valueCents),
    largestPosition: positions[0],
    topFiveWeight,
    individualStockWeight,
    cashWeight,
    concentration:
      largestWeight >= 0.35 || topFiveWeight >= 0.8
        ? "CONCENTRATED"
        : largestWeight >= 0.2 || topFiveWeight >= 0.65
          ? "MODERATE"
          : "DIVERSIFIED",
  };
}

export interface InvestmentPerformanceSummary {
  contributionsCents: number;
  withdrawalsCents: number;
  dividendsCents: number;
  interestCents: number;
  feesCents: number;
  realizedGainCents: number | null;
  unrealizedGainCents: number | null;
  investmentGainLossCents: number | null;
  totalReturnCents: number | null;
  endingValueCents: number;
  hasIncompleteCostBasis: boolean;
  notes: string[];
}

export function calculateInvestmentPerformance(
  holdings: HoldingRecord[],
  activity: InvestmentActivityRecord[],
  range?: DateRange,
): InvestmentPerformanceSummary {
  const scoped = activity.filter(
    (entry) => !range || inRange(entry.date, range),
  );
  const amountFor = (type: InvestmentActivityRecord["type"]) =>
    scoped
      .filter((entry) => entry.type === type)
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
  const contributionsCents = amountFor("CONTRIBUTION");
  const withdrawalsCents = amountFor("WITHDRAWAL");
  const dividendsCents = amountFor("DIVIDEND");
  const interestCents = amountFor("INTEREST");
  const feesCents = scoped.reduce(
    (sum, entry) =>
      sum +
      Math.abs(entry.feesCents) +
      (entry.type === "FEE" ? Math.abs(entry.amountCents) : 0),
    0,
  );
  const sells = scoped.filter((entry) => entry.type === "SELL");
  const hasIncompleteRealizedGain = sells.some(
    (entry) => entry.realizedGainCents === undefined,
  );
  const realizedGainCents = hasIncompleteRealizedGain
    ? null
    : sells.reduce((sum, entry) => sum + (entry.realizedGainCents ?? 0), 0);
  const missingHoldingCostBasis = holdings.some(
    (holding) => holding.securityType !== "CASH" && holding.costBasisCents <= 0,
  );
  // Current holdings cannot establish gain for an earlier period without an
  // opening valuation. Returning all-time unrealized gain would be misleading.
  const periodValuationUnavailable = range !== undefined;
  const unrealizedGainCents = missingHoldingCostBasis || periodValuationUnavailable
    ? null
    : holdings.reduce(
        (sum, holding) =>
          sum +
          (holding.securityType === "CASH"
            ? 0
            : holding.currentValueCents - holding.costBasisCents),
        0,
      );
  const investmentGainLossCents =
    realizedGainCents === null || unrealizedGainCents === null
      ? null
      : realizedGainCents + unrealizedGainCents - feesCents;
  const totalReturnCents =
    investmentGainLossCents === null
      ? null
      : investmentGainLossCents + dividendsCents + interestCents;
  const notes: string[] = [];
  if (hasIncompleteRealizedGain) {
    notes.push("Realized gain/loss is unavailable for one or more sales without cost-basis data.");
  }
  if (missingHoldingCostBasis) {
    notes.push("Unrealized gain/loss is unavailable for positions without reliable cost basis.");
  }
  if (periodValuationUnavailable) {
    notes.push(
      "Period investment gain/loss is unavailable without an opening portfolio valuation.",
    );
  }

  return {
    contributionsCents,
    withdrawalsCents,
    dividendsCents,
    interestCents,
    feesCents,
    realizedGainCents,
    unrealizedGainCents,
    investmentGainLossCents,
    totalReturnCents,
    endingValueCents: holdings.reduce(
      (sum, holding) => sum + holding.currentValueCents,
      0,
    ),
    hasIncompleteCostBasis: hasIncompleteRealizedGain || missingHoldingCostBasis,
    notes,
  };
}

export interface GoalProgress extends GoalRecord {
  remainingCents: number;
  progress: number;
  monthsRemaining: number | null;
  estimatedCompletion?: Date;
  onTrack: boolean | null;
  averageContributionCents: number;
  paceCents: number;
  paceSource: "HISTORY" | "TARGET" | "NONE";
}

function averageMonthlyGoalContribution(
  contributions: GoalContributionRecord[],
  anchor: Date,
): number {
  if (contributions.length === 0) return 0;
  const first = contributions.reduce(
    (earliest, contribution) =>
      contribution.date < earliest ? contribution.date : earliest,
    contributions[0].date,
  );
  const elapsedMonths =
    (anchor.getFullYear() - first.getFullYear()) * 12 +
    anchor.getMonth() -
    first.getMonth() +
    1;
  return Math.round(
    contributions.reduce(
      (sum, contribution) => sum + contribution.amountCents,
      0,
    ) / Math.max(1, elapsedMonths),
  );
}

export function calculateGoalProgress(
  goal: GoalRecord,
  anchor = new Date(),
  contributions: GoalContributionRecord[] = [],
): GoalProgress {
  const remainingCents = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
  const matchingContributions = contributions.filter(
    (contribution) => contribution.goalId === goal.id && contribution.date <= anchor,
  );
  const averageContributionCents = averageMonthlyGoalContribution(
    matchingContributions,
    anchor,
  );
  const paceCents = averageContributionCents || goal.monthlyTargetCents;
  const paceSource =
    averageContributionCents > 0 ? "HISTORY" : goal.monthlyTargetCents > 0 ? "TARGET" : "NONE";
  const monthsRemaining =
    remainingCents === 0
      ? 0
      : paceCents > 0
        ? Math.ceil(remainingCents / paceCents)
        : null;
  const estimatedCompletion =
    monthsRemaining === null ? undefined : addMonths(anchor, monthsRemaining);
  const onTrack = goal.targetDate
    ? estimatedCompletion
      ? estimatedCompletion <= goal.targetDate
      : false
    : null;

  return {
    ...goal,
    remainingCents,
    progress:
      goal.targetAmountCents === 0
        ? 1
        : Math.min(1, goal.currentAmountCents / goal.targetAmountCents),
    monthsRemaining,
    estimatedCompletion,
    onTrack,
    averageContributionCents,
    paceCents,
    paceSource,
  };
}

export interface GoalScenario {
  monthlyContributionCents: number;
  annualReturnPercent: number;
  monthsRemaining: number | null;
  estimatedCompletion?: Date;
  remainingCents: number;
}

export function calculateGoalScenario(
  goal: GoalRecord,
  monthlyContributionCents: number,
  anchor = new Date(),
  annualReturnPercent = 0,
): GoalScenario {
  const remainingCents = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
  if (remainingCents === 0) {
    return { monthlyContributionCents, annualReturnPercent, monthsRemaining: 0, estimatedCompletion: anchor, remainingCents };
  }
  if (monthlyContributionCents <= 0 || annualReturnPercent < 0) {
    return { monthlyContributionCents, annualReturnPercent, monthsRemaining: null, remainingCents };
  }

  let balance = goal.currentAmountCents;
  let months = 0;
  const monthlyRate = annualReturnPercent / 100 / 12;
  while (balance < goal.targetAmountCents && months < 1_200) {
    balance = balance * (1 + monthlyRate) + monthlyContributionCents;
    months += 1;
  }
  const monthsRemaining = balance >= goal.targetAmountCents ? months : null;
  return {
    monthlyContributionCents,
    annualReturnPercent,
    monthsRemaining,
    estimatedCompletion:
      monthsRemaining === null ? undefined : addMonths(anchor, monthsRemaining),
    remainingCents,
  };
}

export interface PurchaseScenario {
  purchaseCents: number;
  cashBeforeCents: number;
  cashAfterCents: number;
  emergencyTargetCents: number;
  remainingAboveEmergencyTargetCents: number;
  averageMonthlyIncomeCents: number;
  averageMonthlySpendingCents: number;
  averageMonthlyDebtPaymentsCents: number;
  currentDebtCents: number;
  otherGoalShortfallCents: number;
  status: "ABOVE_EMERGENCY_TARGET" | "BELOW_EMERGENCY_TARGET" | "INSUFFICIENT_CASH";
  assumptions: string[];
}

export function calculatePurchaseScenario(
  snapshot: FinancialSnapshot,
  purchaseCents: number,
  anchor = snapshot.generatedAt,
  baselineMonths = 3,
): PurchaseScenario {
  const safePurchaseCents = Math.max(0, Math.round(purchaseCents));
  const worth = calculateNetWorth(snapshot.accounts);
  const emergencyGoal = snapshot.goals.find(
    (goal) => goal.type === "EMERGENCY_FUND",
  );
  const emergencyTargetCents = emergencyGoal?.targetAmountCents ?? 0;
  const cashAfterCents = worth.cashCents - safePurchaseCents;
  const summaries = Array.from({ length: Math.max(1, baselineMonths) }, (_, index) =>
    calculatePeriodSummary(snapshot, getMonthRange(anchor, index)),
  );
  const average = (values: number[]) =>
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const otherGoalShortfallCents = snapshot.goals
    .filter((goal) => goal.type !== "EMERGENCY_FUND")
    .reduce(
      (sum, goal) =>
        sum + Math.max(0, goal.targetAmountCents - goal.currentAmountCents),
      0,
    );
  const status =
    cashAfterCents < 0
      ? "INSUFFICIENT_CASH"
      : cashAfterCents < emergencyTargetCents
        ? "BELOW_EMERGENCY_TARGET"
        : "ABOVE_EMERGENCY_TARGET";

  return {
    purchaseCents: safePurchaseCents,
    cashBeforeCents: worth.cashCents,
    cashAfterCents,
    emergencyTargetCents,
    remainingAboveEmergencyTargetCents: cashAfterCents - emergencyTargetCents,
    averageMonthlyIncomeCents: average(summaries.map((summary) => summary.incomeCents)),
    averageMonthlySpendingCents: average(summaries.map((summary) => summary.spendingCents)),
    averageMonthlyDebtPaymentsCents: average(
      summaries.map((summary) => summary.debtPaymentsCents),
    ),
    currentDebtCents: worth.debtCents,
    otherGoalShortfallCents,
    status,
    assumptions: [
      "Uses settled MoneyOS data and current account balances.",
      "Excludes pending transactions and does not forecast investment returns.",
      "Assumes the purchase is paid entirely from tracked cash.",
    ],
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function frequencyFromDays(days: number): RecurringFrequency {
  if (days >= 5 && days <= 9) return "WEEKLY";
  if (days >= 12 && days <= 17) return "BIWEEKLY";
  if (days >= 25 && days <= 36) return "MONTHLY";
  if (days >= 75 && days <= 105) return "QUARTERLY";
  if (days >= 160 && days <= 200) return "SEMIANNUAL";
  if (days >= 330 && days <= 400) return "ANNUAL";
  return "VARIABLE";
}

function annualMultiplier(frequency: RecurringFrequency): number {
  return {
    WEEKLY: 52,
    BIWEEKLY: 26,
    MONTHLY: 12,
    QUARTERLY: 4,
    SEMIANNUAL: 2,
    ANNUAL: 1,
    VARIABLE: 12,
  }[frequency];
}

export function normalizeMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/^(?:sq|tst|pos|paypal|pp)\s*[*-]?\s*/i, "")
    .replace(/\b(?:inc|llc|ltd|payment|purchase|online|debit|credit)\b/g, "")
    .replace(/\b\d{3,}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXPECTED_DAYS: Record<RecurringFrequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30.44,
  QUARTERLY: 91.31,
  SEMIANNUAL: 182.62,
  ANNUAL: 365.25,
  VARIABLE: 30.44,
};

function nextRecurringDate(
  date: Date,
  frequency: RecurringFrequency,
  observedDays: number,
): Date {
  if (frequency === "WEEKLY") return addDays(date, 7);
  if (frequency === "BIWEEKLY") return addDays(date, 14);
  if (frequency === "MONTHLY") return addMonths(date, 1);
  if (frequency === "QUARTERLY") return addMonths(date, 3);
  if (frequency === "SEMIANNUAL") return addMonths(date, 6);
  if (frequency === "ANNUAL") return addMonths(date, 12);
  return addDays(date, Math.max(1, Math.round(observedDays)));
}

export function detectRecurringTransactions(
  transactions: TransactionRecord[],
): RecurringRecord[] {
  const groups = new Map<string, TransactionRecord[]>();
  for (const transaction of settledTransactions(transactions)) {
    if (transaction.transactionType !== "EXPENSE") continue;
    const normalized = transaction.normalizedMerchant || normalizeMerchant(transaction.merchant);
    const key = [transaction.userId, transaction.accountId, normalized].join(":");
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  const detected: RecurringRecord[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const normalizedMerchant = key.split(":").slice(2).join(":");
    const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
    const intervals = sorted.slice(1).map((entry, index) =>
      differenceInCalendarDays(entry.date, sorted[index].date),
    );
    const interval = median(intervals);
    const frequency = frequencyFromDays(interval);
    if (frequency === "VARIABLE") continue;
    const amounts = sorted.map((entry) => Math.abs(entry.amountCents));
    const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
    const variation = average === 0 ? 1 : (Math.max(...amounts) - Math.min(...amounts)) / average;
    if (variation > 0.35) continue;
    const last = sorted.at(-1)!;
    const previous = sorted.at(-2)!;
    const intervalVariation =
      intervals.length === 0
        ? 1
        : (Math.max(...intervals) - Math.min(...intervals)) / Math.max(1, interval);
    const expectedDays = EXPECTED_DAYS[frequency];
    const cadenceDeviation = Math.abs(interval - expectedDays) / expectedDays;
    const confidence = Math.max(
      0.45,
      Math.min(
        0.99,
        0.52 +
          Math.min(0.18, Math.max(0, entries.length - 2) * 0.06) +
          (1 - Math.min(1, variation)) * 0.16 +
          (1 - Math.min(1, cadenceDeviation + intervalVariation)) * 0.13,
      ),
    );

    detected.push({
      id: `detected-${last.accountId}-${normalizedMerchant.replace(/\s/g, "-")}`,
      userId: last.userId,
      accountId: last.accountId,
      merchant: last.merchant,
      amountCents: Math.abs(last.amountCents),
      averageAmountCents: Math.round(average),
      previousAmountCents: Math.abs(previous.amountCents),
      category: last.category,
      frequency,
      nextEstimatedDate: nextRecurringDate(last.date, frequency, interval),
      lastChargeDate: last.date,
      annualizedCents: Math.round(average * annualMultiplier(frequency)),
      status: entries.length >= 3 && confidence >= 0.8 ? "ACTIVE" : "POSSIBLE",
      confidence,
      isSubscription: last.category === "Subscriptions",
    });
  }

  return detected.sort((a, b) => b.annualizedCents - a.annualizedCents);
}

export function getSubscriptionPriceChanges(recurring: RecurringRecord[]) {
  return recurring
    .filter(
      (item) =>
        item.previousAmountCents !== undefined &&
        item.amountCents > item.previousAmountCents &&
        item.amountCents - item.previousAmountCents >= 100 &&
        (item.amountCents - item.previousAmountCents) /
          Math.max(1, item.previousAmountCents) >=
          0.03,
    )
    .map((item) => {
      const previousAmountCents = item.previousAmountCents!;
      return {
        id: item.id,
        merchant: item.merchant,
        previousAmountCents,
        amountCents: item.amountCents,
        increaseCents: item.amountCents - previousAmountCents,
        increasePercent:
          previousAmountCents === 0
            ? 0
            : (item.amountCents - previousAmountCents) / previousAmountCents,
        annualImpactCents:
          (item.amountCents - previousAmountCents) *
          annualMultiplier(item.frequency),
        frequency: item.frequency,
        isSubscription: item.isSubscription,
      };
    })
    .sort((a, b) => b.increaseCents - a.increaseCents);
}

export interface PeriodComparison {
  current: PeriodSummary;
  previous: PeriodSummary;
  incomeChangeCents: number;
  incomeChangePercent: number;
  spendingChangeCents: number;
  spendingChangePercent: number;
  categoryChanges: Array<{
    category: CategoryName;
    currentCents: number;
    previousCents: number;
    changeCents: number;
    changePercent: number;
  }>;
  merchantChanges: Array<{
    merchant: string;
    currentCents: number;
    previousCents: number;
    changeCents: number;
    changePercent: number;
  }>;
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return (current - previous) / previous;
}

export function comparePeriods(
  snapshot: FinancialSnapshot,
  currentRange: DateRange,
  previousRange: DateRange,
): PeriodComparison {
  const current = calculatePeriodSummary(snapshot, currentRange);
  const previous = calculatePeriodSummary(snapshot, previousRange);
  const currentCategories = new Map(
    calculateSpendingByCategory(snapshot.transactions, currentRange).byCategory.map((entry) => [
      entry.category,
      entry.amountCents,
    ]),
  );
  const previousCategories = new Map(
    calculateSpendingByCategory(snapshot.transactions, previousRange).byCategory.map((entry) => [
      entry.category,
      entry.amountCents,
    ]),
  );
  const categoryNames = new Set([...currentCategories.keys(), ...previousCategories.keys()]);
  const currentMerchants = new Map(
    calculateSpendingByMerchant(snapshot.transactions, currentRange).map((entry) => [
      entry.normalizedMerchant,
      entry,
    ]),
  );
  const previousMerchants = new Map(
    calculateSpendingByMerchant(snapshot.transactions, previousRange).map((entry) => [
      entry.normalizedMerchant,
      entry,
    ]),
  );
  const merchantNames = new Set([...currentMerchants.keys(), ...previousMerchants.keys()]);

  return {
    current,
    previous,
    incomeChangeCents: current.incomeCents - previous.incomeCents,
    incomeChangePercent: percentChange(current.incomeCents, previous.incomeCents),
    spendingChangeCents: current.spendingCents - previous.spendingCents,
    spendingChangePercent: percentChange(current.spendingCents, previous.spendingCents),
    categoryChanges: [...categoryNames]
      .map((category) => {
        const currentCents = currentCategories.get(category) ?? 0;
        const previousCents = previousCategories.get(category) ?? 0;
        return {
          category,
          currentCents,
          previousCents,
          changeCents: currentCents - previousCents,
          changePercent: percentChange(currentCents, previousCents),
        };
      })
      .filter((change) => Math.abs(change.changeCents) >= 2_000)
      .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)),
    merchantChanges: [...merchantNames]
      .map((normalizedMerchant) => {
        const currentEntry = currentMerchants.get(normalizedMerchant);
        const previousEntry = previousMerchants.get(normalizedMerchant);
        const currentCents = currentEntry?.amountCents ?? 0;
        const previousCents = previousEntry?.amountCents ?? 0;
        return {
          merchant:
            currentEntry?.merchant ?? previousEntry?.merchant ?? normalizedMerchant,
          currentCents,
          previousCents,
          changeCents: currentCents - previousCents,
          changePercent: percentChange(currentCents, previousCents),
        };
      })
      .filter((change) => Math.abs(change.changeCents) >= 2_000)
      .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents)),
  };
}

export function calculateMonthlySeries(snapshot: FinancialSnapshot, months = 6) {
  return Array.from({ length: months }, (_, index) => {
    const monthsAgo = months - 1 - index;
    const range = getMonthRange(snapshot.generatedAt, monthsAgo);
    const summary = calculatePeriodSummary(snapshot, range);
    return {
      date: range.from,
      incomeCents: summary.incomeCents,
      spendingCents: summary.spendingCents,
      savingsCents: summary.netSavingsCents,
      investmentContributionsCents: summary.investmentContributionsCents,
    };
  });
}
