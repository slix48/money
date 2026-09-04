import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/data/errors";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enqueueSyncJob: vi.fn(),
  disconnectFinancialConnection: vi.fn(),
  rateLimitDistributed: vi.fn(),
}));

vi.mock("@/auth/dal", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/sync/sync-queue", () => ({
  enqueueSyncJob: mocks.enqueueSyncJob,
  processNextSyncJob: vi.fn(),
}));
vi.mock("@/sync/connection-service", () => ({
  disconnectFinancialConnection: mocks.disconnectFinancialConnection,
}));
vi.mock("@/lib/security", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/security")>(),
  rateLimitDistributed: mocks.rateLimitDistributed,
}));

import { DELETE } from "@/app/api/connections/[id]/route";
import { POST as REFRESH } from "@/app/api/connections/[id]/refresh/route";

function request(method: "POST" | "DELETE", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/connections/connection-b", {
    method,
    headers: { origin },
  });
}

describe("connection ownership routes", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.enqueueSyncJob.mockReset();
    mocks.disconnectFinancialConnection.mockReset();
    mocks.rateLimitDistributed.mockReset();
    mocks.rateLimitDistributed.mockResolvedValue({
      allowed: true,
      remaining: 4,
      retryAfterSeconds: 1,
    });
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      name: "User A",
      email: "a@example.com",
      isDemo: false,
    });
  });

  it("derives refresh ownership from the session and hides a foreign id", async () => {
    mocks.enqueueSyncJob.mockRejectedValue(new NotFoundError());
    const response = await REFRESH(request("POST"), {
      params: Promise.resolve({ id: "user-b-connection" }),
    });
    expect(mocks.enqueueSyncJob).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      connectionId: "user-b-connection",
    }));
    expect(response.status).toBe(404);
  });

  it("derives disconnect ownership from the session and hides a foreign id", async () => {
    mocks.disconnectFinancialConnection.mockRejectedValue(new NotFoundError());
    const response = await DELETE(request("DELETE"), {
      params: Promise.resolve({ id: "user-b-connection" }),
    });
    expect(mocks.disconnectFinancialConnection).toHaveBeenCalledWith(
      "user-a",
      "user-b-connection",
    );
    expect(response.status).toBe(404);
  });

  it("rejects cross-origin connection mutations before provider work", async () => {
    const response = await DELETE(request("DELETE", "https://attacker.example"), {
      params: Promise.resolve({ id: "connection-a" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.disconnectFinancialConnection).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await DELETE(request("DELETE"), {
      params: Promise.resolve({ id: "connection-a" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.disconnectFinancialConnection).not.toHaveBeenCalled();
  });
});
