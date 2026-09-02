import type { AccountType } from "@/domain/types";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";

export interface ConnectionSession {
  sessionToken: string;
  expiresAt: Date;
}

export interface ConnectionSessionRequest {
  userId: string;
  accessToken?: string;
  redirectUri?: string;
}

export interface ExchangedConnection {
  accessToken: string;
  providerItemId: string;
  providerInstitutionId?: string;
  institutionName: string;
  consentExpiresAt?: Date;
}

export interface NormalizedProviderAccount {
  externalId: string;
  name: string;
  officialName?: string;
  institutionName: string;
  type: AccountType;
  subtype?: string;
  balanceCents: number | null;
  availableBalanceCents?: number;
  currency: string;
  isLiability: boolean;
  maskLast4?: string;
  balanceAsOf: Date;
}

export interface ProviderCategoryHint {
  primary?: string;
  detailed?: string;
  confidence?: string;
}

export interface NormalizedProviderTransaction {
  externalId: string;
  pendingExternalId?: string;
  accountExternalId: string;
  date: Date;
  authorizedDate?: Date;
  rawName: string;
  providerMerchantName?: string;
  originalDescription?: string;
  amountCents: number;
  currency: string;
  isPending: boolean;
  categoryHint?: ProviderCategoryHint;
  paymentChannel?: string;
}

export interface FinancialDataSyncRequest {
  accessToken: string;
  cursor?: string;
  pageSize?: number;
}

export interface FinancialDataSyncResult {
  cursor: string;
  hasMore: boolean;
  accounts: NormalizedProviderAccount[];
  addedTransactions: NormalizedProviderTransaction[];
  modifiedTransactions: NormalizedProviderTransaction[];
  removedExternalTransactionIds: string[];
  providerRequestId: string;
  syncedAt: Date;
}

export interface VerifiedFinancialDataWebhook {
  providerItemId?: string;
  event:
    | "SYNC_AVAILABLE"
    | "INVESTMENTS_AVAILABLE"
    | "CONNECTION_ERROR"
    | "CONSENT_EXPIRING"
    | "CONNECTION_REMOVED"
    | "IGNORED";
  providerEventId: string;
  occurredAt: Date;
}

export interface FinancialDataProvider {
  readonly id: "plaid" | "mock";
  readonly displayName: string;
  createConnectionSession(
    request: ConnectionSessionRequest,
  ): Promise<ConnectionSession>;
  exchangePublicToken(publicToken: string): Promise<ExchangedConnection>;
  getAccounts(
    accessToken: string,
    institutionName: string,
  ): Promise<NormalizedProviderAccount[]>;
  syncTransactions(
    request: FinancialDataSyncRequest,
    institutionName: string,
  ): Promise<FinancialDataSyncResult>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedFinancialDataWebhook>;
  disconnect(accessToken: string): Promise<void>;
}

export class MockFinancialDataProvider implements FinancialDataProvider {
  readonly id = "mock" as const;
  readonly displayName = "MoneyOS Demo Provider";

  async createConnectionSession(
    request: ConnectionSessionRequest,
  ): Promise<ConnectionSession> {
    this.assertDemoUser(request.userId);
    return {
      sessionToken: "demo-connection-session",
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangedConnection> {
    if (publicToken !== "demo-public-token") {
      throw new Error("Provider connection not found");
    }
    return {
      accessToken: "demo-access-token",
      providerItemId: "demo-connection",
      institutionName: this.displayName,
    };
  }

  async getAccounts(
    accessToken: string,
    institutionName: string,
  ): Promise<NormalizedProviderAccount[]> {
    this.assertAccessToken(accessToken);
    return createDemoSnapshot().accounts.map((account) => ({
      externalId: account.id,
      name: account.name,
      institutionName,
      type: account.type,
      balanceCents: account.balanceCents,
      availableBalanceCents: account.availableBalanceCents,
      currency: account.currency,
      isLiability: account.isLiability,
      balanceAsOf: account.lastUpdatedAt,
    }));
  }

  async syncTransactions(
    request: FinancialDataSyncRequest,
    institutionName: string,
  ): Promise<FinancialDataSyncResult> {
    this.assertAccessToken(request.accessToken);
    const snapshot = createDemoSnapshot();
    const accounts = await this.getAccounts(request.accessToken, institutionName);
    return {
      cursor: "demo-cursor-v1",
      hasMore: false,
      accounts,
      addedTransactions: request.cursor
        ? []
        : snapshot.transactions.map((transaction) => ({
            externalId: transaction.id,
            accountExternalId: transaction.accountId,
            date: transaction.date,
            rawName: transaction.rawMerchant ?? transaction.merchant,
            providerMerchantName: transaction.merchant,
            originalDescription: transaction.rawDescription,
            amountCents: transaction.amountCents,
            currency: "USD",
            isPending: transaction.isPending,
          })),
      modifiedTransactions: [],
      removedExternalTransactionIds: [],
      providerRequestId: "demo-request",
      syncedAt: snapshot.generatedAt,
    };
  }

  async verifyWebhook(): Promise<VerifiedFinancialDataWebhook> {
    throw new Error("Demo provider does not accept webhooks");
  }

  async disconnect(accessToken: string): Promise<void> {
    this.assertAccessToken(accessToken);
  }

  private assertDemoUser(userId: string) {
    if (userId !== DEMO_USER_ID) throw new Error("Provider connection not found");
  }

  private assertAccessToken(accessToken: string) {
    if (accessToken !== "demo-access-token") {
      throw new Error("Provider connection not found");
    }
  }
}
