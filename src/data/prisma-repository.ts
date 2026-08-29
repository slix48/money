import "server-only";
import type {
  CategoryName,
  FinancialSnapshot,
  IncomeType,
} from "@/domain/types";
import { NotFoundError } from "@/data/errors";
import type {
  FinancialRepository,
  GoalCreateInput,
  TransactionUpdate,
} from "@/data/financial-repository";
import { prisma } from "@/lib/db";

function toCents(value: { toString(): string } | number): number {
  return Math.round(Number(value.toString()) * 100);
}

const categoryNames = new Set<CategoryName>([
  "Housing",
  "Food",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Health",
  "Education",
  "Travel",
  "Utilities",
  "Subscriptions",
  "Insurance",
  "Income",
  "Investments",
  "Transfers",
  "Other",
]);

function categoryName(value?: string | null): CategoryName {
  return value && categoryNames.has(value as CategoryName) ? (value as CategoryName) : "Other";
}

export class PrismaFinancialRepository implements FinancialRepository {
  async getUser(viewerUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: viewerUserId },
      select: { id: true, name: true, email: true, isDemo: true },
    });
    if (!user) throw new NotFoundError();
    return user;
  }

  async getSnapshot(
    viewerUserId: string,
    ownerUserId = viewerUserId,
  ): Promise<FinancialSnapshot> {
    if (viewerUserId !== ownerUserId) throw new NotFoundError();

    const user = await prisma.user.findUnique({
      where: { id: viewerUserId },
      select: {
        id: true,
        name: true,
        email: true,
        isDemo: true,
        accounts: {
          orderBy: [{ type: "asc" }, { name: "asc" }],
        },
        transactions: {
          include: { category: { select: { name: true } } },
          orderBy: { date: "desc" },
        },
        recurringTransactions: {
          include: { category: { select: { name: true } } },
          orderBy: { annualizedAmount: "desc" },
        },
        incomeStreams: {
          orderBy: { averageAmount: "desc" },
        },
        investmentAccounts: {
          include: {
            holdings: { orderBy: { currentValue: "desc" } },
            investmentTransactions: { orderBy: { date: "desc" } },
          },
        },
        netWorthSnapshots: { orderBy: { date: "asc" } },
        goals: { orderBy: { targetDate: "asc" } },
      },
    });

    if (!user) throw new NotFoundError();

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isDemo: user.isDemo,
      },
      accounts: user.accounts.map((account) => ({
        id: account.id,
        userId: account.userId,
        name: account.name,
        institution: account.institution,
        type: account.type,
        balanceCents: toCents(account.balance),
        availableBalanceCents:
          account.availableBalance === null ? undefined : toCents(account.availableBalance),
        currency: account.currency,
        connectionStatus: account.connectionStatus,
        source: account.source,
        lastUpdatedAt: account.lastUpdatedAt,
      })),
      transactions: user.transactions.map((transaction) => ({
        id: transaction.id,
        userId: transaction.userId,
        accountId: transaction.accountId,
        linkedAccountId: transaction.linkedAccountId ?? undefined,
        date: transaction.date,
        merchant: transaction.merchant,
        description: transaction.description,
        amountCents: toCents(transaction.amount),
        transactionType: transaction.transactionType,
        category: categoryName(transaction.category?.name),
        subcategory: transaction.subcategory ?? undefined,
        incomeType:
          transaction.transactionType === "INCOME"
            ? (transaction.subcategory?.toUpperCase().replaceAll(" ", "_") as IncomeType)
            : undefined,
        isPending: transaction.isPending,
        isRecurring: transaction.isRecurring,
        notes: transaction.notes ?? undefined,
        source: transaction.source,
        transferPairId: transaction.transferPairId ?? undefined,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      })),
      recurring: user.recurringTransactions.map((item) => ({
        id: item.id,
        userId: item.userId,
        accountId: item.accountId,
        merchant: item.merchant,
        amountCents: toCents(item.amount),
        previousAmountCents:
          item.previousAmount === null ? undefined : toCents(item.previousAmount),
        category: categoryName(item.category?.name),
        frequency: item.frequency,
        nextEstimatedDate: item.nextEstimatedDate ?? undefined,
        lastChargeDate: item.lastChargeDate,
        annualizedCents: toCents(item.annualizedAmount),
        status: item.status,
        confidence: Number(item.confidence),
        isSubscription: item.isSubscription,
      })),
      incomeStreams: user.incomeStreams.map((stream) => ({
        id: stream.id,
        userId: stream.userId,
        name: stream.name,
        payer: stream.payer,
        type: stream.type,
        averageAmountCents: toCents(stream.averageAmount),
        isRecurring: stream.isRecurring,
        frequency: stream.frequency ?? undefined,
        lastReceivedAt: stream.lastReceivedAt,
        nextExpectedAt: stream.nextExpectedAt ?? undefined,
      })),
      holdings: user.investmentAccounts.flatMap((investmentAccount) =>
        investmentAccount.holdings.map((holding) => ({
          id: holding.id,
          userId: holding.userId,
          accountId: investmentAccount.accountId,
          ticker: holding.ticker,
          name: holding.name,
          securityType: holding.securityType,
          quantity: Number(holding.quantity),
          costBasisCents: toCents(holding.costBasis),
          priceCents: toCents(holding.price),
          currentValueCents: toCents(holding.currentValue),
          priceAsOf: holding.priceAsOf,
          priceSource:
            holding.priceSource === "DEMO"
              ? ("DEMO" as const)
              : holding.priceSource === "MANUAL"
                ? ("MANUAL" as const)
                : ("MARKET_PROVIDER" as const),
        })),
      ),
      investmentActivity: user.investmentAccounts.flatMap((investmentAccount) =>
        investmentAccount.investmentTransactions.map((activity) => ({
          id: activity.id,
          userId: activity.userId,
          accountId: investmentAccount.accountId,
          date: activity.date,
          type: activity.type,
          ticker: activity.ticker ?? undefined,
          quantity: activity.quantity === null ? undefined : Number(activity.quantity),
          priceCents: activity.price === null ? undefined : toCents(activity.price),
          amountCents: toCents(activity.amount),
        })),
      ),
      netWorthHistory: user.netWorthSnapshots.map((snapshot) => ({
        id: snapshot.id,
        userId: snapshot.userId,
        date: snapshot.date,
        cashCents: toCents(snapshot.cash),
        investmentsCents: toCents(snapshot.investments),
        debtCents: toCents(snapshot.debt),
        otherAssetsCents: toCents(snapshot.otherAssets),
        assetsCents: toCents(snapshot.assets),
        liabilitiesCents: toCents(snapshot.liabilities),
        netWorthCents: toCents(snapshot.netWorth),
      })),
      goals: user.goals.map((goal) => ({
        id: goal.id,
        userId: goal.userId,
        type: goal.type,
        name: goal.name,
        targetAmountCents: toCents(goal.targetAmount),
        currentAmountCents: toCents(goal.currentAmount),
        targetDate: goal.targetDate ?? undefined,
        linkedAccountId: goal.linkedAccountId ?? undefined,
        monthlyTargetCents: toCents(goal.monthlyTarget),
        color: goal.color,
      })),
      generatedAt: new Date(),
      dataSource: "DATABASE",
    };
  }

  async updateTransaction(
    viewerUserId: string,
    transactionId: string,
    update: TransactionUpdate,
  ): Promise<void> {
    let categoryId: string | undefined;
    if (update.category !== undefined) {
      const category = await prisma.category.findFirst({
        where: { userId: viewerUserId, name: update.category },
        select: { id: true },
      });
      if (!category) throw new NotFoundError("Category not found");
      categoryId = category.id;
    }

    const result = await prisma.transaction.updateMany({
      where: { id: transactionId, userId: viewerUserId },
      data: {
        ...(categoryId ? { categoryId } : {}),
        ...(update.notes !== undefined ? { notes: update.notes } : {}),
        ...(update.isRecurring !== undefined
          ? { isRecurring: update.isRecurring }
          : {}),
      },
    });
    if (result.count !== 1) throw new NotFoundError();
  }

  async createGoal(viewerUserId: string, input: GoalCreateInput) {
    if (input.linkedAccountId) {
      const account = await prisma.account.findFirst({
        where: { id: input.linkedAccountId, userId: viewerUserId },
        select: { id: true },
      });
      if (!account) throw new NotFoundError("Linked account not found");
    }
    const goal = await prisma.goal.create({
      data: {
        userId: viewerUserId,
        type: input.type,
        name: input.name,
        targetAmount: input.targetAmountCents / 100,
        currentAmount: input.currentAmountCents / 100,
        targetDate: input.targetDate,
        linkedAccountId: input.linkedAccountId,
        monthlyTarget: input.monthlyTargetCents / 100,
        color: input.color,
      },
    });
    return {
      id: goal.id,
      userId: goal.userId,
      type: goal.type,
      name: goal.name,
      targetAmountCents: toCents(goal.targetAmount),
      currentAmountCents: toCents(goal.currentAmount),
      targetDate: goal.targetDate ?? undefined,
      linkedAccountId: goal.linkedAccountId ?? undefined,
      monthlyTargetCents: toCents(goal.monthlyTarget),
      color: goal.color,
    };
  }
}

export const prismaFinancialRepository = new PrismaFinancialRepository();
