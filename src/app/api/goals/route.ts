import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { getFinancialRepository } from "@/data/get-repository";
import { rateLimit, readJsonBody, requireSameOrigin, safeApiError } from "@/lib/security";
import { goalCreateSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = rateLimit("goal-create", user.id, 12, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Goal creation limit reached. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = goalCreateSchema.safeParse(await readJsonBody(request, 8_192));
    if (!parsed.success || parsed.data.currentAmountCents > parsed.data.targetAmountCents) {
      return NextResponse.json({ error: "Check the goal amounts and target details." }, { status: 400 });
    }
    const repository = await getFinancialRepository();
    const goal = await repository.createGoal(user.id, {
      type: parsed.data.type,
      name: parsed.data.name,
      targetAmountCents: parsed.data.targetAmountCents,
      currentAmountCents: parsed.data.currentAmountCents,
      targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
      linkedAccountId: parsed.data.linkedAccountId ?? undefined,
      monthlyTargetCents: parsed.data.monthlyTargetCents,
      color: parsed.data.color,
    });
    return NextResponse.json(goal, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Linked account not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
