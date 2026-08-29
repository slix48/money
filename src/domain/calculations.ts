import {
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
  GoalRecord,
  HoldingRecord,
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

  const totalCents = [...totals.values()].reduce((sum, value) => sum + Math.max(0, value), 0);
  const byCategory = [...totals.entries()]
    .map(([category, amountCents]) => ({
      category,
      amountCents: Math.max(0, amountCents),
      share: totalCents === 0 ? 0 : Math.max(0, amountCents) / totalCents,
    }))
    .filter((entry) => entry.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);

  return { totalCents, byCategory };
}

export function calculateSpendingByMerchant(
  transactions: TransactionRecord[],
  range: DateRange,
): Array<{ merchant: string; amountCents: number; transactionCount: number }> {
  const totals = new Map<string, { amountCents: number; transactionCount: number }>();

  for (const transaction of settledTransactions(transactions, range)) {
    if (transaction.transactionType !== "EXPENSE" && transaction.transactionType !== "REFUND") {
      continue;
    }
    const current = totals.get(transaction.merchant) ?? { amountCents: 0, transactionCount: 0 };
    const effect =
      transaction.transactionType === "REFUND"
        ? -Math.abs(transaction.amountCents)
        : Math.abs(transaction.amountCents);
    totals.set(transaction.merchant, {
      amountCents: current.amountCents + effect,
      transactionCount: current.transactionCount + 1,
    });
  }

  return [...totals.entries()]
    .map(([merchant, value]) => ({ merchant, ...value, amountCents: Math.max(0, value.amountCents) }))
    .filter((entry) => entry.amountCents > 0)
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
  debtCents: number;
  cashSavingsCents: number;
  investmentsCents: number;
  unallocatedCents: number;
  branches: Array<{
    key: "necessities" | "wants" | "debt" | "cash-savings" | "investments" | "unallocated";
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
    { key: "necessities", label: "Necessities", amountCents: necessitiesCents + otherSpending, share: (necessitiesCents + otherSpending) / base },
    { key: "wants", label: "Wants", amountCents: wantsCents, share: wantsCents / base },
    { key: "debt", label: "Debt repayment", amountCents: summary.debtPaymentsCents, share: summary.debtPaymentsCents / base },
    { key: "cash-savings", label: "Cash savings", amountCents: summary.cashSavingsCents, share: summary.cashSavingsCents / base },
    { key: "investments", label: "Investment contributions", amountCents: summary.investmentContributionsCents, share: summary.investmentContributionsCents / base },
    { key: "unallocated", label: unallocatedCents >= 0 ? "Unallocated cash flow" : "Cash flow gap", amountCents: unallocatedCents, share: unallocatedCents / base },
  ];

  return {
    incomeCents: summary.incomeCents,
    necessitiesCents: necessitiesCents + otherSpending,
    wantsCents,
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
    if (account.type === "CHECKING" || account.type === "SAVINGS" || account.type === "CASH") {
      cashCents += Math.max(0, account.balanceCents);
    } else if (account.type === "BROKERAGE" || account.type === "RETIREMENT") {
      investmentsCents += Math.max(0, account.balanceCents);
    } else if (account.type === "CREDIT_CARD" || account.type === "LOAN") {
      debtCents += Math.abs(Math.min(0, account.balanceCents));
    } else if (account.balanceCents >= 0) {
      otherAssetsCents += account.balanceCents;
    } else {
      debtCents += Math.abs(account.balanceCents);
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
  positions: Array<HoldingRecord & { weight: number; gainCents: number; gainPercent: number }>;
  allocation: Array<{ type: HoldingRecord["securityType"]; valueCents: number; weight: number }>;
  largestPosition?: HoldingRecord & { weight: number; gainCents: number; gainPercent: number };
  concentration: "DIVERSIFIED" | "MODERATE" | "CONCENTRATED";
}

export function calculatePortfolio(holdings: HoldingRecord[]): PortfolioSummary {
  const valueCents = holdings.reduce((sum, holding) => sum + holding.currentValueCents, 0);
  const costBasisCents = holdings.reduce((sum, holding) => sum + holding.costBasisCents, 0);
  const positions = holdings
    .map((holding) => {
      const gainCents = holding.currentValueCents - holding.costBasisCents;
      return {
        ...holding,
        weight: valueCents === 0 ? 0 : holding.currentValueCents / valueCents,
        gainCents,
        gainPercent: holding.costBasisCents === 0 ? 0 : gainCents / holding.costBasisCents,
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
    concentration:
      largestWeight >= 0.35 ? "CONCENTRATED" : largestWeight >= 0.2 ? "MODERATE" : "DIVERSIFIED",
  };
}

export interface GoalProgress extends GoalRecord {
  remainingCents: number;
  progress: number;
  monthsRemaining: number | null;
  estimatedCompletion?: Date;
  onTrack: boolean | null;
}

export function calculateGoalProgress(goal: GoalRecord, anchor = new Date()): GoalProgress {
  const remainingCents = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
  const monthsRemaining =
    remainingCents === 0
      ? 0
      : goal.monthlyTargetCents > 0
        ? Math.ceil(remainingCents / goal.monthlyTargetCents)
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
    .replace(/\b(?:inc|llc|ltd|payment|purchase|online)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectRecurringTransactions(
  transactions: TransactionRecord[],
): RecurringRecord[] {
  const groups = new Map<string, TransactionRecord[]>();
  for (const transaction of settledTransactions(transactions)) {
    if (transaction.transactionType !== "EXPENSE") continue;
    const key = normalizeMerchant(transaction.merchant);
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }

  const detected: RecurringRecord[] = [];
  for (const [normalizedMerchant, entries] of groups) {
    if (entries.length < 3) continue;
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
    const confidence = Math.max(
      0.5,
      Math.min(
        0.99,
        0.96 - variation * 0.25 - intervalVariation * 0.35 - Math.abs(interval - 30) / 200,
      ),
    );

    detected.push({
      id: `detected-${normalizedMerchant.replace(/\s/g, "-")}`,
      userId: last.userId,
      accountId: last.accountId,
      merchant: last.merchant,
      amountCents: Math.abs(last.amountCents),
      previousAmountCents: Math.abs(previous.amountCents),
      category: last.category,
      frequency,
      nextEstimatedDate: addMonths(last.date, frequency === "MONTHLY" ? 1 : 0),
      lastChargeDate: last.date,
      annualizedCents: Math.round(Math.abs(last.amountCents) * annualMultiplier(frequency)),
      status: confidence >= 0.8 ? "ACTIVE" : "POSSIBLE",
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
        item.amountCents - item.previousAmountCents >= 300,
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
      entry.merchant,
      entry.amountCents,
    ]),
  );
  const previousMerchants = new Map(
    calculateSpendingByMerchant(snapshot.transactions, previousRange).map((entry) => [
      entry.merchant,
      entry.amountCents,
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
      .map((merchant) => {
        const currentCents = currentMerchants.get(merchant) ?? 0;
        const previousCents = previousMerchants.get(merchant) ?? 0;
        return {
          merchant,
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
