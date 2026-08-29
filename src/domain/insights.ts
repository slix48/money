import {
  calculatePeriodSummary,
  comparePeriods,
  getMonthRange,
  getSubscriptionPriceChanges,
} from "@/domain/calculations";
import type { FinancialSnapshot } from "@/domain/types";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

export interface InsightFinding {
  id: string;
  type:
    | "SPENDING_CHANGE"
    | "INCOME_CHANGE"
    | "BILL_CHANGE"
    | "SUBSCRIPTION_CHANGE"
    | "INVESTMENT_CONTRIBUTION"
    | "NET_WORTH_CHANGE"
    | "CASH_FLOW";
  severity: "INFO" | "POSITIVE" | "ATTENTION";
  title: string;
  body: string;
  amountCents?: number;
  percent?: number;
  href: string;
  score: number;
}

export interface FinancialChange {
  id: string;
  area: "Income" | "Spending" | "Bills" | "Investments" | "Net worth" | "Cash" | "Debt";
  title: string;
  detail: string;
  changeCents: number;
  changePercent?: number;
  direction: "UP" | "DOWN" | "FLAT";
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  href: string;
  importance: number;
}

function direction(value: number): FinancialChange["direction"] {
  if (value > 0) return "UP";
  if (value < 0) return "DOWN";
  return "FLAT";
}

function netWorthChange(snapshot: FinancialSnapshot) {
  const history = [...snapshot.netWorthHistory].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest || !previous) return null;
  return {
    current: latest,
    previous,
    netWorth: latest.netWorthCents - previous.netWorthCents,
    cash: latest.cashCents - previous.cashCents,
    investments: latest.investmentsCents - previous.investmentsCents,
    debt: latest.debtCents - previous.debtCents,
  };
}

export function generateInsights(
  snapshot: FinancialSnapshot,
  anchor = snapshot.generatedAt,
): InsightFinding[] {
  const comparison = comparePeriods(
    snapshot,
    getMonthRange(anchor),
    getMonthRange(anchor, 1),
  );
  const findings: InsightFinding[] = [];
  const categoryIncrease = comparison.categoryChanges.find(
    (change) => change.changeCents >= 4_000 && change.changePercent >= 0.15,
  );

  if (categoryIncrease) {
    findings.push({
      id: `category-${categoryIncrease.category}`,
      type: "SPENDING_CHANGE",
      severity: "ATTENTION",
      title: `${categoryIncrease.category} is your largest spending increase`,
      body: `${formatCurrency(categoryIncrease.currentCents, true)} this month, up ${formatPercent(categoryIncrease.changePercent)} from last month.`,
      amountCents: categoryIncrease.changeCents,
      percent: categoryIncrease.changePercent,
      href: "/changes",
      score: 90 + Math.min(20, categoryIncrease.changeCents / 10_000),
    });
  }

  if (comparison.incomeChangeCents >= 5_000) {
    findings.push({
      id: "income-change",
      type: "INCOME_CHANGE",
      severity: "POSITIVE",
      title: "Income increased this month",
      body: `You received ${formatCurrency(comparison.incomeChangeCents, true)} more than last month.`,
      amountCents: comparison.incomeChangeCents,
      percent: comparison.incomeChangePercent,
      href: "/income",
      score: 85,
    });
  }

  for (const change of getSubscriptionPriceChanges(snapshot.recurring)) {
    findings.push({
      id: `bill-${change.id}`,
      type: change.isSubscription ? "SUBSCRIPTION_CHANGE" : "BILL_CHANGE",
      severity: "ATTENTION",
      title: `${change.merchant} increased ${formatCurrency(change.increaseCents)}`,
      body: `The recurring charge changed from ${formatCurrency(change.previousAmountCents)} to ${formatCurrency(change.amountCents)}.`,
      amountCents: change.increaseCents,
      percent: change.increasePercent,
      href: "/recurring",
      score: 95 + Math.min(10, change.increaseCents / 500),
    });
  }

  if (comparison.current.investmentContributionsCents > 0) {
    findings.push({
      id: "investment-contribution",
      type: "INVESTMENT_CONTRIBUTION",
      severity: "POSITIVE",
      title: `${formatCurrency(comparison.current.investmentContributionsCents, true)} contributed to investments`,
      body: "Contributions are shown separately from market gains and dividends.",
      amountCents: comparison.current.investmentContributionsCents,
      href: "/investments",
      score: 75,
    });
  }

  const worthChange = netWorthChange(snapshot);
  if (worthChange && Math.abs(worthChange.netWorth) >= 10_000) {
    findings.push({
      id: "net-worth-change",
      type: "NET_WORTH_CHANGE",
      severity: worthChange.netWorth >= 0 ? "POSITIVE" : "ATTENTION",
      title: `Net worth ${worthChange.netWorth >= 0 ? "increased" : "decreased"} ${formatCurrency(Math.abs(worthChange.netWorth), true)}`,
      body: `Cash changed ${formatSignedCurrency(worthChange.cash, true)} and investments changed ${formatSignedCurrency(worthChange.investments, true)}.`,
      amountCents: worthChange.netWorth,
      href: "/overview",
      score: 80,
    });
  }

  const recurringEntertainment = snapshot.recurring
    .filter(
      (item) =>
        item.status === "ACTIVE" &&
        item.isSubscription &&
        item.category === "Subscriptions",
    )
    .reduce((sum, item) => sum + item.annualizedCents / 12, 0);
  if (recurringEntertainment > 0) {
    findings.push({
      id: "subscription-total",
      type: "CASH_FLOW",
      severity: "INFO",
      title: `${formatCurrency(recurringEntertainment, true)} a month in active subscriptions`,
      body: "This total includes confirmed entertainment and software subscriptions.",
      amountCents: recurringEntertainment,
      href: "/recurring",
      score: 65,
    });
  }

  return findings.sort((a, b) => b.score - a.score).slice(0, 6);
}

