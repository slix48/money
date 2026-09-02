import { describe, expect, it } from "vitest";
import { parseEnvironment } from "@/lib/env";

describe("environment parsing", () => {
  it("fails closed to demo mode when Vercel variables are blank", () => {
    const parsed = parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: " ",
      SESSION_SECRET: "",
      APP_URL: " ",
      DEMO_MODE: "",
    });

    expect(parsed.demoMode).toBe(true);
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.APP_URL).toBe("http://localhost:3000");
    expect(parsed.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("ignores invalid service configuration when the repository is demo-only", () => {
    const parsed = parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "not-a-url",
      SESSION_SECRET: "short",
      APP_URL: "not-a-url",
      DEMO_MODE: "unexpected-value",
    });

    expect(parsed.demoMode).toBe(true);
    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.APP_URL).toBe("http://localhost:3000");
  });

  it("accepts a fully configured PostgreSQL production environment", () => {
    const parsed = parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://moneyos:secret@db.example.com:5432/moneyos",
      SESSION_SECRET: "a-production-session-secret-with-adequate-length",
      APP_URL: "https://money.example.com",
      DEMO_MODE: " false ",
    });

    expect(parsed.demoMode).toBe(false);
    expect(parsed.DATABASE_URL).toContain("db.example.com");
    expect(parsed.APP_URL).toBe("https://money.example.com");
  });

  it("derives the canonical production origin from Vercel", () => {
    const parsed = parseEnvironment({
      NODE_ENV: "production",
      DEMO_MODE: "true",
      VERCEL_URL: "moneyos-preview.vercel.app",
    });

    expect(parsed.APP_URL).toBe("https://moneyos-preview.vercel.app");
  });

  it("rejects an invalid database URL when PostgreSQL mode is explicit", () => {
    expect(() => parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "not-a-url",
      SESSION_SECRET: "a-production-session-secret-with-adequate-length",
      DEMO_MODE: "false",
    })).toThrow("DATABASE_URL must be a valid PostgreSQL URL");
  });

  it("requires a strong session secret for PostgreSQL production mode", () => {
    expect(() => parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://moneyos:secret@db.example.com:5432/moneyos",
      SESSION_SECRET: "short",
      DEMO_MODE: "false",
    })).toThrow("SESSION_SECRET must contain at least 32 characters");
  });

  it("requires a canonical origin for PostgreSQL production mode", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://moneyos:secret@db.example.com:5432/moneyos",
        SESSION_SECRET:
          "a-production-session-secret-with-adequate-length",
        DEMO_MODE: "false",
      }),
    ).toThrow("APP_URL is required");
  });

  it("requires complete Plaid credentials and token encryption", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "development",
        DEMO_MODE: "true",
        PLAID_CLIENT_ID: "client-id",
      }),
    ).toThrow("PLAID_SECRET is required");

    expect(() =>
      parseEnvironment({
        NODE_ENV: "development",
        DEMO_MODE: "true",
        PLAID_CLIENT_ID: "client-id",
        PLAID_SECRET: "secret",
        PROVIDER_TOKEN_ENCRYPTION_KEY: "too-short",
      }),
    ).toThrow("PROVIDER_TOKEN_ENCRYPTION_KEY");
  });

  it("accepts optional sandbox Plaid configuration", () => {
    const parsed = parseEnvironment({
      NODE_ENV: "development",
      DEMO_MODE: "true",
      PLAID_CLIENT_ID: "client-id",
      PLAID_SECRET: "secret",
      PLAID_ENV: "sandbox",
      PLAID_WEBHOOK_URL: "https://example.test/api/providers/plaid/webhook",
      PROVIDER_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    });

    expect(parsed.plaidConfigured).toBe(true);
    expect(parsed.PLAID_ENV).toBe("sandbox");
  });
});
