import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/auth/password";
import {
  createDemoSnapshot,
  DEFAULT_CATEGORIES,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_USER_ID,
} from "../src/domain/demo-data";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed MoneyOS");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const categoryIcons: Record<string, string> = {
  Housing: "House",
  Food: "ShoppingBasket",
  Dining: "Utensils",
  Transportation: "Car",
  Shopping: "ShoppingBag",
  Entertainment: "Clapperboard",
  Health: "HeartPulse",
  Education: "GraduationCap",
  Travel: "Plane",
  Utilities: "Zap",
  Subscriptions: "RefreshCw",
  Insurance: "Shield",
  Income: "WalletCards",
  Investments: "ChartNoAxesCombined",
  Transfers: "ArrowLeftRight",
  Other: "Shapes",
};

function categoryId(name: string): string {
  return `cat-${name.toLowerCase().replaceAll(" ", "-")}`;
}

async function seed() {
  const snapshot = createDemoSnapshot();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
  await prisma.user.create({
    data: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      name: snapshot.user.name,
      passwordHash,
      isDemo: true,
    },
  });

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((category) => ({
      id: categoryId(category.name),
      userId: DEMO_USER_ID,
      name: category.name,
      kind: category.kind,
      color: category.color,
      icon: categoryIcons[category.name] ?? "Shapes",
      isDefault: true,
    })),
  });

  await prisma.account.createMany({
    data: snapshot.accounts.map((account) => ({
      id: account.id,
      userId: account.userId,
      name: account.name,
      institution: account.institution,
      type: account.type,
      balance: account.balanceCents / 100,
      availableBalance:
        account.availableBalanceCents === undefined
          ? null
          : account.availableBalanceCents / 100,
      currency: account.currency,
      isLiability: account.isLiability,
      providerAccountId: account.id,
      source: account.source,
      connectionStatus: account.connectionStatus,
      lastUpdatedAt: account.lastUpdatedAt,
    })),
  });

  const investmentAccounts = snapshot.accounts.filter(
    (account) => account.type === "BROKERAGE" || account.type === "RETIREMENT",
  );
  await prisma.investmentAccount.createMany({
    data: investmentAccounts.map((account) => ({
      id: `investment-${account.id}`,
      userId: DEMO_USER_ID,
      accountId: account.id,
      providerAccountId: account.id,
    })),
  });

  await prisma.recurringTransaction.createMany({
    data: snapshot.recurring.map((item) => ({
      id: item.id,
      userId: item.userId,
      accountId: item.accountId,
      categoryId: categoryId(item.category),
      merchant: item.merchant,
      normalizedMerchant: item.merchant.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      amount: item.amountCents / 100,
      averageAmount: item.averageAmountCents / 100,
      previousAmount:
        item.previousAmountCents === undefined ? null : item.previousAmountCents / 100,
      frequency: item.frequency,
      nextEstimatedDate: item.nextEstimatedDate,
      lastChargeDate: item.lastChargeDate,
      annualizedAmount: item.annualizedCents / 100,
      status: item.status,
      confidence: item.confidence,
      isSubscription: item.isSubscription,
    })),
  });

  const recurringByMerchant = new Map(
    snapshot.recurring.map((item) => [item.merchant, item.id]),
  );
  await prisma.transaction.createMany({
    data: snapshot.transactions.map((transaction) => ({
      id: transaction.id,
      userId: transaction.userId,
      accountId: transaction.accountId,
      linkedAccountId: transaction.linkedAccountId,
      recurringTransactionId: transaction.isRecurring
        ? recurringByMerchant.get(transaction.merchant)
        : undefined,
      categoryId: categoryId(transaction.category),
      externalId: transaction.id,
      date: transaction.date,
      merchant: transaction.merchant,
      rawMerchant: transaction.rawMerchant,
      normalizedMerchant: transaction.normalizedMerchant,
      description: transaction.description,
      rawDescription: transaction.rawDescription,
      amount: transaction.amountCents / 100,
      transactionType: transaction.transactionType,
      subcategory: transaction.subcategory,
      incomeType: transaction.incomeType,
      isPending: transaction.isPending,
      isRecurring: transaction.isRecurring,
      notes: transaction.notes,
      source: transaction.source,
      transferPairId: transaction.transferPairId,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    })),
  });

  await prisma.incomeStream.createMany({
    data: snapshot.incomeStreams.map((stream) => ({
      id: stream.id,
      userId: stream.userId,
      accountId: snapshot.accounts.find((account) => account.type === "CHECKING")?.id,
      name: stream.name,
      payer: stream.payer,
      type: stream.type,
      averageAmount: stream.averageAmountCents / 100,
      isRecurring: stream.isRecurring,
      frequency: stream.frequency,
      lastReceivedAt: stream.lastReceivedAt,
      nextExpectedAt: stream.nextExpectedAt,
    })),
  });

  await prisma.holding.createMany({
    data: snapshot.holdings.map((holding) => ({
      id: holding.id,
      userId: holding.userId,
      investmentAccountId: `investment-${holding.accountId}`,
      ticker: holding.ticker,
      name: holding.name,
      securityType: holding.securityType,
      quantity: holding.quantity,
      costBasis: holding.costBasisCents / 100,
      price: holding.priceCents / 100,
      currentValue: holding.currentValueCents / 100,
      priceAsOf: holding.priceAsOf,
      priceSource: holding.priceSource,
    })),
  });

  await prisma.investmentTransaction.createMany({
    data: snapshot.investmentActivity.map((activity) => ({
      id: activity.id,
      userId: activity.userId,
      investmentAccountId: `investment-${activity.accountId}`,
      externalId: activity.id,
      date: activity.date,
      type: activity.type,
      ticker: activity.ticker,
      quantity: activity.quantity,
      price: activity.priceCents === undefined ? undefined : activity.priceCents / 100,
      amount: activity.amountCents / 100,
      fees: activity.feesCents / 100,
      costBasis:
        activity.costBasisCents === undefined ? undefined : activity.costBasisCents / 100,
      realizedGain:
        activity.realizedGainCents === undefined
          ? undefined
          : activity.realizedGainCents / 100,
    })),
  });

  await prisma.netWorthSnapshot.createMany({
    data: snapshot.netWorthHistory.map((item) => ({
      id: item.id,
      userId: item.userId,
      date: item.date,
      cash: item.cashCents / 100,
      investments: item.investmentsCents / 100,
      debt: item.debtCents / 100,
      otherAssets: item.otherAssetsCents / 100,
      otherLiabilities: 0,
      assets: item.assetsCents / 100,
      liabilities: item.liabilitiesCents / 100,
      netWorth: item.netWorthCents / 100,
    })),
  });

  await prisma.goal.createMany({
    data: snapshot.goals.map((goal) => ({
      id: goal.id,
      userId: goal.userId,
      linkedAccountId: goal.linkedAccountId,
      type: goal.type,
      name: goal.name,
      targetAmount: goal.targetAmountCents / 100,
      currentAmount: goal.currentAmountCents / 100,
      targetDate: goal.targetDate,
      monthlyTarget: goal.monthlyTargetCents / 100,
      notes: goal.notes,
      color: goal.color,
    })),
  });

  await prisma.goalContribution.createMany({
    data: snapshot.goalContributions.map((contribution) => ({
      id: contribution.id,
      userId: contribution.userId,
      goalId: contribution.goalId,
      date: contribution.date,
      amount: contribution.amountCents / 100,
      source: contribution.source,
      notes: contribution.notes,
    })),
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`MoneyOS demo seed failed: ${message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
