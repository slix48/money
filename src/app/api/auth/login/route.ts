import { NextResponse } from "next/server";
import { authenticateCredentials, createSession } from "@/auth/auth-service";
import { setSessionCookie } from "@/auth/cookies";
import { env } from "@/lib/env";
import { loginSchema } from "@/lib/validation";
import {
  rateLimitDistributed,
  readJsonBody,
  requestIdentifier,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limit = await rateLimitDistributed("login", requestIdentifier(request), 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = loginSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }
    const user = await authenticateCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    if (!env.demoMode) {
      const { beginPasskeyAuthentication } = await import(
        "@/auth/passkey-service"
      );
      const ceremony = await beginPasskeyAuthentication(user.id);
      if (ceremony) {
        return NextResponse.json(
          {
            mfaRequired: true,
            ceremonyToken: ceremony.ceremonyToken,
            options: ceremony.options,
            expiresAt: ceremony.expiresAt,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    const token = await createSession(user.id);
    const response = NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return safeApiError(error);
  }
}
