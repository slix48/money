export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "CASH"
  | "BROKERAGE"
  | "RETIREMENT"
  | "LOAN"
  | "OTHER";

export type TransactionType =
  | "EXPENSE"
  | "INCOME"
  | "TRANSFER"
  | "REFUND"
  | "INVESTMENT_CONTRIBUTION"
  | "INVESTMENT_ACTIVITY"
  | "DEBT_PAYMENT"
  | "ADJUSTMENT";

export type CategoryName =
  | "Housing"
  | "Food"
  | "Dining"
  | "Transportation"
  | "Shopping"
  | "Entertainment"
  | "Health"
  | "Education"
  | "Travel"
  | "Utilities"
  | "Subscriptions"
  | "Insurance"
  | "Income"
  | "Investments"
  | "Transfers"
  | "Other";

export type IncomeType =
  | "SALARY"
  | "FREELANCE"
  | "BUSINESS"
  | "INTEREST"
  | "DIVIDENDS"
  | "INVESTMENT_INCOME"
  | "RENTAL"
  | "OTHER";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isDemo: boolean;
}

export interface AccountRecord {
  id: string;
  userId: string;
  name: string;
  institution: string;
  type: AccountType;
  balanceCents: number;
  availableBalanceCents?: number;
  currency: string;
  connectionStatus: "CONNECTED" | "NEEDS_ATTENTION" | "MANUAL" | "DISCONNECTED";
  source: "MOCK_PROVIDER" | "MANUAL" | "IMPORT" | "CONNECTED_PROVIDER";
  lastUpdatedAt: Date;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  accountId: string;
  linkedAccountId?: string;
  date: Date;
  merchant: string;
  description: string;
  amountCents: number;
  transactionType: TransactionType;
  category: CategoryName;
  subcategory?: string;
  incomeType?: IncomeType;
  isPending: boolean;
  isRecurring: boolean;
  notes?: string;
  source: "MOCK_PROVIDER" | "MANUAL" | "IMPORT" | "CONNECTED_PROVIDER";
  transferPairId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMIANNUAL"
  | "ANNUAL"
  | "VARIABLE";

export interface RecurringRecord {
  id: string;
  userId: string;
  accountId: string;
  merchant: string;
  amountCents: number;
  previousAmountCents?: number;
  category: CategoryName;
  frequency: RecurringFrequency;
  nextEstimatedDate?: Date;
  lastChargeDate: Date;
  annualizedCents: number;
  status: "ACTIVE" | "POSSIBLE" | "CANCELLED" | "IGNORED";
  confidence: number;
  isSubscription: boolean;
}

export interface IncomeStreamRecord {
  id: string;
  userId: string;
  name: string;
  payer: string;
  type: IncomeType;
  averageAmountCents: number;
  isRecurring: boolean;
  frequency?: RecurringFrequency;
  lastReceivedAt: Date;
  nextExpectedAt?: Date;
}

export interface HoldingRecord {
  id: string;
  userId: string;
  accountId: string;
  ticker: string;
  name: string;
  securityType: "STOCK" | "ETF" | "MUTUAL_FUND" | "CASH" | "OTHER";
  quantity: number;
  costBasisCents: number;
  priceCents: number;
  currentValueCents: number;
  priceAsOf: Date;
  priceSource: "DEMO" | "MANUAL" | "MARKET_PROVIDER";
}

export interface InvestmentActivityRecord {
  id: string;
  userId: string;
  accountId: string;
  date: Date;
  type: "BUY" | "SELL" | "DIVIDEND" | "INTEREST" | "CONTRIBUTION" | "WITHDRAWAL";
  ticker?: string;
  quantity?: number;
  priceCents?: number;
  amountCents: number;
}

export interface NetWorthSnapshotRecord {
  id: string;
  userId: string;
  date: Date;
  cashCents: number;
  investmentsCents: number;
  debtCents: number;
  otherAssetsCents: number;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

export interface GoalRecord {
  id: string;
  userId: string;
  type: "EMERGENCY_FUND" | "CAR" | "HOUSE" | "VACATION" | "EDUCATION" | "CUSTOM";
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate?: Date;
  linkedAccountId?: string;
  monthlyTargetCents: number;
  color: string;
}

export interface FinancialSnapshot {
  user: UserSummary;
  accounts: AccountRecord[];
  transactions: TransactionRecord[];
  recurring: RecurringRecord[];
  incomeStreams: IncomeStreamRecord[];
  holdings: HoldingRecord[];
  investmentActivity: InvestmentActivityRecord[];
  netWorthHistory: NetWorthSnapshotRecord[];
  goals: GoalRecord[];
  generatedAt: Date;
  dataSource: "DEMO" | "DATABASE";
}

export interface DateRange {
  from: Date;
  to: Date;
}
