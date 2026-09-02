import { differenceInCalendarDays } from "date-fns";
import { normalizeMerchant } from "@/domain/calculations";
import type {
  CategoryName,
  IncomeType,
  TransactionType,
} from "@/domain/types";
import type {
  NormalizedProviderAccount,
  NormalizedProviderTransaction,
} from "@/providers/financial-data";

export interface ClassifiedProviderTransaction
  extends NormalizedProviderTransaction {
  merchant: string;
  normalizedMerchant: string;
  description: string;
  category: CategoryName;
  subcategory?: string;
  transactionType: TransactionType;
  incomeType?: IncomeType;
  linkedAccountExternalId?: string;
  transferPairId?: string;
  refundForExternalId?: string;
  reconciliationConfidence?: number;
  reconciliationReason?: string;
}

export interface PreviousTransactionForReconciliation {
  externalId: string;
  accountExternalId: string;
  date: Date;
  merchant: string;
  normalizedMerchant: string;
  amountCents: number;
  category: CategoryName;
  transactionType: TransactionType;
}

const CARD_PAYMENT = /\b(card(?:member)?|credit card|payment received|autopay|pay(?:ment)? to (?:card|chase|amex|discover|citi|capital one))\b/i;
const TRANSFER = /\b(transfer|xfer|internal|sweep|account to account)\b/i;
const REFUND = /\b(refund|reversal|returned?|credit adjustment)\b/i;
const INCOME = /\b(payroll|paycheck|salary|direct deposit|employer|wages?)\b/i;

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function merchantName(transaction: NormalizedProviderTransaction): string {
  const enriched = transaction.providerMerchantName?.trim();
  if (enriched) return enriched;
  const normalized = normalizeMerchant(transaction.rawName);
  return normalized ? titleCase(normalized) : transaction.rawName.trim();
}

function categoryFromProvider(
  primary = "",
  detailed = "",
): { category: CategoryName; subcategory?: string } {
  const code = `${primary}_${detailed}`.toUpperCase();
  if (/RENT|MORTGAGE/.test(code)) return { category: "Housing", subcategory: detailed };
  if (/UTILIT|INTERNET|TELEPHONE/.test(code)) return { category: "Utilities", subcategory: detailed };
  if (/GROCER/.test(code)) return { category: "Food", subcategory: detailed };
  if (/FOOD_AND_DRINK|RESTAURANT|FAST_FOOD|COFFEE/.test(code)) {
    return { category: "Dining", subcategory: detailed };
  }
  if (/TRANSPORTATION|GAS|PARKING|PUBLIC_TRANSIT/.test(code)) {
    return { category: "Transportation", subcategory: detailed };
  }
  if (/SUBSCRIPTION/.test(code)) return { category: "Subscriptions", subcategory: detailed };
  if (/ENTERTAINMENT/.test(code)) return { category: "Entertainment", subcategory: detailed };
  if (/TRAVEL|AIRLINES|LODGING/.test(code)) return { category: "Travel", subcategory: detailed };
  if (/MEDICAL|HEALTH|PHARMAC/.test(code)) return { category: "Health", subcategory: detailed };
  if (/EDUCATION|STUDENT/.test(code)) return { category: "Education", subcategory: detailed };
  if (/INSURANCE/.test(code)) return { category: "Insurance", subcategory: detailed };
  if (/GENERAL_MERCHANDISE|SHOPPING|CLOTHING|ELECTRONICS/.test(code)) {
    return { category: "Shopping", subcategory: detailed };
  }
  if (/INCOME/.test(code)) return { category: "Income", subcategory: detailed };
  if (/TRANSFER|LOAN_PAYMENT/.test(code)) return { category: "Transfers", subcategory: detailed };
  return { category: "Other", subcategory: detailed || undefined };
}

