"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, Check, Flame, Radar, RefreshCw, TimerReset } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getAgentCommandBriefAction, getAgentRegistryAction } from "@/app/actions/ai.actions";

type Brief = Awaited<ReturnType<typeof getAgentCommandBriefAction>>;\ntype Agent = Awaited<ReturnType<typeof getAgentRegistryAction>>[number];
const iconFor: Record<string, any> = { HANDOFF: Flame, SIGNAL: Radar, FOLLOW_UP: TimerReset, NURTURE: TimerReset };

export default function AgentCommandPage() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);\n  const [done, setDone] = useState<string[]>([]);\n  const [agents, setAgents] = useState<Agent[]>([]);
  async function load() { setLoading(true); try { const [b,a] = await Promise.all([getAgentCommandBriefAction(), getAgentRegistryAction()]); setBrief(b); setAgents(a); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div><MonoLabel className="mb-2 block text-primary">AEXYL AGENTS // COMMAND BRIEF</MonoLabel><Display>Here is what matters right now.</Display><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">A live operating brief assembled from CRM state, outbound conversations, timing signals and due actions. AEXYL recommends; humans execute.</p></div>
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh</button>
    </div>
    {loading ? <div className="grid gap-4 md:grid-cols-5">{[1,2,3,4,5].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-low" />)}</div> :
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["HANDOFFS",brief?.counts.handoffs??0],["SIGNALS",brief?.counts.signals??0],["DUE",brief?.counts.due??0],["NURTURE",brief?.counts.nurture??0],["ACTIVE CAMPAIGNS",brief?.counts.activeCampaigns??0]].map(([label,count])=><GlassPanel key={String(label)} className="p-4"><MonoLabel>{label}</MonoLabel><div className="mt-2 text-2xl font-semibold">{count}</div></GlassPanel>)}</div>
      <GlassPanel className="p-6">
        <div className="flex items-center gap-2 border-b border-border-subtle pb-4"><Bot className="h-4 w-4 text-primary"/><PageTitle className="text-lg">Agent registry</PageTitle><Badge variant="outline">{agents.length} agents</Badge></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{agents.map(agent=><div key={agent.id} className="rounded-2xl border border-border-subtle bg-surface-low p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{agent.name}</p><p className="mt-1 text-xs text-text-muted">{agent.agentKey}</p></div><Badge variant={agent.enabled && !agent.paused ? "secondary" : "outline"}>{agent.paused ? "PAUSED" : agent.enabled ? "ACTIVE" : "OFF"}</Badge></div><p className="mt-3 text-xs leading-5 text-text-secondary">{agent.description}</p><div className="mt-3 flex items-center justify-between text-[10px] text-text-muted"><span>L{agent.autonomyLevel} autonomy</span><span>{agent.requiresApprovalForWrites ? "Writes gated" : "Writes allowed"}</span></div></div>)}</div>
      </GlassPanel>

      <GlassPanel className="p-6"><div className="flex items-center gap-2 border-b border-border-subtle pb-4"><Bot className="h-4 w-4 text-primary"/><PageTitle className="text-lg">Priority actions</PageTitle><Badge variant="primary">{brief?.actions.length??0}</Badge></div>
      <div className="mt-4 space-y-2">{(brief?.actions??[]).map(action=>{const Icon=iconFor[action.type]??Bot;return <Link key={action.id} href={action.href} className="group flex items-center gap-4 rounded-2xl border border-border-subtle bg-surface-low p-4 transition hover:border-primary/40 hover:bg-primary/5"><div className="rounded-xl bg-primary/10 p-2.5"><Icon className="h-4 w-4 text-primary"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{action.title}</span><Badge variant="outline">{action.type}</Badge></div><p className="mt-1 truncate text-xs text-text-secondary">{action.detail}</p></div><button type="button" onClick={(e) => { e.preventDefault(); setDone(v => v.includes(action.id) ? v.filter(x => x !== action.id) : [...v, action.id]); }} className={`rounded-lg border p-2 transition ${done.includes(action.id) ? "border-primary/30 bg-primary/10 text-primary" : "border-border-subtle text-text-muted hover:text-primary"}`} aria-label="Mark action reviewed">{done.includes(action.id) ? <Check className="h-4 w-4"/> : <span className="text-[10px] font-semibold">Done</span>}</button><ArrowUpRight className="h-4 w-4 shrink-0 text-text-muted transition group-hover:text-primary"/></Link>})}{!brief?.actions.length&&<div className="rounded-xl border border-border-subtle bg-surface-low p-10 text-center text-sm text-text-muted">No urgent outbound actions. The system is quiet.</div>}</div></GlassPanel>
    </>}
  </div>;
}
