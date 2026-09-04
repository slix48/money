import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  decryptProviderTokenWithKeyring,
  encryptProviderTokenWithKeyring,
} from "@/lib/provider-token-crypto";

function requireKeyring() {
  if (!env.providerTokenKeyring) {
    throw new Error("Provider token encryption is not configured");
  }
  return env.providerTokenKeyring;
}

export function encryptProviderAccessToken(token: string) {
  return encryptProviderTokenWithKeyring(token, requireKeyring());
}

export async function decryptProviderAccessToken(input: {
  userId: string;
  connectionId: string;
  ciphertext: string;
  keyVersion?: number | null;
}): Promise<string> {
  const keyring = requireKeyring();
  const token = decryptProviderTokenWithKeyring(
    input.ciphertext,
    input.keyVersion,
    keyring,
  );
  const storedVersion = input.keyVersion ?? 1;
  if (storedVersion !== keyring.currentVersion) {
    const rotated = encryptProviderTokenWithKeyring(token, keyring);
    await prisma.financialConnection.updateMany({
      where: {
        id: input.connectionId,
        userId: input.userId,
        accessTokenEncrypted: input.ciphertext,
        tokenKeyVersion: input.keyVersion ?? null,
      },
      data: {
        accessTokenEncrypted: rotated.ciphertext,
        tokenKeyVersion: rotated.keyVersion,
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
      remainingOnOlderVersions: 0,
    };
  }
  const versions = await prisma.financialConnection.groupBy({
    by: ["tokenKeyVersion"],
    where: { accessTokenEncrypted: { not: null } },
    _count: { _all: true },
  });
  return {
    configured: true,
    currentVersion: keyring.currentVersion,
    connectionsByVersion: Object.fromEntries(
      versions.map((item) => [String(item.tokenKeyVersion ?? 1), item._count._all]),
    ),
    remainingOnOlderVersions: versions.reduce(
      (total, item) =>
        total + ((item.tokenKeyVersion ?? 1) === keyring.currentVersion ? 0 : item._count._all),
      0,
    ),
  };
}
