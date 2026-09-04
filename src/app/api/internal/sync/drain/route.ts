import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = createHash("sha256").update(env.CRON_SECRET).digest();
  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const startedAt = Date.now();
  const [{ processSyncQueue, getSyncQueueHealth }, { pruneExpiredRateLimits }] =
    await Promise.all([
      import("@/sync/sync-queue"),
      import("@/lib/security"),
    ]);
  const processed = await processSyncQueue({ limit: 5, maxDurationMs: 20_000 });
  const [queue, expiredRateLimitsRemoved] = await Promise.all([
    getSyncQueueHealth(),
    pruneExpiredRateLimits(),
  ]);
  return NextResponse.json(
    {
      processed,
      durationMs: Date.now() - startedAt,
      expiredRateLimitsRemoved,
      queue,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [{ getSyncQueueHealth }, { getProviderTokenRotationHealth }] =
    await Promise.all([
      import("@/sync/sync-queue"),
      import("@/sync/provider-token-service"),
    ]);
  const [queue, providerTokenEncryption] = await Promise.all([
    getSyncQueueHealth(),
    getProviderTokenRotationHealth(),
  ]);
  return NextResponse.json(
    { status: "ok", queue, providerTokenEncryption },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const runtime = "nodejs";
export const maxDuration = 30;
