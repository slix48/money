import "server-only";
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AuthenticatorTransport } from "@simplewebauthn/server";
import { verifyPasswordCredential } from "@/auth/password";
import { constantTimeEqual, hashSessionToken } from "@/auth/tokens";
import {
  NotFoundError,
  PasskeyVerificationError,
  ReauthenticationRequiredError,
} from "@/data/errors";
import type { UserSummary } from "@/domain/types";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

const CEREMONY_TTL_MS = 5 * 60 * 1_000;
const RECENT_MFA_MS = 15 * 60 * 1_000;
const SUPPORTED_ALGORITHMS = [-7, -257];

interface SessionIdentity {
  id: string;
  user: UserSummary;
  mfaVerifiedAt?: Date;
}

function relyingParty() {
  const origin = new URL(env.APP_URL).origin;
  return {
    origin,
    rpId: new URL(origin).hostname,
  };
}

function ceremonyToken(): string {
  return randomBytes(32).toString("base64url");
}

async function storeChallenge(input: {
  userId: string;
  sessionId?: string;
  challenge: string;
  purpose: "REGISTRATION" | "AUTHENTICATION";
}) {
  const token = ceremonyToken();
  const now = new Date();
  await prisma.$transaction(async (database) => {
    await database.webAuthnChallenge.deleteMany({
      where: {
        userId: input.userId,
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
    });
    await database.webAuthnChallenge.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        tokenHash: hashSessionToken(token),
        challenge: input.challenge,
        purpose: input.purpose,
        expiresAt: new Date(now.getTime() + CEREMONY_TTL_MS),
      },
    });
  });
  return token;
}

async function consumeChallenge(input: {
  userId: string;
  sessionId?: string;
  token: string;
  purpose: "REGISTRATION" | "AUTHENTICATION";
}): Promise<string> {
  return prisma.$transaction(async (database) => {
    const now = new Date();
    const stored = await database.webAuthnChallenge.findFirst({
      where: {
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        tokenHash: hashSessionToken(input.token),
        purpose: input.purpose,
        usedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true, challenge: true },
    });
    if (!stored) throw new PasskeyVerificationError();
    const consumed = await database.webAuthnChallenge.updateMany({
      where: { id: stored.id, userId: input.userId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) throw new PasskeyVerificationError();
    return stored.challenge;
  });
}

async function ownedPasswordHash(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new NotFoundError("User not found");
  return user.passwordHash;
}

function requireRecentMfa(session: SessionIdentity) {
  if (
    !session.mfaVerifiedAt ||
    Date.now() - session.mfaVerifiedAt.getTime() > RECENT_MFA_MS
  ) {
    throw new ReauthenticationRequiredError();
  }
}

export async function verifySensitiveAccountOperation(
  session: SessionIdentity,
  password: string,
): Promise<void> {
  const passwordHash = await ownedPasswordHash(session.user.id);
  if (!(await verifyPasswordCredential(passwordHash, password))) {
    throw new PasskeyVerificationError();
  }
  const credentialCount = await prisma.webAuthnCredential.count({
    where: { userId: session.user.id },
  });
  if (credentialCount > 0) requireRecentMfa(session);
}

export async function listPasskeys(userId: string) {
  return prisma.webAuthnCredential.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      credentialDeviceType: true,
      credentialBackedUp: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function beginPasskeyAuthentication(userId: string) {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (credentials.length === 0) return null;
  const { rpId } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
    timeout: CEREMONY_TTL_MS,
    userVerification: "required",
  });
  return {
    options,
    ceremonyToken: await storeChallenge({
      userId,
      challenge: options.challenge,
      purpose: "AUTHENTICATION",
    }),
    expiresAt: new Date(Date.now() + CEREMONY_TTL_MS),
  };
}

export async function beginPasskeyRegistration(
  session: SessionIdentity,
  password: string,
) {
  const passwordHash = await ownedPasswordHash(session.user.id);
  if (!(await verifyPasswordCredential(passwordHash, password))) {
    throw new PasskeyVerificationError();
  }
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: session.user.id },
    select: { credentialId: true, transports: true },
  });
  if (credentials.length > 0) requireRecentMfa(session);
  const { rpId } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: "MoneyOS",
    rpID: rpId,
    userID: new TextEncoder().encode(session.user.id),
    userName: session.user.email,
    userDisplayName: session.user.name,
    timeout: CEREMONY_TTL_MS,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
  });
  return {
    options,
    ceremonyToken: await storeChallenge({
      userId: session.user.id,
      sessionId: session.id,
      challenge: options.challenge,
      purpose: "REGISTRATION",
    }),
    expiresAt: new Date(Date.now() + CEREMONY_TTL_MS),
  };
}

