import "server-only";
import { addMinutes, addSeconds } from "date-fns";
import { NotFoundError } from "@/data/errors";
import { prisma } from "@/lib/db";
import { getFinancialDataProvider } from "@/providers/registry";
import { prismaSyncStore } from "@/sync/prisma-sync-store";
import { syncInvestmentConnection } from "@/sync/investment-sync";
import {
  FinancialSyncEngine,
  FinancialSyncError,
  type SyncTrigger,
} from "@/sync/sync-engine";

function windowToken(trigger: SyncTrigger, date = new Date()): string {
  if (trigger === "INITIAL" || trigger === "MANUAL" || trigger === "RECONNECT") {
    return String(Math.floor(date.getTime() / (5 * 60 * 1_000)));
  }
  if (trigger === "SCHEDULED") return date.toISOString().slice(0, 13);
  return "once";
}

export async function enqueueSyncJob(input: {
  userId: string;
  connectionId: string;
  trigger: SyncTrigger;
  dedupeToken?: string;
  includeInvestments?: boolean;
}) {
  const connection = await prisma.financialConnection.findFirst({
    where: {
      id: input.connectionId,
      userId: input.userId,
      status: { notIn: ["DISCONNECTING", "DISCONNECTED"] },
    },
    select: { id: true },
  });
  if (!connection) throw new NotFoundError("Connection not found");
  const dedupeKey = [
    input.trigger.toLowerCase(),
    input.connectionId,
    input.dedupeToken ?? windowToken(input.trigger),
  ].join(":");
  const existing = await prisma.syncJob.findUnique({
    where: { dedupeKey },
    select: { id: true, status: true },
  });
  if (existing) return existing;
  try {
    return await prisma.syncJob.create({
      data: {
        userId: input.userId,
        financialConnectionId: input.connectionId,
        trigger: input.trigger,
        dedupeKey,
        includeInvestments: input.includeInvestments ?? false,
      },
      select: { id: true, status: true },
    });
  } catch {
    const concurrent = await prisma.syncJob.findUnique({
      where: { dedupeKey }, select: { id: true, status: true },
    });
    if (!concurrent) throw new Error("Could not enqueue synchronization");
    return concurrent;
  }
}

async function claimJob(jobId?: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const candidate = await prisma.syncJob.findFirst({
      where: {
        ...(jobId ? { id: jobId } : {}),
        availableAt: { lte: now },
        OR: [
          { status: "QUEUED" },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        financialConnectionId: true,
        trigger: true,
        attempts: true,
        includeInvestments: true,
      },
    });
    if (!candidate) return undefined;
    const claimed = await prisma.syncJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "QUEUED" },
          { status: "PROCESSING", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        leaseExpiresAt: addMinutes(now, 2),
      },
    });
    if (claimed.count === 1) return { ...candidate, attempts: candidate.attempts + 1 };
  }
  return undefined;
}

export async function processNextSyncJob(jobId?: string): Promise<boolean> {
  const job = await claimJob(jobId);
  if (!job) return false;
  const engine = new FinancialSyncEngine(prismaSyncStore, getFinancialDataProvider);
  try {
    const syncResult = await engine.sync({
      userId: job.userId,
      connectionId: job.financialConnectionId,
      trigger: job.trigger,
    });
    const investmentResult = job.includeInvestments
      ? await syncInvestmentConnection({
          userId: job.userId,
          connectionId: job.financialConnectionId,
          runId: syncResult.runId,
        })
      : { available: true };
    await prisma.syncJob.updateMany({
      where: { id: job.id, userId: job.userId },
      data: {
        status: "SUCCEEDED",
        leaseExpiresAt: null,
        lastErrorCategory: investmentResult.errorCategory ?? null,
      },
    });
  } catch (error) {
    const failure = error instanceof FinancialSyncError
      ? error.failure
      : { category: "UNKNOWN", retriable: true } as const;
    const retry = failure.retriable && job.attempts < 3;
    await prisma.syncJob.updateMany({
      where: { id: job.id, userId: job.userId },
      data: retry
        ? {
            status: "QUEUED",
            availableAt: addSeconds(new Date(), 30 * 2 ** (job.attempts - 1)),
            leaseExpiresAt: null,
            lastErrorCategory: failure.category,
          }
        : {
            status: "FAILED",
            leaseExpiresAt: null,
            lastErrorCategory: failure.category,
          },
    });
  }
  return true;
}

export interface SyncQueueProcessOptions {
  limit?: number;
  maxDurationMs?: number;
}

export async function processSyncQueue(
  options: number | SyncQueueProcessOptions = {},
): Promise<number> {
  const limit = typeof options === "number" ? options : options.limit ?? 3;
  const maxDurationMs = typeof options === "number"
    ? 20_000
    : options.maxDurationMs ?? 20_000;
  const startedAt = Date.now();
  let processed = 0;
  while (
    processed < Math.max(0, Math.min(limit, 20)) &&
    Date.now() - startedAt < Math.max(1_000, Math.min(maxDurationMs, 50_000)) &&
    await processNextSyncJob()
  ) {
    processed += 1;
  }
  return processed;
}

export async function getSyncQueueHealth(now = new Date()) {
  const [queued, processing, failed, staleLeases, oldestQueued] = await Promise.all([
    prisma.syncJob.count({ where: { status: "QUEUED" } }),
    prisma.syncJob.count({ where: { status: "PROCESSING" } }),
    prisma.syncJob.count({ where: { status: "FAILED" } }),
    prisma.syncJob.count({
      where: { status: "PROCESSING", leaseExpiresAt: { lt: now } },
    }),
    prisma.syncJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    queued,
    processing,
    failed,
    staleLeases,
    oldestQueuedAt: oldestQueued?.createdAt ?? null,
  };
}
