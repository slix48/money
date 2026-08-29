import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "moneyos_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createOpaqueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedDemoToken(
  userId: string,
  secret: string,
  now = Date.now(),
): string {
  const encodedUserId = Buffer.from(userId, "utf8").toString("base64url");
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  const payload = `${encodedUserId}.${expiresAt}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySignedDemoToken(
  token: string,
  secret: string,
  now = Date.now(),
): { userId: string; expiresAt: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedUserId, expiresAtValue, receivedSignature] = parts;
  const payload = `${encodedUserId}.${expiresAtValue}`;
  const expectedSignature = signature(payload, secret);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;

  try {
    const userId = Buffer.from(encodedUserId, "base64url").toString("utf8");
    return userId ? { userId, expiresAt } : null;
  } catch {
    return null;
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
