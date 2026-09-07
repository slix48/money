import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  beginUserUpdate: vi.fn(),
  releaseUserUpdate: vi.fn(),
  cancelJobs: vi.fn(),
  findConnections: vi.fn(),
  updateConnection: vi.fn(),
  deleteUser: vi.fn(),
  getProvider: vi.fn(),
  disconnect: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { updateMany: mocks.releaseUserUpdate },
    financialConnection: { updateMany: mocks.updateConnection },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/providers/registry", () => ({
  getFinancialDataProvider: mocks.getProvider,
}));
vi.mock("@/sync/provider-token-service", () => ({
  decryptProviderAccessToken: mocks.decrypt,
}));

import { AccountDeletionBlockedError } from "@/data/errors";
import { deleteUserAccount } from "@/privacy/privacy-service";

describe("provider-aware account deletion", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.beginUserUpdate.mockResolvedValue({ count: 1 });
    mocks.cancelJobs.mockResolvedValue({ count: 1 });
    mocks.findConnections.mockResolvedValue([{
      id: "connection-a",
      provider: "PLAID",
      accessTokenEncrypted: "encrypted-token",
      tokenKeyVersion: 2,
      tokenEncryptionScheme: "LOCAL_AES_GCM",
    }]);
    mocks.updateConnection.mockResolvedValue({ count: 1 });
    mocks.releaseUserUpdate.mockResolvedValue({ count: 1 });
    mocks.decrypt.mockResolvedValue("provider-access-token");
    mocks.getProvider.mockResolvedValue({ disconnect: mocks.disconnect });
    mocks.transaction.mockImplementation(async (callback) => callback({
      user: {
        updateMany: mocks.beginUserUpdate,
        deleteMany: mocks.deleteUser,
      },
      syncJob: { updateMany: mocks.cancelJobs },
      financialConnection: { findMany: mocks.findConnections },
    }));
  });

  it("does not delete local data when provider revocation cannot be confirmed", async () => {
    mocks.disconnect.mockRejectedValue(new Error("provider unavailable"));
    await expect(deleteUserAccount("user-a"))
      .rejects.toBeInstanceOf(AccountDeletionBlockedError);
    expect(mocks.decrypt).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      connectionId: "connection-a",
      encryptionScheme: "LOCAL_AES_GCM",
    }));
    expect(mocks.disconnect).toHaveBeenCalledWith("provider-access-token");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.releaseUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-a" },
      data: { deletionRequestedAt: null },
    });
  });
});
