import { NextResponse } from "next/server";
import { askFinancialAssistant } from "@/ai/assistant";
import { createFinancialToolContext } from "@/ai/tool-registry";
import { getCurrentUser } from "@/auth/dal";
import { getFinancialRepository } from "@/data/get-repository";
import {
  rateLimit,
  readJsonBody,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { assistantQuerySchema } from "@/lib/validation";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = rateLimit("ai-query", user.id, 20, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Query limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = assistantQuerySchema.safeParse(await readJsonBody(request, 4_096));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a financial question under 600 characters." }, { status: 400 });
    }
    const repository = await getFinancialRepository();
    const context = createFinancialToolContext(user.id, repository);
    const reply = await askFinancialAssistant(parsed.data.message, context);
    if (!env.demoMode) {
      const { recordAiUsage } = await import("@/lib/usage-metrics");
      await recordAiUsage({
        userId: user.id,
        provider: "DETERMINISTIC",
        operation: "FINANCIAL_ASSISTANT",
        inputCharacters: parsed.data.message.length,
        outputCharacters:
          reply.answer.length +
          (reply.calculation?.join(" ").length ?? 0) +
          (reply.note?.length ?? 0),
      });
    }
    return NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return safeApiError(error);
  }
}