export async function finishPasskeyRegistration(input: {
  session: SessionIdentity;
  ceremonyToken: string;
  name: string;
  response: RegistrationResponseJSON;
}) {
  const challenge = await consumeChallenge({
    userId: input.session.user.id,
    sessionId: input.session.id,
    token: input.ceremonyToken,
    purpose: "REGISTRATION",
  });
  const { origin, rpId } = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    });
  } catch {
    throw new PasskeyVerificationError();
  }
  if (!verification.verified) throw new PasskeyVerificationError();
  const info = verification.registrationInfo;
  const transports = input.response.response.transports ?? [];
  return prisma.$transaction(async (database) => {
    const existingCount = await database.webAuthnCredential.count({
      where: { userId: input.session.user.id },
    });
    const credential = await database.webAuthnCredential.create({
      data: {
        userId: input.session.user.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        transports,
        credentialDeviceType: info.credentialDeviceType,
        credentialBackedUp: info.credentialBackedUp,
        name: input.name,
      },
      select: {
        id: true,
        name: true,
        credentialDeviceType: true,
        credentialBackedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    if (existingCount === 0) {
      await database.session.updateMany({
        where: { id: input.session.id, userId: input.session.user.id },
        data: { mfaVerifiedAt: new Date() },
      });
      await database.session.deleteMany({
        where: { userId: input.session.user.id, id: { not: input.session.id } },
      });
    }
    await database.auditEvent.create({
      data: {
        userId: input.session.user.id,
        action: "PASSKEY_REGISTERED",
        entityType: "WebAuthnCredential",
        entityId: credential.id,
        metadata: {
          credentialDeviceType: info.credentialDeviceType,
          credentialBackedUp: info.credentialBackedUp,
          otherSessionsRevoked: existingCount === 0,
        },
      },
    });
    return credential;
  });
}

function userHandleMatches(userHandle: string | undefined, userId: string): boolean {
  if (!userHandle) return true;
  try {
    return constantTimeEqual(
      Buffer.from(userHandle, "base64url").toString("utf8"),
      userId,
    );
  } catch {
    return false;
  }
}

export async function finishPasskeyAuthentication(input: {
  ceremonyToken: string;
  response: AuthenticationResponseJSON;
}): Promise<UserSummary> {
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: input.response.id },
    select: {
      id: true,
      userId: true,
      credentialId: true,
      publicKey: true,
      counter: true,
      transports: true,
      user: { select: { id: true, name: true, email: true, isDemo: true } },
    },
  });
  if (!credential) throw new PasskeyVerificationError();
  const challenge = await consumeChallenge({
    userId: credential.userId,
    token: input.ceremonyToken,
    purpose: "AUTHENTICATION",
  });
  if (!userHandleMatches(input.response.response.userHandle, credential.userId)) {
    throw new PasskeyVerificationError();
  }
  const { origin, rpId } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
  } catch {
    throw new PasskeyVerificationError();
  }
  if (!verification.verified) throw new PasskeyVerificationError();
  const updated = await prisma.webAuthnCredential.updateMany({
    where: {
      id: credential.id,
      userId: credential.userId,
      counter: credential.counter,
    },
    data: {
      counter: verification.authenticationInfo.newCounter,
      credentialDeviceType: verification.authenticationInfo.credentialDeviceType,
      credentialBackedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new PasskeyVerificationError();
  return credential.user;
}

export async function deletePasskey(input: {
  session: SessionIdentity;
  credentialId: string;
  password: string;
}): Promise<void> {
  requireRecentMfa(input.session);
  const passwordHash = await ownedPasswordHash(input.session.user.id);
  if (!(await verifyPasswordCredential(passwordHash, input.password))) {
    throw new PasskeyVerificationError();
  }
  await prisma.$transaction(async (database) => {
    const count = await database.webAuthnCredential.count({
      where: { userId: input.session.user.id },
    });
    if (count < 2) {
      throw new ReauthenticationRequiredError(
        "Keep at least one passkey enrolled",
      );
    }
    const deleted = await database.webAuthnCredential.deleteMany({
      where: { id: input.credentialId, userId: input.session.user.id },
    });
    if (deleted.count !== 1) throw new NotFoundError("Passkey not found");
    await database.auditEvent.create({
      data: {
        userId: input.session.user.id,
        action: "PASSKEY_REMOVED",
        entityType: "WebAuthnCredential",
        entityId: input.credentialId,
      },
    });
  });
}

export async function pruneExpiredAuthenticationState(
  now = new Date(),
): Promise<{ challenges: number; sessions: number }> {
  const [challenges, sessions] = await prisma.$transaction([
    prisma.webAuthnChallenge.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
    }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { challenges: challenges.count, sessions: sessions.count };
}

export const passkeyPolicy = {
  ceremonyTtlMs: CEREMONY_TTL_MS,
  recentMfaMs: RECENT_MFA_MS,
};
