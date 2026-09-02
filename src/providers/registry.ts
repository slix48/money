import "server-only";
import type { FinancialDataProvider } from "@/providers/financial-data";
import { MockFinancialDataProvider } from "@/providers/financial-data";
import type { BrokerageDataProvider } from "@/providers/brokerage-data";
import { MockBrokerageDataProvider } from "@/providers/brokerage-data";

let plaidProvider: FinancialDataProvider | undefined;
let plaidBrokerageProvider: BrokerageDataProvider | undefined;

export async function getFinancialDataProvider(
  provider: "PLAID" | "MOCK",
): Promise<FinancialDataProvider> {
  if (provider === "MOCK") return new MockFinancialDataProvider();
  if (!plaidProvider) {
    const { PlaidFinancialDataProvider } = await import(
      "@/providers/plaid-financial-data"
    );
    plaidProvider = new PlaidFinancialDataProvider();
  }
  return plaidProvider;
}

export async function getBrokerageDataProvider(
  provider: "PLAID" | "MOCK",
): Promise<BrokerageDataProvider> {
  if (provider === "MOCK") return new MockBrokerageDataProvider();
  if (!plaidBrokerageProvider) {
    const { PlaidBrokerageDataProvider } = await import(
      "@/providers/plaid-brokerage-data"
    );
    plaidBrokerageProvider = new PlaidBrokerageDataProvider();
  }
  return plaidBrokerageProvider;
}