export function getWhatChanged(
  snapshot: FinancialSnapshot,
  anchor = snapshot.generatedAt,
): FinancialChange[] {
  const currentRange = getMonthRange(anchor);
  const previousRange = getMonthRange(anchor, 1);
  const comparison = comparePeriods(snapshot, currentRange, previousRange);
  const changes: FinancialChange[] = [];

  if (Math.abs(comparison.incomeChangeCents) >= 5_000) {
    changes.push({
      id: "income",
      area: "Income",
      title: `Income ${comparison.incomeChangeCents >= 0 ? "rose" : "fell"} ${formatCurrency(Math.abs(comparison.incomeChangeCents), true)}`,
      detail: `${formatCurrency(comparison.current.incomeCents, true)} received this month versus ${formatCurrency(comparison.previous.incomeCents, true)} last month.`,
      changeCents: comparison.incomeChangeCents,
      changePercent: comparison.incomeChangePercent,
      direction: direction(comparison.incomeChangeCents),
      sentiment: comparison.incomeChangeCents >= 0 ? "POSITIVE" : "NEGATIVE",
      href: "/income",
      importance: 80 + Math.abs(comparison.incomeChangePercent) * 20,
    });
  }

  if (Math.abs(comparison.spendingChangeCents) >= 5_000) {
    changes.push({
      id: "spending",
      area: "Spending",
      title: `Spending ${comparison.spendingChangeCents >= 0 ? "increased" : "decreased"} ${formatCurrency(Math.abs(comparison.spendingChangeCents), true)}`,
      detail: `${formatCurrency(comparison.current.spendingCents, true)} spent this month, excluding pending charges and transfers.`,
      changeCents: comparison.spendingChangeCents,
      changePercent: comparison.spendingChangePercent,
      direction: direction(comparison.spendingChangeCents),
      sentiment: comparison.spendingChangeCents > 0 ? "NEGATIVE" : "POSITIVE",
      href: "/transactions",
      importance: 85 + Math.abs(comparison.spendingChangePercent) * 20,
    });
  }

  for (const change of comparison.categoryChanges.slice(0, 3)) {
    changes.push({
      id: `category-${change.category}`,
      area: "Spending",
      title: `${change.category} ${change.changeCents >= 0 ? "increased" : "decreased"} ${formatCurrency(Math.abs(change.changeCents), true)}`,
      detail: `${formatCurrency(change.currentCents, true)} this month versus ${formatCurrency(change.previousCents, true)} last month.`,
      changeCents: change.changeCents,
      changePercent: change.changePercent,
      direction: direction(change.changeCents),
      sentiment: change.changeCents > 0 ? "NEGATIVE" : "POSITIVE",
      href: `/transactions?category=${encodeURIComponent(change.category)}`,
      importance: 60 + Math.abs(change.changeCents) / 5_000,
    });
  }

  for (const priceChange of getSubscriptionPriceChanges(snapshot.recurring)) {
    changes.push({
      id: `bill-${priceChange.id}`,
      area: "Bills",
      title: `${priceChange.merchant} now costs ${formatCurrency(priceChange.amountCents)}`,
      detail: `Up ${formatCurrency(priceChange.increaseCents)} from ${formatCurrency(priceChange.previousAmountCents)} per billing period.`,
      changeCents: priceChange.increaseCents,
      changePercent: priceChange.increasePercent,
      direction: "UP",
      sentiment: "NEGATIVE",
      href: "/recurring",
      importance: 100 + priceChange.increasePercent * 20,
    });
  }

  const previousContributions = calculatePeriodSummary(snapshot, previousRange).investmentContributionsCents;
  const contributionChange =
    comparison.current.investmentContributionsCents - previousContributions;
  if (Math.abs(contributionChange) >= 5_000) {
    changes.push({
      id: "contributions",
      area: "Investments",
      title: `Investment contributions ${contributionChange >= 0 ? "increased" : "decreased"} ${formatCurrency(Math.abs(contributionChange), true)}`,
      detail: `${formatCurrency(comparison.current.investmentContributionsCents, true)} contributed this month; market returns are excluded.`,
      changeCents: contributionChange,
      direction: direction(contributionChange),
      sentiment: contributionChange >= 0 ? "POSITIVE" : "NEUTRAL",
      href: "/investments",
      importance: 72,
    });
  }

  const worth = netWorthChange(snapshot);
  if (worth) {
    changes.push({
      id: "net-worth",
      area: "Net worth",
      title: `Net worth ${worth.netWorth >= 0 ? "grew" : "declined"} ${formatCurrency(Math.abs(worth.netWorth), true)}`,
      detail: `From ${formatCurrency(worth.previous.netWorthCents, true)} to ${formatCurrency(worth.current.netWorthCents, true)} across the latest snapshots.`,
      changeCents: worth.netWorth,
      changePercent:
        worth.previous.netWorthCents === 0
          ? undefined
          : worth.netWorth / worth.previous.netWorthCents,
      direction: direction(worth.netWorth),
      sentiment: worth.netWorth >= 0 ? "POSITIVE" : "NEGATIVE",
      href: "/overview",
      importance: 88,
    });
  }

  return changes
    .filter((change) => change.area === "Bills" || Math.abs(change.changeCents) >= 2_000)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);
}
