import { Kanban } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { rupees } from "@/lib/stages";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { KanbanBoard } from "@/components/crm/KanbanBoard";
import { CreateDealButton } from "@/components/crm/CreateDealButton";
import { LiveRefresher } from "@/components/crm/LiveRefresher";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { workspaceId } = await requireWorkspace();
  const [deals, companies] = await Promise.all([
    CrmService.getPipeline(workspaceId),
    CrmService.getCompanies(workspaceId, 200),
  ]);

  const companyOptions = companies.map((c) => ({ id: c.id, name: c.name }));

  const totalPipelineValue = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const weightedPipelineValue = deals.reduce((sum, d) => sum + (Number(d.value || 0) * ((d.probability || 0) / 100)), 0);

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-80px)] animate-in fade-in duration-150">
      <LiveRefresher intervalMs={60000} />

      <PageHeader
        eyebrow="Sales"
        title="Pipeline"
        description="Drag deals between stages. Changes save instantly."
        actions={
          <>
            <div className="glass rounded-lg px-3.5 py-2">
              <p className="text-xs text-text-muted">Total</p>
              <p className="num text-base font-medium text-text-primary">{rupees(totalPipelineValue)}</p>
            </div>
            <div className="glass rounded-lg px-3.5 py-2">
              <p className="text-xs text-text-muted">Weighted</p>
              <p className="num text-base font-medium text-text-primary">{rupees(weightedPipelineValue)}</p>
            </div>
            <CreateDealButton companies={companyOptions} />
          </>
        }
      />

      {deals.length === 0 && (
        <div className="glass-panel shrink-0">
          <EmptyState
            icon={Kanban}
            title="No deals yet"
            body="When a gym says they're interested, mark them Interested from the Today list or Leads and a deal appears here automatically."
            action={{ href: "/sales/leads", label: "Go to Leads" }}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden min-h-0">
        <KanbanBoard initialDeals={deals} companyOptions={companyOptions} />
      </div>
    </div>
  );
}
