import {
  type AccountRecord,
  type CategoryName,
  type FinancialSnapshot,
  type IncomeType,
  type TransactionRecord,
  type TransactionType,
} from "@/domain/types";

export const DEMO_USER_ID = "demo-user-moneyos";
export const DEMO_EMAIL = "demo@moneyos.local";
export const DEMO_PASSWORD = "moneyos-demo";

export const DEFAULT_CATEGORIES: Array<{
  name: CategoryName;
  color: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER" | "INVESTMENT" | "OTHER";
}> = [
  { name: "Housing", color: "#4f6f64", kind: "EXPENSE" },
  { name: "Food", color: "#d19a48", kind: "EXPENSE" },
  { name: "Dining", color: "#cf6d5b", kind: "EXPENSE" },
  { name: "Transportation", color: "#547a9b", kind: "EXPENSE" },
  { name: "Shopping", color: "#8d6b94", kind: "EXPENSE" },
  { name: "Entertainment", color: "#7e8e52", kind: "EXPENSE" },
  { name: "Health", color: "#5b958b", kind: "EXPENSE" },
  { name: "Education", color: "#7377a8", kind: "EXPENSE" },
  { name: "Travel", color: "#b87950", kind: "EXPENSE" },
  { name: "Utilities", color: "#68849a", kind: "EXPENSE" },
  { name: "Subscriptions", color: "#9a6f78", kind: "EXPENSE" },
  { name: "Insurance", color: "#69788b", kind: "EXPENSE" },
  { name: "Income", color: "#3f826d", kind: "INCOME" },
  { name: "Investments", color: "#4f729d", kind: "INVESTMENT" },
  { name: "Transfers", color: "#7b8087", kind: "TRANSFER" },
  { name: "Other", color: "#8d8982", kind: "OTHER" },
];

const accountIds = {
  checking: "acct-checking",
  savings: "acct-savings",
  credit: "acct-credit",
  brokerage: "acct-brokerage",
  retirement: "acct-retirement",
  loan: "acct-loan",
} as const;

function monthDate(anchor: Date, monthsAgo: number, day: number): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth() - monthsAgo;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), 12, 0, 0, 0);
}

interface TransactionInput {
  accountId?: string;
  linkedAccountId?: string;
  merchant: string;
  description?: string;
  amountCents: number;
  transactionType: TransactionType;
  category: CategoryName;
  subcategory?: string;
  incomeType?: IncomeType;
  isPending?: boolean;
  isRecurring?: boolean;
  notes?: string;
  transferPairId?: string;
}

function makeTransaction(
  anchor: Date,
  monthsAgo: number,
  day: number,
  key: string,
  input: TransactionInput,
): TransactionRecord {
  const date = monthDate(anchor, monthsAgo, day);
  return {
    id: `tx-${monthsAgo}-${key}`,
    userId: DEMO_USER_ID,
    accountId: input.accountId ?? accountIds.credit,
    linkedAccountId: input.linkedAccountId,
    date,
    merchant: input.merchant,
    description: input.description ?? input.merchant,
    amountCents: input.amountCents,
    transactionType: input.transactionType,
    category: input.category,
    subcategory: input.subcategory,
    incomeType: input.incomeType,
    isPending: input.isPending ?? false,
    isRecurring: input.isRecurring ?? false,
    notes: input.notes,
    source: "MOCK_PROVIDER",
    transferPairId: input.transferPairId,
    createdAt: date,
    updatedAt: date,
  };
}

