import "server-only";
import type { FinancialRepository } from "@/data/financial-repository";
import { demoFinancialRepository } from "@/data/demo-repository";
import { env } from "@/lib/env";

export async function getFinancialRepository(): Promise<FinancialRepository> {
  if (env.demoMode) return demoFinancialRepository;
  const { prismaFinancialRepository } = await import("@/data/prisma-repository");
  return prismaFinancialRepository;
}
