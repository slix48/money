import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { AccountBase, Transaction } from "plaid";

vi.mock("server-only", () => ({}));

import {
  normalizePlaidAccount,
  normalizePlaidTransaction,
  PlaidFinancialDataProvider,
} from "@/providers/plaid-financial-data";

describe("Plaid financial-data normalization", () => {
  it("normalizes liability balances without changing their meaning", () => {
    const account = normalizePlaidAccount({
      account_id: "card-1",
      balances: {
        available: 4_200,
        current: 800,
        limit: 5_000,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
      mask: "1234",
      name: "Rewards Card",
      official_name: "Rewards Credit Card",
      type: "credit",
      subtype: "credit card",
    } as AccountBase, "Sandbox Bank", new Date("2026-08-30T12:00:00Z"));

    expect(account).toMatchObject({
      type: "CREDIT_CARD",
      isLiability: true,
      balanceCents: 80_000,
      availableBalanceCents: 420_000,
      maskLast4: "1234",
    });
  });

  it("converts Plaid outflow signs to MoneyOS signed cash effects", () => {
    const normalized = normalizePlaidTransaction({
      transaction_id: "transaction-1",
      account_id: "checking-1",
      amount: 42.5,
      date: "2026-08-30",
      authorized_date: "2026-08-29",
      name: "SQ *CHIPOTLE 1234",
      merchant_name: "Chipotle",
      original_description: "SQ *CHIPOTLE 1234",
      pending: false,
      pending_transaction_id: null,
      payment_channel: "in store",
      iso_currency_code: "USD",
      unofficial_currency_code: null,
      personal_finance_category: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_FAST_FOOD",
        confidence_level: "VERY_HIGH",
      },
    } as Transaction);

    expect(normalized).toMatchObject({
      amountCents: -4_250,
      providerMerchantName: "Chipotle",
      categoryHint: { primary: "FOOD_AND_DRINK" },
    });
  });
});

describe("Plaid webhook verification", () => {
  async function signedWebhook(body: Uint8Array, issuedAt: number) {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    const kid = `test-key-${issuedAt}`;
    const token = await new SignJWT({
      request_body_sha256: createHash("sha256").update(body).digest("hex"),
    })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuedAt(issuedAt)
      .sign(privateKey);
    const client = {
      webhookVerificationKeyGet: vi.fn().mockResolvedValue({
        data: {
          key: {
            ...publicJwk,
            alg: "ES256",
            kid,
            use: "sig",
            created_at: issuedAt,
            expired_at: null,
          },
        },
      }),
    };
    return { token, client };
  }

  it("accepts a fresh signed body and rejects body tampering", async () => {
    const body = Buffer.from(JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-1",
    }));
    const issuedAt = Math.floor(Date.now() / 1_000);
    const { token, client } = await signedWebhook(body, issuedAt);
    const provider = new PlaidFinancialDataProvider(client as never);
    await expect(provider.verifyWebhook(body, {
      "plaid-verification": token,
    })).resolves.toMatchObject({
      providerItemId: "item-1",
      event: "SYNC_AVAILABLE",
    });
    await expect(provider.verifyWebhook(Buffer.from("{}"), {
      "plaid-verification": token,
    })).rejects.toThrow("body verification failed");
  });

  it("rejects replayed signatures outside the freshness window", async () => {
    const body = Buffer.from(JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-1",
    }));
    const issuedAt = Math.floor(Date.now() / 1_000) - 10 * 60;
    const { token, client } = await signedWebhook(body, issuedAt);
    const provider = new PlaidFinancialDataProvider(client as never);
    await expect(provider.verifyWebhook(body, {
      "plaid-verification": token,
    })).rejects.toThrow("Stale");
  });
});
