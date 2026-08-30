"use client";

import { format } from "date-fns";
import {
  Ban,
  CalendarClock,
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  ReceiptText,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { RecurringRecord } from "@/domain/types";
import { getSubscriptionPriceChanges } from "@/domain/calculations";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent, titleCase } from "@/lib/format";

type RecurringUpdate = Pick<RecurringRecord, "status"> & {
  isSubscription?: boolean;
};

export function RecurringCenter({
  initialItems,
}: {
  initialItems: RecurringRecord[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = items.filter((item) => item.status === "ACTIVE");
  const possible = items.filter((item) => item.status === "POSSIBLE");
  const subscriptions = active.filter((item) => item.isSubscription);
  const annualizedCents = active.reduce(
    (sum, item) => sum + item.annualizedCents,
    0,
  );
  const changes = useMemo(() => getSubscriptionPriceChanges(items), [items]);

  async function updateItem(
    item: RecurringRecord,
    update: Partial<RecurringUpdate>,
  ) {
    setPendingId(item.id);
    setError("");
    try {
      const response = await fetch("/api/recurring/" + item.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Unable to update recurring item.");
        return;
      }
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, ...update } : candidate,
        ),
      );
      router.refresh();
    } catch {
      setError("Unable to reach MoneyOS. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><RefreshCw size={13} /> Monthly recurring</span><strong className="metric-value">{formatCurrency(annualizedCents / 12, true)}</strong><span className="metric-meta">{active.length} active charges</span></div>
        <div className="metric-cell"><span className="metric-label"><ReceiptText size={13} /> Annualized cost</span><strong className="metric-value">{formatCurrency(annualizedCents, true)}</strong><span className="metric-meta">Using detected cadence</span></div>
        <div className="metric-cell"><span className="metric-label"><CalendarClock size={13} /> Subscriptions</span><strong className="metric-value">{subscriptions.length}</strong><span className="metric-meta">{formatCurrency(subscriptions.reduce((sum, item) => sum + item.annualizedCents / 12, 0), true)} per month</span></div>
        <div className="metric-cell"><span className="metric-label"><CircleAlert size={13} /> Price increases</span><strong className="metric-value">{changes.length}</strong><span className="metric-meta attention">Needs review</span></div>
      </section>

      {changes.length > 0 && (
        <section className="change-band">
          <CircleAlert size={18} />
          <div>
            <strong>Recurring costs changed</strong>
            {changes.map((change) => (
              <p key={change.id}>
                {change.merchant}: {formatCurrency(change.previousAmountCents)} to{" "}
                {formatCurrency(change.amountCents)} ({formatSignedIncrease(change.increaseCents)}/
                {frequencyUnit(change.frequency)}; about {formatCurrency(change.annualImpactCents, true)}/year)
              </p>
            ))}
          </div>
        </section>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel" aria-busy={pendingId !== null}>
        <div className="panel-header"><div><h2>Recurring expenses</h2><p>Annualized values use average amount and detected billing cadence</p></div></div>
        <div className="table-wrap">
          <table className="data-table recurring-table">
            <thead><tr><th>Merchant</th><th>Status</th><th>Frequency</th><th>Last charge</th><th>Next estimate</th><th className="text-right">Amount</th><th className="text-right">Annual</th><th>Review</th></tr></thead>
            <tbody>{items.map((item) => {
              const change = changes.find((candidate) => candidate.id === item.id);
              return (
                <tr key={item.id}>
                  <td><div className="merchant-cell"><span className="merchant-icon">{item.merchant.slice(0, 1)}</span><div className="merchant-copy"><strong>{item.merchant}</strong><span>{item.category}{item.isSubscription ? " · Subscription" : " · Recurring bill"}</span></div></div></td>
                  <td><span className={cn("badge", item.status === "ACTIVE" && "badge-positive", item.status === "POSSIBLE" && "badge-attention")}>{titleCase(item.status)}</span></td>
                  <td>{titleCase(item.frequency)}<small className="table-subtext">{formatPercent(item.confidence, 0)} confidence</small></td>
                  <td>{format(item.lastChargeDate, "MMM d")}</td>
                  <td>{item.nextEstimatedDate ? format(item.nextEstimatedDate, "MMM d") : "Not expected"}</td>
                  <td className="amount-cell"><div>{formatCurrency(item.amountCents)}<small>{formatCurrency(item.averageAmountCents)} average</small>{change && <small className="negative">+{formatPercent(change.increasePercent)}</small>}</div></td>
                  <td className="amount-cell">{formatCurrency(item.annualizedCents, true)}</td>
                  <td>
                    <select
                      className="input compact-select"
                      value={item.status}
                      aria-label={"Status for " + item.merchant}
                      disabled={pendingId === item.id}
                      onChange={(event) => void updateItem(item, {
                        status: event.target.value as RecurringRecord["status"],
                      })}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="POSSIBLE">Possible</option>
                      <option value="CANCELLED">Mark cancelled</option>
                      <option value="IGNORED">Ignore</option>
                    </select>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          {items.length === 0 && (
            <div className="empty-state">
              <div>
                <span className="state-icon"><RefreshCw size={20} /></span>
                <h3>No recurring activity yet</h3>
                <p>Detected bills and subscriptions will appear after repeated settled charges.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {possible.length > 0 && (
        <section className="panel panel-padding">
          <div className="section-heading"><div><h2>Possible subscriptions</h2><p>Patterns need your confirmation</p></div><span className="badge badge-attention">{possible.length} possible</span></div>
          <div className="possible-grid">
            {possible.map((item) => (
              <div key={item.id}>
                <span className="merchant-icon">{item.merchant.slice(0, 1)}</span>
                <div><strong>{item.merchant}</strong><span>{formatCurrency(item.averageAmountCents)} average · {formatPercent(item.confidence, 0)} confidence</span></div>
                <div className="possible-actions">
                  <button className="icon-button" type="button" title="Confirm subscription" aria-label={"Confirm " + item.merchant + " as a subscription"} disabled={pendingId === item.id} onClick={() => void updateItem(item, { status: "ACTIVE", isSubscription: true })}>{pendingId === item.id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}</button>
                  <button className="icon-button" type="button" title="Recurring bill, not a subscription" aria-label={"Mark " + item.merchant + " as a recurring bill"} disabled={pendingId === item.id} onClick={() => void updateItem(item, { status: "ACTIVE", isSubscription: false })}><ReceiptText size={14} /></button>
                  <button className="icon-button" type="button" title="Ignore" aria-label={"Ignore " + item.merchant} disabled={pendingId === item.id} onClick={() => void updateItem(item, { status: "IGNORED" })}><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="threshold-note">
        <Ban size={16} />
        <p>Marking an item cancelled only updates its MoneyOS record. External cancellation is not available in V1 and no provider action is performed.</p>
      </section>
    </>
  );
}

function frequencyUnit(frequency: RecurringRecord["frequency"]) {
  if (frequency === "WEEKLY") return "week";
  if (frequency === "BIWEEKLY") return "two weeks";
  if (frequency === "QUARTERLY") return "quarter";
  if (frequency === "SEMIANNUAL") return "six months";
  if (frequency === "ANNUAL") return "year";
  return "month";
}

function formatSignedIncrease(valueCents: number) {
  return "+" + formatCurrency(valueCents);
}
