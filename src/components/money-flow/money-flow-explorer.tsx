"use client";

import { ArrowDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { MoneyFlow } from "@/domain/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";

export interface FlowDetail {
  label: string;
  amountCents: number;
  meta: string;
}

export function MoneyFlowExplorer({
  flow,
  details,
}: {
  flow: MoneyFlow;
  details: Record<MoneyFlow["branches"][number]["key"], FlowDetail[]>;
}) {
  const visibleBranches = flow.branches.filter((branch) => branch.amountCents !== 0);
  const [activeKey, setActiveKey] = useState<MoneyFlow["branches"][number]["key"]>(
    visibleBranches[0]?.key ?? "necessities",
  );
  const active = visibleBranches.find((branch) => branch.key === activeKey) ?? visibleBranches[0];
  const activeDetails = active ? details[active.key] : [];

  return (
    <div className="money-flow-layout">
      <section className="flow-canvas panel" aria-label="Money flow visualization">
        <div className="flow-income-node">
          <span>Income</span>
          <strong>{formatCurrency(flow.incomeCents, true)}</strong>
          <small>Settled inflows</small>
        </div>
        <div className="flow-drop"><ArrowDown size={16} /></div>
        <div className="flow-node-grid">
          {visibleBranches.map((branch) => (
            <button
              type="button"
              key={branch.key}
              className={activeKey === branch.key ? "active" : undefined}
              onClick={() => setActiveKey(branch.key)}
              aria-pressed={activeKey === branch.key}
            >
              <div><span>{branch.label}</span><strong>{formatCurrency(branch.amountCents, true)}</strong></div>
              <small>{formatPercent(branch.share)} of income</small>
              <i><span style={{ width: `${Math.min(100, Math.max(2, Math.abs(branch.share) * 100))}%` }} /></i>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </section>

      <aside className="panel flow-detail-panel">
        <div className="panel-header">
          <div><h2>{active?.label ?? "Flow details"}</h2><p>{active ? formatPercent(active.share) : "0%"} of current income</p></div>
          {active && <strong>{formatCurrency(active.amountCents, true)}</strong>}
        </div>
        <div className="flow-detail-list">
          {activeDetails.length > 0 ? activeDetails.map((detail, index) => (
            <div key={`${detail.label}-${index}`}>
              <span><strong>{detail.label}</strong><small>{detail.meta}</small></span>
              <b>{formatCurrency(detail.amountCents, true)}</b>
            </div>
          )) : (
            <div className="empty-flow-detail"><p>No line items are required for this residual calculation.</p></div>
          )}
        </div>
        {active?.key === "unallocated" && (
          <p className="flow-detail-note">Unallocated cash flow is income not assigned to tracked spending, debt payments, cash savings transfers, or investment contributions during the period.</p>
        )}
      </aside>
    </div>
  );
}
