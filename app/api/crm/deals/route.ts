import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import type { deals } from "@/db/schema";
import { redactDeal } from "@/lib/redact";
import { assertOwnsDeal } from "@/lib/auth/access";

type CreateDealBody = Partial<Omit<typeof deals.$inferInsert, "id" | "workspaceId" | "createdAt" | "updatedAt">>;

/** Keys a client may never set directly on create; server decides them. */
const PROTECTED_DEAL_KEYS = new Set([
  "id",
  "workspaceId",
  "createdAt",
  "updatedAt",
  "score" as string, // defensive: not a deals column, kept for symmetry
]);

function sanitizeDealBody(body: Record<string, unknown>): CreateDealBody {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PROTECTED_DEAL_KEYS.has(key)) clean[key] = value;
  }
  return clean as CreateDealBody;
}

const VALID_STAGES = new Set([
  "QUALIFIED",
  "CALL_BOOKED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
]);

export async function GET() {
  try {
    const { workspaceId, userId, isSales } = await requireWorkspace();
    const pipelineDeals = await CrmService.getPipeline(workspaceId, isSales ? userId : undefined);
    return NextResponse.json({ success: true, data: isSales ? pipelineDeals.map(redactDeal) : pipelineDeals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch deals";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId, isSales } = await requireWorkspace();
    const body = sanitizeDealBody(await request.json());
    if (isSales) delete body.value; // Sales members can't set deal values.

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }
    if (body.stage !== undefined && !(typeof body.stage === "string" && VALID_STAGES.has(body.stage))) {
      return NextResponse.json(
        { success: false, error: `Invalid stage. Must be one of: ${[...VALID_STAGES].join(", ")}` },
        { status: 400 }
      );
    }

    const deal = await CrmService.createDeal(workspaceId, {
      ...body,
      name: body.name,
      stage: body.stage ?? "QUALIFIED",
      // Ownership is decided server-side; a client-supplied ownerId is ignored.
      ownerId: userId,
    });

    return NextResponse.json({ success: true, data: isSales ? redactDeal(deal) : deal }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create deal";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { workspaceId, userId, isSales } = await requireWorkspace();
    const body: unknown = await request.json();
    const { dealId, stage } = (body ?? {}) as { dealId?: unknown; stage?: unknown };
    if (typeof dealId === "string") await assertOwnsDeal({ workspaceId, userId, isSales }, dealId);

    if (typeof dealId !== "string" || typeof stage !== "string") {
      return NextResponse.json(
        { success: false, error: "dealId and stage are required" },
        { status: 400 }
      );
    }

    if (!VALID_STAGES.has(stage)) {
      return NextResponse.json(
        { success: false, error: `Invalid stage. Must be one of: ${[...VALID_STAGES].join(", ")}` },
        { status: 400 }
      );
    }

    const updatedDeal = await CrmService.updateDealStage(workspaceId, dealId, stage);
    if (!updatedDeal) {
      return NextResponse.json({ success: false, error: "Deal not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: isSales ? redactDeal(updatedDeal) : updatedDeal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update deal stage";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
