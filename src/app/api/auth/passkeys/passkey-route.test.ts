import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createSession: vi.fn(),
  setCookie: vi.fn(),
  beginAuthentication: vi.fn(),
  finishAuthentication: vi.fn(),
  requireSameOrigin: vi.fn(),
  rateLimit: vi.fn(),
  readJsonBody: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { demoMode: false } }));
vi.mock("@/auth/auth-service", () => ({
  authenticateCredentials: mocks.authenticate,
  createSession: mocks.createSession,
}));
vi.mock("@/auth/cookies", () => ({ setSessionCookie: mocks.setCookie }));
vi.mock("@/auth/passkey-service", () => ({
  beginPasskeyAuthentication: mocks.beginAuthentication,
  finishPasskeyAuthentication: mocks.finishAuthentication,
}));
vi.mock("@/lib/security", () => ({
  requireSameOrigin: mocks.requireSameOrigin,
  rateLimitDistributed: mocks.rateLimit,
  readJsonBody: mocks.readJsonBody,
  requestIdentifier: () => "request-hash",
  safeApiError: () => new Response(JSON.stringify({ error: "failed" }), { status: 500 }),
}));

import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as VERIFY_PASSKEY } from "@/app/api/auth/passkeys/authenticate/verify/route";
import { PasskeyVerificationError } from "@/data/errors";

const user = {
  id: "user-a",
  name: "User A",
  email: "a@example.test",
  isDemo: false,
};

function request(path: string) {
  return new Request("http://localhost:3000" + path, {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: "{}",
  });
}

describe("passkey authentication routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 1 });
    mocks.authenticate.mockResolvedValue(user);
    mocks.createSession.mockResolvedValue("opaque-session-token");
  });

  it("does not issue a session after password verification when MFA is enrolled", async () => {
    mocks.readJsonBody.mockResolvedValue({
      email: "a@example.test",
      password: "correct password",
    });
    mocks.beginAuthentication.mockResolvedValue({
      ceremonyToken: "ceremony-token-with-sufficient-length",
      options: { challenge: "challenge" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await LOGIN(request("/api/auth/login"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mfaRequired: true });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("marks the resulting session MFA-verified only after passkey verification", async () => {
    mocks.readJsonBody.mockResolvedValue({
      ceremonyToken: "ceremony-token-with-sufficient-length",
      response: {
        id: "credential-id",
        rawId: "credential-id",
        type: "public-key",
        response: {
          clientDataJSON: "client-data",
          authenticatorData: "authenticator-data",
          signature: "signature",
        },
        clientExtensionResults: {},
      },
    });
    mocks.finishAuthentication.mockResolvedValue(user);
    const response = await VERIFY_PASSKEY(
      request("/api/auth/passkeys/authenticate/verify"),
    );
    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith("user-a", { mfaVerified: true });
    expect(mocks.setCookie).toHaveBeenCalledWith(response, "opaque-session-token");
  });

  it("returns a generic rejection and creates no session after failed verification", async () => {
    mocks.readJsonBody.mockResolvedValue({
      ceremonyToken: "ceremony-token-with-sufficient-length",
      response: {
        id: "credential-id",
        rawId: "credential-id",
        type: "public-key",
        response: {
          clientDataJSON: "client-data",
          authenticatorData: "authenticator-data",
          signature: "signature",
        },
        clientExtensionResults: {},
      },
    });
    mocks.finishAuthentication.mockRejectedValue(new PasskeyVerificationError());
    const response = await VERIFY_PASSKEY(
      request("/api/auth/passkeys/authenticate/verify"),
    );
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
