import { describe, expect, it } from "vitest";
import type {
  ConnectionSession,
  ExchangedConnection,
  FinancialDataProvider,
  FinancialDataSyncRequest,
  FinancialDataSyncResult,
  NormalizedProviderAccount,
  NormalizedProviderTransaction,
  VerifiedFinancialDataWebhook,
} from "@/providers/financial-data";
import type {
  SyncCommitInput,
  SyncConnection,
  SyncFailure,
  SyncStore,
} from "@/sync/sync-engine";
import { FinancialSyncEngine, FinancialSyncError } from "@/sync/sync-engine";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const ACCOUNT: NormalizedProviderAccount = {
  externalId: "account-1",
  name: "Checking",
  institutionName: "Sandbox Bank",
  type: "CHECKING",
  balanceCents: 125_000,
  currency: "USD",
  isLiability: false,
  balanceAsOf: NOW,
};

function transaction(
  externalId: string,
  amountCents = -1_000,
  extra: Partial<NormalizedProviderTransaction> = {},
): NormalizedProviderTransaction {
  return {
    externalId,
    accountExternalId: "account-1",
    date: NOW,
    rawName: "Test merchant",
    amountCents,
    currency: "USD",
    isPending: false,
    ...extra,
  };
}

class FakeProvider implements FinancialDataProvider {
  readonly id = "plaid" as const;
  readonly displayName = "Fake Plaid";
  calls = 0;
  constructor(
    private readonly pages: Map<string, FinancialDataSyncResult | Error>,
  ) {}
  async createConnectionSession(): Promise<ConnectionSession> {
    throw new Error("unused");
  }
  async exchangePublicToken(): Promise<ExchangedConnection> {
    throw new Error("unused");
  }
  async getAccounts() {
    this.calls += 1;
    return [ACCOUNT];
  }
  async syncTransactions(request: FinancialDataSyncRequest) {
    this.calls += 1;
    const page = this.pages.get(request.cursor ?? "START");
    if (!page) throw new Error(`Missing page ${request.cursor ?? "START"}`);
    if (page instanceof Error) throw page;
    return page;
  }
  async verifyWebhook(): Promise<VerifiedFinancialDataWebhook> {
    throw new Error("unused");
  }
  async disconnect(): Promise<void> {}
}

class MemoryStore implements SyncStore {
  connection: SyncConnection = {
    id: "connection-1",
    userId: "user-1",
    provider: "PLAID",
    institutionName: "Sandbox Bank",
    accessToken: "encrypted-outside-test",
  };
  transactions = new Map<string, SyncCommitInput["addedTransactions"][number]>();
  commitCount = 0;
  failure?: SyncFailure;
  failedProviderCalls = 0;
  async loadConnection(userId: string, connectionId: string) {
    if (userId !== this.connection.userId || connectionId !== this.connection.id) {
      throw new Error("Connection not found");
    }
    return { ...this.connection };
  }
  async loadPreviousTransactions() {
    return [];
  }
  async beginSync() {
    return "run-1";
  }
  async commitSync(input: SyncCommitInput) {
    let added = 0;
    let modified = 0;
    for (const item of [...input.addedTransactions, ...input.modifiedTransactions]) {
      const pending = item.pendingExternalId
        ? this.transactions.get(item.pendingExternalId)
        : undefined;
      if (pending && !this.transactions.has(item.externalId)) {
        this.transactions.delete(item.pendingExternalId!);
      }
      if (this.transactions.has(item.externalId) || pending) modified += 1;
      else added += 1;
      this.transactions.set(item.externalId, item);
    }
    let removed = 0;
    for (const id of input.removedExternalTransactionIds) {
      if (this.transactions.delete(id)) removed += 1;
    }
    this.connection.cursor = input.cursor;
    this.commitCount += 1;
    return {
      runId: input.runId,
      accountsChanged: input.accounts.length,
      transactionsAdded: added,
      transactionsModified: modified,
      transactionsRemoved: removed,
    };
  }
  async failSync(input: { failure: SyncFailure; providerCalls: number }) {
    this.failure = input.failure;
    this.failedProviderCalls = input.providerCalls;
  }
}

