"use client";

import { format } from "date-fns";
import { CalendarPlus, Check, LoaderCircle, Plus, Target, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { calculateGoalProgress, calculateGoalScenario } from "@/domain/calculations";
import type {
  AccountRecord,
  GoalContributionRecord,
  GoalRecord,
} from "@/domain/types";
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
type ContributionResponse = Omit<GoalContributionRecord, "date"> & { date: string };

function cents(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function GoalsView({
  initialGoals,
  initialContributions,
  accounts,
  anchor,
}: {
  initialGoals: GoalRecord[];
  initialContributions: GoalContributionRecord[];
  accounts: AccountRecord[];
  anchor: Date;
}) {
  const router = useRouter();
  const [goals, setGoals] = useState(initialGoals);
  const [contributions, setContributions] = useState(initialContributions);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalRecord["type"]>("EMERGENCY_FUND");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("0");
  const [monthly, setMonthly] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [contributionGoalId, setContributionGoalId] = useState<string | null>(null);
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionDate, setContributionDate] = useState(
    anchor.toISOString().slice(0, 10),
  );
  const [contributionNotes, setContributionNotes] = useState("");
  const [plannerGoalId, setPlannerGoalId] = useState(
    initialGoals.find((goal) => goal.type === "CAR")?.id ?? initialGoals[0]?.id ?? "",
  );
  const [scenarioMonthly, setScenarioMonthly] = useState("250");
  const progress = useMemo(
    () => goals.map((goal) => calculateGoalProgress(goal, anchor, contributions)),
    [goals, anchor, contributions],
  );
  const plannerGoal = goals.find((goal) => goal.id === plannerGoalId);
  const scenario = plannerGoal
    ? calculateGoalScenario(plannerGoal, cents(scenarioMonthly), anchor)
    : undefined;
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
    setNotes("");
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
          notes: notes || undefined,
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
      router.refresh();
    } catch {
      setError("Unable to reach MoneyOS. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function addContribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contributionGoalId) return;
    setPending(true);
    setError("");
    try {
      const amountCents = cents(contributionAmount);
      const response = await fetch(
        "/api/goals/" + contributionGoalId + "/contributions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCents,
            date: new Date(contributionDate + "T12:00:00").toISOString(),
            notes: contributionNotes || undefined,
          }),
        },
      );
      const body = (await response.json()) as ContributionResponse | { error?: string };
      if (!response.ok || !("date" in body)) {
        setError(
          "error" in body
            ? body.error ?? "Unable to add contribution."
            : "Unable to add contribution.",
        );
        return;
      }
      const created = { ...body, date: new Date(body.date) };
      setContributions((current) => [created, ...current]);
      setGoals((current) =>
        current.map((goal) =>
          goal.id === contributionGoalId
            ? {
                ...goal,
                currentAmountCents: goal.currentAmountCents + amountCents,
              }
            : goal,
        ),
      );
      setContributionGoalId(null);
      setContributionAmount("");
      setContributionNotes("");
      router.refresh();
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
              <div><dt>Actual monthly average</dt><dd>{goal.paceSource === "HISTORY" ? formatCurrency(goal.averageContributionCents, true) : "No history"}</dd></div>
              <div><dt>Estimated</dt><dd>{goal.estimatedCompletion ? format(goal.estimatedCompletion, "MMM yyyy") : "Not available"}</dd></div>
              <div><dt>Target date</dt><dd>{goal.targetDate ? format(goal.targetDate, "MMM yyyy") : "No date"}</dd></div>
            </dl>
            <footer>
              {goal.onTrack === null ? <span className="badge">No deadline</span> : goal.onTrack ? <span className="badge badge-positive"><Check size={11} /> On track</span> : <span className="badge badge-attention">Behind target</span>}
              {goal.linkedAccountId && <span className="muted">{accounts.find((account) => account.id === goal.linkedAccountId)?.name}</span>}
              <button
                type="button"
                className="icon-button"
                title="Add contribution"
                aria-label={"Add contribution to " + goal.name}
                onClick={() => {
                  setError("");
                  setContributionGoalId(goal.id);
                }}
              >
                <CalendarPlus size={14} />
              </button>
            </footer>
            {goal.notes && <p className="goal-note">{goal.notes}</p>}
          </article>
        ))}
        <button type="button" className="add-goal-tile" onClick={() => setOpen(true)}><span className="state-icon"><Plus size={20} /></span><strong>Add a financial goal</strong><small>Set a target and contribution pace</small></button>
      </section>

      <section className="panel goal-planner">
        <div className="panel-header"><div><h2>Contribution planner</h2><p>Compare a monthly saving pace with no assumed investment return</p></div><span className="badge">0% return assumed</span></div>
        <div className="goal-planner-grid">
          <div className="goal-planner-controls">
            <label className="field"><span>Goal</span><select value={plannerGoalId} onChange={(event) => setPlannerGoalId(event.target.value)}>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select></label>
            <label className="field"><span>Monthly contribution</span><input type="number" min="1" step="0.01" value={scenarioMonthly} onChange={(event) => setScenarioMonthly(event.target.value)} /></label>
          </div>
          <dl className="scenario-results">
            <div><dt>Current balance</dt><dd>{formatCurrency(plannerGoal?.currentAmountCents ?? 0, true)}</dd></div>
            <div><dt>Remaining</dt><dd>{formatCurrency(scenario?.remainingCents ?? 0, true)}</dd></div>
            <div><dt>Months at this pace</dt><dd>{scenario?.monthsRemaining ?? "Not available"}</dd></div>
            <div><dt>Estimated completion</dt><dd>{scenario?.estimatedCompletion ? format(scenario.estimatedCompletion, "MMM yyyy") : "Not available"}</dd></div>
          </dl>
          <div className="goal-history">
            <strong>Recent contributions</strong>
            {contributions.filter((entry) => entry.goalId === plannerGoalId).slice(0, 5).map((entry) => (
              <div key={entry.id}><span>{format(entry.date, "MMM d, yyyy")}<small>{entry.source === "TRANSFER" ? "Linked transfer" : "Manual"}</small></span><b>{formatCurrency(entry.amountCents)}</b></div>
            ))}
            {contributions.every((entry) => entry.goalId !== plannerGoalId) && <p className="muted">No contribution history yet.</p>}
          </div>
        </div>
      </section>

      <section className="contribution-note"><Target size={17} /><p>Actual contribution history drives the default estimate when available. The scenario calculator assumes 0% return and does not promise investment growth.</p></section>

      {contributionGoalId && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Add goal contribution">
          <button className="modal-backdrop" onClick={() => setContributionGoalId(null)} aria-label="Close contribution form" />
          <form className="modal" onSubmit={addContribution}>
            <header><div><span className="eyebrow">Goal contribution</span><h2>{goals.find((goal) => goal.id === contributionGoalId)?.name}</h2></div><button className="icon-button" type="button" onClick={() => setContributionGoalId(null)} aria-label="Close"><X size={17} /></button></header>
            <div className="modal-content">
              <label className="field"><span>Amount</span><input type="number" min="0.01" step="0.01" value={contributionAmount} onChange={(event) => setContributionAmount(event.target.value)} required autoFocus /></label>
              <label className="field"><span>Date</span><input type="date" value={contributionDate} onChange={(event) => setContributionDate(event.target.value)} required /></label>
              <label className="field"><span>Notes</span><textarea value={contributionNotes} onChange={(event) => setContributionNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Optional context" /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
            </div>
            <footer><button type="button" className="button button-secondary" onClick={() => setContributionGoalId(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={pending}>{pending ? <LoaderCircle size={15} className="spin" /> : <CalendarPlus size={15} />}{pending ? "Adding" : "Add contribution"}</button></footer>
          </form>
        </div>
      )}

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
              <label className="field"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Optional context" /></label>
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
