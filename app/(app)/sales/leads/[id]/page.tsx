import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { LogActivityForm } from "@/components/crm/LogActivityForm";
import { ConvertLeadButton } from "@/components/crm/ConvertLeadButton";
import { ActivityService } from "@/services/activity.service";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: leadId } = await params;

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)),
    with: {
      company: true,
      contact: true,
      owner: true,
    }
  });

  if (!lead) notFound();

  const activities = await ActivityService.getActivitiesForEntity(workspaceId, 'leadId', leadId);

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-start">
        <section className="space-y-2">
          <Display>{lead.company?.name} / {lead.contact?.firstName} {lead.contact?.lastName}</Display>
          <div className="flex space-x-3 text-sm">
            <span className="text-text-secondary">Owner: {lead.owner?.firstName || "Unassigned"}</span>
            <span className="text-border-strong">•</span>
            <span className="text-text-secondary">Source: {lead.source || "Unknown"}</span>
          </div>
        </section>

        <div className="flex flex-col items-end space-y-3">
          <div className="flex space-x-3">
            <LogActivityForm entityType="lead" entityId={leadId} />
            {lead.status !== "CONVERTED" && (
              <ConvertLeadButton leadId={leadId} companyName={lead.company?.name || "Prospect"} />
            )}
          </div>
          {lead.status === "CONVERTED" && (
            <span className="text-[11px] font-mono-code text-secondary">LEAD CONVERTED — see pipeline</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <GlassPanel className="p-6">
            <h3 className="text-lg font-medium text-text-primary mb-6">Activity Timeline</h3>
            <ActivityTimeline activities={activities} />
          </GlassPanel>
        </div>

        <div className="space-y-6">
          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Lead Status</h4>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-text-secondary mb-1">Stage</div>
                <div className="font-medium text-text-primary">{lead.stage}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Temperature</div>
                <div className={`font-medium ${
                  lead.temperature === 'HOT' ? 'text-danger' : 
                  lead.temperature === 'WARM' ? 'text-warning' : 'text-text-primary'
                }`}>
                  {lead.temperature}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Score</div>
                <div className="text-2xl font-light text-text-primary">{lead.score}</div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Contact Info</h4>
            {lead.contact ? (
              <div className="space-y-3">
                {lead.contact.email && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">Email</div>
                    <a href={`mailto:${lead.contact.email}`} className="text-sm text-text-primary hover:underline">{lead.contact.email}</a>
                  </div>
                )}
                {lead.contact.phone && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">Phone</div>
                    <a href={`tel:${lead.contact.phone}`} className="text-sm text-text-primary hover:underline">{lead.contact.phone}</a>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">No contact assigned.</div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
