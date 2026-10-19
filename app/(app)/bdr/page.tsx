"use client";

import { useState, useEffect, use } from "react";
import { PageTitle, FieldLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Target, Send, Users, TrendingUp, Zap, RotateCcw,
  Play, Pause, Plus, Search, MessageSquare, Mail, Phone, Link2,
  Globe, ChevronRight, Loader2, Copy, Check, Brain, AlertTriangle,
  MapPin, CheckCircle, XCircle, Clock, Radar, ThumbsUp, ThumbsDown, ExternalLink,
} from "lucide-react";
import {
  generateIcpProfileAction,
  getIcpProfileAction,
  discoverIcpLeadsAction,
  generateSequenceAction,
  getSequencesAction,
  getBdrDashboardAction,
  activateSequenceAction,
  pauseSequenceAction,
  findDormantLeadsAction,
} from "@/app/actions/bdr.actions";
import {
  runDiscoveryAction,
  getDiscoveryBatchesAction,
  getDiscoveryCandidatesAction,
  getPendingCandidatesAction,
  approveCandidateAction,
  rejectCandidateAction,
  getDiscoveryStatsAction,
  getDiscoveryOverviewAction,
  saveDiscoverySettingsAction,
} from "@/app/actions/discovery.actions";
import { googleMapsUrl } from "@/lib/maps";

type Tab = "overview" | "icp" | "discovery" | "sequences" | "reactivation";

const TAB_KEYS: Tab[] = ["overview", "icp", "discovery", "sequences", "reactivation"];

export default function BdrPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  // Deep links such as notifications open a specific tab: /bdr?tab=discovery
  const requested = use(searchParams).tab;
  const initialTab = TAB_KEYS.find((t) => t === requested) ?? "overview";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>([initialTab]));

  const openTab = (tab: Tab) => {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  };

  useEffect(() => {
    const onTabChange = (e: Event) => openTab((e as CustomEvent<Tab>).detail);
    window.addEventListener("bdr-tab-change", onTabChange);
    return () => window.removeEventListener("bdr-tab-change", onTabChange);
  }, []);

  const panel = (tab: Tab, node: React.ReactNode) =>
    visited.has(tab) ? <div hidden={activeTab !== tab}>{node}</div> : null;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "Dashboard", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: "icp", label: "ICP Setup", icon: <Target className="h-3.5 w-3.5" /> },
    { key: "discovery", label: "Lead Discovery", icon: <Search className="h-3.5 w-3.5" /> },
    { key: "sequences", label: "Sequences", icon: <Send className="h-3.5 w-3.5" /> },
    { key: "reactivation", label: "Reactivation", icon: <RotateCcw className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <PageHeader
        eyebrow="Sales · Autopilot"
        title="AI BDR"
        description="Find gyms without websites, review them, and run follow-up sequences. Nothing is sent without your approval."
      />

      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border-subtle bg-surface-lowest/70 p-1 scrollbar-thin">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => openTab(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab.key
                ? "bg-surface-high text-text-primary shadow-sm ring-1 ring-inset ring-border-strong"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-high/50"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {panel("overview", <DashboardTab />)}
      {panel("icp", <IcpSetupTab />)}
      {panel("discovery", <DiscoveryTab />)}
      {panel("sequences", <SequencesTab />)}
      {panel("reactivation", <ReactivationTab />)}
    </div>
  );
}

// ─── Dashboard Overview ───────────────────────────────────────────────

function DashboardTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getBdrDashboardAction>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBdrDashboardAction().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState text="Loading BDR dashboard..." />;

  const stats = data?.stats;
  const profile = data?.profile;

  const metrics = [
    { label: "Active Sequences", value: stats?.sequences.activeSequences ?? 0, icon: Send, color: "text-primary" },
    { label: "Enrolled Leads", value: stats?.sequences.totalEnrolled ?? 0, icon: Users, color: "text-secondary" },
    { label: "Reply Rate", value: `${stats?.replyRate ?? 0}%`, icon: MessageSquare, color: "text-tertiary" },
    { label: "Meetings Booked", value: stats?.sequences.totalMeetings ?? 0, icon: Phone, color: "text-success" },
    { label: "Hot Leads", value: stats?.hotLeadCount ?? 0, icon: Zap, color: "text-warning" },
    { label: "Intent Signals", value: stats?.signals.recentSignals ?? 0, icon: Brain, color: "text-info" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <GlassCard key={m.label} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <m.icon className={`h-4 w-4 ${m.color}`} />
              <span className="text-xs text-text-muted">{m.label}</span>
            </div>
            <div className="num text-2xl font-medium text-text-primary">{m.value}</div>
          </GlassCard>
        ))}
      </div>

      {!profile && (
        <GlassPanel className="p-8 text-center">
          <Target className="h-10 w-10 text-primary mx-auto mb-3" />
          <PageTitle className="text-lg mb-2">Set Up Your ICP</PageTitle>
          <p className="text-sm text-text-muted mb-4 max-w-md mx-auto">
            Tell the AI BDR what you sell and it will build your Ideal Customer Profile,
            find matching leads, and start personalized outreach automatically.
          </p>
          <button
            onClick={() => {
              const event = new CustomEvent("bdr-tab-change", { detail: "icp" });
              window.dispatchEvent(event);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-all"
          >
            <Sparkles className="h-4 w-4" />
            Get Started
          </button>
        </GlassPanel>
      )}

      {profile && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <GlassPanel className="p-5">
            <FieldLabel className="block mb-3 text-primary">ICP summary</FieldLabel>
            <p className="text-xs text-text-secondary mb-3">{profile.businessDescription}</p>
            <div className="flex flex-wrap gap-1.5">
              {(profile.topBuyerRoles as string[]).map((role) => (
                <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel className="p-5">
            <FieldLabel className="block mb-3 text-secondary">Recent sequences</FieldLabel>
            {data?.sequences.length === 0 ? (
              <p className="text-xs text-text-muted">No sequences yet. Create one from the Sequences tab.</p>
            ) : (
              <div className="space-y-2">
                {data?.sequences.slice(0, 4).map((seq) => (
                  <div key={seq.id} className="flex items-center justify-between rounded-lg bg-surface-low p-2.5 border border-border-subtle">
                    <div>
                      <span className="text-xs font-medium text-text-primary">{seq.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-text-muted">{seq.totalEnrolled} enrolled</span>
                        <span className="text-xs text-text-muted">{seq.totalReplied} replied</span>
                      </div>
                    </div>
                    <Badge
                      variant={seq.status === "ACTIVE" ? "primary" : "secondary"}
                      className="text-[11px]"
                    >
                      {seq.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}

// ─── ICP Setup ────────────────────────────────────────────────────────

function IcpSetupTab() {
  const [businessDesc, setBusinessDesc] = useState("");
  const [website, setWebsite] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getIcpProfileAction>> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getIcpProfileAction().then((p) => {
      if (p) {
        setProfile(p);
        setBusinessDesc(p.businessDescription);
        setWebsite(p.website || "");
        setTargetLocation(p.targetLocation || "");
      }
    });
  }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await generateIcpProfileAction({
        businessDescription: businessDesc,
        website: website || undefined,
        targetLocation: targetLocation || undefined,
      });
      if ("error" in result) return;
      const updated = await getIcpProfileAction();
      setProfile(updated);
    } finally {
      setLoading(false);
    }
  };

  const copyOpener = () => {
    if (profile?.personalizedOpener) {
      navigator.clipboard.writeText(profile.personalizedOpener);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const icpData = profile?.idealCustomerProfile as { industry: string; size: string; stage: string; region: string }[] | undefined;
  const buyerRoles = profile?.topBuyerRoles as string[] | undefined;
  const painPoints = profile?.keyPainPoints as string[] | undefined;
  const sampleCompanies = profile?.sampleCompanies as { name: string; initial: string }[] | undefined;
  const sampleBuyers = profile?.sampleBuyers as { name: string; role: string; company: string }[] | undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-border-subtle">
          <Sparkles className="h-4 w-4 text-primary" />
          <PageTitle className="text-base">What do you sell?</PageTitle>
        </div>
        <p className="text-xs text-text-muted">One sentence is enough — AI will do the rest.</p>

        <div>
          <textarea
            rows={4}
            value={businessDesc}
            onChange={(e) => setBusinessDesc(e.target.value)}
            placeholder="We help SaaS startups book more demos through outbound."
            className="w-full rounded-lg bg-surface-low border border-border-subtle px-3.5 py-2.5 text-xs text-text-primary focus:border-primary focus:outline-none resize-none"
            maxLength={500}
          />
          <div className="text-right text-xs text-text-muted">{businessDesc.length}/500</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel className="block mb-1.5 text-xs">Your website (optional)</FieldLabel>
            <div className="relative">
              <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="yourcompany.com"
                className="w-full rounded-lg bg-surface-low border border-border-subtle pl-8 pr-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <FieldLabel className="block mb-1.5 text-xs">
              Target location <span className="text-danger">*</span>
            </FieldLabel>
            <input
              type="text"
              value={targetLocation}
              onChange={(e) => setTargetLocation(e.target.value)}
              placeholder="e.g. United States, India, UK"
              className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading || businessDesc.length < 10}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:shadow-[0_0_30px_rgba(43,102,255,0.4)] transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "Generating..." : "Show me my pipeline preview"}
        </button>

        {!loading && (
          <p className="text-xs text-text-muted text-center flex items-center justify-center gap-1">
            <Check className="h-3 w-3 text-success" /> No credit card required &bull; Takes 30 seconds
          </p>
        )}
      </GlassPanel>

      {profile && profile.status === "ACTIVE" ? (
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <FieldLabel className="text-success text-xs">Live AI preview</FieldLabel>
            </div>
            <span className="text-xs text-text-muted">Generated data</span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                <span className="text-xs font-semibold text-text-primary">Ideal customer profile</span>
              </div>
              <div className="space-y-1">
                {icpData?.map((attr, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <div className="h-1 w-1 rounded-full bg-primary/50" />
                    {attr.industry}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-secondary" />
                <span className="text-xs font-semibold text-text-primary">Top buyer roles</span>
              </div>
              <div className="space-y-1">
                {buyerRoles?.map((role) => (
                  <div key={role} className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Users className="h-3 w-3 text-secondary/70" />
                    {role}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-warning" />
                <span className="text-xs font-semibold text-text-primary">Key pain points</span>
              </div>
              <div className="space-y-1">
                {painPoints?.map((point) => (
                  <div key={point} className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Zap className="h-3 w-3 text-warning/70" />
                    {point}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-text-primary block mb-2">Sample companies</span>
            <div className="flex flex-wrap gap-2">
              {sampleCompanies?.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 rounded-full bg-surface-low border border-border-subtle px-2.5 py-1">
                  <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {c.initial}
                  </div>
                  <span className="text-xs text-text-primary">{c.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-text-primary block mb-2">Sample buyers at these companies</span>
            <div className="flex flex-wrap gap-2">
              {sampleBuyers?.map((b) => (
                <div key={b.name} className="flex items-center gap-1.5 rounded-full bg-surface-low border border-border-subtle px-2.5 py-1">
                  <div className="h-5 w-5 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-secondary">
                    {b.name[0]}
                  </div>
                  <span className="text-xs text-text-primary">{b.name}</span>
                  <span className="text-xs text-text-muted">&middot; {b.role}</span>
                </div>
              ))}
            </div>
          </div>

          {profile.personalizedOpener && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-text-primary">Personalized opening (example)</span>
                <Badge variant="primary" className="text-[11px]">
                  Generated for {profile.openerTargetRole || "decision maker"}
                </Badge>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">{profile.personalizedOpener}</p>
              <button
                onClick={copyOpener}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          )}
        </GlassPanel>
      ) : (
        <GlassPanel className="p-8 flex flex-col items-center justify-center text-center">
          <Target className="h-12 w-12 text-text-muted/30 mb-3" />
          <p className="text-sm text-text-muted">
            Describe your business and target market to generate your ICP preview.
          </p>
        </GlassPanel>
      )}
    </div>
  );
}

// ─── Discovery Engine ────────────────────────────────────────────────

type DiscoverySubTab = "candidates" | "batches" | "settings";

function DiscoveryTab() {
  const [subTab, setSubTab] = useState<DiscoverySubTab>("candidates");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<Awaited<ReturnType<typeof runDiscoveryAction>> | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getDiscoveryStatsAction>> | null>(null);
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof getPendingCandidatesAction>>>([]);
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof getDiscoveryBatchesAction>>>([]);
  const [batchCandidates, setBatchCandidates] = useState<Awaited<ReturnType<typeof getDiscoveryCandidatesAction>>>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("Jorhat, Assam, India");
  const [category, setCategory] = useState("gym");
  const [dailyTarget, setDailyTarget] = useState(5);
  const [rotationText, setRotationText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const refreshOverview = async () => {
    const overview = await getDiscoveryOverviewAction();
    setStats(overview.stats);
    setCandidates(overview.candidates);
    setBatches(overview.batches);
    return overview;
  };

  useEffect(() => {
    refreshOverview()
      .then(({ settings }) => {
        if (settings.location) setLocation(settings.location);
        if (settings.category) setCategory(settings.category);
        if (settings.dailyTarget) setDailyTarget(settings.dailyTarget);
        if (settings.rotation?.length) setRotationText(settings.rotation.join("\n"));
      })
      .finally(() => setLoading(false));
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const result = await saveDiscoverySettingsAction({
        location,
        category,
        dailyTarget,
        rotation: rotationText.split("\n").map((c) => c.trim()).filter(Boolean),
      });
      setSaveMessage("error" in result ? (result.error ?? "Save failed.") : "Saved. The 6:00 AM IST daily run will use these settings.");
    } finally {
      setSaving(false);
    }
  };

  const runDiscovery = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runDiscoveryAction({ location, category, dailyTarget });
      setRunResult(result);
      await refreshOverview();
      if (result.qualified > 0) setSubTab("candidates");
    } finally {
      setRunning(false);
    }
  };

  const approve = async (id: string) => {
    const result = await approveCandidateAction(id);
    if (result.ok) {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      const newStats = await getDiscoveryStatsAction();
      setStats(newStats);
    }
  };

  const reject = async (id: string) => {
    const result = await rejectCandidateAction(id);
    if (result.ok) {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const viewBatch = async (batchId: string) => {
    setSelectedBatchId(batchId);
    const data = await getDiscoveryCandidatesAction(batchId);
    setBatchCandidates(data);
  };

  if (loading) return <LoadingState text="Loading Discovery Engine..." />;

  return (
    <div className="space-y-6">
      {/* Header + Run Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <PageTitle className="text-base flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            Discovery Engine
          </PageTitle>
          <p className="text-xs text-text-muted mt-1">
            Automated local business discovery via OpenStreetMap. Free, legal, no API keys.
          </p>
        </div>
        <button
          onClick={runDiscovery}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-all disabled:opacity-50 self-start"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {running ? "Running Discovery..." : "Run Discovery Now"}
        </button>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total Discovered", value: stats.totalDiscovered, icon: <Search className="h-3.5 w-3.5" /> },
            { label: "Qualified", value: stats.totalQualified, icon: <Target className="h-3.5 w-3.5" /> },
            { label: "Leads Created", value: stats.totalCreated, icon: <Users className="h-3.5 w-3.5" /> },
            { label: "Pending Review", value: stats.pendingReview, icon: <Clock className="h-3.5 w-3.5" /> },
            { label: "Batches Run", value: stats.totalBatches, icon: <Radar className="h-3.5 w-3.5" /> },
          ].map((s) => (
            <GlassCard key={s.label} className="p-3">
              <div className="flex items-center gap-1.5 text-text-muted mb-1">
                {s.icon}
                <span className="text-xs">{s.label}</span>
              </div>
              <span className="num text-xl font-medium text-text-primary">{s.value}</span>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Run Result */}
      {runResult && (
        <GlassCard className={`p-4 ${runResult.status === "FAILED" ? "border-destructive/30" : "border-success/30"}`}>
          <div className="flex items-center gap-2 mb-2">
            {runResult.status === "FAILED" ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : runResult.status === "SKIPPED" ? (
              <Clock className="h-4 w-4 text-warning" />
            ) : (
              <CheckCircle className="h-4 w-4 text-success" />
            )}
            <span className="text-xs font-semibold text-text-primary">
              {runResult.status === "SKIPPED"
                ? "Already ran today"
                : runResult.created > 0
                  ? `Run ${runResult.status}: ${runResult.created} leads created`
                  : `Run ${runResult.status}: ${runResult.qualified} new lead${runResult.qualified === 1 ? "" : "s"} waiting for your review`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {runResult.notes.slice(0, 6).map((note, i) => (
              <Badge key={i} variant="secondary" className="text-[11px]">{note}</Badge>
            ))}
          </div>
          {runResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {runResult.errors.map((err, i) => (
                <p key={i} className="text-xs text-destructive">{err}</p>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border-subtle bg-surface-lowest/70 p-1 scrollbar-thin">
        {([
          { key: "candidates" as const, label: `Pending Review (${candidates.length})` },
          { key: "batches" as const, label: "Run History" },
          { key: "settings" as const, label: "Settings" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              subTab === t.key
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-high/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Pending Candidates */}
      {subTab === "candidates" && (
        <div className="space-y-3">
          {candidates.length === 0 ? (
            <GlassPanel>
              <EmptyState
                icon={CheckCircle}
                title="All caught up"
                body="No gyms are waiting for review. Run discovery to look for more businesses without a website."
                action={
                  <button
                    type="button"
                    onClick={runDiscovery}
                    disabled={running}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-50"
                  >
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Run discovery now
                  </button>
                }
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {candidates.map((c) => (
                <CandidateCard key={c.id} candidate={c} onApprove={approve} onReject={reject} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Batch History */}
      {subTab === "batches" && (
        <div className="space-y-3">
          {batches.length === 0 ? (
            <GlassPanel>
              <EmptyState
                icon={Radar}
                title="No discovery runs yet"
                body="Runs show up here after the daily search at 6:00 AM IST, or as soon as you press Run discovery now."
              />
            </GlassPanel>
          ) : (
            <>
              <div className="space-y-2">
                {batches.map((b) => (
                  <GlassCard
                    key={b.id}
                    className={`p-3 cursor-pointer transition-all hover:border-primary/30 ${selectedBatchId === b.id ? "border-primary/40" : ""}`}
                    onClick={() => viewBatch(b.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={b.status === "COMPLETED" ? "primary" : b.status === "FAILED" ? "danger" : "secondary"}
                          className="text-[11px]"
                        >
                          {b.status}
                        </Badge>
                        <span className="text-xs font-mono-code text-text-muted">{b.runId}</span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {new Date(b.createdAt).toLocaleDateString()} {new Date(b.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-text-muted">
                      <span>Discovered: {b.discoveredCount}</span>
                      <span>Qualified: {b.qualifiedCount}</span>
                      <span className="text-success">Created: {b.createdCount}</span>
                      <span>Skipped: {b.skippedCount}</span>
                    </div>
                  </GlassCard>
                ))}
              </div>

              {selectedBatchId && batchCandidates.length > 0 && (
                <div className="space-y-2">
                  <FieldLabel className="text-xs text-text-muted">Candidates in batch</FieldLabel>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {batchCandidates.map((c) => (
                      <CandidateCard
                        key={c.id}
                        candidate={c}
                        onApprove={c.qualificationStatus === "PENDING" ? approve : undefined}
                        onReject={c.qualificationStatus === "PENDING" ? reject : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Settings */}
      {subTab === "settings" && (
        <GlassPanel className="p-5 space-y-4">
          <PageTitle className="text-sm">Discovery Settings</PageTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel className="block mb-1.5 text-xs">Target location</FieldLabel>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel className="block mb-1.5 text-xs">Category</FieldLabel>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <FieldLabel className="block mb-1.5 text-xs">Daily target</FieldLabel>
              <input
                type="number"
                min={1}
                max={25}
                value={dailyTarget}
                onChange={(e) => setDailyTarget(Number(e.target.value))}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          <div>
            <FieldLabel className="block mb-1.5 text-xs">Daily city rotation (one per line)</FieldLabel>
            <textarea
              rows={5}
              value={rotationText}
              onChange={(e) => setRotationText(e.target.value)}
              placeholder={"Guwahati, Assam, India\nDibrugarh, Assam, India\nTezpur, Assam, India"}
              aria-describedby="rotation-hint"
              className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
            />
            <p id="rotation-hint" className="mt-1 text-xs text-text-muted">
              The 6 AM run searches the next city each day, so it keeps finding new businesses. Leave empty to always search the location above.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={saveSettings}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Settings
            </button>
            {saveMessage && <span className="text-xs text-text-muted">{saveMessage}</span>}
          </div>
          <p className="text-xs text-text-muted">
            Runs automatically every day at 6:00 AM IST using the saved settings, or anytime with Run Discovery Now (uses the values above). Uses OpenStreetMap Overpass API (free, no keys).
          </p>
        </GlassPanel>
      )}
    </div>
  );
}

function waNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return null;
}

function CandidateCard({
  candidate,
  onApprove,
  onReject,
}: {
  candidate: Awaited<ReturnType<typeof getPendingCandidatesAction>>[number];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const totalScore = candidate.fitScore + candidate.opportunityScore;
  const wsStatus = candidate.websiteStatus;
  const isNoWebsite = wsStatus === "NO_WEBSITE" || wsStatus === "BROKEN_WEBSITE";
  const rawMeta = (candidate.discoveryMetadata ?? {}) as { email?: string | null; socials?: string[] };
  const meta = { email: rawMeta.email ?? null, socials: Array.isArray(rawMeta.socials) ? rawMeta.socials : [] };

  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary truncate">{candidate.businessName}</h4>
          <div className="flex items-center gap-2 mt-0.5">
            {candidate.category && (
              <span className="text-xs text-text-muted">{candidate.category}</span>
            )}
            <Badge
              variant={candidate.qualificationStatus === "IMPORTED" ? "primary" : candidate.qualificationStatus === "REJECTED" ? "danger" : "secondary"}
              className="text-[11px]"
            >
              {candidate.qualificationStatus}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <div className={`h-2 w-2 rounded-full ${totalScore >= 60 ? "bg-success" : totalScore >= 40 ? "bg-warning" : "bg-text-muted"}`} />
          <span className="text-xs font-mono-code text-text-muted">{totalScore}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-text-muted mb-2">
        {isNoWebsite && (
          <Badge variant="danger" className="text-[11px]">
            {wsStatus === "NO_WEBSITE" ? "No Website" : "Broken Website"}
          </Badge>
        )}
        {wsStatus === "POOR_WEBSITE" && (
          <Badge variant="secondary" className="text-[11px] border-warning/30">Poor Website</Badge>
        )}
        {candidate.phone && (
          <>
            <a href={`tel:${candidate.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1 text-success hover:underline">
              <Phone className="h-3 w-3" />{candidate.phone}
            </a>
            {waNumber(candidate.phone) && (
              <a
                href={`https://wa.me/${waNumber(candidate.phone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-success hover:underline"
              >
                WhatsApp
              </a>
            )}
          </>
        )}
        {meta.email && (
          <a href={`mailto:${meta.email}`} className="flex items-center gap-1 text-success hover:underline">
            <Mail className="h-3 w-3" />{meta.email}
          </a>
        )}
        {meta.socials.map((s) =>
          /^https?:\/\//.test(s) ? (
            <a key={s} href={s} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-success hover:underline">
              <ExternalLink className="h-3 w-3" />{s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 30)}
            </a>
          ) : (
            <span key={s} className="text-success">{s}</span>
          ),
        )}
        {!candidate.phone && !meta.email && meta.socials.length === 0 && (
          <Badge variant="secondary" className="text-[11px]">No contact listed</Badge>
        )}
        {candidate.address && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />{candidate.address}
          </span>
        )}
        {candidate.website && (
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />{candidate.website.replace(/^https?:\/\//, "").slice(0, 30)}
          </span>
        )}
      </div>

      {candidate.reasons && Array.isArray(candidate.reasons) && (candidate.reasons as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(candidate.reasons as string[]).slice(0, 3).map((r, i) => (
            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-success/10 text-success">{r}</span>
          ))}
        </div>
      )}

      {candidate.gaps && Array.isArray(candidate.gaps) && (candidate.gaps as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(candidate.gaps as string[]).slice(0, 2).map((g, i) => (
            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">{g}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-subtle">
        <div className="flex gap-2 text-xs text-text-muted">
          <span>Fit: {candidate.fitScore}</span>
          <span>Opp: {candidate.opportunityScore}</span>
        </div>
        {(onApprove || onReject) && (
          <div className="flex gap-1">
            {onApprove && (
              <button
                onClick={() => onApprove(candidate.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-success/15 text-success hover:bg-success/25 transition-all"
              >
                <ThumbsUp className="h-3 w-3" /> Approve
              </button>
            )}
            {onReject && (
              <button
                onClick={() => onReject(candidate.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-all"
              >
                <ThumbsDown className="h-3 w-3" /> Reject
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <a
            href={googleMapsUrl(candidate.businessName, candidate.address || candidate.city)}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Google Business Profile (phone, photos, reviews)"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            <MapPin className="h-3 w-3" /> Google Maps
          </a>
          {candidate.sourceUrl && (
            <a
              href={candidate.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              <ExternalLink className="h-3 w-3" /> OSM
            </a>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Sequences ────────────────────────────────────────────────────────

function SequencesTab() {
  const [sequences, setSequences] = useState<Awaited<ReturnType<typeof getSequencesAction>>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [targetProfile, setTargetProfile] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [newSequence, setNewSequence] = useState<Awaited<ReturnType<typeof generateSequenceAction>> | null>(null);

  useEffect(() => {
    getSequencesAction().then(setSequences).finally(() => setLoading(false));
  }, []);

  const createSequence = async () => {
    setCreating(true);
    try {
      const result = await generateSequenceAction({ targetProfile, valueProp });
      setNewSequence(result);
      const updated = await getSequencesAction();
      setSequences(updated);
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const toggleSequence = async (id: string, currentStatus: string) => {
    if (currentStatus === "ACTIVE") {
      await pauseSequenceAction(id);
    } else {
      await activateSequenceAction(id);
    }
    const updated = await getSequencesAction();
    setSequences(updated);
  };

  if (loading) return <LoadingState text="Loading sequences..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageTitle className="text-base">Outreach Sequences</PageTitle>
          <p className="text-xs text-text-muted mt-1">Multi-channel, AI-generated outreach campaigns.</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-all"
        >
          <Plus className="h-4 w-4" />
          New Sequence
        </button>
      </div>

      {showCreate && (
        <GlassPanel className="p-5 space-y-4">
          <PageTitle className="text-sm">Create AI Sequence</PageTitle>
          <div>
            <FieldLabel className="block mb-1.5 text-xs">Target prospect profile</FieldLabel>
            <input
              type="text"
              value={targetProfile}
              onChange={(e) => setTargetProfile(e.target.value)}
              placeholder="VP of Engineering at Series A-B SaaS companies"
              className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <FieldLabel className="block mb-1.5 text-xs">Value proposition</FieldLabel>
            <textarea
              rows={2}
              value={valueProp}
              onChange={(e) => setValueProp(e.target.value)}
              placeholder="We help teams double their pipeline with AI-powered outbound..."
              className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none resize-none"
            />
          </div>
          <button
            onClick={createSequence}
            disabled={creating || targetProfile.length < 5 || valueProp.length < 10}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {creating ? "Generating..." : "Generate Sequence"}
          </button>
        </GlassPanel>
      )}

      {newSequence && (
        <GlassPanel className="p-5 border-success/30">
          <div className="flex items-center gap-2 mb-3">
            <Check className="h-4 w-4 text-success" />
            <span className="text-xs font-semibold text-success">Sequence created: {newSequence.sequence.name}</span>
          </div>
          <div className="space-y-2">
            {newSequence.steps.map((step) => (
              <div key={step.stepNumber} className="rounded-lg bg-surface-low p-3 border border-border-subtle">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[11px]">Step {step.stepNumber}</Badge>
                  <ChannelBadge channel={step.channel} />
                  {step.delayDays > 0 && (
                    <span className="text-xs text-text-muted">+{step.delayDays}d</span>
                  )}
                </div>
                {step.subject && <div className="text-xs font-medium text-text-primary mb-1">{step.subject}</div>}
                <p className="text-xs text-text-secondary line-clamp-2">{step.body}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setNewSequence(null)} className="mt-3 text-xs text-text-muted hover:text-text-secondary">
            Dismiss
          </button>
        </GlassPanel>
      )}

      {sequences.length === 0 ? (
        <GlassPanel>
          <EmptyState
            icon={Send}
            title="No sequences yet"
            body="A sequence drafts timed follow-ups for a group of leads. Nothing is sent until you approve it. Create one above to start."
          />
        </GlassPanel>
      ) : (
        <div className="space-y-2">
          {sequences.map((seq) => (
            <GlassCard key={seq.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-text-primary truncate">{seq.name}</h4>
                    <Badge
                      variant={seq.status === "ACTIVE" ? "primary" : seq.status === "PAUSED" ? "secondary" : "secondary"}
                      className="text-[11px] shrink-0"
                    >
                      {seq.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-text-muted">{seq.totalEnrolled} enrolled</span>
                    <span className="text-xs text-text-muted">{seq.totalReplied} replied</span>
                    <span className="text-xs text-text-muted">{seq.totalMeetings} meetings</span>
                    <span className="text-xs text-text-muted">
                      {new Date(seq.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => toggleSequence(seq.id, seq.status)}
                  className="shrink-0 ml-3 p-2 rounded-lg hover:bg-surface-high transition-colors"
                  title={seq.status === "ACTIVE" ? "Pause" : "Activate"}
                >
                  {seq.status === "ACTIVE" ? (
                    <Pause className="h-4 w-4 text-warning" />
                  ) : (
                    <Play className="h-4 w-4 text-success" />
                  )}
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reactivation ─────────────────────────────────────────────────────

function ReactivationTab() {
  const [loading, setLoading] = useState(false);
  const [dormantLeads, setDormantLeads] = useState<Awaited<ReturnType<typeof findDormantLeadsAction>> | null>(null);

  const findDormant = async () => {
    setLoading(true);
    try {
      const data = await findDormantLeadsAction(14);
      setDormantLeads(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageTitle className="text-base">Reactivation Engine</PageTitle>
          <p className="text-xs text-text-muted mt-1">
            Re-engage dormant leads at the right time based on their stated timeline.
          </p>
        </div>
        <button
          onClick={findDormant}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {loading ? "Scanning..." : "Find Dormant Leads"}
        </button>
      </div>

      {dormantLeads && dormantLeads.length > 0 ? (
        <div className="space-y-2">
          {dormantLeads.map((row) => (
            <GlassCard key={row.lead.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-text-primary">
                      {row.contact?.firstName} {row.contact?.lastName || ""}
                    </h4>
                    {row.contact?.jobTitle && (
                      <span className="text-xs text-text-muted">{row.contact.jobTitle}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {row.company?.name && (
                      <span className="text-xs text-text-secondary">{row.company.name}</span>
                    )}
                    <span className="text-xs text-text-muted">
                      Score: {row.lead.score} &middot; Last contact: {row.lead.lastContactedAt
                        ? new Date(row.lead.lastContactedAt).toLocaleDateString()
                        : "never"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">{row.lead.temperature}</Badge>
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : dormantLeads && dormantLeads.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <Check className="h-10 w-10 text-success mx-auto mb-3" />
          <p className="text-sm text-text-muted">No dormant leads found. Your pipeline is active!</p>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-8 text-center">
          <RotateCcw className="h-10 w-10 text-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            Scan for leads that haven&apos;t been contacted in 14+ days and generate re-engagement messages.
          </p>
        </GlassPanel>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
      <span className="text-xs text-text-muted">{text}</span>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const config: Record<string, { icon: React.ReactNode; color: string }> = {
    EMAIL: { icon: <Mail className="h-3 w-3" />, color: "text-primary" },
    LINKEDIN: { icon: <Link2 className="h-3 w-3" />, color: "text-info" },
    WHATSAPP: { icon: <MessageSquare className="h-3 w-3" />, color: "text-success" },
    CALL: { icon: <Phone className="h-3 w-3" />, color: "text-warning" },
  };
  const c = config[channel] || config.EMAIL;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-mono-code ${c.color}`}>
      {c.icon} {channel}
    </span>
  );
}
