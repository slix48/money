import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processQueue: vi.fn(),
  queueHealth: vi.fn(),
  tokenHealth: vi.fn(),
  pruneRateLimits: vi.fn(),
  pruneSyncHistory: vi.fn(),
  pruneAuthentication: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "a-strong-cron-secret-with-more-than-32-characters" },
}));
vi.mock("@/sync/sync-queue", () => ({
  processSyncQueue: mocks.processQueue,
  getSyncQueueHealth: mocks.queueHealth,
  pruneSyncQueueHistory: mocks.pruneSyncHistory,
}));
vi.mock("@/sync/provider-token-service", () => ({
  getProviderTokenRotationHealth: mocks.tokenHealth,
}));
vi.mock("@/lib/security", () => ({ pruneExpiredRateLimits: mocks.pruneRateLimits }));
vi.mock("@/auth/passkey-service", () => ({
  pruneExpiredAuthenticationState: mocks.pruneAuthentication,
}));

import { GET, POST } from "@/app/api/internal/sync/drain/route";

const secret = "a-strong-cron-secret-with-more-than-32-characters";
function request(method: "GET" | "POST", token = secret) {
  return new Request("http://localhost:3000/api/internal/sync/drain", {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("protected sync drain", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.processQueue.mockResolvedValue(2);
    mocks.queueHealth.mockResolvedValue({ queued: 1, processing: 0, failed: 0, staleLeases: 0, oldestQueuedAt: null });
    mocks.tokenHealth.mockResolvedValue({ currentVersion: 2, connectionsByVersion: { 2: 3 }, remainingOnOlderVersions: 0 });
    mocks.pruneRateLimits.mockResolvedValue(4);
    mocks.pruneSyncHistory.mockResolvedValue({ succeeded: 2, failed: 1 });
    mocks.pruneAuthentication.mockResolvedValue({ challenges: 3, sessions: 1 });
  });

  it("hides the endpoint when the bearer secret is invalid", async () => {
    expect((await POST(request("POST", "wrong"))).status).toBe(404);
    expect(mocks.processQueue).not.toHaveBeenCalled();
  });

  it("runs a bounded drain and returns payload-free operational counts", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(mocks.processQueue).toHaveBeenCalledWith({ limit: 5, maxDurationMs: 20_000 });
    await expect(response.json()).resolves.toMatchObject({
      processed: 2,
      expiredRateLimitsRemoved: 4,
      syncHistoryRemoved: { succeeded: 2, failed: 1 },
      authenticationStateRemoved: { challenges: 3, sessions: 1 },
      queue: { queued: 1 },
    });
  });

  it("reports queue and key-rotation health without draining", async () => {
    const response = await GET(request("GET"));
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      providerTokenEncryption: { remainingOnOlderVersions: 0 },
    });
    expect(mocks.processQueue).not.toHaveBeenCalled();
  });
});
