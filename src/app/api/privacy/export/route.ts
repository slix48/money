import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { ExportCapacityError } from "@/data/errors";
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
      { error: "Demo data is temporary and cannot be exported." },
      { status: 403 },
    );
  }
  const limit = await rateLimitDistributed(
    "privacy-export",
    user.id,
    2,
    24 * 60 * 60 * 1_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "An export was generated recently. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const { createUserDataExport } = await import("@/privacy/privacy-service");
    const archive = await createUserDataExport(user.id);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(archive), {
      headers: {
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="moneyos-data-${date}.json"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportCapacityError) {
      return NextResponse.json(
        { error: "This history requires a background export, which is not available in this deployment." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return safeApiError(error);
  }
}

export const runtime = "nodejs";
export const maxDuration = 30;