function page(input: Partial<FinancialDataSyncResult> & Pick<FinancialDataSyncResult, "cursor">): FinancialDataSyncResult {
  const { cursor, ...overrides } = input;
  return {
    cursor,
    hasMore: false,
    accounts: [ACCOUNT],
    addedTransactions: [],
    modifiedTransactions: [],
    removedExternalTransactionIds: [],
    providerRequestId: "request",
    syncedAt: NOW,
    ...overrides,
  };
}

describe("financial sync engine", () => {
  it("collects every page before advancing the cursor", async () => {
    const provider = new FakeProvider(new Map<string, FinancialDataSyncResult | Error>([
      ["START", page({ cursor: "page-2", hasMore: true, addedTransactions: [transaction("one")] })],
      ["page-2", page({ cursor: "complete", addedTransactions: [transaction("two")] })],
    ]));
    const store = new MemoryStore();
    const result = await new FinancialSyncEngine(store, async () => provider).sync({ userId: "user-1", connectionId: "connection-1", trigger: "INITIAL" });
    expect(result.transactionsAdded).toBe(2);
    expect(store.connection.cursor).toBe("complete");
    expect(store.transactions.size).toBe(2);
    expect(provider.calls).toBe(3);
  });

  it("is idempotent when a provider repeats an external transaction id", async () => {
    const store = new MemoryStore();
    const first = new FakeProvider(new Map([["START", page({ cursor: "next", addedTransactions: [transaction("same")] })]]));
    await new FinancialSyncEngine(store, async () => first).sync({ userId: "user-1", connectionId: "connection-1", trigger: "INITIAL" });
    const repeated = new FakeProvider(new Map([["next", page({ cursor: "next-2", addedTransactions: [transaction("same")] })]]));
    const result = await new FinancialSyncEngine(store, async () => repeated).sync({ userId: "user-1", connectionId: "connection-1", trigger: "WEBHOOK" });
    expect(store.transactions.size).toBe(1);
    expect(result.transactionsAdded).toBe(0);
    expect(result.transactionsModified).toBe(1);
  });

  it("applies modifications, removals, and pending-to-posted replacement", async () => {
    const store = new MemoryStore();
    store.transactions.set("pending", { ...transaction("pending"), merchant: "Pending", normalizedMerchant: "pending", description: "Pending", category: "Other", transactionType: "EXPENSE" });
    store.transactions.set("remove-me", { ...transaction("remove-me"), merchant: "Old", normalizedMerchant: "old", description: "Old", category: "Other", transactionType: "EXPENSE" });
    const provider = new FakeProvider(new Map([["START", page({
      cursor: "done",
      modifiedTransactions: [transaction("posted", -1_050, { pendingExternalId: "pending", isPending: false })],
      removedExternalTransactionIds: ["remove-me"],
    })]]));
    const result = await new FinancialSyncEngine(store, async () => provider).sync({ userId: "user-1", connectionId: "connection-1", trigger: "WEBHOOK" });
    expect(store.transactions.has("pending")).toBe(false);
    expect(store.transactions.has("posted")).toBe(true);
    expect(store.transactions.has("remove-me")).toBe(false);
    expect(result).toMatchObject({ transactionsModified: 1, transactionsRemoved: 1 });
  });

  it("does not advance the cursor when a later page fails", async () => {
    const store = new MemoryStore();
    store.connection.cursor = "old";
    const provider = new FakeProvider(new Map<string, FinancialDataSyncResult | Error>([
      ["old", page({ cursor: "page-2", hasMore: true, addedTransactions: [transaction("uncommitted")] })],
      ["page-2", new Error("provider unavailable")],
    ]));
    await expect(new FinancialSyncEngine(store, async () => provider).sync({ userId: "user-1", connectionId: "connection-1", trigger: "MANUAL" })).rejects.toBeInstanceOf(FinancialSyncError);
    expect(store.connection.cursor).toBe("old");
    expect(store.transactions.size).toBe(0);
    expect(store.commitCount).toBe(0);
    expect(store.failure?.safeCode).toBe("SYNC_FAILED");
    expect(store.failedProviderCalls).toBe(3);
  });

  it("blocks cross-user connection access before provider calls", async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider(new Map());
    await expect(new FinancialSyncEngine(store, async () => provider).sync({ userId: "user-2", connectionId: "connection-1", trigger: "MANUAL" })).rejects.toThrow("not found");
    expect(provider.calls).toBe(0);
  });
});
