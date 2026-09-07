import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/auth/dal";
import { PasskeyVerificationError } from "@/data/errors";
import { env } from "@/lib/env";
import {
  rateLimitDistributed,
  readJsonBody,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { passkeyRegistrationVerificationSchema } from "@/lib/validation";

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
    "passkey-registration-verify",
    session.user.id,
    8,
    60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many passkey attempts." }, { status: 429 });
  }
  try {
    const parsed = passkeyRegistrationVerificationSchema.safeParse(
      await readJsonBody(request, 64 * 1_024),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid passkey response." }, { status: 400 });
    }
    const { finishPasskeyRegistration } = await import("@/auth/passkey-service");
    const credential = await finishPasskeyRegistration({
      session: { ...session, id: session.id },
      ceremonyToken: parsed.data.ceremonyToken,
      name: parsed.data.name,
      response: parsed.data.response as unknown as RegistrationResponseJSON,
    });
    return NextResponse.json(
      { credential },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PasskeyVerificationError) {
      return NextResponse.json(
        { error: "Passkey verification failed. Start enrollment again." },
        { status: 401 },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
