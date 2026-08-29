import type { Metadata } from "next";
import { format } from "date-fns";
import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleDollarSign,
  Repeat2,
  TrendingUp,
} from "lucide-react";
import { requireUser } from "@/auth/dal";
import { DonutChart, ValueTrendChart } from "@/components/charts/financial-charts";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { calculateIncome, calculateMonthlySeries, getMonthRange } from "@/domain/calculations";
import { formatCurrency, formatPercent, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const income = calculateIncome(snapshot.transactions, getMonthRange(snapshot.generatedAt));
  const previous = calculateIncome(snapshot.transactions, getMonthRange(snapshot.generatedAt, 1));
  const series = calculateMonthlySeries(snapshot, 6);
  const incomeTransactions = snapshot.transactions
    .filter((transaction) => !transaction.isPending && transaction.transactionType === "INCOME")
    .slice(0, 8);
  const change = income.totalCents - previous.totalCents;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Earning"
        title="Income"
        description="Salary, side income, and investment income tracked independently from transfers and refunds."
      />
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><CircleDollarSign size={13} /> Total income</span><strong className="metric-value">{formatCurrency(income.totalCents, true)}</strong><span className={`metric-meta ${change >= 0 ? "positive" : "negative"}`}>{change >= 0 ? "+" : ""}{formatCurrency(change, true)} vs last month</span></div>
        <div className="metric-cell"><span className="metric-label"><Repeat2 size={13} /> Recurring income</span><strong className="metric-value">{formatCurrency(income.recurringCents, true)}</strong><span className="metric-meta">{formatPercent(income.recurringCents / Math.max(1, income.totalCents))} of total</span></div>
        <div className="metric-cell"><span className="metric-label"><BriefcaseBusiness size={13} /> Side income</span><strong className="metric-value">{formatCurrency(income.sideIncomeCents, true)}</strong><span className="metric-meta">Freelance and business</span></div>
        <div className="metric-cell"><span className="metric-label"><ChartNoAxesCombined size={13} /> Investment income</span><strong className="metric-value">{formatCurrency(income.investmentIncomeCents, true)}</strong><span className="metric-meta">Dividends and interest</span></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Income over time</h2><p>Settled income by month</p></div><span className="badge badge-positive"><TrendingUp size={12} /> {formatCurrency(Math.max(0, change), true)} increase</span></div>
          <div className="chart-container tall"><ValueTrendChart data={series} valueKey="incomeCents" label="Income" /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Income mix</h2><p>Current month by payer</p></div></div>
          <div className="donut-layout">
            <div className="donut-chart"><DonutChart data={income.bySource.map((source) => ({ name: source.source, valueCents: source.amountCents }))} /></div>
            <div className="legend-list">
              {income.bySource.map((source, index) => (
                <div key={`${source.source}-${source.type}`}><i className={`legend-color color-${index + 1}`} /><span><strong>{source.source}</strong><small>{titleCase(source.type)}</small></span><b>{formatCurrency(source.amountCents, true)}</b></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid equal">
        <div className="panel">
          <div className="panel-header"><div><h2>Income streams</h2><p>Detected payers and cadence</p></div></div>
          <div className="compact-list">
            {snapshot.incomeStreams.map((stream) => (
              <div className="stream-row" key={stream.id}>
                <span className="merchant-icon">{stream.payer.slice(0, 1)}</span>
                <div><strong>{stream.name}</strong><span>{stream.payer} · {titleCase(stream.type)}</span></div>
                <div className="text-right"><b>{formatCurrency(stream.averageAmountCents, true)}</b><span>{stream.isRecurring ? titleCase(stream.frequency ?? "Recurring") : "Variable"}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Recent income</h2><p>Transfers and refunds excluded</p></div></div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Payer</th><th>Type</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{incomeTransactions.map((transaction) => (
                <tr key={transaction.id}><td className="primary-cell">{transaction.merchant}</td><td>{titleCase(transaction.incomeType ?? "OTHER")}</td><td>{format(transaction.date, "MMM d")}</td><td className="amount-cell positive">+{formatCurrency(transaction.amountCents)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
