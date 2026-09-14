"use client";

import { useState } from "react";
import { Display, PageTitle, MonoLabel } from "@/components/ui/typography";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Send, Sparkles, Cpu } from "lucide-react";
import { generateOutreachSequenceAction } from "@/app/actions/ai.actions";
import { useRealtimeTelemetry } from "@/lib/hooks/use-realtime-telemetry";

export default function OutreachPage() {
  const [targetProfile, setTargetProfile] = useState(
    "VP of Engineering / Founder at High-Growth Tech SaaS ($5M - $20M ARR)"
  );
  const [valueProp, setValueProp] = useState(
    "Focus on modernizing legacy CRM workflows into an AI-first operating system to double rep velocity."
  );
  const [loading, setLoading] = useState(false);
  const [sequence, setSequence] = useState<
    Awaited<ReturnType<typeof generateOutreachSequenceAction>> | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const { stats } = useRealtimeTelemetry();

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const seq = await generateOutreachSequenceAction(targetProfile, valueProp);
      setSequence(seq);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate sequence");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-primary block mb-1">AUTOMATION // CAMPAIGNS & AI COMPOSER</MonoLabel>
          <Display>Outreach Engine</Display>
        </div>
        <div className="flex items-center space-x-3">
          <Badge variant="secondary" className="font-mono-code text-[11px]">
            HOT LEADS: {stats?.hotLeads ?? 0}
          </Badge>
          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {loading ? <Cpu className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{loading ? "Generating..." : "Generate Sequence"}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Composer Panel */}
        <GlassPanel className="lg:col-span-2 p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <PageTitle className="text-base text-primary">Aexyl AI Email & Sequence Composer</PageTitle>
            </div>
            <Badge variant="primary" className="font-mono-code text-[9px]">RULES-BASED ENGINE</Badge>
          </div>

          <div className="space-y-4">
            <div>
              <MonoLabel className="block mb-1.5">TARGET PROSPECT PROFILE</MonoLabel>
              <input
                type="text"
                value={targetProfile}
                onChange={(e) => setTargetProfile(e.target.value)}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3.5 py-2.5 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <MonoLabel className="block mb-1.5">STRATEGIC ANGLE & VALUE PROP</MonoLabel>
              <textarea
                rows={3}
                value={valueProp}
                onChange={(e) => setValueProp(e.target.value)}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3.5 py-2.5 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-danger/10 border border-danger/30 p-3 text-xs text-danger">
                {error}
              </div>
            )}

            {sequence && (
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-lowest p-4 border border-border-subtle">
                  <MonoLabel className="text-secondary mb-2">SUBJECT</MonoLabel>
                  <p className="text-xs text-text-primary font-mono-code">{sequence.subject}</p>
                </div>
                {sequence.sequence.map((step) => (
                  <div key={step.step} className="rounded-lg bg-surface-lowest p-4 border border-border-subtle">
                    <div className="flex items-center justify-between mb-2">
                      <MonoLabel className="text-secondary">
                        {`STEP ${step.step} // ${step.channel}`}
                      </MonoLabel>
                      <span className="text-[10px] font-mono-code text-text-muted">{step.title}</span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{step.body}</p>
                  </div>
                ))}
              </div>
            )}

            {!sequence && !loading && (
              <div className="rounded-lg bg-surface-low/50 border border-dashed border-border-subtle p-6 text-center">
                <p className="text-xs text-text-muted">
                  Fill in the target profile and value prop, then hit Generate Sequence to produce a 3-touch email / LinkedIn / call plan.
                </p>
              </div>
            )}
          </div>
        </GlassPanel>

        {/* Campaign Metrics & History */}
        <div className="space-y-6">
          <GlassCard className="p-5">
            <MonoLabel className="block mb-3">LIVE PIPELINE CONTEXT</MonoLabel>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Hot Leads (Score ≥ 70)</span>
                  <span className="font-semibold text-text-primary">{stats?.hotLeads ?? 0}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-low overflow-hidden">
                  <div
                    className="h-full bg-tertiary"
                    style={{
                      width: `${stats?.activeLeads ? Math.min(100, ((stats.hotLeads ?? 0) / stats.activeLeads) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Active Leads</span>
                  <span className="font-semibold text-secondary">{stats?.activeLeads ?? 0}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-low overflow-hidden">
                  <div
                    className="h-full bg-secondary"
                    style={{
                      width: `${stats?.activeCompanies ? Math.min(100, ((stats.activeLeads ?? 0) / Math.max(1, stats.activeCompanies * 3)) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-muted">Open Pipeline</span>
                  <span className="font-semibold text-primary">${(stats?.pipelineRevenue ?? 0).toLocaleString()}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-low overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: "60%" }} />
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <MonoLabel className="block mb-3">WORKSPACE ACCOUNTS</MonoLabel>
            <div className="space-y-3">
              <div className="rounded-lg bg-surface-low p-3 border border-border-subtle text-xs">
                <div className="flex items-center justify-between font-semibold text-text-primary">
                  <span>Active Companies</span>
                  <Badge variant="secondary" className="text-[9px]">{stats?.activeCompanies ?? 0}</Badge>
                </div>
                <div className="mt-1 text-[11px] text-text-muted">Clients directory: /sales/companies</div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
