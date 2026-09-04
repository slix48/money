import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { demoMode: false, APP_URL: "https://money.example.com", NODE_ENV: "test" },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    rateLimitBucket: {
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}));

import { rateLimitDistributed } from "@/lib/security";

describe("distributed rate limiting", () => {
  beforeEach(() => mocks.upsert.mockReset());

  it("uses a hashed fixed-window key and database count", async () => {
    mocks.upsert.mockResolvedValue({
      count: 3,
      resetAt: new Date(60_000),
    });
    const result = await rateLimitDistributed("login", "person@example.com", 2, 60_000, 1_000);

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 59 });
    const input = mocks.upsert.mock.calls[0]?.[0];
    expect(input.where.keyHash).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(input)).not.toContain("person@example.com");
    expect(input.update).toEqual({ count: { increment: 1 } });
  });
});
