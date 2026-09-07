import { NextResponse } from "next/server";
import { getCurrentSession } from "@/auth/dal";
import {
  PasskeyVerificationError,
  ReauthenticationRequiredError,
} from "@/data/errors";
import { env } from "@/lib/env";
import {
  rateLimitDistributed,
  readJsonBody,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { passkeyRegistrationOptionsSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getCurrentSession();
  if (!session?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (env.demoMode) {
    return NextResponse.json({ error: "Passkeys are unavailable in demo mode." }, { status: 403 });
  }
  const limit = await rateLimitDistributed(
    "passkey-registration",
    session.user.id,
    6,
    60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many passkey changes. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const parsed = passkeyRegistrationOptionsSchema.safeParse(
      await readJsonBody(request, 2_048),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Password confirmation is required." }, { status: 400 });
    }
    const { beginPasskeyRegistration } = await import("@/auth/passkey-service");
    const ceremony = await beginPasskeyRegistration(
      { ...session, id: session.id },
      parsed.data.password,
    );
    return NextResponse.json(
      ceremony,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PasskeyVerificationError) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }
    if (error instanceof ReauthenticationRequiredError) {
      return NextResponse.json(
        { error: "Sign out and complete passkey verification again before changing passkeys.", code: "RECENT_MFA_REQUIRED" },
        { status: 409 },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
