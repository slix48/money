import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  decryptProviderToken,
  encryptProviderToken,
} from "@/lib/provider-token-crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("provider token encryption", () => {
  it("round trips a token without embedding the plaintext", () => {
    const encrypted = encryptProviderToken("access-sandbox-secret", KEY);
    expect(encrypted).not.toContain("access-sandbox-secret");
    expect(decryptProviderToken(encrypted, KEY)).toBe("access-sandbox-secret");
  });

  it("uses a unique nonce for every envelope", () => {
    expect(encryptProviderToken("same", KEY)).not.toBe(
      encryptProviderToken("same", KEY),
    );
  });

  it("rejects tampering", () => {
    const encrypted = encryptProviderToken("secret", KEY);
    const segments = encrypted.split(".");
    segments[3] = (segments[3]?.startsWith("A") ? "B" : "A") + segments[3]?.slice(1);
    expect(() => decryptProviderToken(segments.join("."), KEY)).toThrow();
  });
});
