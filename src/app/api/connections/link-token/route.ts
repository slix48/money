import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { env } from "@/lib/env";
import { rateLimit, readJsonBody, requireSameOrigin, safeApiError } from "@/lib/security";
import { connectionSessionSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!env.plaidConfigured || env.demoMode) {
    return NextResponse.json(
      { error: "Account connection is not configured for this deployment." },
      { status: 503 },
    );
  }
  const limit = rateLimit("plaid-link-token", user.id, 10, 60 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many connection attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const { createPlaidLinkSession } = await import("@/sync/connection-service");
    const parsed = connectionSessionSchema.safeParse(await readJsonBody(request, 2_048));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid connection request" }, { status: 400 });
    }
    const session = await createPlaidLinkSession(user.id, parsed.data.connectionId);
    return NextResponse.json(
      { linkToken: session.sessionToken, expiresAt: session.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