function initialType(
  transaction: NormalizedProviderTransaction,
): { transactionType: TransactionType; incomeType?: IncomeType } {
  const primary = transaction.categoryHint?.primary?.toUpperCase() ?? "";
  const detailed = transaction.categoryHint?.detailed?.toUpperCase() ?? "";
  const text = `${transaction.rawName} ${transaction.originalDescription ?? ""}`;
  if (primary.includes("TRANSFER") || TRANSFER.test(text) || CARD_PAYMENT.test(text)) {
    return { transactionType: "TRANSFER" };
  }
  if (transaction.amountCents > 0 && REFUND.test(text)) {
    return { transactionType: "REFUND" };
  }
  if (primary.includes("INCOME") || (transaction.amountCents > 0 && INCOME.test(text))) {
    const incomeType: IncomeType = /interest/i.test(detailed)
      ? "INTEREST"
      : /dividend/i.test(detailed)
        ? "DIVIDENDS"
        : /payroll|wage|salary/i.test(`${detailed} ${text}`)
          ? "SALARY"
          : "OTHER";
    return { transactionType: "INCOME", incomeType };
  }
  if (primary.includes("LOAN_PAYMENT")) return { transactionType: "DEBT_PAYMENT" };
  if (transaction.amountCents < 0) return { transactionType: "EXPENSE" };
  // A positive credit is not income unless the feed provides supporting evidence.
  return { transactionType: "ADJUSTMENT" };
}

export function classifyProviderTransaction(
  transaction: NormalizedProviderTransaction,
): ClassifiedProviderTransaction {
  const merchant = merchantName(transaction);
  const classified = initialType(transaction);
  const category = categoryFromProvider(
    transaction.categoryHint?.primary,
    transaction.categoryHint?.detailed,
  );
  return {
    ...transaction,
    merchant,
    normalizedMerchant: normalizeMerchant(merchant || transaction.rawName),
    description: transaction.originalDescription ?? transaction.rawName,
    category: classified.transactionType === "INCOME" ? "Income" : category.category,
    subcategory: category.subcategory,
    transactionType: classified.transactionType,
    incomeType: classified.incomeType,
  };
}

function pairReason(
  left: ClassifiedProviderTransaction,
  right: ClassifiedProviderTransaction,
  accounts: Map<string, NormalizedProviderAccount>,
): { confidence: number; reason: "CREDIT_CARD_PAYMENT" | "INTERNAL_TRANSFER" } | undefined {
  if (left.accountExternalId === right.accountExternalId) return undefined;
  if (Math.abs(left.amountCents + right.amountCents) > 1) return undefined;
  if (Math.abs(differenceInCalendarDays(left.date, right.date)) > 3) return undefined;
  const leftAccount = accounts.get(left.accountExternalId);
  const rightAccount = accounts.get(right.accountExternalId);
  if (!leftAccount || !rightAccount) return undefined;
  const text = `${left.rawName} ${left.originalDescription ?? ""} ${right.rawName} ${right.originalDescription ?? ""}`;
  const hasCard = leftAccount.type === "CREDIT_CARD" || rightAccount.type === "CREDIT_CARD";
  if (hasCard && CARD_PAYMENT.test(text)) {
    return { confidence: 0.98, reason: "CREDIT_CARD_PAYMENT" };
  }
  const providerTransfer = [left, right].some((transaction) =>
    transaction.categoryHint?.primary?.toUpperCase().includes("TRANSFER"),
  );
  if (providerTransfer || TRANSFER.test(text)) {
    return {
      confidence: providerTransfer && TRANSFER.test(text) ? 0.97 : 0.91,
      reason: "INTERNAL_TRANSFER",
    };
  }
  return undefined;
}

