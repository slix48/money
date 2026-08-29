import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Landmark,
  ReceiptText,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";
import { requireUser } from "@/auth/dal";
import { NetWorthChart, MonthlyCashChart } from "@/components/charts/financial-charts";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import {
  calculateCashFlow,
  calculateGoalProgress,
  calculateMonthlySeries,
  calculateNetWorth,
  calculatePeriodSummary,
  calculatePortfolio,
  getMonthRange,
} from "@/domain/calculations";
import { generateInsights } from "@/domain/insights";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

const ranges = [
  { value: "1m", label: "1M", months: 2 },
  { value: "3m", label: "3M", months: 3 },
  { value: "6m", label: "6M", months: 6 },
  { value: "1y", label: "1Y", months: 12 },
] as const;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const params = await searchParams;
  const selectedRange = ranges.find((range) => range.value === params.range) ?? ranges[2];
  const currentRange = getMonthRange(snapshot.generatedAt);
  const previousRange = getMonthRange(snapshot.generatedAt, 1);
  const netWorth = calculateNetWorth(snapshot.accounts);
  const current = calculatePeriodSummary(snapshot, currentRange);
  const previous = calculatePeriodSummary(snapshot, previousRange);
  const cashFlow = calculateCashFlow(snapshot, currentRange);
  const portfolio = calculatePortfolio(snapshot.holdings);
  const insights = generateInsights(snapshot);
  const goals = snapshot.goals.map((goal) => calculateGoalProgress(goal, snapshot.generatedAt));
  const series = calculateMonthlySeries(snapshot, selectedRange.months);
  const netWorthHistory = snapshot.netWorthHistory.slice(-selectedRange.months);
  const latestWorth = snapshot.netWorthHistory.at(-1);
  const previousWorth = snapshot.netWorthHistory.at(-2);
  const netWorthDelta = latestWorth && previousWorth ? latestWorth.netWorthCents - previousWorth.netWorthCents : 0;
  const recentTransactions = snapshot.transactions.slice(0, 6);
  const upcoming = snapshot.recurring
    .filter((item) => item.status === "ACTIVE" && item.nextEstimatedDate)
    .sort((a, b) => a.nextEstimatedDate!.getTime() - b.nextEstimatedDate!.getTime())
    .slice(0, 5);
  const incomeDelta = current.incomeCents - previous.incomeCents;
  const spendingDelta = current.spendingCents - previous.spendingCents;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={format(snapshot.generatedAt, "MMMM yyyy")}
        title={`Good evening, ${user.name.split(" ")[0]}`}
        description="A complete view of what moved across your financial life."
        actions={
          <>
            <Link className="button button-secondary" href="/changes">
              <Sparkles size={15} /> What changed?
            </Link>
            <Link className="button button-secondary" href="/cash-flow">
              <ArrowRight size={15} /> Money flow
            </Link>
            <div className="segmented-control" aria-label="Chart date range">
              {ranges.map((range) => (
                <Link
                  key={range.value}
                  href={`/overview?range=${range.value}`}
                  className={selectedRange.value === range.value ? "active" : undefined}
                >
                  {range.label}
                </Link>
              ))}
            </div>
          </>
        }
      />

      {snapshot.dataSource === "DEMO" && (
        <div className="data-banner">
          <span className="badge badge-demo">Demo data</span>
          <p>Balances and market prices are realistic examples, not live financial information.</p>
        </div>
      )}

      <section className="metric-strip" aria-label="Current month financial summary">
        <div className="metric-cell">
          <span className="metric-label"><Landmark size={13} /> Net worth</span>
          <strong className="metric-value">{formatCurrency(netWorth.netWorthCents, true)}</strong>
          <span className={`metric-meta ${netWorthDelta >= 0 ? "positive" : "negative"}`}>
            {netWorthDelta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {formatSignedCurrency(netWorthDelta, true)} latest month
          </span>
        </div>
        <div className="metric-cell">
          <span className="metric-label"><CircleDollarSign size={13} /> Monthly income</span>
          <strong className="metric-value">{formatCurrency(current.incomeCents, true)}</strong>
          <span className={`metric-meta ${incomeDelta >= 0 ? "positive" : "negative"}`}>
            {formatSignedCurrency(incomeDelta, true)} vs last month
          </span>
        </div>
        <div className="metric-cell">
          <span className="metric-label"><ReceiptText size={13} /> Monthly spending</span>
          <strong className="metric-value">{formatCurrency(current.spendingCents, true)}</strong>
          <span className={`metric-meta ${spendingDelta <= 0 ? "positive" : "negative"}`}>
            {formatSignedCurrency(spendingDelta, true)} vs last month
          </span>
        </div>
        <div className="metric-cell">
          <span className="metric-label"><WalletCards size={13} /> Monthly savings</span>
          <strong className="metric-value">{formatCurrency(current.netSavingsCents, true)}</strong>
          <span className="metric-meta positive">{formatPercent(current.savingsRate)} of income retained</span>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Net worth</h2><p>Assets minus liabilities across tracked accounts</p></div>
            <span className="badge badge-positive">{formatSignedCurrency(netWorthDelta, true)}</span>
          </div>
          <div className="chart-container"><NetWorthChart data={netWorthHistory} /></div>
          <div className="inline-breakdown">
            <div><span>Cash</span><strong>{formatCurrency(netWorth.cashCents, true)}</strong></div>
            <div><span>Investments</span><strong>{formatCurrency(netWorth.investmentsCents, true)}</strong></div>
            <div><span>Debt</span><strong>{formatCurrency(netWorth.debtCents, true)}</strong></div>
          </div>
        </div>
        <div className="panel insights-panel">
          <div className="panel-header">
            <div><h2>Financial insights</h2><p>Ranked by materiality</p></div>
            <Sparkles size={17} className="positive" />
          </div>
          <div className="insight-list">
            {insights.slice(0, 4).map((insight) => (
              <Link key={insight.id} href={insight.href} className="insight-row">
                <span className={`insight-marker ${insight.severity.toLowerCase()}`} />
                <div><strong>{insight.title}</strong><p>{insight.body}</p></div>
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-grid equal">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Cash flow</h2><p>Income and settled spending by month</p></div>
            <Link href="/cash-flow" className="button button-quiet">Inspect flow <ArrowRight size={14} /></Link>
          </div>
          <div className="chart-container"><MonthlyCashChart data={series} /></div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <div><h2>Where this month went</h2><p>Transfers and contributions remain separate</p></div>
          </div>
          <div className="flow-summary">
            <div className="flow-source"><span>Income</span><strong>{formatCurrency(cashFlow.incomeCents, true)}</strong></div>
            <div className="flow-connector" />
            <div className="flow-branches">
              {cashFlow.branches.filter((branch) => branch.amountCents !== 0).map((branch) => (
                <div key={branch.key}>
                  <span>{branch.label}</span>
                  <strong>{formatCurrency(branch.amountCents, true)}</strong>
                  <i style={{ width: `${Math.min(100, Math.max(3, Math.abs(branch.share) * 100))}%` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Recent transactions</h2><p>Latest activity across every account</p></div>
            <Link href="/transactions" className="button button-quiet">View all <ArrowRight size={14} /></Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Merchant</th><th>Category</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {recentTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td><div className="merchant-cell"><span className="merchant-icon">{transaction.merchant.slice(0, 1)}</span><div className="merchant-copy"><strong>{transaction.merchant}</strong><span>{transaction.description}</span></div></div></td>
                    <td><span className="badge">{transaction.category}</span></td>
                    <td>{format(transaction.date, "MMM d")}</td>
                    <td className={`amount-cell ${transaction.amountCents > 0 ? "positive" : ""}`}>{formatSignedCurrency(transaction.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Upcoming recurring</h2><p>Estimated next charges</p></div></div>
          <div className="compact-list">
            {upcoming.map((item) => (
              <div className="compact-row" key={item.id}>
                <span className="merchant-icon">{item.merchant.slice(0, 1)}</span>
                <div><strong>{item.merchant}</strong><span>{format(item.nextEstimatedDate!, "MMM d")} · {item.frequency.toLowerCase()}</span></div>
                <b>{formatCurrency(item.amountCents)}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-grid equal">
        <div className="panel panel-padding">
          <div className="section-heading"><div><h2>Goal progress</h2><p>Based on current contribution targets</p></div><Target size={17} className="muted" /></div>
          <div className="goal-list">
            {goals.slice(0, 3).map((goal) => (
              <Link href="/goals" className="goal-row" key={goal.id}>
                <div><strong>{goal.name}</strong><span>{formatCurrency(goal.currentAmountCents, true)} of {formatCurrency(goal.targetAmountCents, true)}</span></div>
                <b>{formatPercent(goal.progress, 0)}</b>
                <i><span style={{ width: `${goal.progress * 100}%`, background: goal.color }} /></i>
              </Link>
            ))}
          </div>
        </div>
        <div className="panel panel-padding">
          <div className="section-heading"><div><h2>Portfolio snapshot</h2><p>Demo prices, not live quotes</p></div><ChartNoAxesCombined size={17} className="muted" /></div>
          <div className="portfolio-summary-value">
            <strong>{formatCurrency(portfolio.valueCents, true)}</strong>
            <span className="positive">+{formatCurrency(portfolio.gainCents, true)} total gain</span>
          </div>
          <div className="position-list">
            {portfolio.positions.slice(0, 4).map((position) => (
              <div key={position.id}><strong>{position.ticker}</strong><span>{formatPercent(position.weight)}</span><b>{formatCurrency(position.currentValueCents, true)}</b></div>
            ))}
          </div>
          <Link href="/investments" className="button button-secondary full-width">Open investments <ArrowRight size={14} /></Link>
        </div>
      </section>
    </div>
  );
}
