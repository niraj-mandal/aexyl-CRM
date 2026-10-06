"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getOutboundCampaignsAction, getDiscoveryCandidatesAction, approveDiscoveryCandidateAndEnrollAction, reviewDiscoveryCandidateAction } from "@/app/actions/ai.actions";

type Campaigns = Awaited<ReturnType<typeof getOutboundCampaignsAction>>;
type Candidate = Awaited<ReturnType<typeof getDiscoveryCandidatesAction>>[number];

export default function DiscoveryPage() {
  const [campaigns,setCampaigns]=useState<Campaigns>([]);
  const [campaignId,setCampaignId]=useState("");
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [filter,setFilter]=useState("ALL");
  const [query,setQuery]=useState("");

  const load=async()=>{
    setLoading(true);
    try{
      const cs=await getOutboundCampaignsAction();
      setCampaigns(cs);
      const id=campaignId || cs[0]?.id || "";
      if(id){setCampaignId(id);setCandidates(await getDiscoveryCandidatesAction(id));}
      else setCandidates([]);
    }finally{setLoading(false);}
  };
  useEffect(()=>{void load()},[]);

  const refreshCandidates=async(id:string)=>{
    setCampaignId(id); setLoading(true);
    try{setCandidates(await getDiscoveryCandidatesAction(id));}finally{setLoading(false);}
  };

  const filtered=useMemo(()=>candidates.filter(c=>{
    const tier=filter==="ALL"||c.fitTier===filter;
    const text=(c.companyName+" "+(c.contactFirstName||"")+" "+(c.contactLastName||"")+" "+(c.industry||"")).toLowerCase();
    return tier && text.includes(query.toLowerCase());
  }),[candidates,filter,query]);

  const approve=async(id:string)=>{
    setBusy(id);
    try{await approveDiscoveryCandidateAndEnrollAction(id);await refreshCandidates(campaignId)}finally{setBusy(null)}
  };
  const reject=async(id:string)=>{
    setBusy(id);
    try{await reviewDiscoveryCandidateAction(id,"REJECTED");await refreshCandidates(campaignId)}finally{setBusy(null)}
  };

  const counts={priority:candidates.filter(c=>c.fitTier==="PRIORITY").length,good:candidates.filter(c=>c.fitTier==="GOOD_FIT").length,pending:candidates.filter(c=>c.status==="PENDING").length};

  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div><MonoLabel className="mb-2 block text-primary">OUTBOUND OS // DISCOVERY</MonoLabel><Display>Find the right prospects.</Display><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Review ICP-scored prospects before they enter the outbound machine. Discovery candidates are not CRM leads until approved.</p></div>
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold"><RefreshCw className="h-4 w-4"/>Refresh</button>
    </div>

    <GlassPanel className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3"><MonoLabel>CAMPAIGN</MonoLabel><select value={campaignId} onChange={e=>void refreshCandidates(e.target.value)} className="rounded-xl border border-border-subtle bg-surface-low px-3 py-2 text-sm outline-none">{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search prospects..." className="rounded-xl border border-border-subtle bg-surface-low py-2 pl-9 pr-3 text-sm outline-none"/></div>
      </div>
    </GlassPanel>

    <div className="grid gap-4 md:grid-cols-4">
      {[["ALL","ALL",candidates.length],["PRIORITY","PRIORITY",counts.priority],["GOOD_FIT","GOOD FIT",counts.good],["PENDING","PENDING",counts.pending]].map(([key,label,count])=><button key={String(key)} onClick={()=>setFilter(String(key))} className={`rounded-2xl border p-4 text-left transition ${filter===key?"border-primary/40 bg-primary/5":"border-border-subtle bg-surface-low"}`}><MonoLabel>{label}</MonoLabel><p className="mt-2 text-2xl font-semibold">{count}</p></button>)}
    </div>

    {loading?<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-36 animate-pulse rounded-2xl bg-surface-low"/>)}</div>:!campaignId?<GlassPanel className="p-12 text-center"><Sparkles className="mx-auto h-7 w-7 text-primary"/><p className="mt-3 text-sm">Create a campaign first.</p></GlassPanel>:filtered.length===0?<GlassPanel className="p-12 text-center"><Sparkles className="mx-auto h-7 w-7 text-text-muted"/><p className="mt-3 text-sm text-text-secondary">No discovery candidates match this view.</p><p className="mt-1 text-xs text-text-muted">Candidates can be populated by the external research layer.</p></GlassPanel>:
    <div className="space-y-3">{filtered.map(c=><GlassPanel key={c.id} className="p-5"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><PageTitle className="text-base">{c.companyName}</PageTitle><Badge variant={c.fitTier==="PRIORITY"?"primary":"outline"}>{c.fitTier.replaceAll("_"," ")}</Badge><Badge variant="outline">{c.fitScore}/100</Badge></div>
      <p className="mt-2 text-xs text-text-muted">{[c.contactFirstName,c.contactLastName].filter(Boolean).join(" ")||"Unknown contact"} · {c.contactJobTitle||"Role unknown"} · {c.location||"Location unknown"}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><div><MonoLabel>MATCH SIGNALS</MonoLabel><p className="mt-2 text-xs leading-5 text-text-secondary">{c.reasons.length?c.reasons.slice(0,3).join(" · "):"No strong match signals recorded."}</p></div><div><MonoLabel>GAPS</MonoLabel><p className="mt-2 text-xs leading-5 text-text-muted">{c.gaps.length?c.gaps.slice(0,3).join(" · "):"No major gaps recorded."}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-text-muted">{c.contactEmail&&<span>{c.contactEmail}</span>}{c.website&&<span>{c.website}</span>}{c.linkedinUrl&&<span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3"/>LinkedIn</span>}</div></div>
      <div className="flex shrink-0 gap-2 lg:flex-col">{c.status==="PENDING"?<><button disabled={busy===c.id} onClick={()=>void approve(c.id)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4"/>{busy===c.id?"Adding...":"Approve & add"}</button><button disabled={busy===c.id} onClick={()=>void reject(c.id)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-subtle px-4 py-2.5 text-xs font-semibold"><X className="h-4 w-4"/>Reject</button></>:<Badge variant="outline">{c.status}</Badge>}</div>
    </div></GlassPanel>)}</div>}
  </div>;
}
