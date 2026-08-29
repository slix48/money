import { NextResponse } from "next/server";
import { createSession } from "@/auth/auth-service";
import { setSessionCookie } from "@/auth/cookies";
import { hashPassword } from "@/auth/password";
import { DEFAULT_CATEGORIES } from "@/domain/demo-data";
import { env } from "@/lib/env";
import {
  rateLimit,
  readJsonBody,
  requestIdentifier,
  requireSameOrigin,
  safeApiError,
} from "@/lib/security";
import { registrationSchema } from "@/lib/validation";

const categoryIcons: Record<string, string> = {
  Housing: "House",
  Food: "ShoppingBasket",
  Dining: "Utensils",
  Transportation: "Car",
  Shopping: "ShoppingBag",
  Entertainment: "Clapperboard",
  Health: "HeartPulse",
  Education: "GraduationCap",
  Travel: "Plane",
  Utilities: "Zap",
  Subscriptions: "RefreshCw",
  Insurance: "Shield",
  Income: "WalletCards",
  Investments: "ChartNoAxesCombined",
  Transfers: "ArrowLeftRight",
  Other: "Shapes",
};

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (env.demoMode) {
    return NextResponse.json({ error: "Registration is disabled in demo mode." }, { status: 403 });
  }
  const limit = rateLimit("registration", requestIdentifier(request), 4, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = registrationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Check the account details and password requirements." },
        { status: 400 },
      );
    }
    const { prisma } = await import("@/lib/db");
    const passwordHash = await hashPassword(parsed.data.password);
    const normalizedEmail = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: normalizedEmail,
        passwordHash,
        categories: {
          create: DEFAULT_CATEGORIES.map((category) => ({
            name: category.name,
            kind: category.kind,
            color: category.color,
            icon: categoryIcons[category.name] ?? "Shapes",
            isDefault: true,
          })),
        },
      },
      select: { id: true, name: true, email: true, isDemo: true },
    });
    const token = await createSession(user.id);
    const response = NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return safeApiError(error);
  }
}
