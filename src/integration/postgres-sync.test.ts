import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
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
import { FinancialSyncEngine, FinancialSyncError } from "@/sync/sync-engine";

vi.mock("server-only", () => ({}));

const postgresEnabled = process.env.TEST_POSTGRES === "true";
const NOW = new Date();

function monthsAgo(months: number): Date {
  const day = months === 0 ? Math.max(1, NOW.getUTCDate() - 1) : 5;
  return new Date(Date.UTC(
    NOW.getUTCFullYear(),
    NOW.getUTCMonth() - months,
    day,
    12,
  ));
}

const accounts: NormalizedProviderAccount[] = [
  { externalId: "pg-checking", name: "Checking", institutionName: "Postgres Test Bank", type: "CHECKING", balanceCents: 500_000, availableBalanceCents: 475_000, currency: "USD", isLiability: false, maskLast4: "1001", balanceAsOf: NOW },
  { externalId: "pg-savings", name: "Savings", institutionName: "Postgres Test Bank", type: "SAVINGS", balanceCents: 1_000_000, currency: "USD", isLiability: false, maskLast4: "1002", balanceAsOf: NOW },
  { externalId: "pg-card", name: "Credit Card", institutionName: "Postgres Test Bank", type: "CREDIT_CARD", balanceCents: 80_000, currency: "USD", isLiability: true, maskLast4: "1003", balanceAsOf: NOW },
  { externalId: "pg-brokerage", name: "Brokerage", institutionName: "Postgres Test Bank", type: "BROKERAGE", balanceCents: 2_500_000, currency: "USD", isLiability: false, maskLast4: "1004", balanceAsOf: NOW },
];

function providerTransaction(input: Partial<NormalizedProviderTransaction> & Pick<NormalizedProviderTransaction, "externalId" | "accountExternalId" | "amountCents" | "rawName">): NormalizedProviderTransaction {
  return {
    date: NOW,
    currency: "USD",
    isPending: false,
    ...input,
  };
}

class MutableProvider implements FinancialDataProvider {
  readonly id = "plaid" as const;
  readonly displayName = "Postgres fixture provider";
  readonly pages = new Map<string, FinancialDataSyncResult | Error>();
  calls = 0;
  async createConnectionSession(): Promise<ConnectionSession> {
    throw new Error("unused");
  }
  async exchangePublicToken(): Promise<ExchangedConnection> {
    throw new Error("unused");
  }
  async getAccounts() {
    this.calls += 1;
    return accounts;
  }
  async syncTransactions(request: FinancialDataSyncRequest) {
    this.calls += 1;
    const page = this.pages.get(request.cursor ?? "START");
    if (!page) throw new Error(`No fixture page for ${request.cursor ?? "START"}`);
    if (page instanceof Error) throw page;
    return page;
  }
  async verifyWebhook(): Promise<VerifiedFinancialDataWebhook> {
    throw new Error("unused");
  }
  async disconnect(): Promise<void> {}
}

function page(input: Partial<FinancialDataSyncResult> & Pick<FinancialDataSyncResult, "cursor">): FinancialDataSyncResult {
  const { cursor, ...overrides } = input;
  return {
    cursor,
    hasMore: false,
    accounts,
    addedTransactions: [],
    modifiedTransactions: [],
    removedExternalTransactionIds: [],
    providerRequestId: `request-${cursor}`,
    syncedAt: NOW,
    ...overrides,
  };
}

