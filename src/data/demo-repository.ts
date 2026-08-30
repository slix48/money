import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";
import type { FinancialSnapshot } from "@/domain/types";
import { NotFoundError } from "@/data/errors";
import { detectRecurringTransactions, normalizeMerchant } from "@/domain/calculations";
import type {
  FinancialRepository,
  GoalContributionCreateInput,
  GoalCreateInput,
  IncomeStreamUpdate,
  RecurringUpdate,
  TransactionUpdate,
} from "@/data/financial-repository";

export class DemoFinancialRepository implements FinancialRepository {
  private snapshot: FinancialSnapshot;

  constructor(snapshot = createDemoSnapshot()) {
    this.snapshot = snapshot;
  }

  async getUser(viewerUserId: string) {
    this.assertOwner(viewerUserId, DEMO_USER_ID);
    return { ...this.snapshot.user };
  }

  async getSnapshot(viewerUserId: string, ownerUserId = viewerUserId) {
    this.assertOwner(viewerUserId, ownerUserId);
    return this.snapshot;
  }

  async updateTransaction(
    viewerUserId: string,
    transactionId: string,
    update: TransactionUpdate,
  ): Promise<void> {
    const transaction = this.snapshot.transactions.find(
      (candidate) => candidate.id === transactionId && candidate.userId === viewerUserId,
    );
    if (!transaction) throw new NotFoundError();
    if (update.category !== undefined) {
      transaction.category = update.category;
      if (transaction.isRecurring) {
        const normalized =
          transaction.normalizedMerchant || normalizeMerchant(transaction.merchant);
        const recurring = this.snapshot.recurring.find(
          (item) =>
            item.userId === viewerUserId &&
            item.accountId === transaction.accountId &&
            normalizeMerchant(item.merchant) === normalized,
        );
        if (recurring) {
          recurring.category = update.category;
          recurring.isSubscription = update.category === "Subscriptions";
        }
      }
    }
    if (update.notes !== undefined) transaction.notes = update.notes ?? undefined;
    if (update.isRecurring !== undefined) {
      transaction.isRecurring = update.isRecurring;
      if (update.isRecurring) {
        const normalized = transaction.normalizedMerchant ||
          normalizeMerchant(transaction.merchant);
        const exists = this.snapshot.recurring.some(
          (item) =>
            item.userId === viewerUserId &&
            item.accountId === transaction.accountId &&
            normalizeMerchant(item.merchant) === normalized,
        );
        if (!exists) {
          const detected = detectRecurringTransactions(
            this.snapshot.transactions,
          ).find(
            (item) =>
              item.userId === viewerUserId &&
              item.accountId === transaction.accountId &&
              normalizeMerchant(item.merchant) === normalized,
          );
          const related = this.snapshot.transactions.filter(
            (item) =>
              item.userId === viewerUserId &&
              item.accountId === transaction.accountId &&
              !item.isPending &&
              item.transactionType === "EXPENSE" &&
              (item.normalizedMerchant || normalizeMerchant(item.merchant)) ===
                normalized,
          );
          const averageAmountCents = Math.round(
            related.reduce(
              (sum, item) => sum + Math.abs(item.amountCents),
              0,
            ) / Math.max(1, related.length),
          );
          this.snapshot.recurring.push({
            ...(detected ?? {
              id: "manual-recurring-" + crypto.randomUUID(),
              userId: viewerUserId,
              accountId: transaction.accountId,
              merchant: transaction.merchant,
              amountCents: Math.abs(transaction.amountCents),
              averageAmountCents,
              category: transaction.category,
              frequency: "VARIABLE" as const,
              lastChargeDate: transaction.date,
              annualizedCents: averageAmountCents * 12,
              confidence: 0.5,
              isSubscription: transaction.category === "Subscriptions",
            }),
            id: "manual-recurring-" + crypto.randomUUID(),
            status: "POSSIBLE",
          });
        }
      }
    }
    transaction.updatedAt = new Date();
  }

  async createGoal(viewerUserId: string, input: GoalCreateInput) {
    this.assertOwner(viewerUserId, DEMO_USER_ID);
    if (
      input.linkedAccountId &&
      !this.snapshot.accounts.some(
        (account) => account.id === input.linkedAccountId && account.userId === viewerUserId,
      )
    ) {
      throw new NotFoundError("Linked account not found");
    }
    const goal = {
      ...input,
      id: `goal-${crypto.randomUUID()}`,
      userId: viewerUserId,
    };
    this.snapshot.goals.push(goal);
    return goal;
  }

  async updateRecurring(
    viewerUserId: string,
    recurringId: string,
    update: RecurringUpdate,
  ): Promise<void> {
    const recurring = this.snapshot.recurring.find(
      (candidate) => candidate.id === recurringId && candidate.userId === viewerUserId,
    );
    if (!recurring) throw new NotFoundError();
    if (update.status !== undefined) recurring.status = update.status;
    if (update.isSubscription !== undefined) {
      recurring.isSubscription = update.isSubscription;
    }
  }

  async addGoalContribution(
    viewerUserId: string,
    goalId: string,
    input: GoalContributionCreateInput,
  ) {
    const goal = this.snapshot.goals.find(
      (candidate) => candidate.id === goalId && candidate.userId === viewerUserId,
    );
    if (!goal) throw new NotFoundError();
    const contribution = {
      ...input,
      id: "goal-contribution-" + crypto.randomUUID(),
      userId: viewerUserId,
      goalId,
    };
    this.snapshot.goalContributions.unshift(contribution);
    goal.currentAmountCents += input.amountCents;
    return contribution;
  }

  async updateIncomeStream(
    viewerUserId: string,
    incomeStreamId: string,
    update: IncomeStreamUpdate,
  ): Promise<void> {
    const stream = this.snapshot.incomeStreams.find(
      (candidate) => candidate.id === incomeStreamId && candidate.userId === viewerUserId,
    );
    if (!stream) throw new NotFoundError();
    if (update.name !== undefined) stream.name = update.name;
    if (update.type !== undefined) stream.type = update.type;
  }

  private assertOwner(viewerUserId: string, ownerUserId: string) {
    if (viewerUserId !== ownerUserId || ownerUserId !== DEMO_USER_ID) {
      throw new NotFoundError();
    }
  }
}

const globalForDemo = globalThis as typeof globalThis & {
  moneyOsDemoRepository?: DemoFinancialRepository;
};

export const demoFinancialRepository =
  globalForDemo.moneyOsDemoRepository ?? new DemoFinancialRepository();

if (process.env.NODE_ENV !== "production") {
  globalForDemo.moneyOsDemoRepository = demoFinancialRepository;
}
