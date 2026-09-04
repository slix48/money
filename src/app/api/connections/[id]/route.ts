import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { rateLimitDistributed, requireSameOrigin, safeApiError } from "@/lib/security";
import { entityIdSchema } from "@/lib/validation";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = await rateLimitDistributed("connection-disconnect", user.id, 5, 60 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many connection changes." }, { status: 429 });
  }
  try {
    const { disconnectFinancialConnection } = await import("@/sync/connection-service");
    const id = entityIdSchema.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invalid connection id" }, { status: 400 });
    await disconnectFinancialConnection(user.id, id.data);
    return NextResponse.json(
      { status: "DISCONNECTED", historyPreserved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
