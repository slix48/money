import type { Metadata } from "next";
import { ArrowDownRight, Clock3, ReceiptText, RotateCcw } from "lucide-react";
import { requireUser } from "@/auth/dal";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { PageHeader } from "@/components/ui/page-header";
import { getFinancialRepository } from "@/data/get-repository";
import { DEFAULT_CATEGORIES } from "@/domain/demo-data";
import { calculatePeriodSummary, getMonthRange } from "@/domain/calculations";
import { formatCurrency } from "@/lib/format";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const user = await requireUser();
  const repository = await getFinancialRepository();
  const snapshot = await repository.getSnapshot(user.id);
  const params = await searchParams;
  const range = getMonthRange(snapshot.generatedAt);
  const summary = calculatePeriodSummary(snapshot, range);
  const current = snapshot.transactions.filter(
    (transaction) => transaction.date >= range.from && transaction.date <= range.to,
  );
  const pending = current.filter((transaction) => transaction.isPending);
  const refunds = current
    .filter((transaction) => !transaction.isPending && transaction.transactionType === "REFUND")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Ledger"
        title="Transactions"
        description="Search, review, recategorize, and annotate activity across every account."
      />
      <section className="metric-strip">
        <div className="metric-cell"><span className="metric-label"><ReceiptText size={13} /> Settled spending</span><strong className="metric-value">{formatCurrency(summary.spendingCents, true)}</strong><span className="metric-meta">Transfers excluded</span></div>
        <div className="metric-cell"><span className="metric-label"><ArrowDownRight size={13} /> Transactions</span><strong className="metric-value">{current.length}</strong><span className="metric-meta">This month</span></div>
        <div className="metric-cell"><span className="metric-label"><Clock3 size={13} /> Pending</span><strong className="metric-value">{formatCurrency(pending.reduce((sum, item) => sum + Math.abs(item.amountCents), 0), true)}</strong><span className="metric-meta">Excluded from totals</span></div>
        <div className="metric-cell"><span className="metric-label"><RotateCcw size={13} /> Refunds</span><strong className="metric-value">{formatCurrency(refunds, true)}</strong><span className="metric-meta">Netted by category</span></div>
      </section>
      <TransactionsTable
        initialTransactions={snapshot.transactions}
        accounts={snapshot.accounts}
        categories={DEFAULT_CATEGORIES.map((category) => category.name)}
        initialCategory={params.category}
      />
    </div>
  );
}
