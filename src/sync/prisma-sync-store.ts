import "server-only";
import { addDays, differenceInCalendarDays } from "date-fns";
import { normalizeMerchant, detectRecurringTransactions } from "@/domain/calculations";
import type { CategoryName, TransactionRecord } from "@/domain/types";
import { NotFoundError } from "@/data/errors";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { decryptProviderAccessToken } from "@/sync/provider-token-service";
import {
  FinancialSyncError,
  type
  SyncCommitInput,
  SyncCommitResult,
  SyncConnection,
  SyncFailure,
  SyncStore,
  SyncTrigger,
} from "@/sync/sync-engine";

function toCents(value: { toString(): string } | number): number {
  return Math.round(Number(value.toString()) * 100);
}

function utcDay(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function nextIncomeDate(dates: Date[]): Date | undefined {
  if (dates.length < 2) return undefined;
  const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
  const intervals = sorted.slice(1).map((date, index) =>
    differenceInCalendarDays(date, sorted[index]),
  );
  const averageDays = Math.max(
    1,
    Math.round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length),
  );
  return addDays(sorted.at(-1)!, averageDays);
}

function incomeFrequency(dates: Date[]) {
  if (dates.length < 2) return undefined;
  const sorted = [...dates].sort((left, right) => left.getTime() - right.getTime());
  const days = differenceInCalendarDays(sorted.at(-1)!, sorted.at(-2)!);
  if (days >= 5 && days <= 9) return "WEEKLY" as const;
  if (days >= 12 && days <= 17) return "BIWEEKLY" as const;
  if (days >= 25 && days <= 36) return "MONTHLY" as const;
  if (days >= 75 && days <= 105) return "QUARTERLY" as const;
  if (days >= 330 && days <= 400) return "ANNUAL" as const;
  return "VARIABLE" as const;
}

function connectionStateForFailure(failure: SyncFailure) {
  return failure.category === "AUTHENTICATION"
    ? "NEEDS_ATTENTION" as const
    : "TEMPORARILY_UNAVAILABLE" as const;
}

