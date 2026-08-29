import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { getFinancialRepository } from "@/data/get-repository";
import {
  rateLimit,
  readJsonBody,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { transactionUpdateSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = rateLimit("transaction-update", user.id, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many updates. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = transactionUpdateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid transaction update" }, { status: 400 });
    }
    const { id } = await params;
    const repository = await getFinancialRepository();
    await repository.updateTransaction(user.id, id, parsed.data);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
