"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { updateAgentConfigAction } from "@/app/actions/agents.actions";

const AUTONOMY_OPTIONS = [
  { level: 0, label: "L0 — Observe", hint: "Read data, analyze, produce insights. No mutations." },
  { level: 1, label: "L1 — Recommend", hint: "Analyze and recommend; prepare plans. No automatic mutations." },
  { level: 2, label: "L2 — Prepare", hint: "Create drafts and prepared actions; human confirmation required." },
  { level: 3, label: "L3 — Execute approved", hint: "Auto-execute actions explicitly approved by policy." },
];

export interface AgentSettings {
  enabled: boolean;
  autonomyLevel: number;
  allowedTools: string[];
  dailyRunLimit: number;
  maxTokensPerRun: number;
  dailyBudgetMicroUsd: number;
  requiresApprovalForWrites: boolean;
}

export function AgentSettingsForm({
  agentKey,
  name,
  initial,
}: {
  agentKey: string;
  name: string;
  initial: AgentSettings;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [autonomy, setAutonomy] = useState(initial.autonomyLevel);
  const [tools, setTools] = useState<string[]>(initial.allowedTools);
  const [runLimit, setRunLimit] = useState(initial.dailyRunLimit);
  const [tokenLimit, setTokenLimit] = useState(initial.maxTokensPerRun);
  const [budget, setBudget] = useState(initial.dailyBudgetMicroUsd);
  const [approvalForWrites, setApprovalForWrites] = useState(initial.requiresApprovalForWrites);

  const save = () => {
    setError(null);
    startTransition(async () => {
      await updateAgentConfigAction(agentKey, {
        enabled,
        autonomyLevel: autonomy,
        allowedTools: tools,
        dailyRunLimit: runLimit,
        maxTokensPerRun: tokenLimit,
        dailyBudgetMicroUsd: budget,
      });
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const toggleTool = (tool: string) =>
    setTools((t) => (t.includes(tool) ? t.filter((x) => x !== tool) : [...t, tool]));

  const microToUsd = (v: number) => (v / 1_000_000).toFixed(2);

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-text-primary">Status</p>
          <p className="text-[11px] text-text-muted">Disabled agents never run, manually or by event.</p>
        </div>
        <button
          onClick={() => setEnabled((e) => !e)}
          className={`relative h-6 w-11 rounded-full border transition-colors ${
            enabled ? "border-primary/50 bg-primary/30" : "border-border-subtle bg-surface-high/50"
          }`}
          aria-label={`Toggle ${name}`}
        >
          <span
            className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
            style={{ height: 18, width: 18 }}
          />
        </button>
      </div>

      {/* Autonomy */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-primary">Autonomy level</p>
        <div className="grid gap-2">
          {AUTONOMY_OPTIONS.map((opt) => (
            <button
              key={opt.level}
              onClick={() => setAutonomy(opt.level)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                autonomy === opt.level
                  ? "border-primary/50 bg-primary/10"
                  : "border-border-subtle/60 hover:bg-surface-high/40"
              }`}
            >
              <span className={`text-[11px] font-semibold ${autonomy === opt.level ? "text-primary" : "text-text-primary"}`}>
                {opt.label}
              </span>
              <span className="block text-[10px] text-text-muted">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Approval policy */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-text-primary">Writes require approval</p>
          <p className="text-[11px] text-text-muted">Any mutating tool call creates an Approval instead of executing.</p>
        </div>
        <button
          onClick={() => setApprovalForWrites((w) => !w)}
          className={`relative h-6 w-11 rounded-full border transition-colors ${
            approvalForWrites ? "border-primary/50 bg-primary/30" : "border-border-subtle bg-surface-high/50"
          }`}
          aria-label="Toggle approval requirement"
        >
          <span
            className={`absolute top-0.5 rounded-full bg-white transition-all ${approvalForWrites ? "left-[22px]" : "left-0.5"}`}
            style={{ height: 18, width: 18 }}
          />
        </button>
      </div>

      {/* Tools */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-primary">Allowed tools</p>
        <p className="text-[10px] text-text-muted">
          Unchecked tools are blocked by the policy engine before execution.
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_TOOLS.map((tool) => {
            const on = tools.includes(tool);
            return (
              <button
                key={tool}
                onClick={() => toggleTool(tool)}
                className={`rounded-full border px-2.5 py-1 font-mono-code text-[10px] transition-colors ${
                  on
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border-subtle/60 text-text-muted hover:bg-surface-high/40"
                }`}
              >
                {on ? "✓ " : ""}{tool}
              </button>
            );
          })}
        </div>
      </div>

      {/* Limits */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Daily run limit</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={runLimit}
            onChange={(e) => setRunLimit(Number(e.target.value))}
            className="w-full rounded-lg border border-border-subtle/60 bg-surface-lowest/60 px-3 py-2 text-xs text-text-primary outline-none focus:border-primary/50"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Max tokens / run</span>
          <input
            type="number"
            min={0}
            max={200000}
            step={1000}
            value={tokenLimit}
            onChange={(e) => setTokenLimit(Number(e.target.value))}
            className="w-full rounded-lg border border-border-subtle/60 bg-surface-lowest/60 px-3 py-2 text-xs text-text-primary outline-none focus:border-primary/50"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Daily budget (USD)</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={microToUsd(budget)}
            onChange={(e) => setBudget(Math.round(Number(e.target.value) * 1_000_000))}
            className="w-full rounded-lg border border-border-subtle/60 bg-surface-lowest/60 px-3 py-2 text-xs text-text-primary outline-none focus:border-primary/50"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-4 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-[11px] text-success">Saved.</span>}
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </div>
    </div>
  );
}

/** Full tool catalog the settings form can toggle. Keep in sync with agents/core/registry/tools.ts. */
const ALL_TOOLS = [
  "crm.search_companies",
  "crm.search_contacts",
  "crm.search_leads",
  "crm.get_lead",
  "crm.update_lead",
  "crm.search_deals",
  "crm.move_deal_stage",
  "crm.create_activity",
  "projects.search_projects",
  "projects.create_task",
  "intelligence.get_business_metrics",
  "intelligence.get_insights",
  "intelligence.get_attention_items",
  "intelligence.get_daily_briefing",
  "research.web_search",
  "communication.prepare_email",
  "communication.send_email",
];
