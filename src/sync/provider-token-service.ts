import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  LOCAL_PROVIDER_TOKEN_SCHEME,
  LocalKeyringProviderTokenCipher,
  type ProviderTokenCipher,
} from "@/lib/provider-token-crypto";

function requireKeyring() {
  if (!env.providerTokenKeyring) {
    throw new Error("Provider token encryption is not configured");
  }
  return env.providerTokenKeyring;
}

function providerTokenCipher(): ProviderTokenCipher {
  return new LocalKeyringProviderTokenCipher(requireKeyring());
}

export function encryptProviderAccessToken(token: string) {
  const cipher = providerTokenCipher();
  return {
    ...cipher.encrypt(token),
    encryptionScheme: cipher.scheme,
  };
}

export async function decryptProviderAccessToken(input: {
  userId: string;
  connectionId: string;
  ciphertext: string;
  keyVersion?: number | null;
  encryptionScheme?: string | null;
}): Promise<string> {
  const cipher = providerTokenCipher();
  const scheme = input.encryptionScheme ?? LOCAL_PROVIDER_TOKEN_SCHEME;
  if (scheme !== cipher.scheme) {
    throw new Error("Provider token encryption scheme is unavailable");
  }
  const token = cipher.decrypt(input.ciphertext, input.keyVersion);
  const storedVersion = input.keyVersion ?? 1;
  if (storedVersion !== cipher.currentKeyVersion) {
    const rotated = cipher.encrypt(token);
    await prisma.financialConnection.updateMany({
      where: {
        id: input.connectionId,
        userId: input.userId,
        accessTokenEncrypted: input.ciphertext,
        tokenKeyVersion: input.keyVersion ?? null,
        tokenEncryptionScheme: scheme,
      },
      data: {
        accessTokenEncrypted: rotated.ciphertext,
        tokenKeyVersion: rotated.keyVersion,
        tokenEncryptionScheme: cipher.scheme,
      },
    });
  }
  return token;
}

export async function getProviderTokenRotationHealth() {
  const keyring = env.providerTokenKeyring;
  if (!keyring) {
    return {
      configured: false,
      currentVersion: null,
      connectionsByVersion: {},
      connectionsByScheme: {},
      remainingOnOlderVersions: 0,
    };
  }
  const versions = await prisma.financialConnection.groupBy({
    by: ["tokenEncryptionScheme", "tokenKeyVersion"],
    where: { accessTokenEncrypted: { not: null } },
    _count: { _all: true },
  });
  return {
    configured: true,
    currentVersion: keyring.currentVersion,
    connectionsByVersion: versions.reduce<Record<string, number>>((totals, item) => {
      const version = String(item.tokenKeyVersion ?? 1);
      totals[version] = (totals[version] ?? 0) + item._count._all;
      return totals;
    }, {}),
    connectionsByScheme: Object.fromEntries(
      Object.entries(
        versions.reduce<Record<string, number>>((totals, item) => {
          totals[item.tokenEncryptionScheme] =
            (totals[item.tokenEncryptionScheme] ?? 0) + item._count._all;
          return totals;
        }, {}),
      ),
    ),
    remainingOnOlderVersions: versions.reduce(
      (total, item) =>
        total + ((item.tokenKeyVersion ?? 1) === keyring.currentVersion ? 0 : item._count._all),
      0,
    ),
  };
}
