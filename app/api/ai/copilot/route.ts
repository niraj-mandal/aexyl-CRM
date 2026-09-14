import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const rl = rateLimit(clientKey(request, "ai-copilot", userId), 20, 60);
    if (!rl.ok) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded — try again shortly" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
    const body: unknown = await request.json();
    const { prompt } = (body ?? {}) as { prompt?: unknown };

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    }

    // Bound prompt size so a client can't OOM the agent with a giant payload.
    const boundedPrompt = prompt.slice(0, 2000);

    const copilotResponse = await AiAgentService.processCopilotCommand(workspaceId, boundedPrompt);
    return NextResponse.json({ success: true, data: copilotResponse });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Copilot processing failed";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
