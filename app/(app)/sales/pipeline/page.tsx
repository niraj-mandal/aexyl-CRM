import { Display, Body } from "@/components/ui/typography";
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
    <div className="space-y-8 flex flex-col h-[calc(100vh-80px)] animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={15000} />

      <div className="flex justify-between items-end flex-shrink-0">
        <section className="space-y-2">
          <Display>Pipeline</Display>
          <Body>Track and manage your deals. Drag cards between stages — changes persist instantly.</Body>
        </section>

        <div className="flex items-center space-x-6">
          <div>
            <div className="text-sm text-text-secondary">Total Value</div>
            <div className="text-xl font-light text-text-primary">${totalPipelineValue.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-sm text-text-secondary">Weighted Value</div>
            <div className="text-xl font-light text-text-primary">${weightedPipelineValue.toLocaleString()}</div>
          </div>
          <CreateDealButton companies={companyOptions} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        <KanbanBoard initialDeals={deals} companyOptions={companyOptions} />
      </div>
    </div>
  );
}
