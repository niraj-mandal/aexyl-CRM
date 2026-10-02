"use client";

import { useEffect, useState } from "react";
import { Clock3, MessageCircle, RefreshCw, Sparkles, TimerReset } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundNurtureQueueAction, prepareNurtureAction } from "@/app/actions/ai.actions";

type Queue = Awaited<ReturnType<typeof getOutboundNurtureQueueAction>>;
type Prepared = Awaited<ReturnType<typeof prepareNurtureAction>>;

export default function NurturePage() {
  const [items,setItems]=useState<Queue>([]);
  const [selected,setSelected]=useState<Queue[number]|null>(null);
  const [prepared,setPrepared]=useState<Prepared|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  async function load(){setLoading(true);setError(null);try{setItems(await getOutboundNurtureQueueAction())}catch(e){setError(e instanceof Error?e.message:"Unable to load nurture queue.")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);

  async function select(item: Queue[number]){
    setSelected(item);setPrepared(null);setError(null);
    try{setPrepared(await prepareNurtureAction(item.id))}catch(e){setError(e instanceof Error?e.message:"Unable to prepare nurture action.")}
  }

  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div><MonoLabel className="mb-2 block text-primary">OUTBOUND OS // NURTURE</MonoLabel><Display>Keep the conversation alive.</Display><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Medium-intent, timing and low-intent replies are routed into the right next move without pretending every prospect needs the same follow-up.</p></div>
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>
    </div>
    {error&&<div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>}
    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <GlassPanel className="p-5"><div className="mb-4 flex items-center justify-between"><div><MonoLabel className="text-primary">ACTIVE NURTURE</MonoLabel><PageTitle className="mt-1 text-lg">Next conversations</PageTitle></div><Badge variant="primary">{items.length}</Badge></div>
      {loading?<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-24 animate-pulse rounded-xl bg-surface-low"/>)}</div>:items.length===0?<div className="rounded-xl border border-dashed border-border-subtle p-10 text-center text-xs text-text-muted"><TimerReset className="mx-auto h-6 w-6"/><p className="mt-3 text-sm text-text-secondary">No nurture actions right now.</p></div>:
      <div className="space-y-2">{items.map(item=><button key={item.id} onClick={()=>void select(item)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id===item.id?"border-primary/50 bg-primary/5":"border-border-subtle bg-surface-low hover:border-primary/30"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{item.lead.company?.name||"Unknown company"}</p><p className="mt-1 text-xs text-text-muted">{[item.lead.contact?.firstName,item.lead.contact?.lastName].filter(Boolean).join(" ")||"Unknown contact"}</p></div><Badge variant="outline">{item.intent}</Badge></div></button>)}</div>}
      </GlassPanel>
      <GlassPanel className="p-6">{!selected?<div className="flex min-h-[400px] items-center justify-center text-center"><Sparkles className="mx-auto h-8 w-8 text-text-muted"/><p className="mt-3 text-sm text-text-secondary">Select a prospect.</p></div>:!prepared?<div className="mt-6 h-64 animate-pulse rounded-xl bg-surface-low"/>:<div className="space-y-5"><div><MonoLabel className="text-primary">RECOMMENDED MOVE</MonoLabel><PageTitle className="mt-1 text-2xl">{prepared.action}</PageTitle><p className="mt-2 text-sm text-text-secondary">{prepared.reason}</p></div><div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><MonoLabel className="text-primary">AI PREPARED FOLLOW-UP</MonoLabel><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{prepared.message}</p></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>ANGLE</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">{prepared.angle}</p></div><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>POLICY</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">External communication requires approval before sending.</p></div></div><div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low p-4 text-xs text-text-muted"><Clock3 className="h-4 w-4"/>No automatic send is performed from this screen.</div></div>}</GlassPanel>
    </div>
  </div>
}
