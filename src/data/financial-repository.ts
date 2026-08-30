import type {
  CategoryName,
  FinancialSnapshot,
  GoalContributionRecord,
  GoalRecord,
  IncomeType,
  UserSummary,
} from "@/domain/types";

export interface TransactionUpdate {
  category?: CategoryName;
  notes?: string | null;
  isRecurring?: boolean;
}

export type GoalCreateInput = Omit<GoalRecord, "id" | "userId">;

export interface RecurringUpdate {
  status?: "ACTIVE" | "POSSIBLE" | "CANCELLED" | "IGNORED";
  isSubscription?: boolean;
}

export interface GoalContributionCreateInput {
  date: Date;
  amountCents: number;
  source: "MANUAL" | "TRANSFER" | "ACCOUNT_SYNC";
  notes?: string;
}

export interface IncomeStreamUpdate {
  name?: string;
  type?: IncomeType;
}

export interface FinancialRepository {
  getUser(viewerUserId: string): Promise<UserSummary>;
  getSnapshot(viewerUserId: string, ownerUserId?: string): Promise<FinancialSnapshot>;
  updateTransaction(
    viewerUserId: string,
    transactionId: string,
    update: TransactionUpdate,
  ): Promise<void>;
  createGoal(viewerUserId: string, input: GoalCreateInput): Promise<GoalRecord>;
  updateRecurring(
    viewerUserId: string,
    recurringId: string,
    update: RecurringUpdate,
  ): Promise<void>;
  addGoalContribution(
    viewerUserId: string,
    goalId: string,
    input: GoalContributionCreateInput,
  ): Promise<GoalContributionRecord>;
  updateIncomeStream(
    viewerUserId: string,
    incomeStreamId: string,
    update: IncomeStreamUpdate,
  ): Promise<void>;
}
