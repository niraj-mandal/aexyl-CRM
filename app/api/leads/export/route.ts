import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV export of the workspace's leads.
 * Authenticated via Clerk like every other API route; rate-limited because
 * a full-table serialize is heavier than the JSON endpoints. Only leads in
 * the caller's workspace are ever included (workspace scoping in the service).
 */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  // Quote only when needed; escape embedded quotes per RFC 4180.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    const rl = await rateLimit(clientKey(request, "leads-export", userId), 6, 60);
    if (!rl.ok) {
      return new Response(JSON.stringify({ success: false, error: "Rate limit exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) },
      });
    }

    const leads = await CrmService.getLeads(workspaceId, 5000);

    const header = [
      "company",
      "contact_name",
      "contact_email",
      "status",
      "stage",
      "temperature",
      "score",
      "source",
      "last_contacted_at",
      "next_follow_up_at",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const lead of leads) {
      const contactName = lead.contact
        ? `${lead.contact.firstName ?? ""} ${lead.contact.lastName ?? ""}`.trim()
        : "";
      lines.push(
        [
          lead.company?.name ?? "",
          contactName,
          lead.contact?.email ?? "",
          lead.status,
          lead.stage ?? "",
          lead.temperature,
          lead.score,
          lead.source ?? "",
          lead.lastContactedAt ?? "",
          lead.nextFollowUpAt ?? "",
          lead.createdAt ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Clerk middleware already redirects unauthenticated users; anything else
    // is an unexpected failure — generic 500 without internals.
    return new Response(JSON.stringify({ success: false, error: "Export failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
