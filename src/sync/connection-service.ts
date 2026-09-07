import "server-only";
import { NotFoundError } from "@/data/errors";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getFinancialDataProvider } from "@/providers/registry";
import { enqueueSyncJob } from "@/sync/sync-queue";
import {
  decryptProviderAccessToken,
  encryptProviderAccessToken,
} from "@/sync/provider-token-service";

export interface ConnectionSummary {
  id: string;
  provider: "PLAID" | "MOCK";
  institutionName: string;
  status:
    | "PENDING"
    | "INITIAL_SYNC"
    | "SYNCING"
    | "CONNECTED"
    | "NEEDS_ATTENTION"
    | "TEMPORARILY_UNAVAILABLE"
    | "DISCONNECTING"
    | "DISCONNECTED";
  lastSuccessfulSyncAt?: Date;
  lastAttemptedSyncAt?: Date;
  consentExpiresAt?: Date;
  safeMessage?: string;
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    maskLast4?: string;
    balanceStatus: "AVAILABLE" | "UNAVAILABLE" | "STALE";
    lastUpdatedAt: Date;
  }>;
}

export async function listFinancialConnections(
  userId: string,
): Promise<ConnectionSummary[]> {
  const connections = await prisma.financialConnection.findMany({
    where: { userId },
    include: {
      providerAccounts: {
        include: {
          account: {
            select: {
              id: true,
              name: true,
              type: true,
              balanceStatus: true,
              lastUpdatedAt: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    institutionName: connection.institutionName,
    status: connection.status,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt ?? undefined,
    lastAttemptedSyncAt: connection.lastAttemptedSyncAt ?? undefined,
    consentExpiresAt: connection.consentExpiresAt ?? undefined,
    safeMessage: connection.errorMessageSafe ?? undefined,
    accounts: connection.providerAccounts.map((providerAccount) => ({
      id: providerAccount.account.id,
      name: providerAccount.account.name,
      type: providerAccount.account.type,
      maskLast4: providerAccount.maskLast4 ?? undefined,
      balanceStatus: providerAccount.account.balanceStatus,
      lastUpdatedAt: providerAccount.account.lastUpdatedAt,
    })),
  }));
}

export async function createPlaidLinkSession(
  userId: string,
  connectionId?: string,
) {
  if (!env.plaidConfigured) throw new Error("Plaid is not configured");
  let accessToken: string | undefined;
  if (connectionId) {
    const connection = await prisma.financialConnection.findFirst({
      where: {
        id: connectionId,
        userId,
        provider: "PLAID",
        status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
      },
      select: {
        id: true,
        accessTokenEncrypted: true,
        tokenKeyVersion: true,
        tokenEncryptionScheme: true,
      },
    });
    if (!connection?.accessTokenEncrypted) throw new NotFoundError("Connection not found");
    accessToken = await decryptProviderAccessToken({
      userId,
      connectionId: connection.id,
      ciphertext: connection.accessTokenEncrypted,
      keyVersion: connection.tokenKeyVersion,
      encryptionScheme: connection.tokenEncryptionScheme,
    });
  }
  const provider = await getFinancialDataProvider("PLAID");
  return provider.createConnectionSession({
    userId,
    accessToken,
    redirectUri: env.PLAID_REDIRECT_URI,
  });
}

export async function exchangePlaidPublicToken(
  userId: string,
  publicToken: string,
): Promise<{ connectionId: string; jobId: string }> {
  const provider = await getFinancialDataProvider("PLAID");
  const exchanged = await provider.exchangePublicToken(publicToken);
  const encrypted = encryptProviderAccessToken(exchanged.accessToken);
  const connection = await prisma.$transaction(async (database) => {
    const activeUser = await database.user.findFirst({
      where: { id: userId, deletionRequestedAt: null },
      select: { id: true },
    });
    if (!activeUser) throw new NotFoundError("Connection not found");
    const existing = await database.financialConnection.findUnique({
      where: {
        provider_providerItemId: {
          provider: "PLAID",
          providerItemId: exchanged.providerItemId,
        },
      },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== userId) {
      throw new NotFoundError("Connection not found");
    }
    const stored = existing
      ? await database.financialConnection.update({
          where: { id: existing.id },
          data: {
            providerInstitutionId: exchanged.providerInstitutionId,
            institutionName: exchanged.institutionName,
            status: "INITIAL_SYNC",
            accessTokenEncrypted: encrypted.ciphertext,
            tokenKeyVersion: encrypted.keyVersion,
            tokenEncryptionScheme: encrypted.encryptionScheme,
            consentExpiresAt: exchanged.consentExpiresAt,
            disconnectedAt: null,
            errorCode: null,
            errorMessageSafe: null,
          },
          select: { id: true },
        })
      : await database.financialConnection.create({
          data: {
            userId,
            provider: "PLAID",
            providerItemId: exchanged.providerItemId,
            providerInstitutionId: exchanged.providerInstitutionId,
            institutionName: exchanged.institutionName,
            status: "INITIAL_SYNC",
            accessTokenEncrypted: encrypted.ciphertext,
            tokenKeyVersion: encrypted.keyVersion,
            tokenEncryptionScheme: encrypted.encryptionScheme,
            consentExpiresAt: exchanged.consentExpiresAt,
          },
          select: { id: true },
        });
    await database.auditEvent.create({
      data: {
        userId,
        action: existing ? "FINANCIAL_CONNECTION_REAUTHORIZED" : "FINANCIAL_CONNECTION_CREATED",
        entityType: "FinancialConnection",
        entityId: stored.id,
        metadata: { provider: "PLAID" },
      },
    });
    return { ...stored, reauthorized: Boolean(existing) };
  });
  const job = await enqueueSyncJob({
    userId,
    connectionId: connection.id,
    trigger: connection.reauthorized ? "RECONNECT" : "INITIAL",
    includeInvestments: true,
  });
  return { connectionId: connection.id, jobId: job.id };
}

export async function disconnectFinancialConnection(
  userId: string,
  connectionId: string,
): Promise<void> {
  const connection = await prisma.financialConnection.findFirst({
    where: {
      id: connectionId,
      userId,
      status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
    },
    select: {
      id: true,
      provider: true,
      accessTokenEncrypted: true,
      tokenKeyVersion: true,
      tokenEncryptionScheme: true,
    },
  });
  if (!connection?.accessTokenEncrypted) throw new NotFoundError("Connection not found");
  await prisma.financialConnection.updateMany({
    where: { id: connectionId, userId },
    data: { status: "DISCONNECTING" },
  });
  try {
    const provider = await getFinancialDataProvider(connection.provider);
    await provider.disconnect(
      await decryptProviderAccessToken({
        userId,
        connectionId: connection.id,
        ciphertext: connection.accessTokenEncrypted,
        keyVersion: connection.tokenKeyVersion,
        encryptionScheme: connection.tokenEncryptionScheme,
      }),
    );
  } catch (error) {
    await prisma.financialConnection.updateMany({
      where: { id: connectionId, userId },
      data: {
        status: "TEMPORARILY_UNAVAILABLE",
        errorCode: "PROVIDER_REVOCATION_FAILED",
        errorMessageSafe: "The provider could not confirm disconnection. Try again later.",
      },
    });
    throw error;
  }
  await markConnectionDisconnected(userId, connectionId, "USER_DISCONNECTED");
}

export async function markConnectionDisconnected(
  userId: string,
  connectionId: string,
  reason: "USER_DISCONNECTED" | "PROVIDER_REVOKED",
): Promise<void> {
  await prisma.$transaction(async (database) => {
    const updated = await database.financialConnection.updateMany({
      where: { id: connectionId, userId },
      data: {
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        tokenKeyVersion: null,
        syncCursor: null,
        errorCode: null,
        errorMessageSafe: null,
        disconnectedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new NotFoundError("Connection not found");
    const providerAccounts = await database.providerAccount.findMany({
      where: { userId, financialConnectionId: connectionId },
      select: { accountId: true },
    });
    await database.account.updateMany({
      where: { userId, id: { in: providerAccounts.map((item) => item.accountId) } },
      data: { connectionStatus: "DISCONNECTED", balanceStatus: "STALE" },
    });
    await database.syncJob.updateMany({
      where: {
        userId,
        financialConnectionId: connectionId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: {
        status: "FAILED",
        leaseExpiresAt: null,
        finishedAt: new Date(),
        lastErrorCategory: "DISCONNECTED",
      },
    });
    await database.auditEvent.create({
      data: {
        userId,
        action: "FINANCIAL_CONNECTION_DISCONNECTED",
        entityType: "FinancialConnection",
        entityId: connectionId,
        metadata: { reason, historyPreserved: true },
      },
    });
  });
}
