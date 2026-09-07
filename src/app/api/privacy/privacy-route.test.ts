import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCurrentSession: vi.fn(),
  createExport: vi.fn(),
  revokeSessions: vi.fn(),
  deleteFinancialData: vi.fn(),
  deleteAccount: vi.fn(),
  verifySensitive: vi.fn(),
  clearCookie: vi.fn(),
  requireSameOrigin: vi.fn(),
  rateLimit: vi.fn(),
  readJsonBody: vi.fn(),
}));

vi.mock("@/auth/dal", () => ({
  getCurrentUser: mocks.getCurrentUser,
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/auth/cookies", () => ({ clearSessionCookie: mocks.clearCookie }));
vi.mock("@/auth/passkey-service", () => ({
  verifySensitiveAccountOperation: mocks.verifySensitive,
}));
vi.mock("@/lib/env", () => ({ env: { demoMode: false } }));
vi.mock("@/lib/security", () => ({
  requireSameOrigin: mocks.requireSameOrigin,
  rateLimitDistributed: mocks.rateLimit,
  readJsonBody: mocks.readJsonBody,
  safeApiError: () => new Response(JSON.stringify({ error: "failed" }), { status: 500 }),
}));
vi.mock("@/privacy/privacy-service", () => ({
  createUserDataExport: mocks.createExport,
  revokeAllUserSessions: mocks.revokeSessions,
  deleteUserFinancialData: mocks.deleteFinancialData,
  deleteUserAccount: mocks.deleteAccount,
}));

import { POST as EXPORT } from "@/app/api/privacy/export/route";
import { POST as REVOKE } from "@/app/api/privacy/sessions/revoke/route";
import { DELETE as DELETE_FINANCIAL_DATA } from "@/app/api/privacy/financial-data/route";
import { DELETE as DELETE_ACCOUNT } from "@/app/api/privacy/account/route";

function request(path: string) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
}

function deletionRequest(path: string) {
  return new Request("http://localhost:3000" + path, {
    method: "DELETE",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: "{}",
  });
}

describe("privacy routes", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 1 });
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      name: "User A",
      email: "a@example.test",
      isDemo: false,
    });
    mocks.getCurrentSession.mockResolvedValue({
      id: "session-a",
      user: {
        id: "user-a",
        name: "User A",
        email: "a@example.test",
        isDemo: false,
      },
      mfaVerifiedAt: new Date(),
    });
    mocks.verifySensitive.mockResolvedValue(undefined);
    mocks.deleteFinancialData.mockResolvedValue(undefined);
    mocks.deleteAccount.mockResolvedValue(undefined);
  });

  it("exports only the authenticated user's archive as a non-cacheable download", async () => {
    mocks.createExport.mockResolvedValue({ format: "moneyos-user-data", user: { id: "user-a" } });
    const response = await EXPORT(request("/api/privacy/export"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(mocks.createExport).toHaveBeenCalledWith("user-a");
  });

  it("revokes the session owner's sessions and clears the browser cookie", async () => {
    mocks.revokeSessions.mockResolvedValue(3);
    const response = await REVOKE(request("/api/privacy/sessions/revoke"));

    expect(response.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledWith("user-a");
    expect(mocks.clearCookie).toHaveBeenCalledWith(response);
  });

  it("does not perform privacy operations without an authenticated session", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await EXPORT(request("/api/privacy/export"))).status).toBe(401);
    expect((await REVOKE(request("/api/privacy/sessions/revoke"))).status).toBe(401);
    expect(mocks.createExport).not.toHaveBeenCalled();
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
  });

  it("deletes financial data only for the authenticated session owner", async () => {
    mocks.readJsonBody.mockResolvedValue({ confirmation: "DELETE FINANCIAL DATA", password: "correct password" });
    const response = await DELETE_FINANCIAL_DATA(
      deletionRequest("/api/privacy/financial-data"),
    );
    expect(response.status).toBe(200);
    expect(mocks.verifySensitive).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-a", user: expect.objectContaining({ id: "user-a" }) }),
      "correct password",
    );
    expect(mocks.deleteFinancialData).toHaveBeenCalledWith("user-a");
  });

  it("requires the session email and clears the cookie after account deletion", async () => {
    mocks.readJsonBody.mockResolvedValue({
      confirmation: "DELETE ACCOUNT",
      email: "a@example.test",
      password: "correct password",
    });
    const response = await DELETE_ACCOUNT(deletionRequest("/api/privacy/account"));
    expect(response.status).toBe(200);
    expect(mocks.deleteAccount).toHaveBeenCalledWith("user-a");
    expect(mocks.clearCookie).toHaveBeenCalledWith(response);

    mocks.deleteAccount.mockClear();
    mocks.readJsonBody.mockResolvedValue({
      confirmation: "DELETE ACCOUNT",
      email: "b@example.test",
      password: "correct password",
    });
    expect((await DELETE_ACCOUNT(deletionRequest("/api/privacy/account"))).status).toBe(400);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("does not delete data when no session exists", async () => {
    mocks.getCurrentSession.mockResolvedValue(null);
    expect((await DELETE_FINANCIAL_DATA(
      deletionRequest("/api/privacy/financial-data"),
    )).status).toBe(401);
    expect((await DELETE_ACCOUNT(deletionRequest("/api/privacy/account"))).status).toBe(401);
    expect(mocks.deleteFinancialData).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});
