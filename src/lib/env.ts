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
  PROVIDER_TOKEN_ENCRYPTION_KEYS: z.string().optional(),
  PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION: z.string().optional(),
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

function parseProviderTokenKeyring(input: {
  legacyKey?: string;
  serializedKeys?: string;
  currentVersion?: string;
}) {
  const legacyKey = normalized(input.legacyKey);
  const serializedKeys = normalized(input.serializedKeys);
  const currentVersionValue = normalized(input.currentVersion);
  if (legacyKey && (serializedKeys || currentVersionValue)) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEYS",
      "cannot be combined with the legacy PROVIDER_TOKEN_ENCRYPTION_KEY",
    );
  }
  if (legacyKey) {
    if (!isEncryptionKey(legacyKey)) {
      configurationError(
        "PROVIDER_TOKEN_ENCRYPTION_KEY",
        "must decode to exactly 32 bytes (base64) or be 64 hexadecimal characters",
      );
    }
    return { currentVersion: 1, keys: { 1: legacyKey } } as const;
  }
  if (!serializedKeys && !currentVersionValue) return undefined;
  if (!serializedKeys || !currentVersionValue) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEYS",
      "and PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION must both be configured",
    );
  }
  const currentVersion = Number(currentVersionValue);
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION",
      "must be a positive integer",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeys);
  } catch {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEYS",
      "must be a JSON object mapping positive integer versions to keys",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEYS",
      "must be a JSON object mapping positive integer versions to keys",
    );
  }
  const keys: Record<number, string> = {};
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 10) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEYS",
      "must contain between 1 and 10 key versions",
    );
  }
  for (const [versionValue, keyValue] of entries) {
    const version = Number(versionValue);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof keyValue !== "string" ||
      !isEncryptionKey(keyValue)
    ) {
      configurationError(
        "PROVIDER_TOKEN_ENCRYPTION_KEYS",
        "must map positive integer versions to exactly 32-byte keys",
      );
    }
    keys[version] = keyValue;
  }
  if (!keys[currentVersion]) {
    configurationError(
      "PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION",
      "must identify a key present in PROVIDER_TOKEN_ENCRYPTION_KEYS",
    );
  }
  return { currentVersion, keys };
}

function isPostgreSqlUrl(value: string): boolean {
  const protocol = new URL(value).protocol;
  return protocol === "postgresql:" || protocol === "postgres:";
}

function isHttpsUrl(value: string): boolean {
  return new URL(value).protocol === "https:";
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
  const providerTokenKeyring = parseProviderTokenKeyring({
    legacyKey: providerTokenEncryptionKey,
    serializedKeys: raw.data.PROVIDER_TOKEN_ENCRYPTION_KEYS,
    currentVersion: raw.data.PROVIDER_TOKEN_ENCRYPTION_KEY_VERSION,
  });
  const cronSecret = normalized(raw.data.CRON_SECRET);
  const plaidWasConfigured = Boolean(
    plaidClientId ||
      plaidSecret ||
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
    if (!providerTokenKeyring) {
      configurationError(
        "PROVIDER_TOKEN_ENCRYPTION_KEYS",
        "or legacy PROVIDER_TOKEN_ENCRYPTION_KEY is required for Plaid",
      );
    }
    if (plaidEnvironment.data === "production") {
      if (!plaidWebhookUrl.success || !isHttpsUrl(plaidWebhookUrl.data)) {
        configurationError(
          "PLAID_WEBHOOK_URL",
          "must be a valid HTTPS URL for the Plaid production environment",
        );
      }
      if (!plaidRedirectUri.success || !isHttpsUrl(plaidRedirectUri.data)) {
        configurationError(
          "PLAID_REDIRECT_URI",
          "must be a valid HTTPS URL for the Plaid production environment",
        );
      }
      if (!cronSecret || cronSecret.length < 32) {
        configurationError(
          "CRON_SECRET",
          "must contain at least 32 characters for production provider sync",
        );
      }
    }
  }

  if (cronSecret && cronSecret.length < 32) {
    configurationError("CRON_SECRET", "must contain at least 32 characters");
  }

  if (!demoMode) {
    if (!databaseUrl.success || !isPostgreSqlUrl(databaseUrl.data)) {
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
    const productionAppUrl = appUrl.success
      ? appUrl.data
      : vercelAppUrl.success
        ? vercelAppUrl.data
        : undefined;
    if (
      raw.data.NODE_ENV === "production" &&
      productionAppUrl &&
      !isHttpsUrl(productionAppUrl)
    ) {
      configurationError("APP_URL", "must use HTTPS in production");
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
    providerTokenKeyring,
    CRON_SECRET: cronSecret,
    plaidConfigured:
      Boolean(plaidClientId && plaidSecret && providerTokenKeyring),
  };
}

export const env = parseEnvironment(process.env);
