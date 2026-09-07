import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  getProvider: vi.fn(),
  findConnection: vi.fn(),
  markDisconnected: vi.fn(),
  enqueue: vi.fn(),
  process: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { plaidConfigured: true } }));
vi.mock("@/lib/db", () => ({
  prisma: { financialConnection: { findUnique: mocks.findConnection } },
}));
vi.mock("@/providers/registry", () => ({
  getFinancialDataProvider: mocks.getProvider,
}));
vi.mock("@/sync/connection-service", () => ({
  markConnectionDisconnected: mocks.markDisconnected,
}));
vi.mock("@/sync/sync-queue", () => ({
  enqueueSyncJob: mocks.enqueue,
  processNextSyncJob: mocks.process,
}));

import { POST } from "@/app/api/providers/plaid/webhook/route";

function request() {
  return new Request("http://localhost:3000/api/providers/plaid/webhook", {
    method: "POST",
    headers: { "plaid-verification": "signed-token" },
    body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED" }),
  });
}

describe("Plaid webhook route", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getProvider.mockResolvedValue({ verifyWebhook: mocks.verifyWebhook });
    mocks.verifyWebhook.mockResolvedValue({
      providerItemId: "item-a",
      event: "CONNECTION_REMOVED",
      providerEventId: "event-a",
      occurredAt: new Date(),
    });
    mocks.markDisconnected.mockResolvedValue(undefined);
  });

  it("acknowledges replay of an already-applied disconnect without mutation", async () => {
    mocks.findConnection.mockResolvedValue({
      id: "connection-a",
      userId: "user-a",
      status: "DISCONNECTED",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.markDisconnected).not.toHaveBeenCalled();
  });

  it("disconnects the owning tenant on the first verified provider event", async () => {
    mocks.findConnection.mockResolvedValue({
      id: "connection-a",
      userId: "user-a",
      status: "CONNECTED",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.markDisconnected).toHaveBeenCalledWith(
      "user-a",
      "connection-a",
      "PROVIDER_REVOKED",
    );
  });
});