function createTransactions(anchor: Date): TransactionRecord[] {
  const transactions: TransactionRecord[] = [];

  for (let month = 0; month < 6; month += 1) {
    const paycheck = month === 0 ? 325_000 : 300_000;
    const internet = month === 0 ? 8_300 : 6_500;
    const streambox = month === 0 ? 1_899 : 1_599;
    const investmentContribution = month === 0 ? 40_000 : 35_000;
    const retirementContribution = month === 0 ? 30_000 : 25_000;

    const add = (day: number, key: string, input: TransactionInput) => {
      transactions.push(makeTransaction(anchor, month, day, key, input));
    };

    add(1, "paycheck-1", {
      accountId: accountIds.checking,
      merchant: "Northstar Labs",
      description: "Payroll direct deposit",
      amountCents: paycheck,
      transactionType: "INCOME",
      category: "Income",
      subcategory: "Salary",
      incomeType: "SALARY",
      isRecurring: true,
    });
    add(15, "paycheck-2", {
      accountId: accountIds.checking,
      merchant: "Northstar Labs",
      description: "Payroll direct deposit",
      amountCents: paycheck,
      transactionType: "INCOME",
      category: "Income",
      subcategory: "Salary",
      incomeType: "SALARY",
      isRecurring: true,
    });
    add(2, "rent", {
      merchant: "Park & Pine Apartments",
      amountCents: -185_000,
      transactionType: "EXPENSE",
      category: "Housing",
      subcategory: "Rent",
      isRecurring: true,
    });
    add(3, "streambox", {
      merchant: "Streambox",
      amountCents: -streambox,
      transactionType: "EXPENSE",
      category: "Subscriptions",
      subcategory: "Video streaming",
      isRecurring: true,
    });
    add(4, "spotify", {
      merchant: "Spotify",
      amountCents: -1_199,
      transactionType: "EXPENSE",
      category: "Subscriptions",
      subcategory: "Music",
      isRecurring: true,
    });
    add(5, "internet", {
      merchant: "MetroNet Fiber",
      amountCents: -internet,
      transactionType: "EXPENSE",
      category: "Utilities",
      subcategory: "Internet",
      isRecurring: true,
    });
    add(6, "groceries-1", {
      merchant: "Whole Foods Market",
      amountCents: -(8_800 + month * 240),
      transactionType: "EXPENSE",
      category: "Food",
      subcategory: "Groceries",
    });
    add(7, "phone", {
      merchant: "T-Mobile",
      amountCents: -7_400,
      transactionType: "EXPENSE",
      category: "Utilities",
      subcategory: "Mobile phone",
      isRecurring: true,
    });
    add(8, "coffee", {
      merchant: "Cedar Coffee",
      amountCents: -(740 + month * 35),
      transactionType: "EXPENSE",
      category: "Dining",
      subcategory: "Coffee",
    });
    add(9, "gas", {
      merchant: "Shell",
      amountCents: -(4_250 + month * 80),
      transactionType: "EXPENSE",
      category: "Transportation",
      subcategory: "Fuel",
    });
    add(10, "cloud", {
      merchant: "Cloudbox",
      amountCents: -999,
      transactionType: "EXPENSE",
      category: "Subscriptions",
      subcategory: "Cloud storage",
      isRecurring: true,
    });
    add(11, "dining-1", {
      merchant: month === 0 ? "Nobu" : "Common Table",
      description: month === 0 ? "Dinner with friends" : "Dinner",
      amountCents: month === 0 ? -28_600 : -(4_800 + month * 130),
      transactionType: "EXPENSE",
      category: "Dining",
      subcategory: "Restaurants",
    });
    add(12, "power", {
      merchant: "City Electric",
      amountCents: -(9_200 - month * 310),
      transactionType: "EXPENSE",
      category: "Utilities",
      subcategory: "Electricity",
      isRecurring: true,
    });
    add(13, "groceries-2", {
      merchant: "Trader Joe's",
      amountCents: -(7_350 + month * 170),
      transactionType: "EXPENSE",
      category: "Food",
      subcategory: "Groceries",
    });
    add(14, "gym", {
      merchant: "Form Athletics",
      amountCents: -4_900,
      transactionType: "EXPENSE",
      category: "Health",
      subcategory: "Fitness",
      isRecurring: true,
    });
    add(16, "investment", {
      accountId: accountIds.checking,
      linkedAccountId: accountIds.brokerage,
      merchant: "Brightside Brokerage",
      description: "Monthly brokerage contribution",
      amountCents: -investmentContribution,
      transactionType: "INVESTMENT_CONTRIBUTION",
      category: "Investments",
      subcategory: "Brokerage contribution",
      isRecurring: true,
      transferPairId: `invest-${month}`,
    });
    add(16, "retirement", {
      accountId: accountIds.checking,
      linkedAccountId: accountIds.retirement,
      merchant: "Brightside 401(k)",
      description: "Retirement contribution",
      amountCents: -retirementContribution,
      transactionType: "INVESTMENT_CONTRIBUTION",
      category: "Investments",
      subcategory: "Retirement contribution",
      isRecurring: true,
      transferPairId: `retire-${month}`,
    });
    add(17, "dining-2", {
      merchant: "Sweetgreen",
      amountCents: -(2_180 + month * 60),
      transactionType: "EXPENSE",
      category: "Dining",
      subcategory: "Restaurants",
    });
    add(18, "insurance", {
      merchant: "Lemonade Insurance",
      amountCents: -2_450,
      transactionType: "EXPENSE",
      category: "Insurance",
      subcategory: "Renters insurance",
      isRecurring: true,
    });
    add(19, "shopping", {
      merchant: month === 0 ? "B&H Photo" : "Target",
      description: month === 0 ? "Camera lens" : "Household supplies",
      amountCents: month === 0 ? -89_900 : -(6_200 + month * 210),
      transactionType: "EXPENSE",
      category: "Shopping",
      subcategory: month === 0 ? "Electronics" : "Household",
    });
    add(20, "loan", {
      accountId: accountIds.checking,
      linkedAccountId: accountIds.loan,
      merchant: "Federal Student Aid",
      amountCents: -30_000,
      transactionType: "DEBT_PAYMENT",
      category: "Transfers",
      subcategory: "Student loan payment",
      isRecurring: true,
    });
    add(21, "groceries-3", {
      merchant: "Whole Foods Market",
      amountCents: -(10_240 - month * 110),
      transactionType: "EXPENSE",
      category: "Food",
      subcategory: "Groceries",
    });
    add(22, "rideshare", {
      merchant: "Uber",
      amountCents: -(2_650 + month * 90),
      transactionType: "EXPENSE",
      category: "Transportation",
      subcategory: "Rideshare",
    });
    add(23, "dining-3", {
      merchant: "Ramen Tatsu-ya",
      amountCents: -(4_150 + month * 95),
      transactionType: "EXPENSE",
      category: "Dining",
      subcategory: "Restaurants",
    });
    add(24, "savings", {
      accountId: accountIds.checking,
      linkedAccountId: accountIds.savings,
      merchant: "Internal transfer",
      description: "Transfer to high-yield savings",
      amountCents: month === 0 ? -50_000 : -40_000,
      transactionType: "TRANSFER",
      category: "Transfers",
      subcategory: "Cash savings",
      isRecurring: true,
      transferPairId: `savings-${month}`,
    });
    add(25, "card-payment", {
      accountId: accountIds.checking,
      linkedAccountId: accountIds.credit,
      merchant: "Autopay to Horizon Card",
      amountCents: -(135_000 + month * 2_000),
      transactionType: "TRANSFER",
      category: "Transfers",
      subcategory: "Credit card payment",
      isRecurring: true,
      transferPairId: `card-payment-${month}`,
    });
    add(26, "dividend", {
      accountId: accountIds.brokerage,
      merchant: "Vanguard distributions",
      amountCents: 4_500 + month * 120,
      transactionType: "INCOME",
      category: "Income",
      subcategory: "Dividends",
      incomeType: "DIVIDENDS",
    });
    add(27, "pharmacy", {
      merchant: "CVS Pharmacy",
      amountCents: -(2_300 + month * 70),
      transactionType: "EXPENSE",
      category: "Health",
      subcategory: "Pharmacy",
    });

    if (month === 0) {
      add(10, "freelance", {
        accountId: accountIds.checking,
        merchant: "Civic Design Co.",
        description: "Product strategy project",
        amountCents: 85_000,
        transactionType: "INCOME",
        category: "Income",
        subcategory: "Freelance",
        incomeType: "FREELANCE",
      });
      add(21, "refund", {
        merchant: "Target",
        description: "Returned household items",
        amountCents: 6_500,
        transactionType: "REFUND",
        category: "Shopping",
        subcategory: "Refund",
      });
      add(28, "pending", {
        merchant: "Loro",
        amountCents: -6_240,
        transactionType: "EXPENSE",
        category: "Dining",
        subcategory: "Restaurants",
        isPending: true,
      });
    }

    if (month === 2 || month === 4) {
      add(12, "freelance", {
        accountId: accountIds.checking,
        merchant: "Civic Design Co.",
        amountCents: month === 2 ? 60_000 : 45_000,
        transactionType: "INCOME",
        category: "Income",
        subcategory: "Freelance",
        incomeType: "FREELANCE",
      });
    }
  }

  return transactions.sort((a, b) => b.date.getTime() - a.date.getTime());
}

