import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { LogActivityForm } from "@/components/crm/LogActivityForm";
import { ActivityService } from "@/services/activity.service";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { format } from "date-fns";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: dealId } = await params;

  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)),
    with: {
      company: true,
      owner: true,
    }
  });

  if (!deal) notFound();

  const activities = await ActivityService.getActivitiesForEntity(workspaceId, 'dealId', dealId);

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-start">
        <section className="space-y-2">
          <Display>{deal.name}</Display>
          <div className="flex space-x-3 text-sm">
            <span className="text-text-secondary">{deal.company?.name || "No Company"}</span>
            <span className="text-border-strong">•</span>
            <span className="text-text-secondary">Owner: {deal.owner?.firstName || "Unassigned"}</span>
          </div>
        </section>

        <LogActivityForm entityType="deal" entityId={dealId} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <GlassPanel className="p-6">
            <h3 className="text-lg font-medium text-text-primary mb-6">Activity Timeline</h3>
            <ActivityTimeline activities={activities} />
          </GlassPanel>
        </div>

        <div className="space-y-6">
          <GlassCard className="p-5 bg-gradient-to-br from-surface to-surface-elevated">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Value</h4>
            <div className="text-4xl font-light text-text-primary mb-1">
              ${Number(deal.value || 0).toLocaleString()}
            </div>
            <div className="text-sm text-text-secondary">
              {deal.currency}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Pipeline Status</h4>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-text-secondary mb-1">Stage</div>
                <div className="font-medium text-text-primary px-2 py-1 bg-surface-elevated border border-border-subtle rounded-md inline-block">
                  {deal.stage}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Probability</div>
                <div className="font-medium text-text-primary">
                  {deal.probability}%
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Expected Close</div>
                <div className="font-medium text-text-primary">
                  {deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), "MMM d, yyyy") : "Not set"}
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
