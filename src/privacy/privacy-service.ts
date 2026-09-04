import "server-only";
import { ExportCapacityError, NotFoundError } from "@/data/errors";
import { prisma } from "@/lib/db";

export async function createUserDataExport(userId: string) {
  const [transactionCount, messageCount, auditCount] = await Promise.all([
    prisma.transaction.count({ where: { userId } }),
    prisma.aIMessage.count({ where: { userId } }),
    prisma.auditEvent.count({ where: { userId } }),
  ]);
  if (
    transactionCount > 25_000 ||
    messageCount > 10_000 ||
    auditCount > 50_000
  ) {
    throw new ExportCapacityError();
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      isDemo: true,
      createdAt: true,
      updatedAt: true,
      accounts: {
        select: {
          id: true,
          name: true,
          institution: true,
          type: true,
          balance: true,
          balanceStatus: true,
          availableBalance: true,
          currency: true,
          isLiability: true,
          source: true,
          connectionStatus: true,
          lastUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      categories: {
        select: {
          id: true,
          name: true,
          kind: true,
          color: true,
          icon: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      transactions: {
        select: {
          id: true,
          accountId: true,
          linkedAccountId: true,
          recurringTransactionId: true,
          refundForTransactionId: true,
          categoryId: true,
          date: true,
          authorizedDate: true,
          merchant: true,
          rawMerchant: true,
          normalizedMerchant: true,
          description: true,
          rawDescription: true,
          amount: true,
          transactionType: true,
          subcategory: true,
          incomeType: true,
          isPending: true,
          isRecurring: true,
          notes: true,
          source: true,
          transferPairId: true,
          providerCategory: true,
          providerSyncedAt: true,
          isRemoved: true,
          removedAt: true,
          reconciliationConfidence: true,
          reconciliationReason: true,
          categoryOverride: true,
          typeOverride: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ date: "desc" }, { id: "asc" }],
      },
      recurringTransactions: {
        select: {
          id: true,
          accountId: true,
          categoryId: true,
          merchant: true,
          normalizedMerchant: true,
          amount: true,
          averageAmount: true,
          previousAmount: true,
          frequency: true,
          nextEstimatedDate: true,
          lastChargeDate: true,
          annualizedAmount: true,
          status: true,
          confidence: true,
          isSubscription: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      incomeStreams: {
        select: {
          id: true,
          accountId: true,
          name: true,
          payer: true,
          normalizedPayer: true,
          type: true,
          averageAmount: true,
          isRecurring: true,
          frequency: true,
          lastReceivedAt: true,
          nextExpectedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      investmentAccounts: {
        select: {
          id: true,
          accountId: true,
          createdAt: true,
          updatedAt: true,
          holdings: {
            select: {
              id: true,
              ticker: true,
              name: true,
              securityType: true,
              quantity: true,
              costBasis: true,
              price: true,
              currentValue: true,
              priceAsOf: true,
              priceSource: true,
              priceIsDelayed: true,
              currency: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          investmentTransactions: {
            select: {
              id: true,
              date: true,
              type: true,
              ticker: true,
              quantity: true,
              price: true,
              amount: true,
              fees: true,
              costBasis: true,
              realizedGain: true,
              notes: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ date: "desc" }, { id: "asc" }],
          },
        },
      },
      netWorthSnapshots: {
        select: {
          id: true,
          date: true,
          cash: true,
          investments: true,
          debt: true,
          otherAssets: true,
          otherLiabilities: true,
          assets: true,
          liabilities: true,
          netWorth: true,
          createdAt: true,
        },
        orderBy: { date: "asc" },
      },
      goals: {
        select: {
          id: true,
          linkedAccountId: true,
          type: true,
          name: true,
          targetAmount: true,
          currentAmount: true,
          targetDate: true,
          monthlyTarget: true,
          notes: true,
          color: true,
          createdAt: true,
          updatedAt: true,
          contributions: {
            select: {
              id: true,
              date: true,
              amount: true,
              source: true,
              notes: true,
              createdAt: true,
            },
            orderBy: [{ date: "desc" }, { id: "asc" }],
          },
        },
      },
      insights: {
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          body: true,
          data: true,
          periodStart: true,
          periodEnd: true,
          dismissedAt: true,
          createdAt: true,
        },
      },
      aiConversations: {
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            select: {
              id: true,
              role: true,
              content: true,
              toolName: true,
              toolInput: true,
              toolResult: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
      financialConnections: {
        select: {
          id: true,
          provider: true,
          institutionName: true,
          status: true,
          consentExpiresAt: true,
          lastSuccessfulSyncAt: true,
          lastInvestmentSyncAt: true,
          lastAttemptedSyncAt: true,
          errorMessageSafe: true,
          disconnectedAt: true,
          createdAt: true,
          updatedAt: true,
          providerAccounts: {
            select: {
              id: true,
              accountId: true,
              officialName: true,
              subtype: true,
              maskLast4: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          syncRuns: {
            select: {
              id: true,
              trigger: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              durationMs: true,
              accountsChanged: true,
              transactionsAdded: true,
              transactionsModified: true,
              transactionsRemoved: true,
              holdingsChanged: true,
              investmentActivityChanged: true,
              providerCalls: true,
              errorCategory: true,
            },
            orderBy: { startedAt: "desc" },
          },
        },
      },
      usageMetrics: {
        select: {
          day: true,
          category: true,
          provider: true,
          operation: true,
          requestCount: true,
          inputTokens: true,
          outputTokens: true,
          units: true,
        },
        orderBy: { day: "desc" },
      },
      auditEvents: {
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          requestId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!user) throw new NotFoundError("User not found");
  await prisma.auditEvent.create({
    data: {
      userId,
      action: "PRIVACY_EXPORT_CREATED",
      entityType: "User",
      entityId: userId,
      metadata: { formatVersion: 1 },
    },
  });
  return {
    format: "moneyos-user-data",
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    user,
  };
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  return prisma.$transaction(async (database) => {
    const deleted = await database.session.deleteMany({ where: { userId } });
    await database.auditEvent.create({
      data: {
        userId,
        action: "ALL_SESSIONS_REVOKED",
        entityType: "Session",
        metadata: { sessionsRevoked: deleted.count },
      },
    });
    return deleted.count;
  });
}
