import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as typeof globalThis & {
  moneyOsPrisma?: PrismaClient;
};

function createClient() {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for PostgreSQL access");
  }
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.moneyOsPrisma ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.moneyOsPrisma = prisma;
}
