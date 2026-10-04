"use client";

import { useEffect, useState } from "react";
import { BarChart3, RefreshCw, TrendingUp } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundIntelligenceAction } from "@/app/actions/ai.actions";

type Data = Awaited<ReturnType<typeof getOutboundIntelligenceAction>>;

export default function OutboundIntelligencePage() {
  const [data,setData]=useState<Data|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  async function load(){setLoading(true);setError(null);try{setData(await getOutboundIntelligenceAction())}catch(e){setError(e instanceof Error?e.message:"Unable to load intelligence.")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);

  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div><MonoLabel className="mb-2 block text-primary">OUTBOUND OS // INTELLIGENCE</MonoLabel><Display>Know what is actually working.</Display><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Revenue-grade outbound metrics from your CRM data — not vanity activity counts.</p></div>
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>
    </div>
    {error&&<div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>}
    {loading?<div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map(i=><div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-low"/>)}</div>:data&&<>
      <div className="grid gap-4 md:grid-cols-4">{[
        ["SENT",data.totals.sent],["REPLIES",data.totals.replies],["REPLY RATE",data.totals.replyRate+"%"],["POSITIVE RATE",data.totals.positiveRate+"%"]
      ].map(([label,value])=><GlassPanel key={String(label)} className="p-5"><MonoLabel>{label}</MonoLabel><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p></GlassPanel>)}</div>
      <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <GlassPanel className="p-6"><div className="mb-5 flex items-center justify-between"><div><MonoLabel className="text-primary">CAMPAIGN PERFORMANCE</MonoLabel><PageTitle className="mt-1 text-xl">Where the machine wins</PageTitle></div><TrendingUp className="h-5 w-5 text-primary"/></div>
          <div className="space-y-3">{data.campaignStats.length===0?<p className="text-sm text-text-muted">No campaign data yet.</p>:data.campaignStats.map(c=><div key={c.id} className="rounded-xl border border-border-subtle bg-surface-low p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">{c.name}</p><p className="mt-1 text-xs text-text-muted">{c.enrolled} enrolled · {c.sent} sent · {c.replies} replies</p></div><Badge variant={c.positiveRate>=30?"primary":"outline"}>{c.positiveRate}% positive</Badge></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs text-text-secondary"><span>Reply rate <strong className="text-text-primary">{c.replyRate}%</strong></span><span>Positive <strong className="text-text-primary">{c.positive}</strong></span></div></div>)}</div>
        </GlassPanel>
        <GlassPanel className="p-6"><div className="mb-5"><MonoLabel className="text-primary">REPLY SIGNALS</MonoLabel><PageTitle className="mt-1 text-xl">What prospects are saying</PageTitle></div><div className="space-y-3">{Object.entries(data.byIntent).length===0?<p className="text-sm text-text-muted">No reply signals yet.</p>:Object.entries(data.byIntent).map(([k,v])=><div key={k} className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-low p-4"><span className="text-xs font-semibold">{k}</span><Badge variant="outline">{v}</Badge></div>)}</div><div className="mt-6 border-t border-border-subtle pt-5"><MonoLabel>TOP OBJECTIONS</MonoLabel><div className="mt-3 space-y-2">{Object.entries(data.byObjection).length===0?<p className="text-xs text-text-muted">None classified yet.</p>:Object.entries(data.byObjection).map(([k,v])=><div key={k} className="flex justify-between text-xs"><span className="text-text-secondary">{k.replaceAll("_"," ")}</span><span>{v}</span></div>)}</div></div></GlassPanel>
      </div>
      <GlassPanel className="p-5 flex items-center gap-3"><BarChart3 className="h-5 w-5 text-primary"/><p className="text-xs text-text-secondary">This dashboard is grounded in actual outbound CRM records. As integrations mature, channel-level attribution and meeting/revenue conversion can be added without changing the operating model.</p></GlassPanel>
    </>}
  </div>;
}