function createAccounts(anchor: Date): AccountRecord[] {
  const common = {
    userId: DEMO_USER_ID,
    currency: "USD",
    connectionStatus: "CONNECTED" as const,
    source: "MOCK_PROVIDER" as const,
    lastUpdatedAt: anchor,
  };

  return [
    {
      ...common,
      id: accountIds.checking,
      name: "Everyday Checking",
      institution: "Meridian Bank",
      type: "CHECKING",
      balanceCents: 684_022,
      availableBalanceCents: 671_422,
    },
    {
      ...common,
      id: accountIds.savings,
      name: "Emergency Savings",
      institution: "Meridian Bank",
      type: "SAVINGS",
      balanceCents: 1_845_000,
      availableBalanceCents: 1_845_000,
    },
    {
      ...common,
      id: accountIds.credit,
      name: "Horizon Rewards",
      institution: "Horizon Financial",
      type: "CREDIT_CARD",
      balanceCents: -238_144,
      availableBalanceCents: 761_856,
    },
    {
      ...common,
      id: accountIds.brokerage,
      name: "Individual Brokerage",
      institution: "Brightside",
      type: "BROKERAGE",
      balanceCents: 3_528_000,
    },
    {
      ...common,
      id: accountIds.retirement,
      name: "Northstar 401(k)",
      institution: "Brightside",
      type: "RETIREMENT",
      balanceCents: 5_245_000,
    },
    {
      ...common,
      id: accountIds.loan,
      name: "Student Loan",
      institution: "Federal Student Aid",
      type: "LOAN",
      balanceCents: -1_120_000,
    },
  ];
}

