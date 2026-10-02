"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pause, Play, Plus, RefreshCw, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-card";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import {
  createOutboundStepAction,
  enrollLeadsInOutboundCampaignAction,
  getOutboundCampaignByIdAction,
  updateOutboundCampaignAction,
} from "@/app/actions/ai.actions";

type Campaign = Awaited<ReturnType<typeof getOutboundCampaignByIdAction>>;

export default function CampaignDetailPage() {
  const params = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stepTitle, setStepTitle] = useState("");
  const [stepChannel, setStepChannel] = useState("EMAIL");
  const [stepDelay, setStepDelay] = useState(2);
  const [stepInstructions, setStepInstructions] = useState("");
  const [stepTemplate, setStepTemplate] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setCampaign(await getOutboundCampaignByIdAction(params.campaignId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [params.campaignId]);

  const nextStep = (campaign?.steps.length ?? 0) + 1;
  const availableLeads = useMemo(() => campaign?.enrollments.length ?? 0, [campaign]);

  const addStep = async () => {
    if (!stepTitle.trim()) return;
    setSaving(true);
    try {
      await createOutboundStepAction(params.campaignId, {
        stepNumber: nextStep,
        channel: stepChannel,
        delayDays: stepDelay,
        title: stepTitle,
        instructions: stepInstructions,
        template: stepTemplate,
      });
      setStepTitle(""); setStepInstructions(""); setStepTemplate("");
      await load();
    } finally { setSaving(false); }
  };

  const toggle = async () => {
    if (!campaign) return;
    await updateOutboundCampaignAction(params.campaignId, {
      status: campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
    });
    await load();
  };

  if (loading) return <div className="space-y-4"><div className="h-10 w-64 animate-pulse rounded-xl bg-surface-low" /><div className="h-64 animate-pulse rounded-2xl bg-surface-low" /></div>;
  if (!campaign) return <div className="rounded-2xl border border-dashed border-border-subtle p-10 text-center text-sm text-text-muted">Campaign not found.</div>;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/outreach/campaigns" className="mb-4 inline-flex items-center gap-2 text-xs text-text-muted hover:text-primary"><ArrowLeft className="h-3 w-3" /> Campaigns</Link>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // CAMPAIGN</MonoLabel>
          <Display>{campaign.name}</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{campaign.targetProfile || "Define an ICP to guide enrollment."}</p>
        </div>
        <button onClick={() => void toggle()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold">
          {campaign.status === "ACTIVE" ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Activate</>}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>STATUS</MonoLabel><div className="mt-3"><Badge variant={campaign.status === "ACTIVE" ? "tertiary" : "outline"}>{campaign.status}</Badge></div></div>
        <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>STEPS</MonoLabel><div className="mt-3 text-xl font-semibold">{campaign.steps.length}</div></div>
        <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>ENROLLED</MonoLabel><div className="mt-3 text-xl font-semibold">{availableLeads}</div></div>
        <div className="rounded-xl border border-border-subtle bg-surface-low p-4"><MonoLabel>CHANNELS</MonoLabel><div className="mt-3 text-xl font-semibold">{campaign.channels.length}</div></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
        <GlassPanel className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div><MonoLabel className="text-primary">SEQUENCE</MonoLabel><PageTitle className="mt-1 text-lg">Outbound steps</PageTitle></div>
            <Badge variant="outline">Approval protected</Badge>
          </div>
          <div className="space-y-3">
            {campaign.steps.map((step) => (
              <div key={step.id} className="rounded-xl border border-border-subtle bg-surface-low p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{step.stepNumber}</div><div><h3 className="text-sm font-semibold">{step.title}</h3><p className="text-[11px] text-text-muted">{step.channel} · {step.delayDays === 0 ? "immediate" : `after ${step.delayDays} day${step.delayDays === 1 ? "" : "s"}`}</p></div></div>
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                {step.instructions && <p className="mt-4 text-xs leading-5 text-text-secondary">{step.instructions}</p>}
                {step.template && <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-surface-lowest p-4 text-[11px] leading-5 text-text-secondary">{step.template}</pre>}
              </div>
            ))}
            {campaign.steps.length === 0 && <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center text-xs text-text-muted">No steps yet. Add the first touch on the right.</div>}
          </div>
        </GlassPanel>

        <GlassPanel className="p-6">
          <div className="mb-5"><MonoLabel className="text-primary">STEP BUILDER</MonoLabel><PageTitle className="mt-1 text-lg">Add next touch</PageTitle></div>
          <div className="space-y-4">
            <input value={stepTitle} onChange={e => setStepTitle(e.target.value)} placeholder={`Touch ${nextStep} title`} className="w-full rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none focus:border-primary/50" />
            <div className="grid grid-cols-2 gap-3">
              <select value={stepChannel} onChange={e => setStepChannel(e.target.value)} className="rounded-xl border border-border-subtle bg-surface-low p-3 text-sm"><option>EMAIL</option><option>LINKEDIN</option><option>WHATSAPP</option><option>CALL</option></select>
              <input type="number" min={0} value={stepDelay} onChange={e => setStepDelay(Number(e.target.value))} className="rounded-xl border border-border-subtle bg-surface-low p-3 text-sm" placeholder="Delay days" />
            </div>
            <textarea value={stepInstructions} onChange={e => setStepInstructions(e.target.value)} rows={3} placeholder="What should Aexyl do at this step?" className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none" />
            <textarea value={stepTemplate} onChange={e => setStepTemplate(e.target.value)} rows={6} placeholder="Optional message template / guidance" className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none" />
            <button disabled={saving || !stepTitle.trim()} onClick={() => void addStep()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Add step {nextStep}</button>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <div><MonoLabel className="text-primary">ENROLLMENTS</MonoLabel><PageTitle className="mt-1 text-lg">Leads inside this campaign</PageTitle></div>
          <Badge variant="outline"><Users className="mr-1 inline h-3 w-3" /> {availableLeads}</Badge>
        </div>
        {campaign.enrollments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center">
            <Users className="mx-auto h-7 w-7 text-text-muted" />
            <p className="mt-3 text-sm text-text-secondary">No leads enrolled yet.</p>
            <p className="mt-1 text-xs text-text-muted">Lead selection will be connected to the qualification layer next.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {campaign.enrollments.map((enrollment) => (
              <div key={enrollment.id} className="rounded-xl border border-border-subtle bg-surface-low p-4">
                <div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">{enrollment.lead.company?.name || "Unknown company"}</h3><p className="mt-1 text-xs text-text-muted">{[enrollment.lead.contact?.firstName, enrollment.lead.contact?.lastName].filter(Boolean).join(" ") || "Unknown contact"}</p></div><Badge variant="outline">{enrollment.status}</Badge></div>
                <div className="mt-3 flex gap-2 text-[10px] text-text-muted"><span>Step {enrollment.currentStep}</span><span>·</span><span>{enrollment.intent} intent</span></div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
