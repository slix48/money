import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  createAudit: vi.fn(),
  deleteSessions: vi.fn(),
  transaction: vi.fn(),
  countTransactions: vi.fn(),
  countMessages: vi.fn(),
  countAudits: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    transaction: { count: mocks.countTransactions },
    aIMessage: { count: mocks.countMessages },
    auditEvent: { create: mocks.createAudit, count: mocks.countAudits },
    session: { deleteMany: mocks.deleteSessions },
    $transaction: mocks.transaction,
  },
}));

import {
  createUserDataExport,
  revokeAllUserSessions,
} from "@/privacy/privacy-service";

describe("privacy service", () => {
  beforeEach(() => {
    mocks.findUser.mockReset();
    mocks.createAudit.mockReset();
    mocks.deleteSessions.mockReset();
    mocks.transaction.mockReset();
    mocks.countTransactions.mockReset();
    mocks.countMessages.mockReset();
    mocks.countAudits.mockReset();
    mocks.countTransactions.mockResolvedValue(0);
    mocks.countMessages.mockResolvedValue(0);
    mocks.countAudits.mockResolvedValue(0);
  });

  it("requires background generation before loading an oversized history", async () => {
    mocks.countTransactions.mockResolvedValue(25_001);
    await expect(createUserDataExport("user-a")).rejects.toThrow(
      "Background data export required",
    );
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("exports owned records through an explicit credential-free allowlist", async () => {
    mocks.findUser.mockResolvedValue({
      id: "user-a",
      email: "a@example.test",
      financialConnections: [],
      transactions: [],
    });
    mocks.createAudit.mockResolvedValue({ id: "audit-a" });
    const archive = await createUserDataExport("user-a");

    expect(archive).toMatchObject({
      format: "moneyos-user-data",
      formatVersion: 1,
      user: { id: "user-a" },
    });
    const query = mocks.findUser.mock.calls[0]?.[0];
    expect(query.where).toEqual({ id: "user-a" });
    expect(query.select).not.toHaveProperty("passwordHash");
    expect(query.select).not.toHaveProperty("sessions");
    expect(query.select.webAuthnCredentials.select).toEqual({
      name: true,
      credentialDeviceType: true,
      credentialBackedUp: true,
      createdAt: true,
      lastUsedAt: true,
    });
    expect(query.select.webAuthnCredentials.select).not.toHaveProperty("credentialId");
    expect(query.select.webAuthnCredentials.select).not.toHaveProperty("publicKey");
    expect(query.select.financialConnections.select).not.toHaveProperty(
      "accessTokenEncrypted",
    );
    expect(query.select.financialConnections.select).not.toHaveProperty("syncCursor");
    expect(query.select.financialConnections.select).not.toHaveProperty("providerItemId");
    expect(query.select.transactions.select).not.toHaveProperty("externalId");
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-a", action: "PRIVACY_EXPORT_CREATED" }),
    }));
  });

  it("revokes only the authenticated user's sessions", async () => {
    mocks.deleteSessions.mockResolvedValue({ count: 4 });
    mocks.createAudit.mockResolvedValue({ id: "audit-a" });
    mocks.transaction.mockImplementation(async (callback) => callback({
      session: { deleteMany: mocks.deleteSessions },
      auditEvent: { create: mocks.createAudit },
    }));

    await expect(revokeAllUserSessions("user-a")).resolves.toBe(4);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { userId: "user-a" } });
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user-a",
        metadata: { sessionsRevoked: 4 },
      }),
    }));
  });
});