export function createDemoSnapshot(anchor = new Date()): FinancialSnapshot {
  const transactions = createTransactions(anchor);
  const currentMonth = (day: number) => monthDate(anchor, 0, day);
  const nextMonth = (day: number) => monthDate(anchor, -1, day);

  return {
    user: {
      id: DEMO_USER_ID,
      name: "Alex Morgan",
      email: DEMO_EMAIL,
      isDemo: true,
    },
    accounts: createAccounts(anchor),
    transactions,
    recurring: [
      ["rent", "Park & Pine Apartments", 185_000, undefined, "Housing", 2, false, 1],
      ["streambox", "Streambox", 1_899, 1_599, "Subscriptions", 3, true, 1],
      ["spotify", "Spotify", 1_199, undefined, "Subscriptions", 4, true, 1],
      ["internet", "MetroNet Fiber", 8_300, 6_500, "Utilities", 5, false, 1],
      ["phone", "T-Mobile", 7_400, undefined, "Utilities", 7, false, 1],
      ["cloud", "Cloudbox", 999, undefined, "Subscriptions", 10, true, 1],
      ["gym", "Form Athletics", 4_900, undefined, "Health", 14, true, 1],
      ["insurance", "Lemonade Insurance", 2_450, undefined, "Insurance", 18, false, 1],
      ["possible", "Adobe", 2_299, undefined, "Subscriptions", 27, true, 0.72],
    ].map(([id, merchant, amount, previous, category, day, subscription, confidence]) => ({
      id: `rec-${String(id)}`,
      userId: DEMO_USER_ID,
      accountId: accountIds.credit,
      merchant: String(merchant),
      amountCents: Number(amount),
      previousAmountCents: previous === undefined ? undefined : Number(previous),
      category: category as CategoryName,
      frequency: "MONTHLY" as const,
      nextEstimatedDate: nextMonth(Number(day)),
      lastChargeDate: currentMonth(Number(day)),
      annualizedCents: Number(amount) * 12,
      status: id === "possible" ? ("POSSIBLE" as const) : ("ACTIVE" as const),
      confidence: Number(confidence),
      isSubscription: Boolean(subscription),
    })),
    incomeStreams: [
      {
        id: "income-salary",
        userId: DEMO_USER_ID,
        name: "Primary salary",
        payer: "Northstar Labs",
        type: "SALARY",
        averageAmountCents: 625_000,
        isRecurring: true,
        frequency: "BIWEEKLY",
        lastReceivedAt: currentMonth(15),
        nextExpectedAt: nextMonth(1),
      },
      {
        id: "income-freelance",
        userId: DEMO_USER_ID,
        name: "Product consulting",
        payer: "Civic Design Co.",
        type: "FREELANCE",
        averageAmountCents: 63_333,
        isRecurring: false,
        lastReceivedAt: currentMonth(10),
      },
      {
        id: "income-dividends",
        userId: DEMO_USER_ID,
        name: "Portfolio dividends",
        payer: "Vanguard distributions",
        type: "DIVIDENDS",
        averageAmountCents: 4_800,
        isRecurring: false,
        lastReceivedAt: currentMonth(26),
      },
    ],
    holdings: [
      ["VTI", "Vanguard Total Stock Market ETF", "ETF", 62, 1_425_000, 28_500, 1_767_000, accountIds.brokerage],
      ["AAPL", "Apple Inc.", "STOCK", 42, 702_000, 22_900, 961_800, accountIds.brokerage],
      ["VXUS", "Vanguard Total International Stock ETF", "ETF", 70, 402_500, 6_600, 462_000, accountIds.brokerage],
      ["BND", "Vanguard Total Bond Market ETF", "ETF", 32, 241_000, 7_300, 233_600, accountIds.brokerage],
      ["CASH", "Brokerage Cash", "CASH", 1, 103_600, 103_600, 103_600, accountIds.brokerage],
      ["VFFVX", "Vanguard Target Retirement 2055", "MUTUAL_FUND", 220, 4_120_000, 23_840.91, 5_245_000, accountIds.retirement],
    ].map(([ticker, name, securityType, quantity, cost, price, value, accountId]) => ({
      id: `holding-${String(ticker).toLowerCase()}`,
      userId: DEMO_USER_ID,
      accountId: String(accountId),
      ticker: String(ticker),
      name: String(name),
      securityType: securityType as "STOCK" | "ETF" | "MUTUAL_FUND" | "CASH",
      quantity: Number(quantity),
      costBasisCents: Number(cost),
      priceCents: Number(price),
      currentValueCents: Number(value),
      priceAsOf: anchor,
      priceSource: "DEMO" as const,
    })),
    investmentActivity: Array.from({ length: 6 }, (_, month) => [
      {
        id: `activity-brokerage-${month}`,
        userId: DEMO_USER_ID,
        accountId: accountIds.brokerage,
        date: monthDate(anchor, month, 16),
        type: "CONTRIBUTION" as const,
        amountCents: month === 0 ? 40_000 : 35_000,
      },
      {
        id: `activity-retirement-${month}`,
        userId: DEMO_USER_ID,
        accountId: accountIds.retirement,
        date: monthDate(anchor, month, 16),
        type: "CONTRIBUTION" as const,
        amountCents: month === 0 ? 30_000 : 25_000,
      },
      {
        id: `activity-dividend-${month}`,
        userId: DEMO_USER_ID,
        accountId: accountIds.brokerage,
        date: monthDate(anchor, month, 26),
        type: "DIVIDEND" as const,
        ticker: "VTI",
        amountCents: 4_500 + month * 120,
      },
    ]).flat(),
    netWorthHistory: Array.from({ length: 7 }, (_, index) => {
      const monthsAgo = 6 - index;
      const cash = 2_160_000 + index * 61_500;
      const investments = 7_812_000 + index * 160_167;
      const debt = 1_523_000 - index * 27_476;
      const assets = cash + investments;
      return {
        id: `nw-${monthsAgo}`,
        userId: DEMO_USER_ID,
        date: monthDate(anchor, monthsAgo, 28),
        cashCents: index === 6 ? 2_529_022 : cash,
        investmentsCents: index === 6 ? 8_773_000 : investments,
        debtCents: index === 6 ? 1_358_144 : debt,
        otherAssetsCents: 0,
        assetsCents: index === 6 ? 11_302_022 : assets,
        liabilitiesCents: index === 6 ? 1_358_144 : debt,
        netWorthCents: index === 6 ? 9_943_878 : assets - debt,
      };
    }),
    goals: [
      {
        id: "goal-emergency",
        userId: DEMO_USER_ID,
        type: "EMERGENCY_FUND",
        name: "Emergency fund",
        targetAmountCents: 3_000_000,
        currentAmountCents: 1_845_000,
        targetDate: monthDate(anchor, -18, 1),
        linkedAccountId: accountIds.savings,
        monthlyTargetCents: 50_000,
        color: "#3f826d",
      },
      {
        id: "goal-vacation",
        userId: DEMO_USER_ID,
        type: "VACATION",
        name: "Japan trip",
        targetAmountCents: 600_000,
        currentAmountCents: 312_000,
        targetDate: monthDate(anchor, -9, 1),
        monthlyTargetCents: 32_000,
        color: "#547a9b",
      },
      {
        id: "goal-home",
        userId: DEMO_USER_ID,
        type: "HOUSE",
        name: "Home down payment",
        targetAmountCents: 7_500_000,
        currentAmountCents: 1_280_000,
        targetDate: monthDate(anchor, -48, 1),
        monthlyTargetCents: 130_000,
        color: "#d19a48",
      },
    ],
    generatedAt: anchor,
    dataSource: "DEMO",
  };
}

export { accountIds as DEMO_ACCOUNT_IDS };
