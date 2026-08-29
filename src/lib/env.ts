import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: z.enum(["true", "false"]).default("true"),
});

const parsed = environmentSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  APP_URL: process.env.APP_URL,
  DEMO_MODE: process.env.DEMO_MODE,
});

if (!parsed.success) {
  throw new Error(`Invalid server environment: ${parsed.error.message}`);
}

if (parsed.data.NODE_ENV === "production" && !parsed.data.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

if (parsed.data.DEMO_MODE === "false" && !parsed.data.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when DEMO_MODE is false");
}

export const env = {
  ...parsed.data,
  demoMode: parsed.data.DEMO_MODE === "true",
  sessionSecret:
    parsed.data.SESSION_SECRET ??
    "moneyos-local-demo-secret-change-before-production",
};