function applyPair(
  left: ClassifiedProviderTransaction,
  right: ClassifiedProviderTransaction,
  accounts: Map<string, NormalizedProviderAccount>,
  match: NonNullable<ReturnType<typeof pairReason>>,
) {
  const pairId = `provider:${[left.externalId, right.externalId].sort().join(":")}`;
  for (const [transaction, counterpart] of [[left, right], [right, left]] as const) {
    transaction.linkedAccountExternalId = counterpart.accountExternalId;
    transaction.transferPairId = pairId;
    transaction.reconciliationConfidence = match.confidence;
    transaction.reconciliationReason = match.reason;
    transaction.category = "Transfers";
    transaction.incomeType = undefined;
    const account = accounts.get(transaction.accountExternalId)!;
    const counterpartAccount = accounts.get(counterpart.accountExternalId)!;
    if (
      transaction.amountCents < 0 &&
      (account.type === "CHECKING" || account.type === "SAVINGS") &&
      (counterpartAccount.type === "BROKERAGE" || counterpartAccount.type === "RETIREMENT")
    ) {
      transaction.transactionType = "INVESTMENT_CONTRIBUTION";
      transaction.category = "Investments";
    } else if (
      transaction.amountCents < 0 &&
      (counterpartAccount.type === "CREDIT_CARD" || counterpartAccount.type === "LOAN")
    ) {
      transaction.transactionType = "DEBT_PAYMENT";
    } else {
      transaction.transactionType = "TRANSFER";
    }
  }
}

function matchRefunds(
  transactions: ClassifiedProviderTransaction[],
  previous: PreviousTransactionForReconciliation[],
) {
  const expenses = [...previous, ...transactions]
    .filter((transaction) => transaction.transactionType === "EXPENSE" && transaction.amountCents < 0)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
  for (const transaction of transactions) {
    if (
      transaction.amountCents <= 0 ||
      transaction.transactionType === "TRANSFER" ||
      transaction.transactionType === "INCOME"
    ) continue;
    const textSuggestsRefund = REFUND.test(
      `${transaction.rawName} ${transaction.originalDescription ?? ""}`,
    );
    const candidate = expenses.find((expense) =>
      expense.externalId !== transaction.externalId &&
      expense.normalizedMerchant === transaction.normalizedMerchant &&
      expense.date <= transaction.date &&
      differenceInCalendarDays(transaction.date, expense.date) <= 120 &&
      transaction.amountCents <= Math.abs(expense.amountCents),
    );
    if (!candidate && !textSuggestsRefund) continue;
    transaction.transactionType = "REFUND";
    transaction.incomeType = undefined;
    transaction.reconciliationConfidence = candidate ? 0.96 : 0.72;
    transaction.reconciliationReason = candidate
      ? "MERCHANT_REFUND_MATCH"
      : "REFUND_DESCRIPTION";
    if (candidate) {
      transaction.refundForExternalId = candidate.externalId;
      transaction.category = candidate.category;
    }
  }
}

export function reconcileProviderTransactions(
  providerTransactions: NormalizedProviderTransaction[],
  providerAccounts: NormalizedProviderAccount[],
  previousTransactions: PreviousTransactionForReconciliation[] = [],
): ClassifiedProviderTransaction[] {
  const transactions = providerTransactions.map(classifyProviderTransaction);
  const accounts = new Map(providerAccounts.map((account) => [account.externalId, account]));
  const byAmount = new Map<number, ClassifiedProviderTransaction[]>();
  for (const transaction of transactions) {
    const key = Math.abs(transaction.amountCents);
    byAmount.set(key, [...(byAmount.get(key) ?? []), transaction]);
  }
  const paired = new Set<string>();
  for (const candidates of byAmount.values()) {
    for (const left of candidates) {
      if (paired.has(left.externalId)) continue;
      const ranked = candidates
        .filter((right) => right.amountCents === -left.amountCents && !paired.has(right.externalId))
        .map((right) => ({ right, match: pairReason(left, right, accounts) }))
        .filter((candidate): candidate is { right: ClassifiedProviderTransaction; match: NonNullable<ReturnType<typeof pairReason>> } => Boolean(candidate.match))
        .sort((a, b) => b.match.confidence - a.match.confidence);
      const best = ranked[0];
      if (!best) continue;
      applyPair(left, best.right, accounts, best.match);
      paired.add(left.externalId);
      paired.add(best.right.externalId);
    }
  }
  matchRefunds(transactions, previousTransactions);
  return transactions;
}
