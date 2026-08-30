import type {
  AccountRecord,
  FinancialSnapshot,
  TransactionRecord,
} from "@/domain/types";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";

export interface ProviderConnection {
  provider: string;
  connectionId: string;
  status: "CONNECTED" | "NEEDS_ATTENTION" | "DISCONNECTED";
  consentExpiresAt?: Date;
  lastSuccessfulSyncAt?: Date;
  errorCode?: string;
}

export interface ConnectionSession {
  sessionToken: string;
  expiresAt: Date;
}

export interface FinancialDataSyncRequest {
  connectionId: string;
  cursor?: string;
  pageSize?: number;
}

export interface FinancialDataSyncResult {
  connectionId: string;
  cursor: string;
  hasMore: boolean;
  accounts: AccountRecord[];
  addedOrUpdatedTransactions: TransactionRecord[];
  removedExternalTransactionIds: string[];
  syncedAt: Date;
}

export interface VerifiedFinancialDataWebhook {
  connectionId: string;
  event:
    | "SYNC_AVAILABLE"
    | "CONNECTION_ERROR"
    | "CONSENT_EXPIRING"
    | "CONNECTION_REMOVED";
  providerEventId: string;
  occurredAt: Date;
}

export interface FinancialDataProvider {
  readonly id: string;
  readonly displayName: string;
  createConnectionSession(
    userId: string,
    redirectUri: string,
  ): Promise<ConnectionSession>;
  getConnection(userId: string): Promise<ProviderConnection>;
  sync(
    userId: string,
    request: FinancialDataSyncRequest,
  ): Promise<FinancialDataSyncResult>;
  fetchSnapshot(userId: string): Promise<FinancialSnapshot>;
  verifyWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<VerifiedFinancialDataWebhook>;
  disconnect(userId: string, connectionId: string): Promise<void>;
}

export class MockFinancialDataProvider implements FinancialDataProvider {
  readonly id = "mock-financial-data";
  readonly displayName = "MoneyOS Demo Provider";

  async createConnectionSession(
    userId: string,
    _redirectUri: string,
  ): Promise<ConnectionSession> {
    this.assertDemoUser(userId);
    void _redirectUri;
    return {
      sessionToken: "demo-connection-session",
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    };
  }

  async getConnection(userId: string): Promise<ProviderConnection> {
    this.assertDemoUser(userId);
    return {
      provider: this.id,
      connectionId: "demo-connection",
      status: "CONNECTED",
      lastSuccessfulSyncAt: new Date(),
    };
  }

  async sync(
    userId: string,
    request: FinancialDataSyncRequest,
  ): Promise<FinancialDataSyncResult> {
    this.assertDemoUser(userId);
    if (request.connectionId !== "demo-connection") {
      throw new Error("Provider connection not found");
    }
    const snapshot = createDemoSnapshot();
    return {
      connectionId: request.connectionId,
      cursor: "demo-cursor-v1",
      hasMore: false,
      accounts: snapshot.accounts,
      addedOrUpdatedTransactions: request.cursor
        ? []
        : snapshot.transactions,
      removedExternalTransactionIds: [],
      syncedAt: snapshot.generatedAt,
    };
  }

  async fetchSnapshot(userId: string): Promise<FinancialSnapshot> {
    this.assertDemoUser(userId);
    return createDemoSnapshot();
  }

  async verifyWebhook(): Promise<VerifiedFinancialDataWebhook> {
    throw new Error("Demo provider does not accept webhooks");
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    this.assertDemoUser(userId);
    if (connectionId !== "demo-connection") {
      throw new Error("Provider connection not found");
    }
  }

  private assertDemoUser(userId: string) {
    if (userId !== DEMO_USER_ID) {
      throw new Error("Provider connection not found");
    }
  }
}
