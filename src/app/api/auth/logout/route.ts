import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { invalidateSession } from "@/auth/auth-service";
import { clearSessionCookie } from "@/auth/cookies";
import { SESSION_COOKIE_NAME } from "@/auth/tokens";
import { requireSameOrigin, safeApiError } from "@/lib/security";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    await invalidateSession(token);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return safeApiError(error);
  }
}
