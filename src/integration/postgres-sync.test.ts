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

  it("preserves imported history when a connection is disconnected", async () => {
    const { markConnectionDisconnected } = await import("@/sync/connection-service");
    const countBefore = await prisma.transaction.count({ where: { userId: userA, financialConnectionId: connectionA } });
    await markConnectionDisconnected(userA, connectionA, "USER_DISCONNECTED");
    const connection = await prisma.financialConnection.findUnique({ where: { id: connectionA }, select: { status: true, accessTokenEncrypted: true } });
    expect(connection).toEqual({ status: "DISCONNECTED", accessTokenEncrypted: null });
    expect(await prisma.transaction.count({ where: { userId: userA, financialConnectionId: connectionA } })).toBe(countBefore);
  });
});
