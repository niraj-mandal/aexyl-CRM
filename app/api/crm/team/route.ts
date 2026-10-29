import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/workspace";
import { ScoreboardService } from "@/services/scoreboard.service";

export const dynamic = "force-dynamic";

/** Admin-only: today's calls per team member and the state of their leads. */
export async function GET() {
  let workspaceId: string;
  try {
    ({ workspaceId } = await requireAdmin());
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await ScoreboardService.team(workspaceId));
}
