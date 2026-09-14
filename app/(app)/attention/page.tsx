import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { SweepButton } from "@/components/crm/SweepButton";
import Link from "next/link";
import { AlertCircle, FileWarning, Clock, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const severityBadge = {
  HIGH: { variant: "tertiary" as const, label: "HIGH" },
  WARNING: { variant: "tertiary" as const, label: "WARN" },
  NORMAL: { variant: "secondary" as const, label: "OK" },
  LOW: { variant: "outline" as const, label: "LOW" },
  EXPANSION: { variant: "primary" as const, label: "GROWTH" },
};

export default async function AttentionPage() {
  const { workspaceId } = await requireWorkspace();
  const audit = await AiAgentService.auditPipelineRisk(workspaceId);

  const risks = audit.insights.filter((i) => i.severity === "HIGH" || i.severity === "WARNING");
  const normals = audit.insights.filter((i) => i.severity === "NORMAL" || i.severity === "EXPANSION" || i.severity === "LOW");

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={20000} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <section className="space-y-2">
          <MonoLabel className="text-danger block mb-1">RISK ENGINE // COMPUTED FROM LIVE PIPELINE</MonoLabel>
          <Display>Attention</Display>
          <Body>Critical items, risks, and follow-ups — audited {format(new Date(audit.auditedAt), "HH:mm:ss")}.</Body>
        </section>
        <SweepButton label="Sweep Stale Follow-ups" />
      </div>

      {/* Risk conditions */}
      <section className="space-y-4">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-danger" />
          <PageTitle>Requires Action ({risks.length})</PageTitle>
        </div>
        {risks.length === 0 ? (
          <GlassCard className="flex items-center justify-center min-h-[120px]">
            <Body className="text-center text-text-muted">No high-severity risks. Pipeline is healthy.</Body>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {risks.map((risk) => (
              <GlassPanel key={risk.id} className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant={severityBadge[risk.severity].variant}>{severityBadge[risk.severity].label}</Badge>
                  <span className="font-mono-code text-[10px] text-text-muted">{risk.preset}</span>
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{risk.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{risk.description}</p>
                {risk.detailUrl && (
                  <Link
                    href={risk.detailUrl}
                    className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                  >
                    {risk.actionLabel} →
                  </Link>
                )}
              </GlassPanel>
            ))}
          </div>
        )}
      </section>

      {/* Stalled deals table */}
      {audit.stalledDealDetails.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center space-x-2">
            <FileWarning className="w-5 h-5 text-tertiary" />
            <PageTitle>Stalled Deals ({audit.stalledDealDetails.length})</PageTitle>
          </div>
          <GlassPanel className="p-4 space-y-2.5">
            {audit.stalledDealDetails.map((d) => (
              <Link key={d.id} href={`/sales/deals/${d.id}`} className="block">
                <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3 hover:border-primary/40 transition-colors">
                  <div>
                    <span className="text-xs font-semibold text-text-primary">{d.name}</span>
                    <span className="ml-3 text-[11px] text-text-muted">
                      {d.company} · idle {d.daysSinceUpdate}d
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-tertiary">${d.value.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </GlassPanel>
        </section>
      )}

      {/* Informational / healthy signals */}
      <section className="space-y-4">
        <div className="flex items-center space-x-2">
          <Clock className="w-5 h-5 text-info" />
          <PageTitle>Watch List ({normals.length})</PageTitle>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {normals.map((item) => (
            <GlassCard key={item.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Badge variant={severityBadge[item.severity].variant}>{severityBadge[item.severity].label}</Badge>
                <span className="font-mono-code text-[10px] text-text-muted">{item.preset}</span>
              </div>
              <h4 className="text-xs font-semibold text-text-primary mb-1">{item.title}</h4>
              <p className="text-[11px] text-text-secondary leading-relaxed">{item.description}</p>
              {item.detailUrl && (
                <Link href={item.detailUrl} className="mt-2 inline-flex items-center text-[11px] font-medium text-primary hover:underline">
                  {item.actionLabel} →
                </Link>
              )}
            </GlassCard>
          ))}
        </div>
      </section>

      {audit.insights.length === 1 && audit.insights[0].id === "OPT-OK" && (
        <GlassCard className="p-6 flex items-center justify-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-secondary" />
          <Body className="text-xs text-text-muted">Everything is current. No attention required.</Body>
        </GlassCard>
      )}
    </div>
  );
}
