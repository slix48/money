import { z } from "zod";

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  DEMO_MODE: z.string().optional(),
});

const urlSchema = z.string().url();
const sessionSecretSchema = z.string().min(32);
const demoModeSchema = z.enum(["true", "false"]);
const DEFAULT_APP_URL = "http://localhost:3000";
const DEMO_SESSION_SECRET = "moneyos-public-demo-secret-mock-data-only";

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function configurationError(variable: string, requirement: string): never {
  throw new Error(`Invalid server environment: ${variable} ${requirement}`);
}

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const raw = rawEnvironmentSchema.safeParse(input);
  if (!raw.success) {
    throw new Error(`Invalid server environment: ${raw.error.message}`);
  }

  const demoFlag = demoModeSchema.safeParse(normalized(raw.data.DEMO_MODE)?.toLowerCase());
  // An absent or malformed mode always fails closed to the mock-only repository.
  const demoMode = !demoFlag.success || demoFlag.data === "true";
  const databaseUrl = urlSchema.safeParse(normalized(raw.data.DATABASE_URL));
  const appUrl = urlSchema.safeParse(normalized(raw.data.APP_URL));
  const sessionSecret = sessionSecretSchema.safeParse(normalized(raw.data.SESSION_SECRET));

  if (!demoMode) {
    if (!databaseUrl.success) {
      configurationError("DATABASE_URL", "must be a valid PostgreSQL URL when DEMO_MODE=false");
    }
    if (normalized(raw.data.APP_URL) && !appUrl.success) {
      configurationError("APP_URL", "must be a valid URL when DEMO_MODE=false");
    }
    if (normalized(raw.data.SESSION_SECRET) && !sessionSecret.success) {
      configurationError("SESSION_SECRET", "must contain at least 32 characters");
    }
    if (raw.data.NODE_ENV === "production" && !sessionSecret.success) {
      configurationError("SESSION_SECRET", "is required in production when DEMO_MODE=false");
    }
  }

  return {
    NODE_ENV: raw.data.NODE_ENV,
    DATABASE_URL: databaseUrl.success ? databaseUrl.data : undefined,
    SESSION_SECRET: sessionSecret.success ? sessionSecret.data : undefined,
    APP_URL: appUrl.success ? appUrl.data : DEFAULT_APP_URL,
    DEMO_MODE: demoMode ? "true" as const : "false" as const,
    demoMode,
    sessionSecret: sessionSecret.success ? sessionSecret.data : DEMO_SESSION_SECRET,
  };
}

export const env = parseEnvironment(process.env);
