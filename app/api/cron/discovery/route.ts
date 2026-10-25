import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { users, workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { DiscoveryOrchestrator } from "@/services/discovery/orchestrator";

export const dynamic = "force-dynamic";
// Discovery makes several slow third-party calls; the default function limit cuts it off mid-run.
export const maxDuration = 300;

const SYSTEM_CLERK_ID = "system-cron";

function bearerMatches(provided: string, secret: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function getSystemUserId(): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, SYSTEM_CLERK_ID),
  });
  if (existing) return existing.id;

  await db
    .insert(users)
    .values({
      clerkId: SYSTEM_CLERK_ID,
      email: "system@aexyl.local",
      firstName: "Aexyl",
      lastName: "System",
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, SYSTEM_CLERK_ID))
    .limit(1);
  return row.id;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  const token = provided?.startsWith("Bearer ") ? provided.slice(7) : null;

  if (!secret || !token || !bearerMatches(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];

  try {
    const systemUserId = await getSystemUserId();
    const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);

    for (const ws of allWorkspaces) {
      try {
        // This endpoint is scheduled for 6:00 AM IST itself (vercel.json), so skip the hour check.
        // If it fails, the later /api/cron/tick run retries it and sends the notification.
        const result = await DiscoveryOrchestrator.runDaily(ws.id, systemUserId, undefined, { ignoreTimeGate: true, retryLater: true });
        results.push({
          workspaceId: ws.id,
          status: result.status,
          created: result.created,
          discovered: result.discovered,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ws.id}: ${msg}`);
        logger.error("discovery cron workspace failed", { workspaceId: ws.id, error: msg });
        await captureError(err, { scope: "cron.discovery.workspace", workspaceId: ws.id });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`fatal: ${msg}`);
    logger.error("discovery cron fatal", { error: msg });
    await captureError(err, { scope: "cron.discovery.fatal" });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    results,
    errors,
    durationMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  }, { status: results.length > 0 ? 200 : 500 });
}
