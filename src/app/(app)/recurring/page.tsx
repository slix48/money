import type { Metadata } from "next";
import { format } from "date-fns";
import { Ban, CalendarClock, CircleAlert, RefreshCw, ReceiptText } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { getSubscriptionPriceChanges } from "@/domain/calculations";
import { formatCurrency, formatPercent, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const active = snapshot.recurring.filter((item) => item.status === "ACTIVE");
  const possible = snapshot.recurring.filter((item) => item.status === "POSSIBLE");
  const annualizedCents = active.reduce((sum, item) => sum + item.annualizedCents, 0);
  const subscriptions = active.filter((item) => item.isSubscription);
  const changes = getSubscriptionPriceChanges(snapshot.recurring);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Obligations" title="Recurring" description="Confirmed bills, probable subscriptions, next charges, and meaningful price changes." />
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><RefreshCw size={13} /> Monthly recurring</span><strong className="metric-value">{formatCurrency(annualizedCents / 12, true)}</strong><span className="metric-meta">{active.length} active charges</span></div>
        <div className="metric-cell"><span className="metric-label"><ReceiptText size={13} /> Annualized cost</span><strong className="metric-value">{formatCurrency(annualizedCents, true)}</strong><span className="metric-meta">At current amounts</span></div>
        <div className="metric-cell"><span className="metric-label"><CalendarClock size={13} /> Subscriptions</span><strong className="metric-value">{subscriptions.length}</strong><span className="metric-meta">{formatCurrency(subscriptions.reduce((sum, item) => sum + item.annualizedCents / 12, 0), true)} per month</span></div>
        <div className="metric-cell"><span className="metric-label"><CircleAlert size={13} /> Price increases</span><strong className="metric-value">{changes.length}</strong><span className="metric-meta attention">Needs review</span></div>
      </section>

      {changes.length > 0 && (
        <section className="change-band">
          <CircleAlert size={18} />
          <div><strong>Recurring costs changed</strong><p>{changes.map((change) => `${change.merchant} rose from ${formatCurrency(change.previousAmountCents)} to ${formatCurrency(change.amountCents)}`).join(". ")}.</p></div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><div><h2>Recurring expenses</h2><p>Annualized values use the detected billing cadence</p></div></div>
        <div className="table-wrap">
          <table className="data-table recurring-table">
            <thead><tr><th>Merchant</th><th>Status</th><th>Frequency</th><th>Last charge</th><th>Next estimate</th><th className="text-right">Amount</th><th className="text-right">Annual</th><th>Action</th></tr></thead>
            <tbody>{snapshot.recurring.map((item) => {
              const change = changes.find((candidate) => candidate.id === item.id);
              return (
                <tr key={item.id}>
                  <td><div className="merchant-cell"><span className="merchant-icon">{item.merchant.slice(0, 1)}</span><div className="merchant-copy"><strong>{item.merchant}</strong><span>{item.category}{item.isSubscription ? " · Subscription" : ""}</span></div></div></td>
                  <td><span className={`badge ${item.status === "ACTIVE" ? "badge-positive" : item.status === "POSSIBLE" ? "badge-attention" : ""}`}>{titleCase(item.status)}</span></td>
                  <td>{titleCase(item.frequency)}</td>
                  <td>{format(item.lastChargeDate, "MMM d")}</td>
                  <td>{item.nextEstimatedDate ? format(item.nextEstimatedDate, "MMM d") : "—"}</td>
                  <td className="amount-cell"><div>{formatCurrency(item.amountCents)}{change && <small className="negative">+{formatPercent(change.increasePercent)}</small>}</div></td>
                  <td className="amount-cell">{formatCurrency(item.annualizedCents, true)}</td>
                  <td><button className="button button-secondary" type="button" disabled title="Cancellation not available in V1"><Ban size={13} /> V1 unavailable</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      {possible.length > 0 && (
        <section className="panel panel-padding">
          <div className="section-heading"><div><h2>Possible recurring charges</h2><p>Patterns below the confirmed confidence threshold</p></div><span className="badge badge-attention">{possible.length} possible</span></div>
          <div className="possible-grid">
            {possible.map((item) => (
              <div key={item.id}><span className="merchant-icon">{item.merchant.slice(0, 1)}</span><div><strong>{item.merchant}</strong><span>{formatCurrency(item.amountCents)} · {formatPercent(item.confidence, 0)} confidence</span></div><button className="button button-secondary" type="button">Review</button></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
