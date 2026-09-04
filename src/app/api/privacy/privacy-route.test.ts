import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createExport: vi.fn(),
  revokeSessions: vi.fn(),
  clearCookie: vi.fn(),
  requireSameOrigin: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/auth/dal", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/auth/cookies", () => ({ clearSessionCookie: mocks.clearCookie }));
vi.mock("@/lib/env", () => ({ env: { demoMode: false } }));
vi.mock("@/lib/security", () => ({
  requireSameOrigin: mocks.requireSameOrigin,
  rateLimitDistributed: mocks.rateLimit,
  safeApiError: () => new Response(JSON.stringify({ error: "failed" }), { status: 500 }),
}));
vi.mock("@/privacy/privacy-service", () => ({
  createUserDataExport: mocks.createExport,
  revokeAllUserSessions: mocks.revokeSessions,
}));

import { POST as EXPORT } from "@/app/api/privacy/export/route";
import { POST as REVOKE } from "@/app/api/privacy/sessions/revoke/route";

function request(path: string) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
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
});
