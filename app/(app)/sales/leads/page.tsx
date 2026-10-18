import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { DeleteLeadButton } from "@/components/crm/DeleteLeadButton";

// Columns for DataTable must match the data shape
// Note: TanStack Table usually wants these in a client component, but we can pass them down or define them client-side.
// For simplicity in Phase 2 without a separate columns file, we'll render a simpler generic table or 
// create a dedicated LeadsTable client component if we need complex cell rendering.
// Since we need to pass functions, let's just create a simple mapped table view here or use a dedicated Client component for the table.

import Link from "next/link";
import { MapPin } from "lucide-react";
import { googleMapsUrl, placeFromLeadSource } from "@/lib/maps";
import { LeadOutcomeSelect, LeadPhoneEditor } from "@/components/crm/LeadQuickActions";

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  NURTURE: "Nurture",
  CONVERTED: "Converted",
  LOST: "Lost",
  UNQUALIFIED: "Unqualified",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [leads, totalLeads, leadCounts] = await Promise.all([
    CrmService.getLeads(workspaceId, PAGE_SIZE, (page - 1) * PAGE_SIZE),
    CrmService.countLeads(workspaceId),
    CrmService.getLeadCounts(workspaceId),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalLeads / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // Metrics come from real SQL counts across the whole table — not the page slice.
  const total = leadCounts.total;
  const newLeads = leadCounts.new;
  const hotLeads = leadCounts.hot;

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <section className="space-y-1">
          <Display>Leads</Display>
          <Body>
            {total} lead{total === 1 ? "" : "s"} · {newLeads} new · <span className="text-danger">{hotLeads} hot</span>
          </Body>
        </section>

        <div className="flex items-center gap-3">
          <a
            href="/api/leads/export"
            className="border border-border-subtle text-text-primary px-4 py-2 rounded-md font-medium text-sm hover:border-primary/50 transition"
          >
            Export CSV
          </a>
          <Link
            href="/sales/leads/new"
            className="bg-text-primary text-background px-4 py-2 rounded-md font-medium text-sm hover:bg-text-secondary transition"
          >
            + Add Lead
          </Link>
        </div>
      </div>

      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Temperature</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Owner</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {leads.length > 0 ? leads.map(lead => (
                <tr key={lead.id} className="hover:bg-surface-elevated/30 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/sales/leads/${lead.id}`} className="font-medium text-text-primary hover:underline">
                        {lead.company?.name || "Unknown"}
                      </Link>
                      {lead.company?.name && (
                        <a
                          href={googleMapsUrl(lead.company.name, lead.company.location || placeFromLeadSource(lead.source))}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Google Business Profile"
                          aria-label={`Open ${lead.company.name} on Google Maps`}
                          className="inline-flex items-center gap-1 rounded border border-border-subtle px-1.5 py-0.5 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
                        >
                          <MapPin className="h-3 w-3" /> Maps
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {lead.contact && !/^team\b/i.test(lead.contact.firstName) && (
                        <span>{lead.contact.firstName} {lead.contact.lastName}</span>
                      )}
                      <LeadPhoneEditor leadId={lead.id} phone={lead.contact?.phone ?? null} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-surface-elevated text-xs rounded-md border border-border-subtle">
                      {STATUS_LABEL[lead.status] ?? lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-md border ${
                      lead.temperature === 'HOT' ? 'bg-danger/10 text-danger border-danger/20' : 
                      lead.temperature === 'WARM' ? 'bg-warning/10 text-warning border-warning/20' : 
                      'bg-surface-elevated text-text-secondary border-border-subtle'
                    }`}>
                      {lead.temperature}
                    </span>
                  </td>
                  <td className="px-4 py-3">{lead.score}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{lead.owner?.firstName}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <LeadOutcomeSelect leadId={lead.id} compact />
                      <DeleteLeadButton leadId={lead.id} leadName={lead.company?.name || "this lead"} />
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-text-muted">
                    No leads yet. Your sales pipeline will appear here once prospects are added.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalLeads)} of {totalLeads}
          </span>
          <div className="flex items-center gap-2">
            {safePage > 1 && (
              <Link href={`/sales/leads?page=${safePage - 1}`} className="px-3 py-1.5 rounded-md border border-border-subtle hover:border-primary/50 transition">
                ← Prev
              </Link>
            )}
            <span className="font-mono-code">{safePage} / {totalPages}</span>
            {safePage < totalPages && (
              <Link href={`/sales/leads?page=${safePage + 1}`} className="px-3 py-1.5 rounded-md border border-border-subtle hover:border-primary/50 transition">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
