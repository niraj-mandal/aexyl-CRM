"use client";

import { useEffect, useState } from "react";
import { Inbox, RefreshCw, Send, Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundInboxAction, prepareInboundResponseAction, sendApprovedOutboundMessageAction } from "@/app/actions/ai.actions";

type Data = Awaited<ReturnType<typeof getOutboundInboxAction>>;
type Reply = Data["replies"][number];

export default function OutboundInboxPage() {
  const [data,setData]=useState<Data|null>(null);
  const [selected,setSelected]=useState<Reply|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);\n  const [draft,setDraft]=useState<{messageId:string;message:string;reason:string}|null>(null);\n  const [busy,setBusy]=useState(false);

  async function load(){setLoading(true);setError(null);try{setData(await getOutboundInboxAction())}catch(e){setError(e instanceof Error?e.message:"Unable to load inbox.")}finally{setLoading(false)}}
  useEffect(()=>{void load()},[]);

  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div><MonoLabel className="mb-2 block text-primary">OUTBOUND OS // INBOX</MonoLabel><Display>Every conversation, one place.</Display><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">A unified operator view for outbound replies and sent messages. Intelligence sits beside the conversation instead of hiding it in another tool.</p></div>
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>
    </div>
    {error&&<div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">{error}</div>}
    <div className="grid gap-6 xl:grid-cols-[.75fr_1.25fr]">
      <GlassPanel className="p-5"><div className="mb-4 flex items-center justify-between"><div><MonoLabel className="text-primary">CONVERSATIONS</MonoLabel><PageTitle className="mt-1 text-lg">Recent replies</PageTitle></div><Badge variant="primary">{data?.replies.length||0}</Badge></div>
      {loading?<div className="space-y-3">{[1,2,3,4].map(i=><div key={i} className="h-20 animate-pulse rounded-xl bg-surface-low"/>)}</div>:!data?.replies.length?<div className="rounded-xl border border-dashed border-border-subtle p-10 text-center text-xs text-text-muted"><Inbox className="mx-auto h-6 w-6"/><p className="mt-3">No replies yet.</p></div>:
      <div className="space-y-2">{data.replies.map(reply=><button key={reply.id} onClick={()=>setSelected(reply)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id===reply.id?"border-primary/50 bg-primary/5":"border-border-subtle bg-surface-low hover:border-primary/30"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{reply.enrollment?.lead?.company?.name||"Unknown company"}</p><p className="mt-1 text-xs text-text-muted">{[reply.enrollment?.lead?.contact?.firstName,reply.enrollment?.lead?.contact?.lastName].filter(Boolean).join(" ")||"Unknown contact"}</p></div><Badge variant={reply.intent==="HIGH"?"primary":"outline"}>{reply.intent}</Badge></div><p className="mt-3 line-clamp-2 text-xs leading-5 text-text-secondary">{reply.body}</p></button>)}</div>}
      </GlassPanel>
      <GlassPanel className="p-6">{!selected?<div className="flex min-h-[500px] items-center justify-center text-center"><Sparkles className="mx-auto h-8 w-8 text-text-muted"/><p className="mt-3 text-sm text-text-secondary">Select a conversation to inspect its intelligence.</p></div>:<div className="space-y-6"><div className="flex items-start justify-between gap-4"><div><MonoLabel className="text-primary">CONVERSATION</MonoLabel><PageTitle className="mt-1 text-2xl">{selected.enrollment?.lead?.contact?.firstName||"Prospect"} {selected.enrollment?.lead?.contact?.lastName||""}</PageTitle><p className="mt-1 text-xs text-text-muted">{selected.enrollment?.lead?.company?.name||"Unknown company"} · {selected.channel}</p></div><Badge variant={selected.intent==="HIGH"?"primary":"outline"}>{selected.intent} · {selected.confidence}%</Badge></div><div className="rounded-2xl border border-border-subtle bg-surface-low p-5"><MonoLabel>PROSPECT REPLY</MonoLabel><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{selected.body}</p></div><div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border-subtle p-4"><MonoLabel>OBJECTION</MonoLabel><p className="mt-2 text-xs">{selected.objection||"Not classified"}</p></div><div className="rounded-xl border border-border-subtle p-4"><MonoLabel>NEXT MOVE</MonoLabel><p className="mt-2 text-xs">{selected.recommendedAction||"Review"}</p></div><div className="rounded-xl border border-border-subtle p-4"><MonoLabel>CAMPAIGN</MonoLabel><p className="mt-2 text-xs">{selected.enrollment?.campaign?.name||"—"}</p></div></div><div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-text-secondary"><Send className="h-4 w-4"/>Actions remain approval-gated. This inbox does not send automatically.</div><div className="flex gap-2">{selected.recommendedAction !== "STOP" && <button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await prepareInboundResponseAction(selected.id);setDraft({messageId:r.messageId,message:r.message,reason:r.reason})}catch(e){setError(e instanceof Error?e.message:"Unable to prepare response.")}finally{setBusy(false)}}} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white"><Sparkles className="h-4 w-4"/>{busy?"Preparing...":"Prepare response"}</button>}</div>{draft&&<div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><MonoLabel className="text-primary">AI DRAFT // APPROVAL REQUIRED</MonoLabel><div className="mt-3 whitespace-pre-wrap rounded-xl border border-border-subtle bg-background p-4 text-sm leading-6">{draft.message}</div><p className="mt-3 text-xs text-text-muted">{draft.reason}</p><div className="mt-4 flex gap-2"><button onClick={()=>setDraft(null)} className="rounded-xl border border-border-subtle px-4 py-2 text-xs font-semibold">Discard</button><button disabled={busy} onClick={async()=>{setBusy(true);try{await sendApprovedOutboundMessageAction(draft.messageId);setDraft(null);await load()}catch(e){setError(e instanceof Error?e.message:"Unable to send.")}finally{setBusy(false)}}} className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white">{busy?"Sending...":"Approve & send"}</button></div></div>}</div></div>}</GlassPanel>
    </div>
  </div>;
}
