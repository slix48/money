import { z } from "zod";

const rawEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  DEMO_MODE: z.string().optional(),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.string().optional(),
  PLAID_WEBHOOK_URL: z.string().optional(),
  PLAID_REDIRECT_URI: z.string().optional(),
  PROVIDER_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

const urlSchema = z.string().url();
const sessionSecretSchema = z.string().min(32);
const demoModeSchema = z.enum(["true", "false"]);
const plaidEnvironmentSchema = z.enum(["sandbox", "production"]);
const DEFAULT_APP_URL = "http://localhost:3000";
const DEMO_SESSION_SECRET = "moneyos-public-demo-secret-mock-data-only";

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function configurationError(variable: string, requirement: string): never {
  throw new Error(`Invalid server environment: ${variable} ${requirement}`);
}

function isEncryptionKey(value: string | undefined): boolean {
  if (!value) return false;
  if (/^[a-f\d]{64}$/i.test(value)) return true;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
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
  const vercelUrl = normalized(raw.data.VERCEL_URL);
  const vercelAppUrl = urlSchema.safeParse(
    vercelUrl
      ? vercelUrl.startsWith("http://") || vercelUrl.startsWith("https://")
        ? vercelUrl
        : "https://" + vercelUrl
      : undefined,
  );
  const sessionSecret = sessionSecretSchema.safeParse(normalized(raw.data.SESSION_SECRET));
  const plaidClientId = normalized(raw.data.PLAID_CLIENT_ID);
  const plaidSecret = normalized(raw.data.PLAID_SECRET);
  const plaidEnvironment = plaidEnvironmentSchema.safeParse(
    normalized(raw.data.PLAID_ENV)?.toLowerCase() ?? "sandbox",
  );
  const plaidWebhookUrl = urlSchema.safeParse(normalized(raw.data.PLAID_WEBHOOK_URL));
  const plaidRedirectUri = urlSchema.safeParse(normalized(raw.data.PLAID_REDIRECT_URI));
  const providerTokenEncryptionKey = normalized(
    raw.data.PROVIDER_TOKEN_ENCRYPTION_KEY,
  );
  const plaidWasConfigured = Boolean(
    plaidClientId ||
      plaidSecret ||
      normalized(raw.data.PLAID_ENV) ||
      normalized(raw.data.PLAID_WEBHOOK_URL) ||
      normalized(raw.data.PLAID_REDIRECT_URI),
  );

  if (plaidWasConfigured) {
    if (!plaidClientId) configurationError("PLAID_CLIENT_ID", "is required for Plaid");
    if (!plaidSecret) configurationError("PLAID_SECRET", "is required for Plaid");
    if (!plaidEnvironment.success) {
      configurationError("PLAID_ENV", "must be sandbox or production");
    }
    if (
      normalized(raw.data.PLAID_WEBHOOK_URL) &&
      !plaidWebhookUrl.success
    ) {
      configurationError("PLAID_WEBHOOK_URL", "must be a valid URL");
    }
    if (
      normalized(raw.data.PLAID_REDIRECT_URI) &&
      !plaidRedirectUri.success
    ) {
      configurationError("PLAID_REDIRECT_URI", "must be a valid URL");
    }
    if (!isEncryptionKey(providerTokenEncryptionKey)) {
      configurationError(
        "PROVIDER_TOKEN_ENCRYPTION_KEY",
        "must decode to exactly 32 bytes (base64) or be 64 hexadecimal characters",
      );
    }
  }

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
    if (
      raw.data.NODE_ENV === "production" &&
      !appUrl.success &&
      !vercelAppUrl.success
    ) {
      configurationError(
        "APP_URL",
        "is required in production when DEMO_MODE=false",
      );
    }
  }

  return {
    NODE_ENV: raw.data.NODE_ENV,
    DATABASE_URL: databaseUrl.success ? databaseUrl.data : undefined,
    SESSION_SECRET: sessionSecret.success ? sessionSecret.data : undefined,
    APP_URL: appUrl.success
      ? appUrl.data
      : vercelAppUrl.success
        ? vercelAppUrl.data
        : DEFAULT_APP_URL,
    DEMO_MODE: demoMode ? "true" as const : "false" as const,
    demoMode,
    sessionSecret: sessionSecret.success ? sessionSecret.data : DEMO_SESSION_SECRET,
    PLAID_CLIENT_ID: plaidClientId,
    PLAID_SECRET: plaidSecret,
    PLAID_ENV: plaidEnvironment.success ? plaidEnvironment.data : "sandbox" as const,
    PLAID_WEBHOOK_URL: plaidWebhookUrl.success ? plaidWebhookUrl.data : undefined,
    PLAID_REDIRECT_URI: plaidRedirectUri.success ? plaidRedirectUri.data : undefined,
    PROVIDER_TOKEN_ENCRYPTION_KEY: providerTokenEncryptionKey,
    CRON_SECRET: normalized(raw.data.CRON_SECRET),
    plaidConfigured:
      Boolean(plaidClientId && plaidSecret) && isEncryptionKey(providerTokenEncryptionKey),
  };
}

export const env = parseEnvironment(process.env);
