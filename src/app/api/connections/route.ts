import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { env } from "@/lib/env";
import { safeApiError } from "@/lib/security";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (env.demoMode) {
    return NextResponse.json({
      providerConfigured: false,
      demoMode: true,
      connections: [],
    }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { listFinancialConnections } = await import("@/sync/connection-service");
    return NextResponse.json({
      providerConfigured: env.plaidConfigured,
      demoMode: false,
      connections: await listFinancialConnections(user.id),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return safeApiError(error);
  }
}
