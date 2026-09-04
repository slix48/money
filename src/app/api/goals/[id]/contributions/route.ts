import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { getFinancialRepository } from "@/data/get-repository";
import {
  rateLimitDistributed,
  readJsonBody,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { entityIdSchema, goalContributionSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const limit = await rateLimitDistributed("goal-contribution", user.id, 30, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Contribution update limit reached. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const id = entityIdSchema.safeParse((await params).id);
    const input = goalContributionSchema.safeParse(await readJsonBody(request, 8_192));
    if (!id.success || !input.success) {
      return NextResponse.json({ error: "Invalid goal contribution" }, { status: 400 });
    }
    const repository = await getFinancialRepository();
    const contribution = await repository.addGoalContribution(user.id, id.data, {
      amountCents: input.data.amountCents,
      date: input.data.date ? new Date(input.data.date) : new Date(),
      source: "MANUAL",
      notes: input.data.notes,
    });
    return NextResponse.json(contribution, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
