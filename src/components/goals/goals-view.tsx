"use client";

import { format } from "date-fns";
import { Check, LoaderCircle, Plus, Target, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { calculateGoalProgress } from "@/domain/calculations";
import type { AccountRecord, GoalRecord } from "@/domain/types";
import { formatCurrency, formatPercent, titleCase } from "@/lib/format";

const goalTypes = [
  ["EMERGENCY_FUND", "Emergency fund"],
  ["CAR", "Car"],
  ["HOUSE", "House"],
  ["VACATION", "Vacation"],
  ["EDUCATION", "Education"],
  ["CUSTOM", "Custom"],
] as const;

const colors = ["#3f826d", "#547a9b", "#d19a48", "#8d6b94", "#cf6d5b"];

type GoalResponse = Omit<GoalRecord, "targetDate"> & { targetDate?: string };

function cents(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function GoalsView({
  initialGoals,
  accounts,
  anchor,
}: {
  initialGoals: GoalRecord[];
  accounts: AccountRecord[];
  anchor: Date;
}) {
  const [goals, setGoals] = useState(initialGoals);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalRecord["type"]>("EMERGENCY_FUND");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("0");
  const [monthly, setMonthly] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const progress = useMemo(
    () => goals.map((goal) => calculateGoalProgress(goal, anchor)),
    [goals, anchor],
  );
  const totalTarget = goals.reduce((sum, goal) => sum + goal.targetAmountCents, 0);
  const totalCurrent = goals.reduce((sum, goal) => sum + goal.currentAmountCents, 0);
  const totalMonthly = goals.reduce((sum, goal) => sum + goal.monthlyTargetCents, 0);

  function resetForm() {
    setName("");
    setType("EMERGENCY_FUND");
    setTarget("");
    setCurrent("0");
    setMonthly("");
    setTargetDate("");
    setLinkedAccountId("");
    setColor(colors[0]);
    setError("");
  }

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          targetAmountCents: cents(target),
          currentAmountCents: cents(current),
          monthlyTargetCents: cents(monthly),
          targetDate: targetDate ? new Date(`${targetDate}T12:00:00`).toISOString() : null,
          linkedAccountId: linkedAccountId || null,
          color,
        }),
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const errorBody = body as { error?: string };
        setError(errorBody.error ?? "Unable to create goal.");
        return;
      }
      const createdGoal = body as GoalResponse;
      setGoals((currentGoals) => [
        ...currentGoals,
        {
          ...createdGoal,
          targetDate: createdGoal.targetDate ? new Date(createdGoal.targetDate) : undefined,
        },
      ]);
      setOpen(false);
      resetForm();
    } catch {
      setError("Unable to reach MoneyOS. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><Target size={13} /> Goal targets</span><strong className="metric-value">{formatCurrency(totalTarget, true)}</strong><span className="metric-meta">Across {goals.length} goals</span></div>
        <div className="metric-cell"><span className="metric-label">Current progress</span><strong className="metric-value">{formatCurrency(totalCurrent, true)}</strong><span className="metric-meta positive">{formatPercent(totalCurrent / Math.max(1, totalTarget), 0)} funded</span></div>
        <div className="metric-cell"><span className="metric-label">Monthly target</span><strong className="metric-value">{formatCurrency(totalMonthly, true)}</strong><span className="metric-meta">Planned contributions</span></div>
        <div className="metric-cell"><span className="metric-label">On track</span><strong className="metric-value">{progress.filter((goal) => goal.onTrack !== false).length}/{progress.length}</strong><span className="metric-meta">At current targets</span></div>
      </section>

      <section className="goals-grid">
        {progress.map((goal) => (
          <article className="panel goal-card" key={goal.id}>
            <header><span className="goal-color" style={{ background: goal.color }} /><div><span>{titleCase(goal.type)}</span><h2>{goal.name}</h2></div><b>{formatPercent(goal.progress, 0)}</b></header>
            <div className="goal-amount"><strong>{formatCurrency(goal.currentAmountCents, true)}</strong><span>of {formatCurrency(goal.targetAmountCents, true)}</span></div>
            <div className="goal-progress"><span style={{ width: `${goal.progress * 100}%`, background: goal.color }} /></div>
            <dl>
              <div><dt>Remaining</dt><dd>{formatCurrency(goal.remainingCents, true)}</dd></div>
              <div><dt>Monthly target</dt><dd>{formatCurrency(goal.monthlyTargetCents, true)}</dd></div>
              <div><dt>Estimated</dt><dd>{goal.estimatedCompletion ? format(goal.estimatedCompletion, "MMM yyyy") : "Not available"}</dd></div>
              <div><dt>Target date</dt><dd>{goal.targetDate ? format(goal.targetDate, "MMM yyyy") : "No date"}</dd></div>
            </dl>
            <footer>
              {goal.onTrack === null ? <span className="badge">No deadline</span> : goal.onTrack ? <span className="badge badge-positive"><Check size={11} /> On track</span> : <span className="badge badge-attention">Behind target</span>}
              {goal.linkedAccountId && <span className="muted">{accounts.find((account) => account.id === goal.linkedAccountId)?.name}</span>}
            </footer>
          </article>
        ))}
        <button type="button" className="add-goal-tile" onClick={() => setOpen(true)}><span className="state-icon"><Plus size={20} /></span><strong>Add a financial goal</strong><small>Set a target and contribution pace</small></button>
      </section>

      <section className="contribution-note"><Target size={17} /><p>Completion estimates use the monthly contribution target only. MoneyOS does not assume or promise investment returns.</p></section>

      {open && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Create financial goal">
          <button className="modal-backdrop" onClick={() => setOpen(false)} aria-label="Close goal form" />
          <form className="modal" onSubmit={createGoal}>
            <header><div><span className="eyebrow">New goal</span><h2>Create a financial target</h2></div><button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></header>
            <div className="modal-content">
              <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" minLength={2} maxLength={80} required /></label>
              <label className="field"><span>Goal type</span><select value={type} onChange={(event) => setType(event.target.value as GoalRecord["type"])}>{goalTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <div className="form-grid">
                <label className="field"><span>Target amount</span><input type="number" min="1" step="0.01" value={target} onChange={(event) => setTarget(event.target.value)} required /></label>
                <label className="field"><span>Current amount</span><input type="number" min="0" step="0.01" value={current} onChange={(event) => setCurrent(event.target.value)} required /></label>
              </div>
              <div className="form-grid">
                <label className="field"><span>Monthly target</span><input type="number" min="0" step="0.01" value={monthly} onChange={(event) => setMonthly(event.target.value)} required /></label>
                <label className="field"><span>Target date</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
              </div>
              <label className="field"><span>Linked account</span><select value={linkedAccountId} onChange={(event) => setLinkedAccountId(event.target.value)}><option value="">No linked account</option>{accounts.filter((account) => ["CHECKING", "SAVINGS", "CASH", "BROKERAGE"].includes(account.type)).map((account) => <option value={account.id} key={account.id}>{account.name} · {formatCurrency(account.balanceCents, true)}</option>)}</select></label>
              <fieldset className="color-field"><legend>Color</legend><div>{colors.map((value) => <button key={value} type="button" className={color === value ? "selected" : undefined} style={{ background: value }} onClick={() => setColor(value)} aria-label={`Use ${value} color`}>{color === value && <Check size={13} />}</button>)}</div></fieldset>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
            <footer><button type="button" className="button button-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}{pending ? "Creating" : "Create goal"}</button></footer>
          </form>
        </div>
      )}
    </>
  );
}
