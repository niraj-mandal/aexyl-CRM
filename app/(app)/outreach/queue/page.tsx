"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Clock3, Mail, MessageCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-card";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundExecutionQueueAction, prepareOutboundEnrollmentAction } from "@/app/actions/ai.actions";

type Queue = Awaited<ReturnType<typeof getOutboundExecutionQueueAction>>;
type Prepared = Awaited<ReturnType<typeof prepareOutboundEnrollmentAction>>;

const channelIcons = { EMAIL: Mail, LINKEDIN: Send, WHATSAPP: MessageCircle };

export default function OutboundQueuePage() {
  const [queue, setQueue] = useState<Queue>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Queue[number] | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setQueue(await getOutboundExecutionQueueAction()); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load outbound queue."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const prepare = async (item: Queue[number]) => {
    setSelected(item);
    setPrepared(null);
    setPreparing(true);
    try { setPrepared(await prepareOutboundEnrollmentAction(item.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare outbound action."); }
    finally { setPreparing(false); }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // EXECUTION QUEUE</MonoLabel>
          <Display>Next actions.</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Only enrolled campaign actions that are actually due appear here. Preparation is grounded in the CRM and remains separate from sending.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        <GlassPanel className="p-6">
          <div className="mb-5 flex items-center justify-between"><div><MonoLabel className="text-primary">DUE NOW</MonoLabel><PageTitle className="mt-1 text-lg">Outbound queue</PageTitle></div><Badge variant="primary">{queue.length}</Badge></div>
          {loading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-low" />)}</div> :
          queue.length === 0 ? <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center text-xs text-text-muted"><Clock3 className="mx-auto h-6 w-6" /><p className="mt-3 text-sm text-text-secondary">Nothing is due right now.</p><p className="mt-1">Enroll leads in an active campaign to populate this queue.</p></div> :
          <div className="space-y-2">{queue.map(item => {
            const step = item.campaign;
            return <button key={item.id} onClick={() => void prepare(item)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === item.id ? "border-primary/50 bg-primary/5" : "border-border-subtle bg-surface-low hover:border-primary/30"}`}>
              <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold">{item.lead.company?.name || "Unknown company"}</p><p className="mt-1 text-xs text-text-muted">{[item.lead.contact?.firstName,item.lead.contact?.lastName].filter(Boolean).join(" ") || "Unknown contact"}{item.lead.contact?.jobTitle ? ` · ${item.lead.contact.jobTitle}` : ""}</p></div><ArrowRight className="h-4 w-4 text-text-muted" /></div>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted"><Badge variant="outline">{step.name}</Badge><span>Step {item.currentStep}</span><span>·</span><span>{item.intent} intent</span></div>
            </button>;
          })}</div>}
        </GlassPanel>

        <GlassPanel className="p-6">
          <MonoLabel className="text-primary">CONTROLLED PREPARATION</MonoLabel>
          <PageTitle className="mt-1 text-lg">{selected?.lead.company?.name || "Select an action"}</PageTitle>
          {!selected ? <div className="flex min-h-[320px] items-center justify-center text-center text-xs text-text-muted"><Sparkles className="mx-auto h-7 w-7" /><p className="mt-3">Select a due action to prepare its next touch.</p></div> :
          preparing ? <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface-low" /> :
          prepared ? <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-center justify-between"><MonoLabel className="text-primary">GENERATED OPENING</MonoLabel><Badge variant="outline">{prepared.opening.generatedBy === "llm" ? "AI grounded" : "Fallback"}</Badge></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{prepared.opening.opening}</p></div>
            <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>ANGLE</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">{prepared.opening.angle}</p></div><div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>REASON</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">{prepared.opening.reason}</p></div></div>
            <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>STEP INSTRUCTIONS</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">{prepared.step.instructions || "Use the campaign objective and CRM context to make this touch relevant."}</p></div>
            <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-low p-4"><div><p className="text-xs font-semibold">Ready for review</p><p className="mt-1 text-[11px] text-text-muted">No external message has been sent.</p></div><Badge variant="secondary">APPROVAL REQUIRED</Badge></div>
          </div> : null}
        </GlassPanel>
      </div>
    </div>
  );
}
