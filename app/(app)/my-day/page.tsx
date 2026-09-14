import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { SweepButton } from "@/components/crm/SweepButton";
import { CompleteTaskButton } from "@/components/crm/CompleteTaskButton";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Flame, ListTodo } from "lucide-react";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const { workspaceId } = await requireWorkspace();
  const queue = await CrmService.getPriorityQueue(workspaceId);
  const openTasks = await CrmService.getOpenTasks(workspaceId, 8);

  const followUpsDue = queue.followUpsDue ?? [];
  const hotLeads = queue.hotLeads ?? [];
  const staleLeads = queue.staleLeads ?? [];
  const dealsNeedingAttention = queue.dealsNeedingAttention ?? [];
  const wonRecently = queue.wonRecently ?? [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={15000} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <section className="space-y-2">
          <MonoLabel className="text-primary block mb-1">FOCUS // TODAY&apos;S OPERATING QUEUE</MonoLabel>
          <Display>My Day</Display>
          <Body>Follow-ups, hot leads, and deals that need you today — computed from live CRM state.</Body>
        </section>
        <SweepButton />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ListTodo className="h-4 w-4 text-primary" />
              <PageTitle>Agent Tasks</PageTitle>
            </div>
            <Badge variant="primary" className="font-mono-code text-[10px]">{openTasks.length}</Badge>
          </div>
          {openTasks.length === 0 ? (
            <GlassCard className="flex items-center justify-center min-h-[120px]">
              <Body className="text-center text-text-muted">No open tasks. Ask the Copilot to create one.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {openTasks.map((task) => (
                <GlassCard key={task.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-text-primary">{task.title}</h4>
                      <p className="text-[11px] text-text-muted mt-1">
                        {[task.priority !== "MEDIUM" ? task.priority : null, task.deal?.name, task.dueAt ? `due ${format(new Date(task.dueAt), "MMM d")}` : null]
                          .filter(Boolean)
                          .join(" · ") || "no due date"}
                        {task.createdBy === "copilot" && " · via Copilot"}
                      </p>
                      {task.description && <p className="text-[11px] text-text-muted mt-1 line-clamp-2">{task.description}</p>}
                    </div>
                    <CompleteTaskButton taskId={task.id} title={task.title} />
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <PageTitle>Follow-ups Due</PageTitle>
            <Badge variant="tertiary" className="font-mono-code text-[10px]">{followUpsDue.length}</Badge>
          </div>
          {followUpsDue.length === 0 ? (
            <GlassCard className="flex items-center justify-center min-h-[120px]">
              <Body className="text-center text-text-muted">No follow-ups due today.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {followUpsDue.map((lead) => (
                <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">
                          {lead.company?.name || "Unknown company"} · {lead.contact?.firstName} {lead.contact?.lastName}
                        </h4>
                        <p className="text-[11px] text-text-muted mt-1">
                          Due {lead.nextFollowUpAt ? format(new Date(lead.nextFollowUpAt), "MMM d, HH:mm") : "—"}
                          {lead.temperature === "HOT" && " · HOT"}
                        </p>
                      </div>
                      <Badge variant={lead.temperature === "HOT" ? "tertiary" : "outline"} className="font-mono-code text-[10px]">
                        {lead.temperature}
                      </Badge>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Flame className="h-4 w-4 text-danger" />
              <PageTitle>Hot Leads</PageTitle>
            </div>
            <Badge variant="tertiary" className="font-mono-code text-[10px]">{hotLeads.length}</Badge>
          </div>
          {hotLeads.length === 0 ? (
            <GlassCard className="flex items-center justify-center min-h-[120px]">
              <Body className="text-center text-text-muted">No hot leads right now.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {hotLeads.map((lead) => (
                <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">
                          {lead.company?.name || "Unknown company"}
                        </h4>
                        <p className="text-[11px] text-text-muted mt-1">
                          Score {lead.score}/100 · {lead.contact?.email || "no email"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-mono-code text-[10px]">{lead.score}</Badge>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-info" />
              <PageTitle>Stale Leads (7+ days quiet)</PageTitle>
            </div>
            <Badge variant="outline" className="font-mono-code text-[10px]">{staleLeads.length}</Badge>
          </div>
          {staleLeads.length === 0 ? (
            <GlassCard className="flex items-center justify-center min-h-[120px]">
              <Body className="text-center text-text-muted">All leads have recent contact.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {staleLeads.slice(0, 5).map((lead) => (
                <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-text-primary">
                        {lead.company?.name || "Unknown company"}
                      </h4>
                      <span className="text-[11px] text-text-muted">
                        {lead.lastContactedAt
                          ? `Last touch ${format(new Date(lead.lastContactedAt), "MMM d")}`
                          : "Never contacted"}
                      </span>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-tertiary" />
              <PageTitle>Deals Needing Attention</PageTitle>
            </div>
            <Badge variant="tertiary" className="font-mono-code text-[10px]">{dealsNeedingAttention.length}</Badge>
          </div>
          {dealsNeedingAttention.length === 0 ? (
            <GlassCard className="flex items-center justify-center min-h-[120px]">
              <Body className="text-center text-text-muted">No at-risk deals. Pipeline is healthy.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {dealsNeedingAttention.map((deal) => (
                <Link key={deal.id} href={`/sales/deals/${deal.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">{deal.name}</h4>
                        <p className="text-[11px] text-text-muted mt-1">
                          ${Number(deal.value || 0).toLocaleString()} · {deal.stage}
                          {deal.closesThisWeek
                            ? ` · closes ${format(new Date(deal.expectedCloseDate!), "MMM d")}`
                            : " · quiet 7+ days"}
                        </p>
                      </div>
                      <Badge variant={Number(deal.value || 0) > 50000 ? "tertiary" : "outline"} className="font-mono-code text-[10px]">
                        ${Number(deal.value || 0).toLocaleString()}
                      </Badge>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {wonRecently.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-4 w-4 text-secondary" />
            <PageTitle>Recently Won</PageTitle>
          </div>
          <div className="flex flex-wrap gap-3">
            {wonRecently.map((deal) => (
              <Link key={deal.id} href={`/sales/deals/${deal.id}`}>
                <GlassCard className="px-4 py-3 transition-all hover:border-secondary/40">
                  <span className="text-xs font-semibold text-text-primary">{deal.name}</span>
                  <span className="ml-3 text-[11px] text-secondary">
                    ${Number(deal.value || 0).toLocaleString()}
                  </span>
                </GlassCard>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
