"use client";

import { LoaderCircle, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { IncomeStreamRecord, IncomeType } from "@/domain/types";
import { formatCurrency, titleCase } from "@/lib/format";

const incomeTypes: IncomeType[] = [
  "SALARY",
  "FREELANCE",
  "BUSINESS",
  "INTEREST",
  "DIVIDENDS",
  "INVESTMENT_INCOME",
  "RENTAL",
  "OTHER",
];

export function IncomeStreams({
  initialStreams,
}: {
  initialStreams: IncomeStreamRecord[];
}) {
  const router = useRouter();
  const [streams, setStreams] = useState(initialStreams);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<IncomeType>("OTHER");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = streams.find((stream) => stream.id === activeId);

  function edit(stream: IncomeStreamRecord) {
    setActiveId(stream.id);
    setName(stream.name);
    setType(stream.type);
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/income-streams/" + active.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Unable to update income stream.");
        return;
      }
      setStreams((current) =>
        current.map((stream) =>
          stream.id === active.id ? { ...stream, name: name.trim(), type } : stream,
        ),
      );
      setActiveId(null);
      router.refresh();
    } catch {
      setError("Unable to reach MoneyOS. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="compact-list">
        {streams.map((stream) => (
          <div className="stream-row" key={stream.id}>
            <span className="merchant-icon">{stream.payer.slice(0, 1)}</span>
            <div><strong>{stream.name}</strong><span>{stream.payer} · {titleCase(stream.type)}</span></div>
            <div className="stream-amount"><b>{formatCurrency(stream.averageAmountCents, true)}</b><span>{stream.isRecurring ? titleCase(stream.frequency ?? "Recurring") : "Variable"}</span></div>
            <button className="icon-button" type="button" title="Edit income stream" aria-label={"Edit " + stream.name} onClick={() => edit(stream)}><Pencil size={13} /></button>
          </div>
        ))}
        {streams.length === 0 && (
          <div className="empty-state">
            <div>
              <h3>No income streams detected</h3>
              <p>Settled income transactions will be grouped here by payer and source.</p>
            </div>
          </div>
        )}
      </div>

      {active && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Edit income stream">
          <button className="modal-backdrop" onClick={() => setActiveId(null)} aria-label="Close income stream form" />
          <form className="modal" onSubmit={save}>
            <header><div><span className="eyebrow">Income source</span><h2>{active.payer}</h2></div><button className="icon-button" type="button" onClick={() => setActiveId(null)} aria-label="Close"><X size={17} /></button></header>
            <div className="modal-content">
              <label className="field"><span>Display name</span><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required autoFocus /></label>
              <label className="field"><span>Income group</span><select value={type} onChange={(event) => setType(event.target.value as IncomeType)}>{incomeTypes.map((value) => <option value={value} key={value}>{titleCase(value)}</option>)}</select></label>
              <p className="muted form-help">This changes the MoneyOS grouping label. It does not alter the source transaction.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
            <footer><button type="button" className="button button-secondary" onClick={() => setActiveId(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <Pencil size={15} />}{pending ? "Saving" : "Save source"}</button></footer>
          </form>
        </div>
      )}
    </>
  );
}
