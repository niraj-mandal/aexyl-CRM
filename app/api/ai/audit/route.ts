import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const rl = rateLimit(clientKey(request, "ai-audit", userId), 6, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
    const audit = await AiAgentService.auditPipelineRisk(workspaceId);
    return NextResponse.json({ success: true, data: audit });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline audit failed";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
