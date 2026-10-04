"use client";

import { useEffect, useState } from "react";
import { Megaphone, Pause, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { discoverIcpMatchesAction } from "@/app/actions/ai.actions";
import {
  createOutboundCampaignAction,
  getOutboundCampaignsAction,
  updateOutboundCampaignAction,
} from "@/app/actions/ai.actions";

type Campaigns = Awaited<ReturnType<typeof getOutboundCampaignsAction>>;
type Campaign = Campaigns[number];
type Match = Awaited<ReturnType<typeof discoverIcpMatchesAction>>[number];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaigns>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [targetProfile, setTargetProfile] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setCampaigns(await getOutboundCampaignsAction());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createOutboundCampaignAction({
        name,
        targetProfile,
        valueProp,
        channels: ["EMAIL", "WHATSAPP"],
      });
      setName("");
      setTargetProfile("");
      setValueProp("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const discover = async (campaign: Campaign) => {
    setSelected(campaign); setDiscovering(true);
    try { setMatches(await discoverIcpMatchesAction(campaign.id)); } finally { setDiscovering(false); }
  };

  const toggle = async (campaign: Campaign) => {
    const status = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    await updateOutboundCampaignAction(campaign.id, { status });
    await load();
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-4 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // CAMPAIGN CONTROL</MonoLabel>
          <Display>Campaigns.</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Persistent outbound programs with real CRM state. Build the campaign first; execution stays behind Aexyl&apos;s approval and communication guardrails.
          </p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <GlassPanel className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2"><Plus className="h-4 w-4 text-primary" /></div>
            <div>
              <MonoLabel className="text-primary">NEW CAMPAIGN</MonoLabel>
              <PageTitle className="mt-1 text-lg">Define the outbound motion</PageTitle>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block">
              <MonoLabel className="mb-2 block">CAMPAIGN NAME</MonoLabel>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Assam hospitality growth" className="w-full rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none focus:border-primary/50" />
            </label>
            <label className="block">
              <MonoLabel className="mb-2 block">TARGET PROFILE</MonoLabel>
              <textarea value={targetProfile} onChange={(e) => setTargetProfile(e.target.value)} rows={4} placeholder="Who should enter this campaign?" className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none focus:border-primary/50" />
            </label>
            <label className="block">
              <MonoLabel className="mb-2 block">VALUE PROPOSITION</MonoLabel>
              <textarea value={valueProp} onChange={(e) => setValueProp(e.target.value)} rows={4} placeholder="What relevant outcome are we offering?" className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none focus:border-primary/50" />
            </label>
            <button disabled={saving || !name.trim()} onClick={() => void create()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create campaign
            </button>
          </div>
        </GlassPanel>

        <GlassPanel className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <MonoLabel className="text-secondary">LIVE CAMPAIGNS</MonoLabel>
              <PageTitle className="mt-1 text-lg">{campaigns.length} programs</PageTitle>
            </div>
            <Badge variant="outline">Persistent CRM state</Badge>
          </div>

          {loading ? (
            <div className="space-y-3">{[1,2,3].map(n => <div key={n} className="h-24 animate-pulse rounded-xl bg-surface-low" />)}</div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-10 text-center">
              <Megaphone className="mx-auto h-7 w-7 text-text-muted" />
              <p className="mt-3 text-sm text-text-secondary">No campaigns yet.</p>
              <p className="mt-1 text-xs text-text-muted">Create the first outbound motion on the left.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="rounded-xl border border-border-subtle bg-surface-low p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-text-primary">{campaign.name}</h3>
                        <Badge variant={campaign.status === "ACTIVE" ? "tertiary" : "outline"}>{campaign.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-text-muted">{campaign.targetProfile || "No target profile defined yet."}</p>
                    </div>
                    <button onClick={() => void toggle(campaign)} className="rounded-lg border border-border-subtle p-2 text-text-muted hover:text-text-primary" title={campaign.status === "ACTIVE" ? "Pause" : "Activate"}>
                      {campaign.status === "ACTIVE" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-surface-lowest p-3"><div className="text-sm font-semibold">{campaign.steps.length}</div><MonoLabel>STEPS</MonoLabel></div>
                    <div className="rounded-lg bg-surface-lowest p-3"><div className="text-sm font-semibold">{campaign.enrollments.length}</div><MonoLabel>ENROLLED</MonoLabel></div>
                    <div className="rounded-lg bg-surface-lowest p-3"><div className="text-sm font-semibold">{campaign.channels.length}</div><MonoLabel>CHANNELS</MonoLabel></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
