import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Workspace-scoped real-time telemetry snapshot for polling clients.
 * Same payload shape the SSE stream used, so the client hook can switch
 * transports without touching consumers.
 */
export async function GET(request: Request) {
  try {
    const { workspaceId, userId, firstName, lastName } = await requireWorkspace();
    const rl = await rateLimit(clientKey(request, "telemetry", userId), 120, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
    const stats = await CrmService.getRealtimeStats(workspaceId, { firstName, lastName });

    return NextResponse.json({
      success: true,
      data: { type: "PULSE", ...stats },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ success: false, error: message }, { status: 401 });
  }
}
