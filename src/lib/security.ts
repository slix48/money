import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

interface RateBucket {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  moneyOsRateBuckets?: Map<string, RateBucket>;
};

const buckets = globalForRateLimit.moneyOsRateBuckets ?? new Map<string, RateBucket>();
globalForRateLimit.moneyOsRateBuckets = buckets;

export function rateLimit(
  namespace: string,
  identifier: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const safeKey = createHash("sha256")
    .update(`${namespace}:${identifier}`)
    .digest("hex");
  const existing = buckets.get(safeKey);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(safeKey, bucket);

  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function requestIdentifier(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const allowedOrigins = new Set([new URL(env.APP_URL).origin]);
    if (env.NODE_ENV !== "production") {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const host = forwardedHost ?? request.headers.get("host");
      const forwardedProtocol = request.headers.get("x-forwarded-proto");
      allowedOrigins.add(requestUrl.origin);
      if (host && !/[\r\n]/.test(host)) {
        const protocol =
          forwardedProtocol === "https" ? "https:" : requestUrl.protocol;
        allowedOrigins.add(protocol + "//" + host);
      }
    }
    if (allowedOrigins.has(originUrl.origin)) return true;

    if (env.NODE_ENV === "development") {
      const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
      const allowedLoopback = [...allowedOrigins].some((value) => {
        const candidate = new URL(value);
        return loopbackHosts.has(candidate.hostname) && candidate.port === originUrl.port;
      });
      return loopbackHosts.has(originUrl.hostname) && allowedLoopback;
    }
    return false;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return NextResponse.json({ error: "Request origin rejected" }, { status: 403 });
}

export async function readJsonBody<T>(request: Request, maxBytes = 16_384): Promise<T> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== "application/json" &&
    !contentType?.endsWith("+json")
  ) {
    throw new Error("UNSUPPORTED_MEDIA_TYPE");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text) as T;
}

export function safeApiError(error: unknown): NextResponse {
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }
  if (error instanceof Error && error.message === "UNSUPPORTED_MEDIA_TYPE") {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  return NextResponse.json({ error: "Unable to complete the request" }, { status: 500 });
}
