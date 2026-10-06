"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  Flame,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-card";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import {
  generateOutreachSequenceAction,
  getOutboundWorkspaceAction,
  preparePersonalizedOpeningAction,
} from "@/app/actions/ai.actions";

type Snapshot = Awaited<ReturnType<typeof getOutboundWorkspaceAction>>;
type Lead = Snapshot["priorityLeads"][number];
type Opening = Awaited<ReturnType<typeof preparePersonalizedOpeningAction>>;

const channels = [
  { id: "EMAIL", label: "Email", icon: Mail },
  { id: "LINKEDIN", label: "LinkedIn", icon: Send },
  { id: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
] as const;

export default function OutreachPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [channel, setChannel] = useState<(typeof channels)[number]["id"]>("EMAIL");
  const [opening, setOpening] = useState<Opening | null>(null);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetProfile, setTargetProfile] = useState(
    "Owners, founders and decision-makers at growing local businesses that need better websites and lead generation.",
  );
  const [valueProp, setValueProp] = useState(
    "We design premium websites and build practical marketing systems that turn attention into qualified enquiries.",
  );
  const [sequence, setSequence] = useState<Awaited<ReturnType<typeof generateOutreachSequenceAction>> | null>(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getOutboundWorkspaceAction());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load outbound intelligence.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const queue = useMemo(() => {
    if (!snapshot) return [];
    const seen = new Set<string>();
    return [...snapshot.priorityLeads, ...snapshot.dueFollowUps, ...snapshot.reactivationCandidates].filter((lead) => {
      if (seen.has(lead.id)) return false;
      seen.add(lead.id);
      return true;
    }).slice(0, 10);
  }, [snapshot]);

  const prepareOpening = async (lead: Lead) => {
    setSelectedLead(lead);
    setOpening(null);
    setOpeningLoading(true);
    try {
      setOpening(await preparePersonalizedOpeningAction(lead.id, channel));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the opening.");
    } finally {
      setOpeningLoading(false);
    }
  };

  const generateSequence = async () => {
    setSequenceLoading(true);
    setError(null);
    try {
      setSequence(await generateOutreachSequenceAction(targetProfile, valueProp));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the sequence.");
    } finally {
      setSequenceLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // AI SALES ENGINE</MonoLabel>
          <Display>Fill the pipeline.</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Discover who deserves attention, understand why, prepare the next touch, and hand high-intent conversations back to the team.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold text-text-primary transition hover:border-primary/40 hover:bg-surface-high disabled:opacity-50"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh intelligence
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ["Active leads", snapshot?.metrics.totalLeads ?? 0, Users],
          ["Hot", snapshot?.metrics.hotLeads ?? 0, Flame],
          ["Follow-ups due", snapshot?.metrics.dueFollowUps ?? 0, Clock3],
          ["Stale", snapshot?.metrics.staleLeads ?? 0, AlertCircle],
          ["Reactivation", snapshot?.metrics.reactivationCandidates ?? 0, RefreshCw],
          ["Accounts", snapshot?.metrics.companies ?? 0, Target],
          ["Open deals", snapshot?.metrics.openDeals ?? 0, Zap],
          ["Pipeline", `$\${(snapshot?.metrics.pipelineValue ?? 0).toLocaleString()}`, Sparkles],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-xl border border-border-subtle bg-surface-low p-4">
            <Icon className="h-4 w-4 text-primary" />
            <div className="mt-3 text-xl font-semibold text-text-primary">{String(value)}</div>
            <div className="mt-1 text-[10px] font-mono-code uppercase tracking-wider text-text-muted">{String(label)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
        <GlassPanel className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <MonoLabel className="text-secondary">TODAY'S OUTBOUND QUEUE</MonoLabel>
              <PageTitle className="mt-1 text-lg">Who needs attention?</PageTitle>
            </div>
            <Badge variant="primary">{queue.length} priority</Badge>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((n) => <div key={n} className="h-20 animate-pulse rounded-xl bg-surface-low" />)}
            </div>
          ) : queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-8 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-text-muted" />
              <p className="mt-3 text-sm text-text-secondary">No priority leads are currently queued.</p>
              <p className="mt-1 text-xs text-text-muted">Import or discover leads to start the outbound loop.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queue.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => void prepareOpening(lead)}
                  className={`group w-full rounded-xl border p-4 text-left transition ${selectedLead?.id === lead.id ? "border-primary/50 bg-primary/5" : "border-border-subtle bg-surface-low hover:border-primary/30 hover:bg-surface-high/50"}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary">{lead.company}</span>
                        <Badge variant={lead.temperature === "HOT" || lead.score >= 70 ? "tertiary" : "outline"}>{lead.score}</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-text-muted">
                        {lead.contact?.name || "Unknown contact"}{lead.contact?.title ? ` · ${lead.contact.title}` : ""}{lead.industry ? ` · ${lead.industry}` : ""}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
                    {lead.nextFollowUpAt && <span className="rounded-full bg-surface-high px-2 py-1">follow-up due</span>}
                    {lead.daysSinceContact === null && <span className="rounded-full bg-surface-high px-2 py-1">never contacted</span>}
                    {lead.daysSinceContact !== null && lead.daysSinceContact >= 7 && <span className="rounded-full bg-surface-high px-2 py-1">{lead.daysSinceContact}d quiet</span>}
                    {lead.status === "NURTURE" && <span className="rounded-full bg-surface-high px-2 py-1">nurture</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </GlassPanel>

        <GlassPanel className="p-6">
          <div className="flex flex-col gap-4 border-b border-border-subtle pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <MonoLabel className="text-secondary">PERSONALIZED FIRST TOUCH</MonoLabel>
              <PageTitle className="mt-1 text-lg">
                {selectedLead ? selectedLead.company : "Select a lead"}
              </PageTitle>
            </div>
            <div className="flex gap-1 rounded-xl border border-border-subtle bg-surface-low p-1">
              {channels.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    setChannel(id);
                    if (selectedLead) void prepareOpening(selectedLead);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${channel === id ? "bg-primary/15 text-primary" : "text-text-muted hover:text-text-primary"}`}
                >
                  <Icon className="mr-1 inline h-3 w-3" />{label}
                </button>
              ))}
            </div>
          </div>

          {!selectedLead ? (
            <div className="flex min-h-[290px] items-center justify-center text-center">
              <div>
                <Target className="mx-auto h-8 w-8 text-text-muted" />
                <p className="mt-3 text-sm text-text-secondary">Pick a lead from the queue.</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-text-muted">Aexyl will prepare a grounded opening from the CRM profile. It will never send automatically from this screen.</p>
              </div>
            </div>
          ) : openingLoading ? (
            <div className="min-h-[290px] animate-pulse rounded-xl bg-surface-low" />
          ) : opening ? (
            <div className="mt-6 space-y-5">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <MonoLabel className="text-primary">GENERATED OPENING</MonoLabel>
                  <Badge variant="outline">{opening.generatedBy === "llm" ? "AI grounded" : "Fallback"}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7 text-text-primary">{opening.opening}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border-subtle bg-surface-low p-4">
                  <MonoLabel>ANGLE</MonoLabel>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">{opening.angle}</p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-low p-4">
                  <MonoLabel>WHY THIS ANGLE</MonoLabel>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">{opening.reason}</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-low p-4">
                <div>
                  <p className="text-xs font-semibold text-text-primary">Human approval required</p>
                  <p className="mt-1 text-[11px] text-text-muted">Preparation is safe. Sending remains a separate controlled action.</p>
                </div>
                <Badge variant="secondary">PREPARE ONLY</Badge>
              </div>
            </div>
          ) : null}
        </GlassPanel>
      </div>

      <GlassPanel className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2"><Search className="h-4 w-4 text-primary" /></div>
          <div>
            <MonoLabel className="text-primary">ICP WORKBENCH</MonoLabel>
            <PageTitle className="mt-1 text-lg">Define who Aexyl should target</PageTitle>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <MonoLabel className="mb-2 block">TARGET PROFILE</MonoLabel>
            <textarea value={targetProfile} onChange={(e) => setTargetProfile(e.target.value)} rows={4} className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-4 text-sm text-text-primary outline-none transition focus:border-primary/50" />
          </div>
          <div>
            <MonoLabel className="mb-2 block">VALUE PROPOSITION</MonoLabel>
            <textarea value={valueProp} onChange={(e) => setValueProp(e.target.value)} rows={4} className="w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-4 text-sm text-text-primary outline-none transition focus:border-primary/50" />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-text-muted">This composer prepares a sequence. It does not silently send anything.</p>
          <button onClick={() => void generateSequence()} disabled={sequenceLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50">
            {sequenceLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {sequenceLoading ? "Preparing..." : "Generate sequence"}
          </button>
        </div>
        {sequence && (
          <div className="mt-6 grid gap-3 lg:grid-cols-3">
            {sequence.sequence.map((step) => (
              <div key={step.step} className="rounded-xl border border-border-subtle bg-surface-low p-5">
                <div className="flex items-center justify-between">
                  <MonoLabel>TOUCH {step.step}</MonoLabel>
                  <Badge variant="outline">{step.channel}</Badge>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-text-primary">{step.title}</h3>
                <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-text-secondary">{step.body}</p>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
