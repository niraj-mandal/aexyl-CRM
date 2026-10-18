import { NextResponse } from "next/server";
import { actionNeededSummaryAction, attentionCountAction } from "@/app/actions/agents.actions";
import { listNotificationsAction } from "@/app/actions/production.actions";

export const dynamic = "force-dynamic";

/**
 * One snapshot for all always-visible chrome (sidebar badges, header approval
 * pin, notification bell). A plain GET, unlike server actions, doesn't queue
 * behind or block the user's own server-action calls.
 */
export async function GET() {
  try {
    const [summary, attention, notifications] = await Promise.allSettled([
      actionNeededSummaryAction(),
      attentionCountAction(),
      listNotificationsAction(),
    ]);
    if (notifications.status === "rejected" && summary.status === "rejected") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({
      pending: summary.status === "fulfilled" ? summary.value.pending : 0,
      failedRuns: summary.status === "fulfilled" ? summary.value.failedRuns : 0,
      attention: attention.status === "fulfilled" ? attention.value.count : 0,
      unread: notifications.status === "fulfilled" ? notifications.value.unread : 0,
      items: notifications.status === "fulfilled" ? notifications.value.items : [],
    });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}
