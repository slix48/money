import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { clearSessionCookie } from "@/auth/cookies";
import { env } from "@/lib/env";
import {
  rateLimitDistributed,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (env.demoMode) {
    return NextResponse.json(
      { error: "Session management is unavailable for the shared demo." },
      { status: 403 },
    );
  }
  const limit = await rateLimitDistributed(
    "session-revoke-all",
    user.id,
    3,
    60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many session changes. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const { revokeAllUserSessions } = await import("@/privacy/privacy-service");
    const sessionsRevoked = await revokeAllUserSessions(user.id);
    const response = NextResponse.json(
      { ok: true, sessionsRevoked },
      { headers: { "Cache-Control": "no-store" } },
    );
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return safeApiError(error);
  }
}
