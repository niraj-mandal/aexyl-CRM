import { NextResponse } from "next/server";
import { getOutreachLeadsAction } from "@/app/actions/outreach.actions";
import { planToday } from "@/lib/today";

export const dynamic = "force-dynamic";

/**
 * The dashboard's Today panel, as a GET so it loads in parallel with other panels.
 * `?start=` is the browser's local midnight (ISO), so "today" is the user's day.
 */
export async function GET(req: Request) {
  const start = new Date(new URL(req.url).searchParams.get("start") ?? "");
  // Fall back to IST midnight if the browser didn't send a valid one.
  const IST = 330 * 60_000;
  const startOfToday = Number.isNaN(start.getTime())
    ? new Date(Math.floor((Date.now() + IST) / 86_400_000) * 86_400_000 - IST)
    : start;
  try {
    return NextResponse.json(planToday(await getOutreachLeadsAction(), startOfToday));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
