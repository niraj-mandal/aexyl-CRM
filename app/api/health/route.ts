import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Uptime/health probe (spec §1). Verifies the app can reach its database.
 * 200 = healthy, 503 = degraded. No auth: safe, non-sensitive payload only.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      db: "reachable",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "unreachable", latencyMs: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
