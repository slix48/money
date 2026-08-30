import type {
  HoldingRecord,
  InvestmentActivityRecord,
} from "@/domain/types";
import { createDemoSnapshot, DEMO_USER_ID } from "@/domain/demo-data";

export interface BrokerageSyncRequest {
  connectionId: string;
  cursor?: string;
}

export interface BrokerageSyncResult {
  connectionId: string;
  cursor: string;
  hasMore: boolean;
  holdings: HoldingRecord[];
  activity: InvestmentActivityRecord[];
  asOf: Date;
}

export interface BrokerageDataProvider {
  readonly id: string;
  sync(
    userId: string,
    request: BrokerageSyncRequest,
  ): Promise<BrokerageSyncResult>;
  disconnect(userId: string, connectionId: string): Promise<void>;
}

export class MockBrokerageDataProvider implements BrokerageDataProvider {
  readonly id = "mock-brokerage-data";

  async sync(
    userId: string,
    request: BrokerageSyncRequest,
  ): Promise<BrokerageSyncResult> {
    if (userId !== DEMO_USER_ID || request.connectionId !== "demo-brokerage") {
      throw new Error("Brokerage connection not found");
    }
    const snapshot = createDemoSnapshot();
    return {
      connectionId: request.connectionId,
      cursor: "demo-brokerage-cursor-v1",
      hasMore: false,
      holdings: snapshot.holdings,
      activity: request.cursor ? [] : snapshot.investmentActivity,
      asOf: snapshot.generatedAt,
    };
  }

  async disconnect(userId: string, connectionId: string): Promise<void> {
    if (userId !== DEMO_USER_ID || connectionId !== "demo-brokerage") {
      throw new Error("Brokerage connection not found");
    }
  }
}
