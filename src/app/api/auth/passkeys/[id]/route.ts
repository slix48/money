import { NextResponse } from "next/server";
import { getCurrentSession } from "@/auth/dal";
import {
  NotFoundError,
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
import { entityIdSchema, passkeyDeleteSchema } from "@/lib/validation";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    "passkey-delete",
    session.user.id,
    6,
    60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many passkey changes." }, { status: 429 });
  }
  try {
    const id = entityIdSchema.safeParse((await params).id);
    const body = passkeyDeleteSchema.safeParse(
      await readJsonBody(request, 2_048),
    );
    if (!id.success || !body.success) {
      return NextResponse.json({ error: "Invalid passkey removal request." }, { status: 400 });
    }
    const { deletePasskey } = await import("@/auth/passkey-service");
    await deletePasskey({
      session: { ...session, id: session.id },
      credentialId: id.data,
      password: body.data.password,
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Passkey not found." }, { status: 404 });
    }
    if (error instanceof PasskeyVerificationError) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }
    if (error instanceof ReauthenticationRequiredError) {
      return NextResponse.json(
        { error: error.message, code: "RECENT_MFA_REQUIRED" },
        { status: 409 },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
