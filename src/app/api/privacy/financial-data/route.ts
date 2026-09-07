import { NextResponse } from "next/server";
import { getCurrentSession } from "@/auth/dal";
import {
  AccountDeletionBlockedError,
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
import { financialDataDeletionSchema } from "@/lib/validation";

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const session = await getCurrentSession();
  if (!session?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (env.demoMode) {
    return NextResponse.json({ error: "Demo data cannot be deleted." }, { status: 403 });
  }
  const limit = await rateLimitDistributed(
    "financial-data-delete",
    session.user.id,
    3,
    24 * 60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many deletion attempts." }, { status: 429 });
  }
  try {
    const parsed = financialDataDeletionSchema.safeParse(
      await readJsonBody(request, 2_048),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Deletion confirmation is invalid." }, { status: 400 });
    }
    const [{ verifySensitiveAccountOperation }, { deleteUserFinancialData }] =
      await Promise.all([
        import("@/auth/passkey-service"),
        import("@/privacy/privacy-service"),
      ]);
    await verifySensitiveAccountOperation(
      { ...session, id: session.id },
      parsed.data.password,
    );
    await deleteUserFinancialData(session.user.id);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PasskeyVerificationError) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }
    if (error instanceof ReauthenticationRequiredError) {
      return NextResponse.json(
        { error: "Sign out and complete passkey verification again before deleting data.", code: "RECENT_MFA_REQUIRED" },
        { status: 409 },
      );
    }
    if (error instanceof AccountDeletionBlockedError) {
      return NextResponse.json(
        { error: "A provider could not confirm disconnection. No local data was deleted; try again later." },
        { status: 503 },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
