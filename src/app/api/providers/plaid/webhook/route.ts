import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";

const MAX_WEBHOOK_BYTES = 64 * 1_024;

export async function POST(request: Request) {
  if (!env.plaidConfigured) {
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    const [{ prisma }, { getFinancialDataProvider }, { markConnectionDisconnected }, syncQueue] = await Promise.all([
      import("@/lib/db"),
      import("@/providers/registry"),
      import("@/sync/connection-service"),
      import("@/sync/sync-queue"),
    ]);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_WEBHOOK_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    const provider = await getFinancialDataProvider("PLAID");
    const verified = await provider.verifyWebhook(body, {
      "plaid-verification": request.headers.get("plaid-verification") ?? "",
    });
    if (!verified.providerItemId || verified.event === "IGNORED") {
      return NextResponse.json({ received: true });
    }
    const connection = await prisma.financialConnection.findUnique({
      where: {
        provider_providerItemId: {
          provider: "PLAID",
          providerItemId: verified.providerItemId,
        },
      },
      select: { id: true, userId: true, status: true },
    });
    if (!connection) return NextResponse.json({ received: true });
    if (verified.event === "CONNECTION_REMOVED") {
      if (connection.status === "DISCONNECTED") {
        return NextResponse.json({ received: true });
      }
      await markConnectionDisconnected(connection.userId, connection.id, "PROVIDER_REVOKED");
      return NextResponse.json({ received: true });
    }
    if (verified.event === "CONNECTION_ERROR" || verified.event === "CONSENT_EXPIRING") {
      await prisma.financialConnection.updateMany({
        where: { id: connection.id, userId: connection.userId },
        data: {
          status: "NEEDS_ATTENTION",
          errorCode: verified.event,
          errorMessageSafe:
            verified.event === "CONSENT_EXPIRING"
              ? "This institution needs renewed consent."
              : "This institution needs to be reconnected.",
        },
      });
      return NextResponse.json({ received: true });
    }
    if (["DISCONNECTING", "DISCONNECTED"].includes(connection.status)) {
      return NextResponse.json({ received: true });
    }
    const job = await syncQueue.enqueueSyncJob({
      userId: connection.userId,
      connectionId: connection.id,
      trigger: "WEBHOOK",
      dedupeToken: verified.providerEventId,
      includeInvestments: verified.event === "INVESTMENTS_AVAILABLE",
    });
    after(() => syncQueue.processNextSyncJob(job.id));
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Webhook rejected" }, { status: 401 });
  }
}
