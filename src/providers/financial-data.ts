import type { FinancialSnapshot } from "@/domain/types";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";

export interface ProviderConnection {
  provider: string;
  connectionId: string;
  status: "CONNECTED" | "NEEDS_ATTENTION" | "DISCONNECTED";
  lastSuccessfulSyncAt?: Date;
  errorCode?: string;
}

export interface FinancialDataProvider {
  readonly id: string;
  readonly displayName: string;
  getConnection(userId: string): Promise<ProviderConnection>;
  fetchSnapshot(userId: string): Promise<FinancialSnapshot>;
  disconnect(userId: string): Promise<void>;
}

export class MockFinancialDataProvider implements FinancialDataProvider {
  readonly id = "mock-financial-data";
  readonly displayName = "MoneyOS Demo Provider";

  async getConnection(userId: string): Promise<ProviderConnection> {
    this.assertDemoUser(userId);
    return {
      provider: this.id,
      connectionId: "demo-connection",
      status: "CONNECTED",
      lastSuccessfulSyncAt: new Date(),
    };
  }

  async fetchSnapshot(userId: string): Promise<FinancialSnapshot> {
    this.assertDemoUser(userId);
    return createDemoSnapshot();
  }

  async disconnect(userId: string): Promise<void> {
    this.assertDemoUser(userId);
  }

  private assertDemoUser(userId: string) {
    if (userId !== DEMO_USER_ID) {
      throw new Error("Provider connection not found");
    }
  }
}
