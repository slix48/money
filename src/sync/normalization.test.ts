import { describe, expect, it } from "vitest";
import type {
  NormalizedProviderAccount,
  NormalizedProviderTransaction,
} from "@/providers/financial-data";
import {
  classifyProviderTransaction,
  reconcileProviderTransactions,
} from "@/sync/normalization";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const accounts: NormalizedProviderAccount[] = [
  { externalId: "checking", name: "Checking", institutionName: "Test", type: "CHECKING", balanceCents: 100_000, currency: "USD", isLiability: false, balanceAsOf: NOW },
  { externalId: "savings", name: "Savings", institutionName: "Test", type: "SAVINGS", balanceCents: 200_000, currency: "USD", isLiability: false, balanceAsOf: NOW },
  { externalId: "card", name: "Card", institutionName: "Test", type: "CREDIT_CARD", balanceCents: 80_000, currency: "USD", isLiability: true, balanceAsOf: NOW },
  { externalId: "brokerage", name: "Brokerage", institutionName: "Test", type: "BROKERAGE", balanceCents: 40_000, currency: "USD", isLiability: false, balanceAsOf: NOW },
];

function transaction(input: Partial<NormalizedProviderTransaction> & Pick<NormalizedProviderTransaction, "externalId" | "accountExternalId" | "amountCents">): NormalizedProviderTransaction {
  return { date: NOW, rawName: "Transaction", currency: "USD", isPending: false, ...input };
}

describe("provider normalization and reconciliation", () => {
  it("uses enriched merchant names without destroying raw descriptions", () => {
    const result = classifyProviderTransaction(transaction({
      externalId: "chipotle",
      accountExternalId: "card",
      amountCents: -2_145,
      rawName: "SQ *CHIPOTLE 1234",
      providerMerchantName: "Chipotle",
      originalDescription: "SQ *CHIPOTLE 1234 NEW YORK NY",
      categoryHint: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_FAST_FOOD" },
    }));
    expect(result).toMatchObject({ merchant: "Chipotle", normalizedMerchant: "chipotle", category: "Dining", transactionType: "EXPENSE" });
    expect(result.description).toContain("SQ *CHIPOTLE");
  });

  it("does not classify an unexplained positive credit as income", () => {
    expect(classifyProviderTransaction(transaction({ externalId: "credit", accountExternalId: "checking", amountCents: 5_000 })).transactionType).toBe("ADJUSTMENT");
  });

  it("reconciles both sides of an internal transfer", () => {
    const result = reconcileProviderTransactions([
      transaction({ externalId: "out", accountExternalId: "checking", amountCents: -50_000, rawName: "Online transfer to savings", categoryHint: { primary: "TRANSFER_OUT" } }),
      transaction({ externalId: "in", accountExternalId: "savings", amountCents: 50_000, rawName: "Online transfer from checking", categoryHint: { primary: "TRANSFER_IN" } }),
    ], accounts);
    expect(result.map((item) => item.transactionType)).toEqual(["TRANSFER", "TRANSFER"]);
    expect(result[0].transferPairId).toBe(result[1].transferPairId);
    expect(result[0].reconciliationConfidence).toBeGreaterThan(0.9);
  });

  it("reconciles a card payment without creating spending", () => {
    const result = reconcileProviderTransactions([
      transaction({ externalId: "bank-payment", accountExternalId: "checking", amountCents: -80_000, rawName: "Payment to credit card" }),
      transaction({ externalId: "card-payment", accountExternalId: "card", amountCents: 80_000, rawName: "Payment received thank you" }),
    ], accounts);
    expect(result.find((item) => item.externalId === "bank-payment")?.transactionType).toBe("DEBT_PAYMENT");
    expect(result.find((item) => item.externalId === "card-payment")?.transactionType).toBe("TRANSFER");
  });

  it("separates an investment contribution from return", () => {
    const result = reconcileProviderTransactions([
      transaction({ externalId: "bank-invest", accountExternalId: "checking", amountCents: -40_000, rawName: "Transfer to brokerage" }),
      transaction({ externalId: "broker-invest", accountExternalId: "brokerage", amountCents: 40_000, rawName: "Transfer from checking" }),
    ], accounts);
    expect(result.find((item) => item.externalId === "bank-invest")?.transactionType).toBe("INVESTMENT_CONTRIBUTION");
    expect(result.find((item) => item.externalId === "broker-invest")?.transactionType).toBe("TRANSFER");
  });

  it("matches a refund to an earlier merchant purchase", () => {
    const [refund] = reconcileProviderTransactions([
      transaction({ externalId: "refund", accountExternalId: "card", amountCents: 4_500, rawName: "AMAZON REFUND", providerMerchantName: "Amazon" }),
    ], accounts, [{ externalId: "purchase", accountExternalId: "card", date: new Date("2026-08-01T12:00:00Z"), merchant: "Amazon", normalizedMerchant: "amazon", amountCents: -8_000, category: "Shopping", transactionType: "EXPENSE" }]);
    expect(refund).toMatchObject({ transactionType: "REFUND", category: "Shopping", refundForExternalId: "purchase" });
  });

  it("leaves uncertain equal amounts unmatched", () => {
    const result = reconcileProviderTransactions([
      transaction({ externalId: "a", accountExternalId: "checking", amountCents: -2_000, rawName: "Coffee" }),
      transaction({ externalId: "b", accountExternalId: "savings", amountCents: 2_000, rawName: "Adjustment" }),
    ], accounts);
    expect(result[0].transferPairId).toBeUndefined();
    expect(result[1].transactionType).toBe("ADJUSTMENT");
  });
});