describe.runIf(postgresEnabled)("PostgreSQL connected-data integration", () => {
  let prisma: Awaited<typeof import("@/lib/db")>["prisma"];
  let store: Awaited<typeof import("@/sync/prisma-sync-store")>["prismaSyncStore"];
  let userA: string;
  let userB: string;
  let connectionA: string;
  let connectionB: string;
  const provider = new MutableProvider();

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ prismaSyncStore: store } = await import("@/sync/prisma-sync-store"));
    const { DEFAULT_CATEGORIES } = await import("@/domain/demo-data");
    const { encryptProviderToken } = await import("@/lib/provider-token-crypto");
    const encryptionKey = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY!;
    const createUser = (suffix: string) => prisma.user.create({
      data: {
        email: `postgres-sync-${suffix}-${Date.now()}@example.test`,
        name: `Postgres ${suffix}`,
        categories: {
          create: DEFAULT_CATEGORIES.map((category) => ({
            name: category.name,
            kind: category.kind,
            color: category.color,
            icon: "Circle",
            isDefault: true,
          })),
        },
      },
      select: { id: true },
    });
    const [createdA, createdB] = await Promise.all([createUser("a"), createUser("b")]);
    userA = createdA.id;
    userB = createdB.id;
    const [createdConnectionA, createdConnectionB] = await Promise.all([
      prisma.financialConnection.create({
        data: {
          userId: userA,
          provider: "PLAID",
          providerItemId: `postgres-item-a-${Date.now()}`,
          institutionName: "Postgres Test Bank",
          status: "INITIAL_SYNC",
          accessTokenEncrypted: encryptProviderToken("postgres-access-a", encryptionKey),
          tokenKeyVersion: 1,
        },
        select: { id: true },
      }),
      prisma.financialConnection.create({
        data: {
          userId: userB,
          provider: "PLAID",
          providerItemId: `postgres-item-b-${Date.now()}`,
          institutionName: "Other Tenant Bank",
          status: "INITIAL_SYNC",
          accessTokenEncrypted: encryptProviderToken("postgres-access-b", encryptionKey),
          tokenKeyVersion: 1,
        },
        select: { id: true },
      }),
    ]);
    connectionA = createdConnectionA.id;
    connectionB = createdConnectionB.id;
  });

  afterAll(async () => {
    if (prisma && userA && userB) {
      await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
      await prisma.$disconnect();
    }
  });

  it("initially synchronizes normalized accounting semantics into PostgreSQL", async () => {
    provider.pages.set("START", page({
      cursor: "cursor-1",
      addedTransactions: [
        providerTransaction({ externalId: "salary", accountExternalId: "pg-checking", amountCents: 400_000, rawName: "ACME PAYROLL", categoryHint: { primary: "INCOME", detailed: "INCOME_WAGES" } }),
        providerTransaction({ externalId: "groceries", accountExternalId: "pg-card", amountCents: -12_000, rawName: "WHOLE FOODS", categoryHint: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }),
        providerTransaction({ externalId: "transfer-out", accountExternalId: "pg-checking", amountCents: -50_000, rawName: "Transfer to savings", categoryHint: { primary: "TRANSFER_OUT" } }),
        providerTransaction({ externalId: "transfer-in", accountExternalId: "pg-savings", amountCents: 50_000, rawName: "Transfer from checking", categoryHint: { primary: "TRANSFER_IN" } }),
        providerTransaction({ externalId: "card-purchase", accountExternalId: "pg-card", amountCents: -6_000, rawName: "LOCAL RESTAURANT", categoryHint: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_RESTAURANT" } }),
        providerTransaction({ externalId: "card-pay-out", accountExternalId: "pg-checking", amountCents: -80_000, rawName: "Payment to credit card" }),
        providerTransaction({ externalId: "card-pay-in", accountExternalId: "pg-card", amountCents: 80_000, rawName: "Payment received thank you" }),
        providerTransaction({ externalId: "amazon-purchase", accountExternalId: "pg-card", amountCents: -10_000, rawName: "AMAZON PURCHASE", providerMerchantName: "Amazon", categoryHint: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACE" } }),
        providerTransaction({ externalId: "amazon-refund", accountExternalId: "pg-card", amountCents: 2_500, rawName: "AMAZON REFUND", providerMerchantName: "Amazon" }),
        providerTransaction({ externalId: "pending", accountExternalId: "pg-card", amountCents: -2_500, rawName: "PENDING CAFE", isPending: true }),
        ...[2, 1, 0].map((months) => providerTransaction({ externalId: `stream-${months}`, accountExternalId: "pg-card", amountCents: -1_599, rawName: "STREAMING SERVICE", providerMerchantName: "Streaming Service", date: monthsAgo(months), categoryHint: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_SUBSCRIPTION" } })),
      ],
    }));
    const result = await new FinancialSyncEngine(store, async () => provider).sync({
      userId: userA,
      connectionId: connectionA,
      trigger: "INITIAL",
    });
    expect(result.transactionsAdded).toBe(13);
    const rows = await prisma.transaction.findMany({
      where: { userId: userA, financialConnectionId: connectionA },
      select: { externalId: true, transactionType: true, transferPairId: true, refundForTransactionId: true },
    });
    const byId = new Map(rows.map((row) => [row.externalId, row]));
    expect(byId.get("transfer-out")?.transactionType).toBe("TRANSFER");
    expect(byId.get("transfer-out")?.transferPairId).toBe(byId.get("transfer-in")?.transferPairId);
    expect(byId.get("card-pay-out")?.transactionType).toBe("DEBT_PAYMENT");
    expect(byId.get("card-pay-in")?.transactionType).toBe("TRANSFER");
    expect(byId.get("amazon-refund")?.transactionType).toBe("REFUND");
    expect(byId.get("amazon-refund")?.refundForTransactionId).toBeTruthy();
    expect(await prisma.recurringTransaction.count({ where: { userId: userA, normalizedMerchant: "streaming service" } })).toBe(1);
    expect((await prisma.financialConnection.findUnique({ where: { id: connectionA } }))?.syncCursor).toBe("cursor-1");
  });

  it("feeds synchronized normalized data through the existing AI tools", async () => {
    const { getFinancialRepository } = await import("@/data/get-repository");
    const { createFinancialToolContext, executeFinancialTool } = await import("@/ai/tool-registry");
    const repository = await getFinancialRepository();
    const context = createFinancialToolContext(userA, repository);
    const income = await executeFinancialTool(context, "getIncome", { monthsAgo: 0 });
    const spending = await executeFinancialTool(context, "getSpendingByCategory", { monthsAgo: 0 });
    const subscriptions = await executeFinancialTool(context, "getSubscriptions", { status: "ACTIVE" });
    expect(income.data).toMatchObject({ totalCents: 400_000 });
    expect(spending.data).toMatchObject({ totalCents: 27_099 });
    expect(subscriptions.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchant: "Streaming Service" }),
    ]));
  });

  it("reconciles pending-to-posted, modifications, removals, and duplicate delivery idempotently", async () => {
    provider.pages.set("cursor-1", page({
      cursor: "cursor-2",
      modifiedTransactions: [providerTransaction({ externalId: "posted", pendingExternalId: "pending", accountExternalId: "pg-card", amountCents: -2_650, rawName: "CAFE" })],
      removedExternalTransactionIds: ["pending", "groceries"],
    }));
    await new FinancialSyncEngine(store, async () => provider).sync({ userId: userA, connectionId: connectionA, trigger: "WEBHOOK" });
    expect(await prisma.transaction.count({ where: { userId: userA, externalId: { in: ["pending", "posted"] } } })).toBe(1);
    expect(await prisma.transaction.findFirst({ where: { userId: userA, externalId: "posted" }, select: { isPending: true } })).toEqual({ isPending: false });
    expect(await prisma.transaction.findFirst({ where: { userId: userA, externalId: "groceries" }, select: { isRemoved: true } })).toEqual({ isRemoved: true });

    provider.pages.set("cursor-2", page({ cursor: "cursor-3", addedTransactions: [providerTransaction({ externalId: "salary", accountExternalId: "pg-checking", amountCents: 400_000, rawName: "ACME PAYROLL", categoryHint: { primary: "INCOME", detailed: "INCOME_WAGES" } })] }));
    const repeated = await new FinancialSyncEngine(store, async () => provider).sync({ userId: userA, connectionId: connectionA, trigger: "WEBHOOK" });
    expect(repeated.transactionsAdded).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: userA, financialConnectionId: connectionA, externalId: "salary" } })).toBe(1);
    const { PrismaFinancialRepository } = await import("@/data/prisma-repository");
    const snapshot = await new PrismaFinancialRepository().getSnapshot(userA);
    expect(snapshot.transactions.some((transaction) => transaction.merchant === "Whole Foods")).toBe(false);
  });

  it("rolls back cursor advancement when a later provider page fails", async () => {
    provider.pages.set("cursor-3", page({ cursor: "failed-page", hasMore: true, addedTransactions: [providerTransaction({ externalId: "must-not-commit", accountExternalId: "pg-checking", amountCents: -100, rawName: "FAILED PAGE" })] }));
    provider.pages.set("failed-page", new Error("provider outage"));
    await expect(new FinancialSyncEngine(store, async () => provider).sync({ userId: userA, connectionId: connectionA, trigger: "MANUAL" })).rejects.toBeInstanceOf(FinancialSyncError);
    const connection = await prisma.financialConnection.findUnique({ where: { id: connectionA }, select: { syncCursor: true } });
    expect(connection?.syncCursor).toBe("cursor-3");
    expect(await prisma.transaction.count({ where: { userId: userA, externalId: "must-not-commit" } })).toBe(0);
  });

  it("enforces tenant ownership in application access and composite database constraints", async () => {
    const callsBefore = provider.calls;
    await expect(new FinancialSyncEngine(store, async () => provider).sync({ userId: userA, connectionId: connectionB, trigger: "MANUAL" })).rejects.toThrow("not found");
    expect(provider.calls).toBe(callsBefore);
    const ownedAccount = await prisma.account.findFirst({ where: { userId: userA }, select: { id: true } });
    await expect(prisma.providerAccount.create({
      data: {
        userId: userA,
        financialConnectionId: connectionB,
        accountId: ownedAccount!.id,
        providerAccountId: "cross-tenant-account",
      },
    })).rejects.toThrow();
  });

  it("binds passkey ceremonies to one tenant and consumes a failed challenge once", async () => {
    const suffix = Date.now().toString(36);
    const [sessionA, sessionB] = await Promise.all([
      prisma.session.create({
        data: {
          userId: userA,
          tokenHash: "passkey-session-a-" + suffix,
          expiresAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      }),
      prisma.session.create({
        data: {
          userId: userB,
          tokenHash: "passkey-session-b-" + suffix,
          expiresAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      }),
    ]);
    await expect(prisma.webAuthnChallenge.create({
      data: {
        userId: userA,
        sessionId: sessionB.id,
        tokenHash: "cross-tenant-challenge-" + suffix,
        challenge: "challenge",
        purpose: "REGISTRATION",
        expiresAt: new Date(Date.now() + 60_000),
      },
    })).rejects.toThrow();

    const credentialId = "postgres-passkey-" + suffix;
    await prisma.webAuthnCredential.create({
      data: {
        userId: userA,
        credentialId,
        publicKey: Buffer.from("invalid-test-public-key"),
        counter: 0,
        transports: [],
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
        name: "PostgreSQL test passkey",
      },
    });
    const { beginPasskeyAuthentication, finishPasskeyAuthentication } = await import(
      "@/auth/passkey-service"
    );
    const { hashSessionToken } = await import("@/auth/tokens");
    const ceremony = await beginPasskeyAuthentication(userA);
    expect(ceremony).not.toBeNull();
    const invalidResponse = {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: "e30",
        authenticatorData: "eA",
        signature: "eA",
      },
      clientExtensionResults: {},
    };
    await expect(finishPasskeyAuthentication({
      ceremonyToken: ceremony!.ceremonyToken,
      response: invalidResponse as never,
    })).rejects.toThrow("Passkey verification failed");
    const consumed = await prisma.webAuthnChallenge.findUnique({
      where: { tokenHash: hashSessionToken(ceremony!.ceremonyToken) },
      select: { usedAt: true },
    });
    expect(consumed?.usedAt).toBeInstanceOf(Date);
    await expect(finishPasskeyAuthentication({
      ceremonyToken: ceremony!.ceremonyToken,
      response: invalidResponse as never,
    })).rejects.toThrow("Passkey verification failed");

    await prisma.webAuthnCredential.deleteMany({ where: { userId: userA } });
    await prisma.webAuthnChallenge.deleteMany({ where: { userId: userA } });
    await prisma.session.deleteMany({ where: { id: { in: [sessionA.id, sessionB.id] } } });
  });

  it("permits only one active synchronization run per connection", async () => {
    const active = await prisma.syncRun.create({
      data: {
        userId: userA,
        financialConnectionId: connectionA,
        trigger: "MANUAL",
      },
      select: { id: true },
    });
    await expect(prisma.syncRun.create({
      data: {
        userId: userA,
        financialConnectionId: connectionA,
        trigger: "WEBHOOK",
      },
    })).rejects.toThrow();
    await prisma.syncRun.update({
      where: { id: active.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), durationMs: 1 },
    });
  });

  it("reports queue depth, retries, stale leases, latency, and failure categories", async () => {
    const suffix = Date.now().toString(36);
    const now = new Date();
    const old = new Date(now.getTime() - 10 * 60 * 1_000);
    const jobs = await Promise.all([
      prisma.syncJob.create({
        data: {
          userId: userA,
          financialConnectionId: connectionA,
          trigger: "MANUAL",
          dedupeKey: "health-queued-" + suffix,
          status: "QUEUED",
          attempts: 1,
          createdAt: old,
        },
        select: { id: true },
      }),
      prisma.syncJob.create({
        data: {
          userId: userA,
          financialConnectionId: connectionA,
          trigger: "WEBHOOK",
          dedupeKey: "health-processing-" + suffix,
          status: "PROCESSING",
          attempts: 2,
          claimedAt: old,
          leaseExpiresAt: new Date(now.getTime() - 1_000),
          createdAt: old,
        },
        select: { id: true },
      }),
      prisma.syncJob.create({
        data: {
          userId: userA,
          financialConnectionId: connectionA,
          trigger: "SCHEDULED",
          dedupeKey: "health-failed-" + suffix,
          status: "FAILED",
          attempts: 3,
          finishedAt: old,
          lastErrorCategory: "PROVIDER_OUTAGE",
        },
        select: { id: true },
      }),
    ]);
    const { getSyncQueueHealth } = await import("@/sync/sync-queue");
    const health = await getSyncQueueHealth(now);
    expect(health.queued).toBeGreaterThanOrEqual(1);
    expect(health.processing).toBeGreaterThanOrEqual(1);
    expect(health.failed).toBeGreaterThanOrEqual(1);
    expect(health.retrying).toBeGreaterThanOrEqual(1);
    expect(health.staleLeases).toBeGreaterThanOrEqual(1);
    expect(health.oldestPendingAgeMs).toBeGreaterThanOrEqual(10 * 60 * 1_000);
    expect(health.maxAttempts).toBeGreaterThanOrEqual(3);
    expect(health.failureCategoriesLast7Days.PROVIDER_OUTAGE).toBeGreaterThanOrEqual(1);
    await prisma.syncJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
  });

  it("enforces rate limits atomically across concurrent PostgreSQL callers", async () => {
    const { rateLimitDistributed } = await import("@/lib/security");
    const namespace = `postgres-limit-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        rateLimitDistributed(namespace, "same-identity", 3, 60_000)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(3);
  });

  it("exports no provider credentials and revokes sessions within one tenant", async () => {
    const { createUserDataExport, revokeAllUserSessions } = await import(
      "@/privacy/privacy-service"
    );
    await Promise.all([
      prisma.session.create({
        data: {
          userId: userA,
          tokenHash: `session-a-${Date.now()}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      prisma.session.create({
        data: {
          userId: userB,
          tokenHash: `session-b-${Date.now()}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ]);
    const storedConnection = await prisma.financialConnection.findUnique({
      where: { id: connectionA },
      select: {
        accessTokenEncrypted: true,
        providerItemId: true,
        syncCursor: true,
      },
    });
    const serialized = JSON.stringify(await createUserDataExport(userA));
    expect(serialized).not.toContain(storedConnection!.accessTokenEncrypted!);
    expect(serialized).not.toContain(storedConnection!.providerItemId);
    expect(serialized).not.toContain(storedConnection!.syncCursor!);

    await expect(revokeAllUserSessions(userB)).resolves.toBe(1);
    expect(await prisma.session.count({ where: { userId: userA } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: userB } })).toBe(0);
  });

  it("preserves imported history when a connection is disconnected", async () => {
    const { markConnectionDisconnected } = await import("@/sync/connection-service");
    const countBefore = await prisma.transaction.count({ where: { userId: userA, financialConnectionId: connectionA } });
    await markConnectionDisconnected(userA, connectionA, "USER_DISCONNECTED");
    const connection = await prisma.financialConnection.findUnique({ where: { id: connectionA }, select: { status: true, accessTokenEncrypted: true } });
    expect(connection).toEqual({ status: "DISCONNECTED", accessTokenEncrypted: null });
    expect(await prisma.transaction.count({ where: { userId: userA, financialConnectionId: connectionA } })).toBe(countBefore);
  });

  it("deletes one account without affecting another tenant", async () => {
    const user = await prisma.user.create({
      data: {
        email: "postgres-delete-account-" + Date.now() + "@example.test",
        name: "Delete Account Test",
        sessions: {
          create: {
            tokenHash: "delete-account-session-" + Date.now(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
      select: { id: true },
    });
    const { deleteUserAccount } = await import("@/privacy/privacy-service");
    await deleteUserAccount(user.id);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: userB }, select: { id: true } }))
      .toEqual({ id: userB });
  });

  it("deletes financial data transactionally while preserving authentication", async () => {
    const suffix = Date.now().toString(36);
    const user = await prisma.user.create({
      data: {
        email: "postgres-delete-financial-" + suffix + "@example.test",
        name: "Delete Financial Test",
        categories: {
          create: {
            name: "Other",
            kind: "OTHER",
            color: "#000000",
            icon: "Shapes",
            isDefault: true,
          },
        },
        sessions: {
          create: {
            tokenHash: "delete-financial-session-" + suffix,
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
      select: { id: true },
    });
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        name: "Disposable checking",
        institution: "Manual",
        type: "CHECKING",
        balance: 100,
        lastUpdatedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        date: new Date(),
        merchant: "Private merchant",
        description: "Must be deleted",
        amount: -25,
        transactionType: "EXPENSE",
        source: "MANUAL",
      },
    });
    const { deleteUserFinancialData } = await import("@/privacy/privacy-service");
    await deleteUserFinancialData(user.id);
    expect(await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } }))
      .toEqual({ id: user.id });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.category.count({ where: { userId: user.id } }))
      .toBe((await import("@/domain/demo-data")).DEFAULT_CATEGORIES.length);
    expect(await prisma.user.findUnique({ where: { id: userB }, select: { id: true } }))
      .toEqual({ id: userB });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
