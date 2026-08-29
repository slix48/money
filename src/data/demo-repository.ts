import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";
import type { FinancialSnapshot } from "@/domain/types";
import { NotFoundError } from "@/data/errors";
import type {
  FinancialRepository,
  GoalCreateInput,
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
    if (update.category !== undefined) transaction.category = update.category;
    if (update.notes !== undefined) transaction.notes = update.notes ?? undefined;
    if (update.isRecurring !== undefined) transaction.isRecurring = update.isRecurring;
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
