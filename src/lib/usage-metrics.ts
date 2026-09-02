import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

function utcDay(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function recordAiUsage(input: {
  userId: string;
  provider: string;
  operation: string;
  inputCharacters: number;
  outputCharacters: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  if (env.demoMode) return;
  const inputTokens = input.inputTokens ?? Math.ceil(input.inputCharacters / 4);
  const outputTokens = input.outputTokens ?? Math.ceil(input.outputCharacters / 4);
  await prisma.usageMetric.upsert({
    where: {
      userId_day_category_provider_operation: {
        userId: input.userId,
        day: utcDay(),
        category: "AI",
        provider: input.provider,
        operation: input.operation,
      },
    },
    update: {
      requestCount: { increment: 1 },
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
    },
    create: {
      userId: input.userId,
      day: utcDay(),
      category: "AI",
      provider: input.provider,
      operation: input.operation,
      requestCount: 1,
      inputTokens,
      outputTokens,
    },
  });
}
