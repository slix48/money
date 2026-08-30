export type FinancialAction =
  | { type: "SUBSCRIPTION_CANCELLATION"; recurringId: string }
  | {
      type: "TRANSFER";
      fromAccountId: string;
      toAccountId: string;
      amountCents: number;
      currency: string;
    }
  | {
      type: "BILL_PAYMENT";
      accountId: string;
      billId: string;
      amountCents: number;
      currency: string;
    }
  | {
      type: "SAVINGS_TRANSFER";
      fromAccountId: string;
      toAccountId: string;
      amountCents: number;
      currency: string;
    }
  | {
      type: "BROKERAGE_ORDER";
      accountId: string;
      ticker: string;
      side: "BUY" | "SELL";
      orderType: "MARKET" | "LIMIT";
      quantity: number;
      limitPriceCents?: number;
    };

export interface ActionProposal {
  proposalId: string;
  userId: string;
  action: FinancialAction;
  summary: string;
  providerId: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: "PROPOSED";
  createdAt: Date;
  expiresAt: Date;
}

export interface ActionPermission {
  proposalId: string;
  allowed: boolean;
  reasons: string[];
  requiresExplicitConfirmation: true;
  requiresStepUpAuthentication: boolean;
  evaluatedAt: Date;
  policyVersion: string;
}

export interface ActionConfirmation {
  proposalId: string;
  userId: string;
  confirmedAt: Date;
  confirmationNonce: string;
  idempotencyKey: string;
  stepUpAuthenticationId?: string;
}

export interface ActionExecutionResult {
  proposalId: string;
  executionId: string;
  status: "ACCEPTED" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  providerReference?: string;
  message: string;
  auditedAt: Date;
}

export interface ActionCapability {
  available: boolean;
  reason?: string;
  requiresExplicitConfirmation: true;
  requiresStepUpAuthentication: boolean;
}

export interface FinancialActionPolicy {
  readonly version: string;
  evaluate(
    proposal: ActionProposal,
    authenticatedUserId: string,
  ): Promise<ActionPermission>;
}

export interface FinancialActionProvider {
  readonly id: string;
  getCapability(action: FinancialAction): Promise<ActionCapability>;
  prepare(
    userId: string,
    action: FinancialAction,
    idempotencyKey: string,
  ): Promise<ActionProposal>;
  execute(
    proposal: ActionProposal,
    permission: ActionPermission,
    confirmation: ActionConfirmation,
  ): Promise<ActionExecutionResult>;
}

export interface CancellationCapability extends ActionCapability {
  recurringId: string;
  method?: "API" | "ASSISTED" | "MANUAL";
}

export interface SubscriptionActionProvider {
  readonly id: string;
  getCancellationCapability(
    userId: string,
    recurringId: string,
  ): Promise<CancellationCapability>;
  prepareCancellation(
    userId: string,
    recurringId: string,
    idempotencyKey: string,
  ): Promise<ActionProposal>;
  executeCancellation(
    proposal: ActionProposal,
    permission: ActionPermission,
    confirmation: ActionConfirmation,
  ): Promise<ActionExecutionResult>;
}

const unavailableCapability: ActionCapability = {
  available: false,
  reason: "Financial actions are not available in MoneyOS V1",
  requiresExplicitConfirmation: true,
  requiresStepUpAuthentication: true,
};

export class V1ActionsUnavailable
  implements FinancialActionProvider, SubscriptionActionProvider
{
  readonly id = "v1-actions-unavailable";

  async getCapability(_action: FinancialAction): Promise<ActionCapability> {
    void _action;
    return unavailableCapability;
  }

  async getCancellationCapability(
    _userId: string,
    recurringId: string,
  ): Promise<CancellationCapability> {
    return { ...unavailableCapability, recurringId };
  }

  async prepare(
    _userId: string,
    _action: FinancialAction,
    _idempotencyKey: string,
  ): Promise<ActionProposal> {
    void _userId;
    void _action;
    void _idempotencyKey;
    throw new Error("Financial actions are not available in MoneyOS V1");
  }

  async prepareCancellation(
    _userId: string,
    _recurringId: string,
    _idempotencyKey: string,
  ): Promise<ActionProposal> {
    void _userId;
    void _recurringId;
    void _idempotencyKey;
    throw new Error("Subscription cancellation is not available in MoneyOS V1");
  }

  async execute(
    _proposal: ActionProposal,
    _permission: ActionPermission,
    _confirmation: ActionConfirmation,
  ): Promise<ActionExecutionResult> {
    void _proposal;
    void _permission;
    void _confirmation;
    throw new Error("Financial actions are not available in MoneyOS V1");
  }

  async executeCancellation(
    _proposal: ActionProposal,
    _permission: ActionPermission,
    _confirmation: ActionConfirmation,
  ): Promise<ActionExecutionResult> {
    void _proposal;
    void _permission;
    void _confirmation;
    throw new Error("Subscription cancellation is not available in MoneyOS V1");
  }
}
