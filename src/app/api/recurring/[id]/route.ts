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
import { entityIdSchema, recurringUpdateSchema } from "@/lib/validation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const limit = rateLimit("recurring-update", user.id, 30, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many updates. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const id = entityIdSchema.safeParse((await params).id);
    const update = recurringUpdateSchema.safeParse(await readJsonBody(request));
    if (!id.success || !update.success) {
      return NextResponse.json({ error: "Invalid recurring update" }, { status: 400 });
    }
    const repository = await getFinancialRepository();
    await repository.updateRecurring(user.id, id.data, update.data);
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Recurring item not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
