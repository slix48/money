import { describe, expect, it } from "vitest";
import { readSandboxConfiguration } from "../../scripts/plaid-sandbox-e2e";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("Plaid Sandbox E2E safety gate", () => {
  it("skips unless explicitly enabled", () => {
    expect(readSandboxConfiguration({})).toBeUndefined();
  });

  it("refuses production and non-disposable databases", () => {
    expect(() => readSandboxConfiguration({
      RUN_PLAID_SANDBOX_E2E: "true",
      NODE_ENV: "production",
    })).toThrow("never run");
    expect(() => readSandboxConfiguration({
      RUN_PLAID_SANDBOX_E2E: "true",
      NODE_ENV: "test",
      PLAID_ENV: "sandbox",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/moneyos",
      PLAID_CLIENT_ID: "client",
      PLAID_SECRET: "secret",
      PROVIDER_TOKEN_ENCRYPTION_KEY: KEY,
      PLAID_SANDBOX_DATABASE_CONFIRM: "localhost:5432/moneyos",
    })).toThrow("must start with");
  });

  it("requires exact confirmation for a disposable target", () => {
    const base = {
      RUN_PLAID_SANDBOX_E2E: "true",
      NODE_ENV: "test",
      PLAID_ENV: "sandbox",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/moneyos_sandbox_e2e_local",
      PLAID_CLIENT_ID: "client",
      PLAID_SECRET: "secret",
      PROVIDER_TOKEN_ENCRYPTION_KEY: KEY,
    };
    expect(() => readSandboxConfiguration(base)).toThrow("must exactly equal");
    expect(readSandboxConfiguration({
      ...base,
      PLAID_SANDBOX_DATABASE_CONFIRM: "localhost:5432/moneyos_sandbox_e2e_local",
    })).toMatchObject({ clientId: "client" });
  });
});
