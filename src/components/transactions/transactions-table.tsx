"use client";

import { format } from "date-fns";
import {
  Check,
  ChevronRight,
  Filter,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  AccountRecord,
  CategoryName,
  TransactionRecord,
} from "@/domain/types";
import { formatSignedCurrency, titleCase } from "@/lib/format";

type StatusFilter = "ALL" | "SETTLED" | "PENDING" | "RECURRING";
type SortOption = "NEWEST" | "OLDEST" | "HIGHEST" | "LOWEST";

export function TransactionsTable({
  initialTransactions,
  accounts,
  categories,
  initialCategory,
}: {
  initialTransactions: TransactionRecord[];
  accounts: AccountRecord[];
  categories: CategoryName[];
  initialCategory?: string;
}) {
  const router = useRouter();
  const validInitialCategory = categories.includes(initialCategory as CategoryName)
    ? (initialCategory as CategoryName)
    : "ALL";
  const [transactions, setTransactions] = useState(initialTransactions);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryName | "ALL">(validInitialCategory);
  const [accountId, setAccountId] = useState("ALL");
  const [merchant, setMerchant] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [type, setType] = useState<TransactionRecord["transactionType"] | "ALL">("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sort, setSort] = useState<SortOption>("NEWEST");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<CategoryName>("Other");
  const [editNotes, setEditNotes] = useState("");
  const [editRecurring, setEditRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const accountMap = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const merchants = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.merchant))].sort(),
    [transactions],
  );

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...transactions]
      .filter((transaction) => {
        const matchesQuery =
          !normalizedQuery ||
          transaction.merchant.toLowerCase().includes(normalizedQuery) ||
          transaction.rawMerchant?.toLowerCase().includes(normalizedQuery) ||
          transaction.description.toLowerCase().includes(normalizedQuery) ||
          transaction.rawDescription?.toLowerCase().includes(normalizedQuery) ||
          transaction.notes?.toLowerCase().includes(normalizedQuery);
        const matchesAccount = accountId === "ALL" || transaction.accountId === accountId;
        const matchesMerchant = merchant === "ALL" || transaction.merchant === merchant;
        const matchesCategory = category === "ALL" || transaction.category === category;
        const matchesType = type === "ALL" || transaction.transactionType === type;
        const matchesStatus =
          status === "ALL" ||
          (status === "SETTLED" && !transaction.isPending) ||
          (status === "PENDING" && transaction.isPending) ||
          (status === "RECURRING" && transaction.isRecurring);
        const from = dateFrom ? new Date(dateFrom + "T00:00:00") : undefined;
        const to = dateTo ? new Date(dateTo + "T23:59:59.999") : undefined;
        const matchesDate =
          (!from || transaction.date >= from) && (!to || transaction.date <= to);
        return (
          matchesQuery &&
          matchesAccount &&
          matchesMerchant &&
          matchesCategory &&
          matchesType &&
          matchesStatus &&
          matchesDate
        );
      })
      .sort((left, right) => {
        if (sort === "OLDEST") return left.date.getTime() - right.date.getTime();
        if (sort === "HIGHEST") return Math.abs(right.amountCents) - Math.abs(left.amountCents);
        if (sort === "LOWEST") return Math.abs(left.amountCents) - Math.abs(right.amountCents);
        return right.date.getTime() - left.date.getTime();
      });
  }, [
    transactions,
    query,
    accountId,
    merchant,
    category,
    type,
    status,
    dateFrom,
    dateTo,
    sort,
  ]);

  const active = transactions.find((transaction) => transaction.id === activeId);

  function openTransaction(transaction: TransactionRecord) {
    setActiveId(transaction.id);
    setEditCategory(transaction.category);
    setEditNotes(transaction.notes ?? "");
    setEditRecurring(transaction.isRecurring);
    setSaveError("");
    setSaved(false);
  }

  async function saveTransaction() {
    if (!active) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(active.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: editCategory,
          notes: editNotes.trim() || null,
          isRecurring: editRecurring,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSaveError(body.error ?? "Unable to save transaction.");
        return;
      }
      setTransactions((current) =>
        current.map((transaction) =>
          transaction.id === active.id
            ? {
                ...transaction,
                category: editCategory,
                notes: editNotes.trim() || undefined,
                isRecurring: editRecurring,
                updatedAt: new Date(),
              }
            : transaction,
        ),
      );
      setSaved(true);
      router.refresh();
    } catch {
      setSaveError("Unable to reach MoneyOS. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <div className="toolbar-group grow">
            <label className="search-field">
              <Search size={15} />
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search merchant, description, or note"
                aria-label="Search transactions"
              />
            </label>
          </div>
          <div className="toolbar-group">
            <Filter size={14} className="muted" />
            <select
              className="select-control"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              aria-label="Filter by account"
            >
              <option value="ALL">All accounts</option>
              {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
            </select>
            <select
              className="select-control"
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
              aria-label="Filter by merchant"
            >
              <option value="ALL">All merchants</option>
              {merchants.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
            <select
              className="select-control"
              value={category}
              onChange={(event) => setCategory(event.target.value as CategoryName | "ALL")}
              aria-label="Filter by category"
            >
              <option value="ALL">All categories</option>
              {categories.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
            <select
              className="select-control"
              value={type}
              onChange={(event) => setType(event.target.value as TransactionRecord["transactionType"] | "ALL")}
              aria-label="Filter by type"
            >
              <option value="ALL">All types</option>
              <option value="EXPENSE">Expenses</option>
              <option value="INCOME">Income</option>
              <option value="REFUND">Refunds</option>
              <option value="TRANSFER">Transfers</option>
              <option value="INVESTMENT_CONTRIBUTION">Contributions</option>
              <option value="DEBT_PAYMENT">Debt payments</option>
              <option value="INVESTMENT_ACTIVITY">Investment activity</option>
              <option value="ADJUSTMENT">Adjustments</option>
            </select>
            <select
              className="select-control"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              aria-label="Filter by status"
            >
              <option value="ALL">All statuses</option>
              <option value="SETTLED">Settled</option>
              <option value="PENDING">Pending</option>
              <option value="RECURRING">Recurring</option>
            </select>
            <input
              className="select-control date-control"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label="Transactions from date"
            />
            <input
              className="select-control date-control"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label="Transactions through date"
            />
            <SlidersHorizontal size={14} className="muted" />
            <select
              className="select-control"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortOption)}
              aria-label="Sort transactions"
            >
              <option value="NEWEST">Newest first</option>
              <option value="OLDEST">Oldest first</option>
              <option value="HIGHEST">Highest amount</option>
              <option value="LOWEST">Lowest amount</option>
            </select>
          </div>
        </div>
        <div className="table-summary">
          <span>{visible.length} transaction{visible.length === 1 ? "" : "s"}</span>
          {(accountId !== "ALL" || merchant !== "ALL" || category !== "ALL" || type !== "ALL" || status !== "ALL" || dateFrom || dateTo || query) && (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setQuery("");
                setAccountId("ALL");
                setMerchant("ALL");
                setCategory("ALL");
                setType("ALL");
                setStatus("ALL");
                setDateFrom("");
                setDateTo("");
              }}
            >
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="data-table transactions-table">
            <thead>
              <tr><th>Date</th><th>Merchant</th><th>Account</th><th>Category</th><th>Status</th><th className="text-right">Amount</th><th aria-label="Details" /></tr>
            </thead>
            <tbody>
              {visible.map((transaction) => (
                <tr
                  key={transaction.id}
                  className="interactive-row"
                  tabIndex={0}
                  onClick={() => openTransaction(transaction)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openTransaction(transaction);
                    }
                  }}
                  aria-label={`View ${transaction.merchant} transaction`}
                >
                  <td>{format(transaction.date, "MMM d, yyyy")}</td>
                  <td>
                    <div className="merchant-cell">
                      <span className="merchant-icon">{transaction.merchant.slice(0, 1)}</span>
                      <div className="merchant-copy"><strong>{transaction.merchant}</strong><span>{transaction.description}</span></div>
                    </div>
                  </td>
                  <td>{accountMap.get(transaction.accountId)?.name ?? "Unknown account"}</td>
                  <td><span className="badge">{transaction.category}</span></td>
                  <td>
                    {transaction.isPending ? (
                      <span className="badge badge-attention">Pending</span>
                    ) : transaction.isRecurring ? (
                      <span className="badge badge-positive">Recurring</span>
                    ) : (
                      <span className="muted">Settled</span>
                    )}
                  </td>
                  <td className={`amount-cell ${transaction.amountCents > 0 ? "positive" : ""}`}>
                    {formatSignedCurrency(transaction.amountCents)}
                  </td>
                  <td><ChevronRight size={14} className="muted" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && (
            <div className="empty-state">
              <div><span className="state-icon"><Search size={20} /></span><h3>No matching transactions</h3><p>Adjust the search or filter selections.</p></div>
            </div>
          )}
        </div>
      </section>

      {active && (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="Transaction details">
          <button className="drawer-backdrop" onClick={() => setActiveId(null)} aria-label="Close transaction details" />
          <aside className="drawer">
            <header className="drawer-header">
              <div><span className="eyebrow">Transaction detail</span><h2>{active.merchant}</h2></div>
              <button type="button" className="icon-button" onClick={() => setActiveId(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="drawer-content">
              <div className="transaction-amount-block">
                <strong className={active.amountCents > 0 ? "positive" : ""}>{formatSignedCurrency(active.amountCents)}</strong>
                <span>{active.isPending ? "Pending" : "Settled"} · {format(active.date, "MMMM d, yyyy")}</span>
              </div>
              <dl className="detail-list">
                <div><dt>Account</dt><dd>{accountMap.get(active.accountId)?.name ?? "Unknown"}</dd></div>
                <div><dt>Type</dt><dd>{titleCase(active.transactionType)}</dd></div>
                <div><dt>Source</dt><dd>{titleCase(active.source)}</dd></div>
                <div><dt>Description</dt><dd>{active.description}</dd></div>
                {active.rawMerchant && active.rawMerchant !== active.merchant && <div><dt>Original merchant</dt><dd>{active.rawMerchant}</dd></div>}
                {active.rawDescription && active.rawDescription !== active.description && <div><dt>Original description</dt><dd>{active.rawDescription}</dd></div>}
              </dl>
              <div className="drawer-divider" />
              <label className="field">
                <span>Category</span>
                <select value={editCategory} onChange={(event) => setEditCategory(event.target.value as CategoryName)}>
                  {categories.map((name) => <option value={name} key={name}>{name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  placeholder="Add a private note"
                  maxLength={1000}
                />
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={editRecurring} onChange={(event) => setEditRecurring(event.target.checked)} />
                <span><strong>Recurring transaction</strong><small>Include this merchant in recurring activity.</small></span>
              </label>
              {saveError && <p className="form-error" role="alert">{saveError}</p>}
              {saved && <p className="save-success"><Check size={14} /> Transaction updated</p>}
            </div>
            <footer className="drawer-footer">
              <button type="button" className="button button-secondary" onClick={() => setActiveId(null)}>Close</button>
              <button type="button" className="button button-primary" onClick={saveTransaction} disabled={saving}>
                {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
                {saving ? "Saving" : "Save changes"}
              </button>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
