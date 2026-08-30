import type { Metadata } from "next";
import { endOfDay, format, startOfYear } from "date-fns";
import {
  ChartNoAxesCombined,
  CircleDollarSign,
  Landmark,
  PieChart,
  TrendingUp,
} from "lucide-react";
import { requireUser } from "@/auth/dal";
import { DonutChart, ValueTrendChart } from "@/components/charts/financial-charts";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import {
  calculateInvestmentPerformance,
  calculatePortfolio,
} from "@/domain/calculations";
import type { InvestmentActivityRecord } from "@/domain/types";
import { cn } from "@/lib/cn";
import {
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  titleCase,
} from "@/lib/format";

export const metadata: Metadata = { title: "Investments" };

export default async function InvestmentsPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const portfolio = calculatePortfolio(snapshot.holdings);
  const performance = calculateInvestmentPerformance(
    snapshot.holdings,
    snapshot.investmentActivity,
  );
  const yearPerformance = calculateInvestmentPerformance(
    snapshot.holdings,
    snapshot.investmentActivity,
    {
      from: startOfYear(snapshot.generatedAt),
      to: endOfDay(snapshot.generatedAt),
    },
  );
  const activity = [...snapshot.investmentActivity].sort(
    (left, right) => right.date.getTime() - left.date.getTime(),
  );
  const gain = performance.investmentGainLossCents;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Wealth"
        title="Investments"
        description="Portfolio value, contributions, returns, income, allocation, and concentration kept explicitly separate."
      />
      <div className="data-banner"><span className="badge badge-demo">Demo prices</span><p>Market values shown here are mock development prices and are not live quotes.</p></div>
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><Landmark size={13} /> Portfolio value</span><strong className="metric-value">{formatCurrency(portfolio.valueCents, true)}</strong><span className="metric-meta">Current tracked market value</span></div>
        <div className="metric-cell"><span className="metric-label"><CircleDollarSign size={13} /> Contributions YTD</span><strong className="metric-value">{formatCurrency(yearPerformance.contributionsCents, true)}</strong><span className="metric-meta">{formatCurrency(yearPerformance.withdrawalsCents, true)} withdrawn</span></div>
        <div className="metric-cell"><span className="metric-label"><TrendingUp size={13} /> Investment gain/loss</span><strong className={cn("metric-value", gain !== null && gain >= 0 ? "positive" : "negative")}>{gain === null ? "Unavailable" : formatSignedCurrency(gain, true)}</strong><span className="metric-meta">Contributions and dividends excluded</span></div>
        <div className="metric-cell"><span className="metric-label"><ChartNoAxesCombined size={13} /> Dividends YTD</span><strong className="metric-value">{formatCurrency(yearPerformance.dividendsCents, true)}</strong><span className="metric-meta">{formatCurrency(yearPerformance.feesCents, true)} tracked fees</span></div>
      </section>

      {performance.notes.map((note) => (
        <section className="threshold-note" key={note}><ChartNoAxesCombined size={16} /><p>{note}</p></section>
      ))}

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Portfolio value over time</h2><p>Balance history, not investment return</p></div></div>
          <div className="chart-container tall"><ValueTrendChart data={snapshot.netWorthHistory} valueKey="investmentsCents" label="Investments" color="var(--chart-3)" /></div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Asset allocation</h2><p>Current value by security type</p></div><PieChart size={17} className="muted" /></div>
          <div className="donut-layout vertical">
            <div className="donut-chart"><DonutChart data={portfolio.allocation.map((item) => ({ name: titleCase(item.type), valueCents: item.valueCents }))} /></div>
            <div className="legend-list compact">
              {portfolio.allocation.map((item, index) => <div key={item.type}><i className={"legend-color color-" + (index + 1)} /><span><strong>{titleCase(item.type)}</strong></span><b>{formatPercent(item.weight)}</b></div>)}
            </div>
          </div>
        </div>
      </section>

      <section className={cn("concentration-band", portfolio.concentration === "CONCENTRATED" ? "attention" : "positive")}>
        <ChartNoAxesCombined size={18} />
        <div>
          <strong>{titleCase(portfolio.concentration)} portfolio concentration</strong>
          <p>{portfolio.largestPosition?.name} is {formatPercent(portfolio.largestPosition?.weight ?? 0)}. The top five positions are {formatPercent(portfolio.topFiveWeight)}, individual stocks are {formatPercent(portfolio.individualStockWeight)}, and cash is {formatPercent(portfolio.cashWeight)}. Descriptive analysis only.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Positions</h2><p>Average and total cost basis remain distinct from current value</p></div></div>
        <div className="table-wrap">
          <table className="data-table positions-table">
            <thead><tr><th>Security</th><th>Account</th><th className="text-right">Quantity</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Total cost</th><th className="text-right">Value</th><th className="text-right">Gain / loss</th><th className="text-right">Weight</th></tr></thead>
            <tbody>{portfolio.positions.map((position) => (
              <tr key={position.id}>
                <td><div className="merchant-cell"><span className="ticker-icon">{position.ticker.slice(0, 4)}</span><div className="merchant-copy"><strong>{position.ticker}</strong><span>{position.name}</span></div></div></td>
                <td>{snapshot.accounts.find((account) => account.id === position.accountId)?.name}</td>
                <td className="amount-cell">{position.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                <td className="amount-cell">{position.averageCostBasisCents === undefined ? "Not applicable" : formatCurrency(position.averageCostBasisCents)}</td>
                <td className="amount-cell">{formatCurrency(position.priceCents)}</td>
                <td className="amount-cell">{position.hasReliableCostBasis ? formatCurrency(position.costBasisCents, true) : "Unavailable"}</td>
                <td className="amount-cell">{formatCurrency(position.currentValueCents, true)}</td>
                <td className={cn("amount-cell", position.hasReliableCostBasis && (position.gainCents >= 0 ? "positive" : "negative"))}>{position.hasReliableCostBasis ? formatSignedCurrency(position.gainCents, true) : "Unavailable"}<small>{position.hasReliableCostBasis ? formatPercent(position.gainPercent) : "Missing cost basis"}</small></td>
                <td className="amount-cell">{formatPercent(position.weight)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>Investment activity</h2><p>Contributions, income, trades, withdrawals, and fees</p></div></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Security</th><th>Account</th><th className="text-right">Cash effect</th><th className="text-right">Realized gain</th></tr></thead>
            <tbody>{activity.slice(0, 16).map((item) => {
              const effect = activityCashEffect(item);
              return (
                <tr key={item.id}>
                  <td>{format(item.date, "MMM d, yyyy")}</td>
                  <td><span className={cn("badge", ["DIVIDEND", "INTEREST"].includes(item.type) && "badge-positive", ["WITHDRAWAL", "FEE"].includes(item.type) && "badge-attention")}>{titleCase(item.type)}</span></td>
                  <td>{item.ticker ?? "Not applicable"}</td>
                  <td>{snapshot.accounts.find((account) => account.id === item.accountId)?.name}</td>
                  <td className={cn("amount-cell", effect > 0 ? "positive" : effect < 0 ? "negative" : undefined)}>{formatSignedCurrency(effect)}</td>
                  <td className={cn("amount-cell", item.realizedGainCents !== undefined && (item.realizedGainCents >= 0 ? "positive" : "negative"))}>{item.type !== "SELL" ? "Not applicable" : item.realizedGainCents === undefined ? "Unavailable" : formatSignedCurrency(item.realizedGainCents)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="threshold-note">
        <CircleDollarSign size={16} />
        <p>Method: investment gain/loss equals recorded realized gain plus current unrealized gain minus fees. Contributions, withdrawals, dividends, and interest are reported separately and never presented as market performance.</p>
      </section>
    </div>
  );
}

function activityCashEffect(activity: InvestmentActivityRecord): number {
  const amount = Math.abs(activity.amountCents);
  if (["BUY", "WITHDRAWAL", "FEE"].includes(activity.type)) return -amount;
  return amount;
}
