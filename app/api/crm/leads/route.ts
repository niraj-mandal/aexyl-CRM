import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { LeadScoringService } from "@/services/sales/lead-scoring.service";
import type { leads } from "@/db/schema";

type CreateLeadBody = Partial<Omit<typeof leads.$inferInsert, "id" | "workspaceId" | "score" | "createdAt" | "updatedAt">>;

/** Keys a client may never set directly on create; server decides them. */
const PROTECTED_LEAD_KEYS = new Set([
  "id",
  "workspaceId",
  "createdAt",
  "updatedAt",
]);

function sanitizeLeadBody(body: Record<string, unknown>): CreateLeadBody {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PROTECTED_LEAD_KEYS.has(key)) clean[key] = value;
  }
  return clean as CreateLeadBody;
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const leads = await CrmService.getLeads(workspaceId, limit, offset);
    return NextResponse.json({ success: true, data: leads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch leads";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId } = await requireWorkspace();
    const body = sanitizeLeadBody(await request.json());

    const score = LeadScoringService.calculateScore(body, undefined);

    const lead = await CrmService.createLead(workspaceId, {
      ...body,
      score,
      // Ownership is decided server-side; a client-supplied ownerId is ignored.
      ownerId: userId,
    });

    return NextResponse.json({ success: true, data: lead }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create lead";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
