"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Clock3, Flame, Mail, RefreshCw, UserRound } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundHandoffQueueAction, acknowledgeOutboundHandoffAction } from "@/app/actions/ai.actions";

type Queue = Awaited<ReturnType<typeof getOutboundHandoffQueueAction>>;

export default function OutboundHandoffsPage() {
  const [items, setItems] = useState<Queue>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Queue[number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await getOutboundHandoffQueueAction()); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load handoffs."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function acknowledge() {
    if (!selected) return;
    await acknowledgeOutboundHandoffAction(selected.id);
    setSelected(null);
    await load();
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // HUMAN HANDOFF</MonoLabel>
          <Display>High-intent leads.</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Replies that signal meaningful buying intent are surfaced here with the CRM context needed for a human to take over.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
        <GlassPanel className="p-5">
          <div className="mb-4 flex items-center justify-between"><div><MonoLabel className="text-primary">NEEDS HUMAN</MonoLabel><PageTitle className="mt-1 text-lg">Handoff queue</PageTitle></div><Badge variant="primary">{items.length}</Badge></div>
          {loading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-low" />)}</div> :
          items.length === 0 ? <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-text-muted" /><p className="mt-3 text-sm text-text-secondary">No high-intent handoffs.</p><p className="mt-1 text-xs text-text-muted">AEXYL will surface them when replies qualify.</p></div> :
          <div className="space-y-2">{items.map(item => {
            const lead = item.enrollment?.lead;
            return <button key={item.id} onClick={() => setSelected(item)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === item.id ? "border-primary/50 bg-primary/5" : "border-border-subtle bg-surface-low hover:border-primary/30"}`}>
              <div className="flex gap-3"><div className="mt-0.5 rounded-lg bg-primary/10 p-2"><Flame className="h-4 w-4 text-primary" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{lead?.company?.name || "Unknown company"}</p><p className="mt-1 truncate text-xs text-text-muted">{[lead?.contact?.firstName,lead?.contact?.lastName].filter(Boolean).join(" ") || "Unknown contact"}{lead?.contact?.jobTitle ? ` · ${lead.contact.jobTitle}` : ""}</p><div className="mt-2 flex gap-2 text-[10px] text-text-muted"><Badge variant="outline">HIGH INTENT</Badge><span>{item.channel}</span></div></div></div>
            </button>;
          })}</div>}
        </GlassPanel>

        <GlassPanel className="p-6">
          {!selected ? <div className="flex min-h-[420px] items-center justify-center text-center"><div><UserRound className="mx-auto h-8 w-8 text-text-muted" /><p className="mt-3 text-sm text-text-secondary">Select a handoff.</p><p className="mt-1 text-xs text-text-muted">The conversation context will appear here.</p></div></div> :
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4"><div><MonoLabel className="text-primary">HIGH INTENT DETECTED</MonoLabel><PageTitle className="mt-1 text-2xl">{selected.enrollment?.company?.name || selected.enrollment?.lead?.company?.name || "Lead"}</PageTitle><p className="mt-1 text-xs text-text-muted">{[selected.enrollment?.lead?.contact?.firstName,selected.enrollment?.lead?.contact?.lastName].filter(Boolean).join(" ")} · {selected.enrollment?.lead?.contact?.email || "No email"}</p></div><Badge variant="primary"><Flame className="mr-1 h-3 w-3" /> {selected.confidence}%</Badge></div>
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><MonoLabel className="text-primary">PROSPECT REPLY</MonoLabel><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-text-primary">{selected.body}</p></div>
            <div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>INTENT</MonoLabel><p className="mt-2 text-sm font-semibold">{selected.intent}</p></div><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>CAMPAIGN</MonoLabel><p className="mt-2 text-sm font-semibold">{selected.enrollment?.campaign?.name || "—"}</p></div><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>CHANNEL</MonoLabel><p className="mt-2 text-sm font-semibold">{selected.channel}</p></div></div>
            <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>RECOMMENDED ACTION</MonoLabel><p className="mt-2 text-sm text-text-secondary">Move this prospect to a human conversation and review the reply before responding.</p></div>
            <div className="flex flex-wrap gap-3"><button onClick={() => void acknowledge()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white"><CheckCircle2 className="h-4 w-4" /> Take handoff</button><a href={leadUrl(selected)} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><ArrowUpRight className="h-4 w-4" /> Open lead</a><span className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-4 py-2.5 text-xs text-text-muted"><Clock3 className="h-4 w-4" /> Response received {new Date(selected.receivedAt).toLocaleString()}</span></div>
          </div>}
        </GlassPanel>
      </div>
    </div>
  );
}

function leadUrl(item: Queue[number]) {
  const id = item.enrollment?.lead?.id;
  return id ? `/sales/leads/${id}` : "/sales/leads";
}
