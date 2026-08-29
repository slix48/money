import type { Metadata } from "next";
import { Landmark, PiggyBank, ReceiptText, Scale, TrendingUp } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { MoneyFlowExplorer, type FlowDetail } from "@/components/money-flow/money-flow-explorer";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import {
  calculateCashFlow,
  calculateSpendingByCategory,
  getMonthRange,
} from "@/domain/calculations";
import type { MoneyFlow } from "@/domain/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Money Flow" };

const necessities = new Set(["Housing", "Food", "Transportation", "Health", "Education", "Utilities", "Insurance"]);
const wants = new Set(["Dining", "Shopping", "Entertainment", "Travel", "Subscriptions"]);

export default async function CashFlowPage() {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const range = getMonthRange(snapshot.generatedAt);
  const flow = calculateCashFlow(snapshot, range);
  const spending = calculateSpendingByCategory(snapshot.transactions, range);
  const currentTransactions = snapshot.transactions.filter(
    (transaction) => !transaction.isPending && transaction.date >= range.from && transaction.date <= range.to,
  );

  const detailRecord: Record<MoneyFlow["branches"][number]["key"], FlowDetail[]> = {
    necessities: spending.byCategory
      .filter((entry) => necessities.has(entry.category))
      .map((entry) => ({ label: entry.category, amountCents: entry.amountCents, meta: "Settled spending" })),
    wants: spending.byCategory
      .filter((entry) => wants.has(entry.category))
      .map((entry) => ({ label: entry.category, amountCents: entry.amountCents, meta: "Settled spending" })),
    debt: currentTransactions
      .filter((transaction) => transaction.transactionType === "DEBT_PAYMENT")
      .map((transaction) => ({ label: transaction.merchant, amountCents: Math.abs(transaction.amountCents), meta: transaction.subcategory ?? "Debt payment" })),
    "cash-savings": currentTransactions
      .filter((transaction) => transaction.transactionType === "TRANSFER" && transaction.subcategory === "Cash savings")
      .map((transaction) => ({ label: transaction.description, amountCents: Math.abs(transaction.amountCents), meta: "Internal transfer" })),
    investments: currentTransactions
      .filter((transaction) => transaction.transactionType === "INVESTMENT_CONTRIBUTION")
      .map((transaction) => ({ label: transaction.merchant, amountCents: Math.abs(transaction.amountCents), meta: transaction.subcategory ?? "Contribution" })),
    unallocated: [],
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Allocation" title="Money flow" description="Where settled income went across living costs, debt reduction, cash savings, and investment contributions." />
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><Landmark size={13} /> Income</span><strong className="metric-value">{formatCurrency(flow.incomeCents, true)}</strong><span className="metric-meta">Current month</span></div>
        <div className="metric-cell"><span className="metric-label"><ReceiptText size={13} /> Spending</span><strong className="metric-value">{formatCurrency(flow.necessitiesCents + flow.wantsCents, true)}</strong><span className="metric-meta">Necessities and wants</span></div>
        <div className="metric-cell"><span className="metric-label"><PiggyBank size={13} /> Cash savings</span><strong className="metric-value">{formatCurrency(flow.cashSavingsCents, true)}</strong><span className="metric-meta">{formatPercent(flow.cashSavingsCents / Math.max(1, flow.incomeCents))} of income</span></div>
        <div className="metric-cell"><span className="metric-label"><TrendingUp size={13} /> Investments</span><strong className="metric-value">{formatCurrency(flow.investmentsCents, true)}</strong><span className="metric-meta">Contributions only</span></div>
      </section>
      <MoneyFlowExplorer flow={flow} details={detailRecord} />
      <section className="reconciliation-strip">
        <Scale size={17} />
        <div><strong>Flow reconciles to income</strong><p>Credit-card payments and internal transfers are excluded from spending. Refunds reduce their original category. Pending activity is excluded.</p></div>
        <b>{formatCurrency(flow.branches.reduce((sum, branch) => sum + branch.amountCents, 0), true)}</b>
      </section>
    </div>
  );
}
