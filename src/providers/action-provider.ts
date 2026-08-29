export type FinancialAction =
  | { type: "SUBSCRIPTION_CANCELLATION"; recurringId: string }
  | { type: "TRANSFER"; fromAccountId: string; toAccountId: string; amountCents: number }
  | { type: "TRADE"; accountId: string; ticker: string; quantity: number };

export interface ActionPreparation {
  actionId: string;
  summary: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  requiresExplicitConfirmation: true;
  expiresAt: Date;
}

export interface FinancialActionProvider {
  readonly id: string;
  prepare(userId: string, action: FinancialAction): Promise<ActionPreparation>;
  executeConfirmed(userId: string, actionId: string, confirmationToken: string): Promise<never>;
}

export class V1ActionsUnavailable implements FinancialActionProvider {
  readonly id = "v1-actions-unavailable";

  async prepare(): Promise<ActionPreparation> {
    throw new Error("Financial actions are not available in MoneyOS V1");
  }

  async executeConfirmed(): Promise<never> {
    throw new Error("Financial actions are not available in MoneyOS V1");
  }
}
