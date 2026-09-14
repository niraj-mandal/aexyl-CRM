import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import type { companies } from "@/db/schema";

type CreateCompanyBody = Partial<Omit<typeof companies.$inferInsert, "id" | "workspaceId" | "createdAt" | "updatedAt">>;

/** Keys a client may never set directly on create; server decides them. */
const PROTECTED_COMPANY_KEYS = new Set(["id", "workspaceId", "createdAt", "updatedAt"]);

function sanitizeCompanyBody(body: Record<string, unknown>): CreateCompanyBody {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PROTECTED_COMPANY_KEYS.has(key)) clean[key] = value;
  }
  return clean as CreateCompanyBody;
}

export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const companies = await CrmService.getCompanies(workspaceId, limit, offset);
    return NextResponse.json({ success: true, data: companies });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch companies";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, workspaceId } = await requireWorkspace();
    const body = sanitizeCompanyBody(await request.json());

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    }

    const company = await CrmService.createCompany(workspaceId, {
      ...body,
      name: body.name,
      // Ownership is decided server-side; a client-supplied ownerId is ignored.
      ownerId: userId,
    });

    return NextResponse.json({ success: true, data: company }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create company";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
