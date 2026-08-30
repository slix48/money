import "server-only";
import type {
  CategoryName,
  FinancialSnapshot,
} from "@/domain/types";
import { normalizeMerchant } from "@/domain/calculations";
import { NotFoundError } from "@/data/errors";
import type {
  FinancialRepository,
  GoalContributionCreateInput,
  GoalCreateInput,
  IncomeStreamUpdate,
  RecurringUpdate,
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
        goalContributions: { orderBy: { date: "desc" } },
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
        isLiability: account.isLiability,
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
        rawMerchant: transaction.rawMerchant ?? undefined,
        normalizedMerchant:
          transaction.normalizedMerchant ?? normalizeMerchant(transaction.merchant),
        description: transaction.description,
        rawDescription: transaction.rawDescription ?? undefined,
        amountCents: toCents(transaction.amount),
        transactionType: transaction.transactionType,
        category: categoryName(transaction.category?.name),
        subcategory: transaction.subcategory ?? undefined,
        incomeType: transaction.incomeType ?? undefined,
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
        averageAmountCents: toCents(item.averageAmount ?? item.amount),
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
          feesCents: toCents(activity.fees),
          costBasisCents:
            activity.costBasis === null ? undefined : toCents(activity.costBasis),
          realizedGainCents:
            activity.realizedGain === null ? undefined : toCents(activity.realizedGain),
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
        notes: goal.notes ?? undefined,
        color: goal.color,
      })),
      goalContributions: user.goalContributions.map((contribution) => ({
        id: contribution.id,
        userId: contribution.userId,
        goalId: contribution.goalId,
        date: contribution.date,
        amountCents: toCents(contribution.amount),
        source: contribution.source,
        notes: contribution.notes ?? undefined,
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

    await prisma.$transaction(async (database) => {
      const ownedTransaction = await database.transaction.findFirst({
        where: { id: transactionId, userId: viewerUserId },
        select: {
          id: true,
          accountId: true,
          categoryId: true,
          merchant: true,
          normalizedMerchant: true,
          recurringTransactionId: true,
          amount: true,
          date: true,
          category: { select: { name: true } },
        },
      });
      if (!ownedTransaction) throw new NotFoundError();

      let recurringTransactionId: string | null | undefined;
      if (update.isRecurring === false) {
        recurringTransactionId = null;
      } else if (update.isRecurring === true) {
        const normalizedMerchant =
          ownedTransaction.normalizedMerchant ??
          normalizeMerchant(ownedTransaction.merchant);
        const existing = await database.recurringTransaction.findFirst({
          where: {
            userId: viewerUserId,
            accountId: ownedTransaction.accountId,
            normalizedMerchant,
          },
          select: { id: true },
        });
        const recurring =
          existing ??
          (await database.recurringTransaction.create({
            data: {
              userId: viewerUserId,
              accountId: ownedTransaction.accountId,
              categoryId: categoryId ?? ownedTransaction.categoryId,
              merchant: ownedTransaction.merchant,
              normalizedMerchant,
              amount: Math.abs(Number(ownedTransaction.amount)),
              averageAmount: Math.abs(Number(ownedTransaction.amount)),
              frequency: "VARIABLE",
              lastChargeDate: ownedTransaction.date,
              annualizedAmount:
                Math.abs(Number(ownedTransaction.amount)) * 12,
              status: "POSSIBLE",
              confidence: 0.5,
              isSubscription:
                (update.category ?? ownedTransaction.category?.name) ===
                "Subscriptions",
            },
            select: { id: true },
          }));
        recurringTransactionId = recurring.id;
      }

      const recurrenceForCategoryUpdate =
        typeof recurringTransactionId === "string"
          ? recurringTransactionId
          : update.isRecurring === false
            ? null
            : ownedTransaction.recurringTransactionId;
      if (categoryId && recurrenceForCategoryUpdate) {
        await database.recurringTransaction.updateMany({
          where: {
            id: recurrenceForCategoryUpdate,
            userId: viewerUserId,
          },
          data: {
            categoryId,
            isSubscription: update.category === "Subscriptions",
          },
        });
      }

      const result = await database.transaction.updateMany({
        where: { id: transactionId, userId: viewerUserId },
        data: {
          ...(categoryId ? { categoryId } : {}),
          ...(update.notes !== undefined ? { notes: update.notes } : {}),
          ...(update.isRecurring !== undefined
            ? {
                isRecurring: update.isRecurring,
                recurringTransactionId,
              }
            : {}),
        },
      });
      if (result.count !== 1) throw new NotFoundError();
      await database.auditEvent.create({
        data: {
          userId: viewerUserId,
          action: "TRANSACTION_UPDATED",
          entityType: "Transaction",
          entityId: transactionId,
          metadata: {
            changedFields: Object.keys(update),
          },
        },
      });
    });
  }

  async createGoal(viewerUserId: string, input: GoalCreateInput) {
    if (input.linkedAccountId) {
      const account = await prisma.account.findFirst({
        where: { id: input.linkedAccountId, userId: viewerUserId },
        select: { id: true },
      });
      if (!account) throw new NotFoundError("Linked account not found");
    }
    const goal = await prisma.$transaction(async (database) => {
      const created = await database.goal.create({
        data: {
          userId: viewerUserId,
          type: input.type,
          name: input.name,
          targetAmount: input.targetAmountCents / 100,
          currentAmount: input.currentAmountCents / 100,
          targetDate: input.targetDate,
          linkedAccountId: input.linkedAccountId,
          monthlyTarget: input.monthlyTargetCents / 100,
          notes: input.notes,
          color: input.color,
        },
      });
      await database.auditEvent.create({
        data: {
          userId: viewerUserId,
          action: "GOAL_CREATED",
          entityType: "Goal",
          entityId: created.id,
        },
      });
      return created;
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
      notes: goal.notes ?? undefined,
      color: goal.color,
    };
  }

  async updateRecurring(
    viewerUserId: string,
    recurringId: string,
    update: RecurringUpdate,
  ): Promise<void> {
    await prisma.$transaction(async (database) => {
      const result = await database.recurringTransaction.updateMany({
        where: { id: recurringId, userId: viewerUserId },
        data: update,
      });
      if (result.count !== 1) throw new NotFoundError();
      await database.auditEvent.create({
        data: {
          userId: viewerUserId,
          action: "RECURRING_UPDATED",
          entityType: "RecurringTransaction",
          entityId: recurringId,
          metadata: { changedFields: Object.keys(update) },
        },
      });
    });
  }

  async addGoalContribution(
    viewerUserId: string,
    goalId: string,
    input: GoalContributionCreateInput,
  ) {
    return prisma.$transaction(async (database) => {
      const goal = await database.goal.findFirst({
        where: { id: goalId, userId: viewerUserId },
        select: { id: true },
      });
      if (!goal) throw new NotFoundError();
      const contribution = await database.goalContribution.create({
        data: {
          userId: viewerUserId,
          goalId,
          date: input.date,
          amount: input.amountCents / 100,
          source: input.source,
          notes: input.notes,
        },
      });
      await database.goal.update({
        where: { id: goal.id },
        data: { currentAmount: { increment: input.amountCents / 100 } },
      });
      await database.auditEvent.create({
        data: {
          userId: viewerUserId,
          action: "GOAL_CONTRIBUTION_ADDED",
          entityType: "Goal",
          entityId: goalId,
        },
      });
      return {
        id: contribution.id,
        userId: contribution.userId,
        goalId: contribution.goalId,
        date: contribution.date,
        amountCents: toCents(contribution.amount),
        source: contribution.source,
        notes: contribution.notes ?? undefined,
      };
    });
  }

  async updateIncomeStream(
    viewerUserId: string,
    incomeStreamId: string,
    update: IncomeStreamUpdate,
  ): Promise<void> {
    await prisma.$transaction(async (database) => {
      const result = await database.incomeStream.updateMany({
        where: { id: incomeStreamId, userId: viewerUserId },
        data: update,
      });
      if (result.count !== 1) throw new NotFoundError();
      await database.auditEvent.create({
        data: {
          userId: viewerUserId,
          action: "INCOME_STREAM_UPDATED",
          entityType: "IncomeStream",
          entityId: incomeStreamId,
          metadata: { changedFields: Object.keys(update) },
        },
      });
    });
  }
}

export const prismaFinancialRepository = new PrismaFinancialRepository();
