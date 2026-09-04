import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  oldKey: Buffer.alloc(32, 4).toString("base64"),
  currentKey: Buffer.alloc(32, 5).toString("base64"),
  updateMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    providerTokenKeyring: {
      currentVersion: 2,
      keys: { 1: mocks.oldKey, 2: mocks.currentKey },
    },
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    financialConnection: {
      updateMany: mocks.updateMany,
      groupBy: mocks.groupBy,
    },
  },
}));

import { encryptProviderToken } from "@/lib/provider-token-crypto";
import {
  decryptProviderAccessToken,
  encryptProviderAccessToken,
  getProviderTokenRotationHealth,
} from "@/sync/provider-token-service";

describe("provider token rotation service", () => {
  beforeEach(() => {
    mocks.updateMany.mockReset();
    mocks.groupBy.mockReset();
  });

  it("lazily rotates an old token with a tenant-scoped compare-and-swap", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const ciphertext = encryptProviderToken("provider-secret", mocks.oldKey);
    await expect(decryptProviderAccessToken({
      userId: "user-a",
      connectionId: "connection-a",
      ciphertext,
      keyVersion: 1,
    })).resolves.toBe("provider-secret");

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "connection-a",
        userId: "user-a",
        accessTokenEncrypted: ciphertext,
        tokenKeyVersion: 1,
      }),
      data: expect.objectContaining({ tokenKeyVersion: 2 }),
    }));
    expect(mocks.updateMany.mock.calls[0]?.[0].data.accessTokenEncrypted)
      .not.toContain("provider-secret");
  });

  it("writes new tokens with the current key version", () => {
    expect(encryptProviderAccessToken("new-secret")).toMatchObject({
      keyVersion: 2,
    });
  });

  it("reports only aggregate key-version health", async () => {
    mocks.groupBy.mockResolvedValue([
      { tokenKeyVersion: 1, _count: { _all: 3 } },
      { tokenKeyVersion: 2, _count: { _all: 5 } },
    ]);
    await expect(getProviderTokenRotationHealth()).resolves.toEqual({
      configured: true,
      currentVersion: 2,
      connectionsByVersion: { 1: 3, 2: 5 },
      remainingOnOlderVersions: 3,
    });
  });
});
