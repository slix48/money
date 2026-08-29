import type { Metadata } from "next";
import { format, startOfYear } from "date-fns";
import { ChartNoAxesCombined, CircleDollarSign, Landmark, PieChart, TrendingUp } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { DonutChart, ValueTrendChart } from "@/components/charts/financial-charts";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { calculatePortfolio } from "@/domain/calculations";
import { formatCurrency, formatPercent, formatSignedCurrency, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Investments" };

export default async function InvestmentsPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const portfolio = calculatePortfolio(snapshot.holdings);
  const yearStart = startOfYear(snapshot.generatedAt);
  const yearActivity = snapshot.investmentActivity.filter((item) => item.date >= yearStart && item.date <= snapshot.generatedAt);
  const contributions = yearActivity.filter((item) => item.type === "CONTRIBUTION").reduce((sum, item) => sum + item.amountCents, 0);
  const dividends = yearActivity.filter((item) => ["DIVIDEND", "INTEREST"].includes(item.type)).reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Wealth" title="Investments" description="Portfolio value, contributions, returns, income, allocation, and concentration kept explicitly separate." />
      <div className="data-banner"><span className="badge badge-demo">Demo prices</span><p>Market values shown here are mock development prices and are not live quotes.</p></div>
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><Landmark size={13} /> Portfolio value</span><strong className="metric-value">{formatCurrency(portfolio.valueCents, true)}</strong><span className="metric-meta">Across brokerage and retirement</span></div>
        <div className="metric-cell"><span className="metric-label"><CircleDollarSign size={13} /> Contributions YTD</span><strong className="metric-value">{formatCurrency(contributions, true)}</strong><span className="metric-meta">Excludes market returns</span></div>
        <div className="metric-cell"><span className="metric-label"><TrendingUp size={13} /> Investment gain</span><strong className="metric-value positive">{formatSignedCurrency(portfolio.gainCents, true)}</strong><span className="metric-meta positive">{formatPercent(portfolio.gainPercent)} vs cost basis</span></div>
        <div className="metric-cell"><span className="metric-label"><ChartNoAxesCombined size={13} /> Dividends YTD</span><strong className="metric-value">{formatCurrency(dividends, true)}</strong><span className="metric-meta">Cash distributions</span></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Portfolio value over time</h2><p>Historical tracked investment balances</p></div></div>
          <div className="chart-container tall"><ValueTrendChart data={snapshot.netWorthHistory} valueKey="investmentsCents" label="Investments" color="var(--chart-3)" /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Asset allocation</h2><p>Current value by security type</p></div><PieChart size={17} className="muted" /></div>
          <div className="donut-layout vertical">
            <div className="donut-chart"><DonutChart data={portfolio.allocation.map((item) => ({ name: titleCase(item.type), valueCents: item.valueCents }))} /></div>
            <div className="legend-list compact">
              {portfolio.allocation.map((item, index) => <div key={item.type}><i className={`legend-color color-${index + 1}`} /><span><strong>{titleCase(item.type)}</strong></span><b>{formatPercent(item.weight)}</b></div>)}
            </div>
          </div>
        </div>
      </section>

      <section className={`concentration-band ${portfolio.concentration === "CONCENTRATED" ? "attention" : "positive"}`}>
        <ChartNoAxesCombined size={18} />
        <div><strong>{titleCase(portfolio.concentration)} portfolio concentration</strong><p>{portfolio.largestPosition?.name} is {formatPercent(portfolio.largestPosition?.weight ?? 0)} of tracked investments. This is descriptive analysis, not investment advice.</p></div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Positions</h2><p>Cost basis and gain/loss use tracked lot totals</p></div></div>
        <div className="table-wrap">
          <table className="data-table positions-table">
            <thead><tr><th>Security</th><th>Account</th><th className="text-right">Quantity</th><th className="text-right">Price</th><th className="text-right">Cost basis</th><th className="text-right">Value</th><th className="text-right">Gain / loss</th><th className="text-right">Weight</th></tr></thead>
            <tbody>{portfolio.positions.map((position) => (
              <tr key={position.id}><td><div className="merchant-cell"><span className="ticker-icon">{position.ticker.slice(0, 4)}</span><div className="merchant-copy"><strong>{position.ticker}</strong><span>{position.name}</span></div></div></td><td>{snapshot.accounts.find((account) => account.id === position.accountId)?.name}</td><td className="amount-cell">{position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td><td className="amount-cell">{formatCurrency(position.priceCents)}</td><td className="amount-cell">{formatCurrency(position.costBasisCents, true)}</td><td className="amount-cell">{formatCurrency(position.currentValueCents, true)}</td><td className={`amount-cell ${position.gainCents >= 0 ? "positive" : "negative"}`}>{formatSignedCurrency(position.gainCents, true)}<small>{formatPercent(position.gainPercent)}</small></td><td className="amount-cell">{formatPercent(position.weight)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Investment activity</h2><p>Contributions, income, buys, sells, and withdrawals</p></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Security</th><th>Account</th><th className="text-right">Amount</th></tr></thead><tbody>{snapshot.investmentActivity.slice(0, 12).map((item) => <tr key={item.id}><td>{format(item.date, "MMM d, yyyy")}</td><td><span className={`badge ${item.type === "CONTRIBUTION" || item.type === "DIVIDEND" ? "badge-positive" : ""}`}>{titleCase(item.type)}</span></td><td>{item.ticker ?? "—"}</td><td>{snapshot.accounts.find((account) => account.id === item.accountId)?.name}</td><td className="amount-cell positive">+{formatCurrency(item.amountCents)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
