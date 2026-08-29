import type { CategoryName, FinancialSnapshot, GoalRecord, UserSummary } from "@/domain/types";

export interface TransactionUpdate {
  category?: CategoryName;
  notes?: string | null;
  isRecurring?: boolean;
}

export type GoalCreateInput = Omit<GoalRecord, "id" | "userId">;

export interface FinancialRepository {
  getUser(viewerUserId: string): Promise<UserSummary>;
  getSnapshot(viewerUserId: string, ownerUserId?: string): Promise<FinancialSnapshot>;
  updateTransaction(
    viewerUserId: string,
    transactionId: string,
    update: TransactionUpdate,
  ): Promise<void>;
  createGoal(viewerUserId: string, input: GoalCreateInput): Promise<GoalRecord>;
}
