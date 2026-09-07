import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { createSession } from "@/auth/auth-service";
import { setSessionCookie } from "@/auth/cookies";
import { PasskeyVerificationError } from "@/data/errors";
import { env } from "@/lib/env";
import {
  rateLimitDistributed,
  readJsonBody,
  requestIdentifier,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { passkeyAuthenticationVerificationSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (env.demoMode) {
    return NextResponse.json({ error: "Passkeys are unavailable in demo mode." }, { status: 403 });
  }
  const limit = await rateLimitDistributed(
    "passkey-authentication",
    requestIdentifier(request),
    8,
    15 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const parsed = passkeyAuthenticationVerificationSchema.safeParse(
      await readJsonBody(request, 64 * 1_024),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid passkey response." }, { status: 400 });
    }
    const { finishPasskeyAuthentication } = await import("@/auth/passkey-service");
    const user = await finishPasskeyAuthentication({
      ceremonyToken: parsed.data.ceremonyToken,
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
    });
    const token = await createSession(user.id, { mfaVerified: true });
    const response = NextResponse.json(
      { user },
      { headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof PasskeyVerificationError) {
      return NextResponse.json(
        { error: "Passkey verification failed. Start sign-in again." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
