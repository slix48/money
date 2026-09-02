import "server-only";
import { subDays, subMonths } from "date-fns";
import { prisma } from "@/lib/db";
import { getBrokerageDataProvider } from "@/providers/registry";
import { prismaSyncStore } from "@/sync/prisma-sync-store";
import { providerErrorCode } from "@/sync/sync-engine";

const UNAVAILABLE_PRODUCT_CODES = new Set([
  "INVALID_PRODUCT",
  "NO_INVESTMENT_ACCOUNTS",
  "PRODUCT_NOT_ENABLED",
  "PRODUCTS_NOT_SUPPORTED",
]);

function utcDay(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function syncInvestmentConnection(input: {
  userId: string;
  connectionId: string;
  runId: string;
}): Promise<{ available: boolean; errorCategory?: string }> {
  const connection = await prismaSyncStore.loadConnection(
    input.userId,
    input.connectionId,
  );
  const state = await prisma.financialConnection.findFirst({
    where: { id: input.connectionId, userId: input.userId },
    select: { lastInvestmentSyncAt: true },
  });
  if (!state) return { available: false, errorCategory: "CONNECTION_NOT_FOUND" };
  let result;
  try {
    const provider = await getBrokerageDataProvider(connection.provider);
    const now = new Date();
    result = await provider.sync({
      accessToken: connection.accessToken,
      startDate: state.lastInvestmentSyncAt
        ? subDays(state.lastInvestmentSyncAt, 45)
        : subMonths(now, 24),
      endDate: now,
    });
  } catch (error) {
    const code = providerErrorCode(error);
    const errorCategory = UNAVAILABLE_PRODUCT_CODES.has(code ?? "")
      ? "INVESTMENTS_NOT_AVAILABLE"
      : "INVESTMENT_SYNC_FAILED";
    await prisma.syncRun.updateMany({
      where: {
        id: input.runId,
        userId: input.userId,
        financialConnectionId: input.connectionId,
      },
      data: { errorCategory },
    });
    return { available: false, errorCategory };
  }

  await prisma.$transaction(async (database) => {
      const investmentAccounts = await database.investmentAccount.findMany({
        where: { userId: input.userId },
        include: {
          account: {
            select: {
              providerAccount: {
                select: { providerAccountId: true, financialConnectionId: true },
              },
            },
          },
        },
      });
      const relevantAccounts = investmentAccounts.filter(
        (account) =>
          account.account.providerAccount?.financialConnectionId ===
          input.connectionId,
      );
      const accountByExternalId = new Map(
        relevantAccounts.flatMap((account) => {
          const externalId = account.account.providerAccount?.providerAccountId;
          return externalId ? [[externalId, account] as const] : [];
        }),
      );
      const existingHoldings = await database.holding.findMany({
        where: {
          userId: input.userId,
          investmentAccountId: { in: relevantAccounts.map((account) => account.id) },
        },
        select: {
          id: true,
          investmentAccountId: true,
          providerSecurityId: true,
          ticker: true,
        },
      });
      const existingByProviderSecurity = new Map(
        existingHoldings.flatMap((holding) =>
          holding.providerSecurityId
            ? [[`${holding.investmentAccountId}:${holding.providerSecurityId}`, holding] as const]
            : [],
        ),
      );
      const existingByTicker = new Map(
        existingHoldings.map((holding) => [
          `${holding.investmentAccountId}:${holding.ticker}`,
          holding,
        ] as const),
      );
      const activeSecuritiesByAccount = new Map<string, Set<string>>();
      let holdingsChanged = 0;
      for (const holding of result.holdings) {
        const investmentAccount = accountByExternalId.get(holding.accountExternalId);
        if (!investmentAccount) continue;
        const active = activeSecuritiesByAccount.get(investmentAccount.id) ?? new Set<string>();
        active.add(holding.securityExternalId);
        activeSecuritiesByAccount.set(investmentAccount.id, active);
        const existing =
          existingByProviderSecurity.get(
            `${investmentAccount.id}:${holding.securityExternalId}`,
          ) ??
          existingByTicker.get(`${investmentAccount.id}:${holding.ticker}`);
        const data = {
          providerSecurityId: holding.securityExternalId,
          ticker: holding.ticker,
          name: holding.name,
          securityType: holding.securityType,
          quantity: holding.quantity,
          costBasis:
            holding.costBasisCents === undefined
              ? null
              : holding.costBasisCents / 100,
          price: holding.priceCents / 100,
          currentValue: holding.currentValueCents / 100,
          priceAsOf: holding.priceAsOf,
          priceSource: holding.priceSource,
          priceIsDelayed: holding.priceIsDelayed,
          currency: holding.currency.slice(0, 3).toUpperCase(),
        };
        if (existing) {
          await database.holding.update({ where: { id: existing.id }, data });
        } else {
          await database.holding.create({
            data: {
              userId: input.userId,
              investmentAccountId: investmentAccount.id,
              ...data,
            },
          });
        }
        holdingsChanged += 1;
      }
      for (const account of relevantAccounts) {
        const active = activeSecuritiesByAccount.get(account.id) ?? new Set<string>();
        const deleted = await database.holding.deleteMany({
          where: {
            userId: input.userId,
            investmentAccountId: account.id,
            providerSecurityId: {
              not: null,
              ...(active.size > 0 ? { notIn: [...active] } : {}),
            },
          },
        });
        holdingsChanged += deleted.count;
      }

      let activityChanged = 0;
      for (const activity of result.activity) {
        const investmentAccount = accountByExternalId.get(activity.accountExternalId);
        if (!investmentAccount) continue;
        await database.investmentTransaction.upsert({
          where: {
            investmentAccountId_externalId: {
              investmentAccountId: investmentAccount.id,
              externalId: activity.externalId,
            },
          },
          update: {
            date: activity.date,
            type: activity.type,
            ticker: activity.ticker,
            quantity: activity.quantity,
            price:
              activity.priceCents === undefined
                ? null
                : activity.priceCents / 100,
            amount: activity.amountCents / 100,
            fees: activity.feesCents / 100,
            costBasis:
              activity.costBasisCents === undefined
                ? null
                : activity.costBasisCents / 100,
            realizedGain:
              activity.realizedGainCents === undefined
                ? null
                : activity.realizedGainCents / 100,
            notes: activity.description,
          },
          create: {
            userId: input.userId,
            investmentAccountId: investmentAccount.id,
            externalId: activity.externalId,
            date: activity.date,
            type: activity.type,
            ticker: activity.ticker,
            quantity: activity.quantity,
            price:
              activity.priceCents === undefined
                ? null
                : activity.priceCents / 100,
            amount: activity.amountCents / 100,
            fees: activity.feesCents / 100,
            costBasis:
              activity.costBasisCents === undefined
                ? null
                : activity.costBasisCents / 100,
            realizedGain:
              activity.realizedGainCents === undefined
                ? null
                : activity.realizedGainCents / 100,
            notes: activity.description,
          },
        });
        activityChanged += 1;
      }
      await database.financialConnection.updateMany({
        where: { id: input.connectionId, userId: input.userId },
        data: { lastInvestmentSyncAt: result.asOf },
      });
      await database.syncRun.updateMany({
        where: {
          id: input.runId,
          userId: input.userId,
          financialConnectionId: input.connectionId,
        },
        data: {
          holdingsChanged,
          investmentActivityChanged: activityChanged,
          providerCalls: { increment: result.providerCalls },
        },
      });
      await database.usageMetric.upsert({
        where: {
          userId_day_category_provider_operation: {
            userId: input.userId,
            day: utcDay(result.asOf),
            category: "FINANCIAL_DATA",
            provider: connection.provider,
            operation: "INVESTMENTS_SYNC",
          },
        },
        update: {
          requestCount: { increment: 1 },
          units: { increment: result.providerCalls },
        },
        create: {
          userId: input.userId,
          day: utcDay(result.asOf),
          category: "FINANCIAL_DATA",
          provider: connection.provider,
          operation: "INVESTMENTS_SYNC",
          requestCount: 1,
          units: result.providerCalls,
        },
      });
      await database.auditEvent.create({
        data: {
          userId: input.userId,
          action: "INVESTMENT_SYNC_COMPLETED",
          entityType: "FinancialConnection",
          entityId: input.connectionId,
          metadata: { holdingsChanged, activityChanged },
        },
      });
  }, { maxWait: 5_000, timeout: 30_000 });
  return { available: true };
}
