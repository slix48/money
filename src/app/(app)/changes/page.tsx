import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Scale, Sparkles } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { comparePeriods, getMonthRange } from "@/domain/calculations";
import { getWhatChanged } from "@/domain/insights";
import { formatCurrency, formatPercent, formatSignedCurrency } from "@/lib/format";

export const metadata: Metadata = { title: "What Changed" };

export default async function ChangesPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const comparison = comparePeriods(snapshot, getMonthRange(snapshot.generatedAt), getMonthRange(snapshot.generatedAt, 1));
  const changes = getWhatChanged(snapshot);
  const maxCategory = Math.max(
    1,
    ...comparison.categoryChanges.flatMap((change) => [change.currentCents, change.previousCents]),
  );

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Monthly review" title="What changed?" description="The most financially meaningful differences between this month and last month, ranked by materiality." />
      <section className="comparison-strip">
        <div><span>Income</span><strong>{formatCurrency(comparison.current.incomeCents, true)}</strong><small className={comparison.incomeChangeCents >= 0 ? "positive" : "negative"}>{formatSignedCurrency(comparison.incomeChangeCents, true)}</small></div>
        <div><span>Spending</span><strong>{formatCurrency(comparison.current.spendingCents, true)}</strong><small className={comparison.spendingChangeCents <= 0 ? "positive" : "negative"}>{formatSignedCurrency(comparison.spendingChangeCents, true)}</small></div>
        <div><span>Retained</span><strong>{formatCurrency(comparison.current.netSavingsCents, true)}</strong><small>{formatPercent(comparison.current.savingsRate)} savings rate</small></div>
        <div><span>Investment contributions</span><strong>{formatCurrency(comparison.current.investmentContributionsCents, true)}</strong><small>Returns excluded</small></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel change-list-panel">
          <div className="panel-header"><div><h2>Material changes</h2><p>{changes.length} findings passed significance thresholds</p></div><Sparkles size={17} className="positive" /></div>
          <div className="change-list">
            {changes.map((change, index) => (
              <Link className="change-row" href={change.href} key={change.id}>
                <span className={`change-rank ${change.sentiment.toLowerCase()}`}>{String(index + 1).padStart(2, "0")}</span>
                <div><span className="badge">{change.area}</span><strong>{change.title}</strong><p>{change.detail}</p></div>
                <div className={change.sentiment === "POSITIVE" ? "positive" : change.sentiment === "NEGATIVE" ? "negative" : "muted"}>
                  {change.direction === "UP" ? <ArrowUpRight size={15} /> : change.direction === "DOWN" ? <ArrowDownRight size={15} /> : <Scale size={15} />}
                  {change.changePercent !== undefined && <span>{formatPercent(Math.abs(change.changePercent))}</span>}
                </div>
                <ArrowRight size={14} className="muted" />
              </Link>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Category shifts</h2><p>Current month compared with previous month</p></div></div>
          <div className="comparison-bars">
            {comparison.categoryChanges.slice(0, 7).map((change) => (
              <div key={change.category}>
                <header><strong>{change.category}</strong><span className={change.changeCents > 0 ? "negative" : "positive"}>{formatSignedCurrency(change.changeCents, true)}</span></header>
                <div className="bar-pair"><i><span style={{ width: `${(change.previousCents / maxCategory) * 100}%` }} /></i><small>{formatCurrency(change.previousCents, true)} prior</small></div>
                <div className="bar-pair current"><i><span style={{ width: `${(change.currentCents / maxCategory) * 100}%` }} /></i><small>{formatCurrency(change.currentCents, true)} current</small></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="threshold-note"><CircleAlert size={16} /><p>Small fluctuations are intentionally omitted. Recurring price changes use their own percentage and pattern thresholds.</p></section>
    </div>
  );
}
