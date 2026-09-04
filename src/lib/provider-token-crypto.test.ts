import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  decryptProviderToken,
  decryptProviderTokenWithKeyring,
  encryptProviderToken,
  encryptProviderTokenWithKeyring,
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

  it("decrypts old key versions while encrypting with the current version", () => {
    const oldKey = Buffer.alloc(32, 3).toString("base64");
    const keyring = {
      currentVersion: 2,
      keys: { 1: oldKey, 2: KEY },
    };
    const oldCiphertext = encryptProviderToken("rotate-me", oldKey);
    expect(decryptProviderTokenWithKeyring(oldCiphertext, 1, keyring)).toBe(
      "rotate-me",
    );
    const current = encryptProviderTokenWithKeyring("new-token", keyring);
    expect(current.keyVersion).toBe(2);
    expect(decryptProviderTokenWithKeyring(
      current.ciphertext,
      current.keyVersion,
      keyring,
    )).toBe("new-token");
  });

  it("fails closed when a stored key version is missing", () => {
    const ciphertext = encryptProviderToken("secret", KEY);
    expect(() => decryptProviderTokenWithKeyring(ciphertext, 1, {
      currentVersion: 2,
      keys: { 2: Buffer.alloc(32, 8).toString("base64") },
    })).toThrow("key version is unavailable");
  });
});
