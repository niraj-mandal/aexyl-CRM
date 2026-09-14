import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { GlassCard } from "@/components/ui/glass-card";

// Columns for DataTable must match the data shape
// Note: TanStack Table usually wants these in a client component, but we can pass them down or define them client-side.
// For simplicity in Phase 2 without a separate columns file, we'll render a simpler generic table or 
// create a dedicated LeadsTable client component if we need complex cell rendering.
// Since we need to pass functions, let's just create a simple mapped table view here or use a dedicated Client component for the table.

import Link from "next/link";

export default async function LeadsPage() {
  const { workspaceId } = await requireWorkspace();
  const [leads, leadCounts] = await Promise.all([
    CrmService.getLeads(workspaceId, 500),
    CrmService.getLeadCounts(workspaceId),
  ]);

  // Metrics come from real SQL counts across the whole table — not the page slice.
  const total = leadCounts.total;
  const newLeads = leadCounts.new;
  const hotLeads = leadCounts.hot;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-end">
        <section className="space-y-2">
          <Display>Leads</Display>
          <Body>Manage your top-of-funnel prospects.</Body>
        </section>
        
        {/* We would typically use a Dialog here. For Phase 2, we'll just put a simple "Create Lead" card or button that navigates to a create page, or render the form directly. */}
        <Link 
          href="/sales/leads/new" 
          className="bg-text-primary text-background px-4 py-2 rounded-md font-medium text-sm hover:bg-text-secondary transition"
        >
          + Add Lead
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <div className="text-sm text-text-secondary">Total Leads</div>
          <div className="text-3xl font-light mt-1">{total}</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-sm text-text-secondary">New</div>
          <div className="text-3xl font-light mt-1">{newLeads}</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-sm text-text-secondary">Hot</div>
          <div className="text-3xl font-light mt-1 text-danger">{hotLeads}</div>
        </GlassCard>
      </div>

      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium">Contact</th>
                <th className="px-6 py-4 font-medium">Stage</th>
                <th className="px-6 py-4 font-medium">Temp</th>
                <th className="px-6 py-4 font-medium">Score</th>
                <th className="px-6 py-4 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {leads.length > 0 ? leads.map(lead => (
                <tr key={lead.id} className="hover:bg-surface-elevated/30 transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/sales/leads/${lead.id}`} className="font-medium text-text-primary hover:underline">
                      {lead.company?.name || "Unknown"}
                    </Link>
                  </td>
                  <td className="px-6 py-4">{lead.contact?.firstName} {lead.contact?.lastName}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-surface-elevated text-xs rounded-md border border-border-subtle">
                      {lead.stage || "N/A"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-md border ${
                      lead.temperature === 'HOT' ? 'bg-danger/10 text-danger border-danger/20' : 
                      lead.temperature === 'WARM' ? 'bg-warning/10 text-warning border-warning/20' : 
                      'bg-surface-elevated text-text-secondary border-border-subtle'
                    }`}>
                      {lead.temperature}
                    </span>
                  </td>
                  <td className="px-6 py-4">{lead.score}</td>
                  <td className="px-6 py-4">{lead.owner?.firstName}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-text-muted">
                    No leads yet. Your sales pipeline will appear here once prospects are added.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
