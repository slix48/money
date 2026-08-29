import "server-only";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_USER_ID } from "@/domain/demo-data";
import type { UserSummary } from "@/domain/types";
import { env } from "@/lib/env";
import { verifyPassword } from "@/auth/password";
import {
  constantTimeEqual,
  createOpaqueSessionToken,
  createSignedDemoToken,
  hashSessionToken,
  SESSION_TTL_SECONDS,
  verifySignedDemoToken,
} from "@/auth/tokens";

export async function authenticateCredentials(
  email: string,
  password: string,
): Promise<UserSummary | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (env.demoMode) {
    if (
      !constantTimeEqual(normalizedEmail, DEMO_EMAIL) ||
      !constantTimeEqual(password, DEMO_PASSWORD)
    ) {
      return null;
    }
    return {
      id: DEMO_USER_ID,
      name: "Alex Morgan",
      email: DEMO_EMAIL,
      isDemo: true,
    };
  }

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true, isDemo: true, passwordHash: true },
  });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) return null;
  return { id: user.id, name: user.name, email: user.email, isDemo: user.isDemo };
}

export async function createSession(userId: string): Promise<string> {
  if (env.demoMode) {
    if (userId !== DEMO_USER_ID) throw new Error("User not found");
    return createSignedDemoToken(userId, env.sessionSecret);
  }

  const token = createOpaqueSessionToken();
  const { prisma } = await import("@/lib/db");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });
  return token;
}

export async function resolveSession(token?: string): Promise<UserSummary | null> {
  if (!token) return null;
  if (env.demoMode) {
    const session = verifySignedDemoToken(token, env.sessionSecret);
    if (!session || session.userId !== DEMO_USER_ID) return null;
    return {
      id: DEMO_USER_ID,
      name: "Alex Morgan",
      email: DEMO_EMAIL,
      isDemo: true,
    };
  }

  const { prisma } = await import("@/lib/db");
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, name: true, email: true, isDemo: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session.user;
}

export async function invalidateSession(token?: string): Promise<void> {
  if (!token || env.demoMode) return;
  const { prisma } = await import("@/lib/db");
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}