function providerCategoryJson(
  hint: SyncCommitInput["addedTransactions"][number]["categoryHint"],
): Record<string, string> | undefined {
  if (!hint) return undefined;
  return Object.fromEntries(
    Object.entries(hint).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export class PrismaSyncStore implements SyncStore {
  async loadConnection(userId: string, connectionId: string): Promise<SyncConnection> {
    const connection = await prisma.financialConnection.findFirst({
      where: {
        id: connectionId,
        userId,
        status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        institutionName: true,
        accessTokenEncrypted: true,
        tokenKeyVersion: true,
        tokenEncryptionScheme: true,
        syncCursor: true,
      },
    });
    if (!connection?.accessTokenEncrypted) throw new NotFoundError("Connection not found");
    return {
      id: connection.id,
      userId: connection.userId,
      provider: connection.provider,
      institutionName: connection.institutionName,
      accessToken: await decryptProviderAccessToken({
        userId,
        connectionId: connection.id,
        ciphertext: connection.accessTokenEncrypted,
        keyVersion: connection.tokenKeyVersion,
        encryptionScheme: connection.tokenEncryptionScheme,
      }),
      cursor: connection.syncCursor ?? undefined,
    };
  }

  async loadPreviousTransactions(userId: string, connectionId: string) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        financialConnectionId: connectionId,
        isRemoved: false,
        date: { gte: addDays(new Date(), -180) },
      },
      select: {
        externalId: true,
        date: true,
        merchant: true,
        normalizedMerchant: true,
        amount: true,
        transactionType: true,
        category: { select: { name: true } },
        account: {
          select: { providerAccount: { select: { providerAccountId: true } } },
        },
      },
    });
    return transactions.flatMap((transaction) => {
      const accountExternalId = transaction.account.providerAccount?.providerAccountId;
      if (!transaction.externalId || !accountExternalId) return [];
      return [{
        externalId: transaction.externalId,
        accountExternalId,
        date: transaction.date,
        merchant: transaction.merchant,
        normalizedMerchant:
          transaction.normalizedMerchant ?? normalizeMerchant(transaction.merchant),
        amountCents: toCents(transaction.amount),
        category: (transaction.category?.name ?? "Other") as CategoryName,
        transactionType: transaction.transactionType,
      }];
    });
  }

  async beginSync(connection: SyncConnection, trigger: SyncTrigger): Promise<string> {
    try {
      return await prisma.$transaction(async (database) => {
      const now = new Date();
      await database.syncRun.updateMany({
        where: {
          financialConnectionId: connection.id,
          userId: connection.userId,
          status: "RUNNING",
          startedAt: { lt: new Date(now.getTime() - 3 * 60 * 1_000) },
        },
        data: {
          status: "FAILED",
          finishedAt: now,
          durationMs: 3 * 60 * 1_000,
          errorCategory: "STALE_RUN",
        },
      });
      const owned = await database.financialConnection.updateMany({
        where: {
          id: connection.id,
          userId: connection.userId,
          status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
        },
        data: {
          status: connection.cursor ? "SYNCING" : "INITIAL_SYNC",
          lastAttemptedSyncAt: new Date(),
          errorCode: null,
          errorMessageSafe: null,
        },
      });
      if (owned.count !== 1) throw new NotFoundError("Connection not found");
      const providerAccounts = await database.providerAccount.findMany({
        where: { userId: connection.userId, financialConnectionId: connection.id },
        select: { accountId: true },
      });
      if (providerAccounts.length > 0) {
        await database.account.updateMany({
          where: {
            userId: connection.userId,
            id: { in: providerAccounts.map((item) => item.accountId) },
          },
          data: { connectionStatus: "SYNCING" },
        });
      }
      const run = await database.syncRun.create({
        data: {
          userId: connection.userId,
          financialConnectionId: connection.id,
          trigger,
        },
        select: { id: true },
      });
      return run.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new FinancialSyncError({
          category: "SYNC_CONFLICT",
          safeCode: "SYNC_ALREADY_RUNNING",
          safeMessage: "This connection is already synchronizing.",
          retriable: true,
        });
      }
      throw error;
    }
  }

  async commitSync(input: SyncCommitInput): Promise<SyncCommitResult> {
    return prisma.$transaction(async (database) => {
      const active = await database.financialConnection.updateMany({
        where: {
          id: input.connection.id,
          userId: input.connection.userId,
          status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
          syncCursor: input.connection.cursor ?? null,
        },
        data: { lastAttemptedSyncAt: input.syncedAt },
      });
      const running = await database.syncRun.count({
        where: {
          id: input.runId,
          userId: input.connection.userId,
          financialConnectionId: input.connection.id,
          status: "RUNNING",
        },
      });
      if (active.count !== 1 || running !== 1) {
        throw new FinancialSyncError({
          category: "SYNC_CONFLICT",
          safeCode: "STALE_SYNC_COMMIT",
          safeMessage: "A newer connection state superseded this synchronization.",
          retriable: false,
        });
      }
      const categoryRows = await database.category.findMany({
        where: { userId: input.connection.userId },
        select: { id: true, name: true },
      });
      const categoryIds = new Map(categoryRows.map((category) => [category.name, category.id]));
      const fallbackCategoryId = categoryIds.get("Other");
      if (!fallbackCategoryId) throw new Error("User categories are not initialized");

      const previousProviderAccounts = await database.providerAccount.findMany({
        where: {
          userId: input.connection.userId,
          financialConnectionId: input.connection.id,
        },
        select: { accountId: true, providerAccountId: true },
      });
      const accountIds = new Map<string, string>();
      for (const account of input.accounts) {
        const existing = await database.account.findUnique({
          where: {
            userId_providerAccountId: {
              userId: input.connection.userId,
              providerAccountId: account.externalId,
            },
          },
          select: { id: true, balance: true },
        });
        const storedAccount = existing
          ? await database.account.update({
              where: { id: existing.id },
              data: {
                name: account.name,
                institution: account.institutionName,
                type: account.type,
                balance:
                  account.balanceCents === null
                    ? existing.balance
                    : account.balanceCents / 100,
                balanceStatus:
                  account.balanceCents === null ? "UNAVAILABLE" : "AVAILABLE",
                availableBalance:
                  account.availableBalanceCents === undefined
                    ? null
                    : account.availableBalanceCents / 100,
                currency: account.currency.slice(0, 3).toUpperCase(),
                isLiability: account.isLiability,
                source: "CONNECTED_PROVIDER",
                connectionStatus: "CONNECTED",
                lastUpdatedAt: account.balanceAsOf,
              },
              select: { id: true },
            })
          : await database.account.create({
              data: {
                userId: input.connection.userId,
                name: account.name,
                institution: account.institutionName,
                type: account.type,
                balance: (account.balanceCents ?? 0) / 100,
                balanceStatus:
                  account.balanceCents === null ? "UNAVAILABLE" : "AVAILABLE",
                availableBalance:
                  account.availableBalanceCents === undefined
                    ? null
                    : account.availableBalanceCents / 100,
                currency: account.currency.slice(0, 3).toUpperCase(),
                isLiability: account.isLiability,
                providerAccountId: account.externalId,
                source: "CONNECTED_PROVIDER",
                connectionStatus: "CONNECTED",
                lastUpdatedAt: account.balanceAsOf,
              },
              select: { id: true },
            });
        accountIds.set(account.externalId, storedAccount.id);
        await database.providerAccount.upsert({
          where: {
            financialConnectionId_providerAccountId: {
              financialConnectionId: input.connection.id,
              providerAccountId: account.externalId,
            },
          },
          update: {
            officialName: account.officialName,
            subtype: account.subtype,
            maskLast4: account.maskLast4,
            accountId: storedAccount.id,
          },
          create: {
            userId: input.connection.userId,
            financialConnectionId: input.connection.id,
            accountId: storedAccount.id,
            providerAccountId: account.externalId,
            officialName: account.officialName,
            subtype: account.subtype,
            maskLast4: account.maskLast4,
          },
        });
        if (account.type === "BROKERAGE" || account.type === "RETIREMENT") {
          await database.investmentAccount.upsert({
            where: { accountId: storedAccount.id },
            update: { providerAccountId: account.externalId },
            create: {
              userId: input.connection.userId,
              accountId: storedAccount.id,
              providerAccountId: account.externalId,
            },
          });
        }
      }
      const activeExternalIds = new Set(input.accounts.map((account) => account.externalId));
      const missingAccountIds = previousProviderAccounts
        .filter((account) => !activeExternalIds.has(account.providerAccountId))
        .map((account) => account.accountId);
      if (missingAccountIds.length > 0) {
        await database.account.updateMany({
          where: { userId: input.connection.userId, id: { in: missingAccountIds } },
          data: { connectionStatus: "DISCONNECTED", balanceStatus: "STALE" },
        });
      }

      const incoming = [...input.addedTransactions, ...input.modifiedTransactions];
      const lookupExternalIds = new Set(
        incoming.flatMap((transaction) => [
          transaction.externalId,
          transaction.pendingExternalId,
        ]).filter((value): value is string => Boolean(value)),
      );
      const existingRows = lookupExternalIds.size === 0
        ? []
        : await database.transaction.findMany({
            where: {
              userId: input.connection.userId,
              financialConnectionId: input.connection.id,
              externalId: { in: [...lookupExternalIds] },
            },
            select: {
              id: true,
              externalId: true,
              categoryOverride: true,
              typeOverride: true,
            },
          });
      const existingByExternalId = new Map(
        existingRows.flatMap((row) => row.externalId ? [[row.externalId, row] as const] : []),
      );
      const storedTransactionIds = new Map<string, string>();
      let transactionsAdded = 0;
      let transactionsModified = 0;

      for (const transaction of incoming) {
        const accountId = accountIds.get(transaction.accountExternalId);
        if (!accountId) throw new Error("Provider transaction references an unknown account");
        const categoryId = categoryIds.get(transaction.category) ?? fallbackCategoryId;
        const linkedAccountId = transaction.linkedAccountExternalId
          ? accountIds.get(transaction.linkedAccountExternalId)
          : undefined;
        const existing =
          existingByExternalId.get(transaction.externalId) ??
          (transaction.pendingExternalId
            ? existingByExternalId.get(transaction.pendingExternalId)
            : undefined);
        const providerData = {
          accountId,
          linkedAccountId,
          financialConnectionId: input.connection.id,
          externalId: transaction.externalId,
          date: transaction.date,
          authorizedDate: transaction.authorizedDate,
          merchant: transaction.merchant,
          rawMerchant: transaction.rawName,
          normalizedMerchant: transaction.normalizedMerchant,
          description: transaction.description,
          rawDescription: transaction.originalDescription ?? transaction.rawName,
          amount: transaction.amountCents / 100,
          subcategory: transaction.subcategory,
          isPending: transaction.isPending,
          source: "CONNECTED_PROVIDER" as const,
          transferPairId: transaction.transferPairId,
          pendingExternalId: transaction.pendingExternalId,
          providerCategory: providerCategoryJson(transaction.categoryHint),
          providerSyncedAt: input.syncedAt,
          isRemoved: false,
          removedAt: null,
          reconciliationConfidence: transaction.reconciliationConfidence,
          reconciliationReason: transaction.reconciliationReason,
        };
        if (existing) {
          await database.transaction.update({
            where: { id: existing.id },
            data: {
              ...providerData,
              ...(!existing.categoryOverride ? { categoryId } : {}),
              ...(!existing.typeOverride
                ? {
                    transactionType: transaction.transactionType,
                    incomeType: transaction.incomeType,
                  }
                : {}),
            },
          });
          storedTransactionIds.set(transaction.externalId, existing.id);
          existingByExternalId.set(transaction.externalId, {
            ...existing,
            externalId: transaction.externalId,
          });
          transactionsModified += 1;
        } else {
          const created = await database.transaction.create({
            data: {
              userId: input.connection.userId,
              ...providerData,
              categoryId,
              transactionType: transaction.transactionType,
              incomeType: transaction.incomeType,
            },
            select: { id: true },
          });
          storedTransactionIds.set(transaction.externalId, created.id);
          transactionsAdded += 1;
        }
      }

      const refundExternalIds = incoming
        .map((transaction) => transaction.refundForExternalId)
        .filter((value): value is string => Boolean(value));
      if (refundExternalIds.length > 0) {
        const refundTargets = await database.transaction.findMany({
          where: {
            userId: input.connection.userId,
            financialConnectionId: input.connection.id,
            externalId: { in: refundExternalIds },
          },
          select: { id: true, externalId: true },
        });
        const refundTargetsByExternalId = new Map(
          refundTargets.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []),
        );
        for (const transaction of incoming) {
          const transactionId = storedTransactionIds.get(transaction.externalId);
          const refundForTransactionId = transaction.refundForExternalId
            ? refundTargetsByExternalId.get(transaction.refundForExternalId)
            : undefined;
          if (transactionId && refundForTransactionId) {
            await database.transaction.update({
              where: { id: transactionId },
              data: { refundForTransactionId },
            });
          }
        }
      }

      const incomingIds = new Set(incoming.map((transaction) => transaction.externalId));
      const removableIds = input.removedExternalTransactionIds.filter(
        (externalId) => !incomingIds.has(externalId),
      );
      const removed = removableIds.length === 0
        ? { count: 0 }
        : await database.transaction.updateMany({
            where: {
              userId: input.connection.userId,
              financialConnectionId: input.connection.id,
              externalId: { in: removableIds },
            },
            data: { isRemoved: true, removedAt: input.syncedAt },
          });

      await this.refreshDerivedData(
        database,
        input.connection.userId,
        input.syncedAt,
      );
      await this.saveNetWorthSnapshot(database, input.connection.userId, input.syncedAt);
      await database.financialConnection.update({
        where: { id: input.connection.id },
        data: {
          syncCursor: input.cursor,
          status: "CONNECTED",
          lastSuccessfulSyncAt: input.syncedAt,
          lastAttemptedSyncAt: input.syncedAt,
          errorCode: null,
          errorMessageSafe: null,
        },
      });
      await database.syncRun.update({
        where: { id: input.runId },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          durationMs: input.durationMs,
          accountsChanged: input.accounts.length,
          transactionsAdded,
          transactionsModified,
          transactionsRemoved: removed.count,
          providerCalls: input.providerCalls,
        },
      });
      await database.usageMetric.upsert({
        where: {
          userId_day_category_provider_operation: {
            userId: input.connection.userId,
            day: utcDay(input.syncedAt),
            category: "FINANCIAL_DATA",
            provider: input.connection.provider,
            operation: "SYNC",
          },
        },
        update: {
          requestCount: { increment: 1 },
          units: { increment: input.providerCalls },
        },
        create: {
          userId: input.connection.userId,
          day: utcDay(input.syncedAt),
          category: "FINANCIAL_DATA",
          provider: input.connection.provider,
          operation: "SYNC",
          requestCount: 1,
          units: input.providerCalls,
        },
      });
      await database.auditEvent.create({
        data: {
          userId: input.connection.userId,
          action: "FINANCIAL_SYNC_COMPLETED",
          entityType: "FinancialConnection",
          entityId: input.connection.id,
          metadata: {
            trigger: input.trigger,
            accountsChanged: input.accounts.length,
            transactionsAdded,
            transactionsModified,
            transactionsRemoved: removed.count,
          },
        },
      });
      return {
        runId: input.runId,
        accountsChanged: input.accounts.length,
        transactionsAdded,
        transactionsModified,
        transactionsRemoved: removed.count,
      };
    }, { maxWait: 5_000, timeout: 30_000 });
  }

  async failSync(input: {
    runId: string;
    connection: SyncConnection;
    durationMs: number;
    providerCalls: number;
    failure: SyncFailure;
  }): Promise<void> {
    const status = connectionStateForFailure(input.failure);
    await prisma.$transaction(async (database) => {
      await database.syncRun.updateMany({
        where: {
          id: input.runId,
          userId: input.connection.userId,
          financialConnectionId: input.connection.id,
        },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          durationMs: input.durationMs,
          providerCalls: input.providerCalls,
          errorCategory: input.failure.category,
        },
      });
      await database.financialConnection.updateMany({
        where: {
          id: input.connection.id,
          userId: input.connection.userId,
          status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
          syncCursor: input.connection.cursor ?? null,
        },
        data: {
          status,
          errorCode: input.failure.safeCode,
          errorMessageSafe: input.failure.safeMessage,
        },
      });
      const providerAccounts = await database.providerAccount.findMany({
        where: {
          userId: input.connection.userId,
          financialConnectionId: input.connection.id,
        },
        select: { accountId: true },
      });
      await database.account.updateMany({
        where: {
          userId: input.connection.userId,
          id: { in: providerAccounts.map((item) => item.accountId) },
        },
        data: {
          connectionStatus: status,
          balanceStatus: "STALE",
        },
      });
    });
  }

  private async refreshDerivedData(
    database: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    asOf: Date,
  ) {
    const rows = await database.transaction.findMany({
      where: {
        userId,
        isRemoved: false,
        date: {
          gte: addDays(asOf, -550),
          lt: addDays(utcDay(asOf), 1),
        },
      },
      include: { category: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
    const transactionRecords: TransactionRecord[] = rows.map((transaction) => ({
      id: transaction.id,
      userId: transaction.userId,
      accountId: transaction.accountId,
      linkedAccountId: transaction.linkedAccountId ?? undefined,
      refundForTransactionId: transaction.refundForTransactionId ?? undefined,
      date: transaction.date,
      authorizedDate: transaction.authorizedDate ?? undefined,
      merchant: transaction.merchant,
      rawMerchant: transaction.rawMerchant ?? undefined,
      normalizedMerchant: transaction.normalizedMerchant ?? normalizeMerchant(transaction.merchant),
      description: transaction.description,
      rawDescription: transaction.rawDescription ?? undefined,
      amountCents: toCents(transaction.amount),
      transactionType: transaction.transactionType,
      category: (transaction.category?.name ?? "Other") as CategoryName,
      subcategory: transaction.subcategory ?? undefined,
      incomeType: transaction.incomeType ?? undefined,
      isPending: transaction.isPending,
      isRecurring: transaction.isRecurring,
      notes: transaction.notes ?? undefined,
      source: transaction.source,
      transferPairId: transaction.transferPairId ?? undefined,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    }));
    const detected = detectRecurringTransactions(transactionRecords);
    const categoryRows = await database.category.findMany({
      where: { userId }, select: { id: true, name: true },
    });
    const categoryIds = new Map(categoryRows.map((category) => [category.name, category.id]));
    const existingRecurring = await database.recurringTransaction.findMany({
      where: { userId },
      select: { id: true, accountId: true, normalizedMerchant: true },
    });
    const existingRecurringByKey = new Map(
      existingRecurring.map((item) => [`${item.accountId}:${item.normalizedMerchant}`, item]),
    );
    for (const item of detected) {
      const key = `${item.accountId}:${normalizeMerchant(item.merchant)}`;
      const existing = existingRecurringByKey.get(key);
      const data = {
        categoryId: categoryIds.get(item.category),
        merchant: item.merchant,
        normalizedMerchant: normalizeMerchant(item.merchant),
        amount: item.amountCents / 100,
        averageAmount: item.averageAmountCents / 100,
        previousAmount:
          item.previousAmountCents === undefined
            ? null
            : item.previousAmountCents / 100,
        frequency: item.frequency,
        nextEstimatedDate: item.nextEstimatedDate,
        lastChargeDate: item.lastChargeDate,
        annualizedAmount: item.annualizedCents / 100,
        confidence: item.confidence,
      };
      const recurring = existing
        ? await database.recurringTransaction.update({
            where: { id: existing.id }, data, select: { id: true },
          })
        : await database.recurringTransaction.create({
            data: {
              userId,
              accountId: item.accountId,
              ...data,
              status: item.status,
              isSubscription: item.isSubscription,
            },
            select: { id: true },
          });
      await database.transaction.updateMany({
        where: {
          userId,
          accountId: item.accountId,
          normalizedMerchant: normalizeMerchant(item.merchant),
          transactionType: "EXPENSE",
        },
        data: { isRecurring: true, recurringTransactionId: recurring.id },
      });
    }

    const incomeGroups = new Map<string, TransactionRecord[]>();
    for (const transaction of transactionRecords) {
      if (transaction.isPending || transaction.transactionType !== "INCOME") continue;
      const payer = transaction.normalizedMerchant || normalizeMerchant(transaction.merchant);
      incomeGroups.set(payer, [...(incomeGroups.get(payer) ?? []), transaction]);
    }
    const streams = await database.incomeStream.findMany({
      where: { userId },
      select: { id: true, normalizedPayer: true, payer: true },
    });
    const streamByPayer = new Map(
      streams.map((stream) => [stream.normalizedPayer ?? normalizeMerchant(stream.payer), stream]),
    );
    for (const [normalizedPayer, entries] of incomeGroups) {
      const sorted = [...entries].sort((left, right) => left.date.getTime() - right.date.getTime());
      const last = sorted.at(-1)!;
      const averageAmount = entries.reduce((sum, item) => sum + item.amountCents, 0) / entries.length / 100;
      const frequency = incomeFrequency(sorted.map((item) => item.date));
      const existing = streamByPayer.get(normalizedPayer);
      if (existing) {
        await database.incomeStream.update({
          where: { id: existing.id },
          data: {
            accountId: last.accountId,
            payer: last.merchant,
            normalizedPayer,
            averageAmount,
            isRecurring: entries.length >= 2 && frequency !== "VARIABLE",
            frequency,
            lastReceivedAt: last.date,
            nextExpectedAt: nextIncomeDate(sorted.map((item) => item.date)),
          },
        });
      } else {
        await database.incomeStream.create({
          data: {
            userId,
            accountId: last.accountId,
            name: last.merchant,
            payer: last.merchant,
            normalizedPayer,
            type: last.incomeType ?? "OTHER",
            averageAmount,
            isRecurring: entries.length >= 2 && frequency !== "VARIABLE",
            frequency,
            lastReceivedAt: last.date,
            nextExpectedAt: nextIncomeDate(sorted.map((item) => item.date)),
          },
        });
      }
    }
  }

  private async saveNetWorthSnapshot(
    database: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string,
    asOf: Date,
  ) {
    const accounts = await database.account.findMany({
      where: { userId, balanceStatus: { not: "UNAVAILABLE" } },
      select: { balance: true, isLiability: true, type: true },
    });
    let cash = 0;
    let investments = 0;
    let debt = 0;
    let otherAssets = 0;
    for (const account of accounts) {
      const balance = Number(account.balance);
      if (account.isLiability || balance < 0) debt += Math.abs(balance);
      else if (["CHECKING", "SAVINGS", "CASH"].includes(account.type)) cash += balance;
      else if (["BROKERAGE", "RETIREMENT"].includes(account.type)) investments += balance;
      else otherAssets += balance;
    }
    const assets = cash + investments + otherAssets;
    await database.netWorthSnapshot.upsert({
      where: { userId_date: { userId, date: utcDay(asOf) } },
      update: {
        cash,
        investments,
        debt,
        otherAssets,
        otherLiabilities: 0,
        assets,
        liabilities: debt,
        netWorth: assets - debt,
      },
      create: {
        userId,
        date: utcDay(asOf),
        cash,
        investments,
        debt,
        otherAssets,
        otherLiabilities: 0,
        assets,
        liabilities: debt,
        netWorth: assets - debt,
      },
    });
  }
}

export const prismaSyncStore = new PrismaSyncStore();
