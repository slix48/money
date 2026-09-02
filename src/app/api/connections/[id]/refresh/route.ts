import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/auth/dal";
import { NotFoundError } from "@/data/errors";
import { rateLimit, requireSameOrigin, safeApiError } from "@/lib/security";
import { entityIdSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const limit = rateLimit("connection-refresh", user.id, 3, 10 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "This connection was refreshed recently. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  try {
    const { enqueueSyncJob, processNextSyncJob } = await import("@/sync/sync-queue");
    const id = entityIdSchema.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invalid connection id" }, { status: 400 });
    const job = await enqueueSyncJob({
      userId: user.id,
      connectionId: id.data,
      trigger: "MANUAL",
      includeInvestments: true,
    });
    after(() => processNextSyncJob(job.id));
    return NextResponse.json(
      { status: job.status, jobId: job.id },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return safeApiError(error);
  }
}
