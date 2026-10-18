import { NextResponse } from "next/server";
import { getOutreachLeadsAction } from "@/app/actions/outreach.actions";

export const dynamic = "force-dynamic";

/** Lead list for the dashboard's Today panel, as a GET so it loads in parallel with other panels. */
export async function GET() {
  try {
    return NextResponse.json(await getOutreachLeadsAction());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
