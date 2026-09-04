import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

export interface ProviderTokenKeyring {
  currentVersion: number;
  keys: Readonly<Record<number, string>>;
}

export interface EncryptedProviderToken {
  ciphertext: string;
  keyVersion: number;
}

function decodeKey(encodedKey: string): Buffer {
  const key = /^[a-f\d]{64}$/i.test(encodedKey)
    ? Buffer.from(encodedKey, "hex")
    : Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("Provider token encryption key must be exactly 32 bytes");
  }
  return key;
}

export function encryptProviderToken(token: string, encodedKey: string): string {
  if (!token) throw new Error("Provider token cannot be empty");
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, decodeKey(encodedKey), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [VERSION, nonce, authTag, ciphertext]
    .map((value) => typeof value === "string" ? value : value.toString("base64url"))
    .join(".");
}

export function decryptProviderToken(
  encryptedToken: string,
  encodedKey: string,
): string {
  const [version, nonceValue, tagValue, ciphertextValue, extra] =
    encryptedToken.split(".");
  if (
    version !== VERSION ||
    !nonceValue ||
    !tagValue ||
    !ciphertextValue ||
    extra
  ) {
    throw new Error("Unsupported provider token envelope");
  }
  const nonce = Buffer.from(nonceValue, "base64url");
  const authTag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (nonce.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("Invalid provider token envelope");
  }
  const decipher = createDecipheriv(ALGORITHM, decodeKey(encodedKey), nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function keyForVersion(keyring: ProviderTokenKeyring, version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid provider token key version");
  }
  const key = keyring.keys[version];
  if (!key) throw new Error("Provider token key version is unavailable");
  return key;
}

export function encryptProviderTokenWithKeyring(
  token: string,
  keyring: ProviderTokenKeyring,
): EncryptedProviderToken {
  return {
    ciphertext: encryptProviderToken(
      token,
      keyForVersion(keyring, keyring.currentVersion),
    ),
    keyVersion: keyring.currentVersion,
  };
}

export function decryptProviderTokenWithKeyring(
  encryptedToken: string,
  keyVersion: number | null | undefined,
  keyring: ProviderTokenKeyring,
): string {
  // Connections created before key-version tracking used version 1.
  return decryptProviderToken(
    encryptedToken,
    keyForVersion(keyring, keyVersion ?? 1),
  );
}
