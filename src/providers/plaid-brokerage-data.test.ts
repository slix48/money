import { describe, expect, it, vi } from "vitest";
import type { Holding, InvestmentTransaction, Security } from "plaid";

vi.mock("server-only", () => ({}));

import {
  normalizePlaidHolding,
  normalizePlaidInvestmentActivity,
} from "@/providers/plaid-brokerage-data";

const security = {
  security_id: "security-apple",
  ticker_symbol: "AAPL",
  name: "Apple Inc.",
  type: "equity",
  is_cash_equivalent: false,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
  update_datetime: "2026-08-29T20:00:00Z",
} as Security;

describe("Plaid brokerage normalization", () => {
  it("preserves missing cost basis and labels institution prices as delayed", () => {
    const holding = normalizePlaidHolding({
      account_id: "brokerage-1",
      security_id: "security-apple",
      institution_price: 229.5,
      institution_price_as_of: "2026-08-29",
      institution_value: 22_950,
      cost_basis: null,
      quantity: 100,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    } as Holding, security);

    expect(holding).toMatchObject({
      ticker: "AAPL",
      securityType: "STOCK",
      costBasisCents: undefined,
      priceCents: 22_950,
      currentValueCents: 2_295_000,
      priceSource: "PLAID_INSTITUTION",
      priceIsDelayed: true,
    });
  });

  it("maps dividend activity but does not invent realized gain", () => {
    const activity = normalizePlaidInvestmentActivity({
      investment_transaction_id: "dividend-1",
      account_id: "brokerage-1",
      security_id: "security-apple",
      date: "2026-08-15",
      name: "QUALIFIED DIVIDEND",
      quantity: 0,
      amount: -24,
      price: 0,
      fees: null,
      type: "cash",
      subtype: "qualified dividend",
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    } as InvestmentTransaction, security);

    expect(activity).toMatchObject({
      type: "DIVIDEND",
      amountCents: 2_400,
      feesCents: 0,
      realizedGainCents: undefined,
    });
  });

  it("drops ambiguous provider transfers instead of misclassifying contributions", () => {
    const activity = normalizePlaidInvestmentActivity({
      investment_transaction_id: "transfer-1",
      account_id: "brokerage-1",
      security_id: null,
      date: "2026-08-15",
      name: "JOURNAL TRANSFER",
      quantity: 0,
      amount: -2_000,
      price: 0,
      fees: null,
      type: "transfer",
      subtype: "transfer",
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    } as InvestmentTransaction, undefined);

    expect(activity).toBeUndefined();
  });
});
