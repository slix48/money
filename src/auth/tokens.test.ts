import { describe, expect, it } from "vitest";
import {
  createOpaqueSessionToken,
  createSignedDemoToken,
  hashSessionToken,
  verifySignedDemoToken,
} from "@/auth/tokens";

const secret = "test-secret-with-at-least-thirty-two-characters";

describe("session token security", () => {
  it("round-trips a signed demo session", () => {
    const token = createSignedDemoToken("user-1", secret, 1_000);
    expect(verifySignedDemoToken(token, secret, 2_000)).toMatchObject({ userId: "user-1" });
  });

  it("rejects tampered and expired demo sessions", () => {
    const token = createSignedDemoToken("user-1", secret, 1_000);
    const tampered = token.replace("user", "other").replace(/.$/, "x");

    expect(verifySignedDemoToken(tampered, secret, 2_000)).toBeNull();
    expect(verifySignedDemoToken(token, secret, 1_000 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("creates high-entropy opaque production tokens and stores only their hash", () => {
    const left = createOpaqueSessionToken();
    const right = createOpaqueSessionToken();

    expect(left).not.toBe(right);
    expect(left.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(left)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(left)).not.toContain(left);
  });
});
