import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { env } from "@/lib/env";
import { rateLimit, readJsonBody, requireSameOrigin, safeApiError } from "@/lib/security";
import { publicTokenExchangeSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!env.plaidConfigured || env.demoMode) {
    return NextResponse.json({ error: "Account connection is unavailable." }, { status: 503 });
  }
  const limit = rateLimit("plaid-token-exchange", user.id, 6, 60 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many connection attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const [{ exchangePlaidPublicToken }, { processNextSyncJob }] = await Promise.all([
      import("@/sync/connection-service"),
      import("@/sync/sync-queue"),
    ]);
    const parsed = publicTokenExchangeSchema.safeParse(await readJsonBody(request, 4_096));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid provider token" }, { status: 400 });
    }
    const connected = await exchangePlaidPublicToken(user.id, parsed.data.publicToken);
    after(() => processNextSyncJob(connected.jobId));
    return NextResponse.json(
      { connectionId: connected.connectionId, status: "INITIAL_SYNC" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Unable to connect this institution" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
