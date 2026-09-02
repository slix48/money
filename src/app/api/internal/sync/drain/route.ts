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
  const { processSyncQueue } = await import("@/sync/sync-queue");
  const processed = await processSyncQueue(3);
  return NextResponse.json({ processed }, { headers: { "Cache-Control": "no-store" } });
}
