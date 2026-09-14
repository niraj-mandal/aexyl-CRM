"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { updateWorkspaceSettingsAction } from "@/app/actions/crm.actions";

export interface WorkspaceSettings {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  sweepEnabled: boolean;
  sweepFollowUpDays: number;
  staleLeadDays: number;
}

const TABS = [
  "Workspace",
  "Team",
  "Automations",
  "Security",
  "Integrations",
] as const;

export type SettingsTab = (typeof TABS)[number];

export function SettingsNav({
  active,
  onChange,
  counts,
}: {
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  counts?: Partial<Record<SettingsTab, string>>;
}) {
  return (
    <nav className="space-y-1">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          data-active={active === tab}
          className="w-full flex items-center justify-between text-left px-4 py-3 rounded-md text-sm font-medium transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-elevated/50 data-[active=true]:bg-surface-elevated data-[active=true]:text-text-primary"
        >
          <span>{tab}</span>
          {counts?.[tab] && (
            <span className="font-mono-code text-[10px] text-text-muted">{counts[tab]}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** Editable workspace name with save/cancel. */
export function WorkspaceNameEditor({ name }: { name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateWorkspaceSettingsAction({ name: value });
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename workspace");
      }
    });
  };

  if (!editing) {
    return (
      <div className="flex space-x-3">
        <input
          type="text"
          value={name}
          disabled
          className="flex-1 bg-surface border border-border-strong rounded-md px-4 py-2 text-sm text-text-primary opacity-70 cursor-not-allowed"
        />
        <button
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
          className="px-4 py-2 bg-surface-elevated text-sm font-medium rounded-md border border-border-strong hover:bg-surface-elevated/80 transition"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex space-x-3">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          className="flex-1 rounded-md bg-surface-lowest border border-border-subtle px-4 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none"
        />
        <button
          onClick={save}
          disabled={pending || value.trim().length < 2}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{pending ? "Saving..." : "Save"}</span>
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className="px-4 py-2 bg-surface-elevated text-sm font-medium rounded-md border border-border-strong hover:bg-surface-elevated/80 transition"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Automation toggles/numbers — every change persists and the sweep reads it live. */
export function AutomationControls({ settings }: { settings: WorkspaceSettings }) {
  const router = useRouter();
  const [sweepEnabled, setSweepEnabled] = useState(settings.sweepEnabled);
  const [followUpDays, setFollowUpDays] = useState(settings.sweepFollowUpDays);
  const [staleDays, setStaleDays] = useState(settings.staleLeadDays);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const persist = (patch: {
    sweepEnabled?: boolean;
    sweepFollowUpDays?: number;
    staleLeadDays?: number;
  }) => {
    setSaved(false);
    startTransition(async () => {
      await updateWorkspaceSettingsAction(patch);
      router.refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  return (
    <div className="space-y-6">
      {/* Sweep toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-primary">Agentic follow-up sweep</p>
          <p className="mt-1 text-xs text-text-muted">
            When on, the Copilot and My Day can automatically schedule follow-ups for stale
            leads. When off, sweeps are disabled workspace-wide.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={sweepEnabled}
          disabled={pending}
          onClick={() => {
            const next = !sweepEnabled;
            setSweepEnabled(next);
            persist({ sweepEnabled: next });
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            sweepEnabled ? "bg-primary" : "bg-surface-container-highest"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              sweepEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Intervals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-2">
          <span className="block text-sm font-medium text-text-primary">Follow-up in N days</span>
          <input
            type="number"
            min={1}
            max={30}
            value={followUpDays}
            onChange={(e) => setFollowUpDays(Number(e.target.value))}
            onBlur={() => {
              if (followUpDays !== settings.sweepFollowUpDays && followUpDays >= 1 && followUpDays <= 30) {
                persist({ sweepFollowUpDays: followUpDays });
              }
            }}
            className="w-24 rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none"
          />
          <span className="block text-[11px] text-text-muted">
            Scheduled follow-ups land this many days out (1–30).
          </span>
        </label>
        <label className="space-y-2">
          <span className="block text-sm font-medium text-text-primary">Stale after N quiet days</span>
          <input
            type="number"
            min={1}
            max={60}
            value={staleDays}
            onChange={(e) => setStaleDays(Number(e.target.value))}
            onBlur={() => {
              if (staleDays !== settings.staleLeadDays && staleDays >= 1 && staleDays <= 60) {
                persist({ staleLeadDays: staleDays });
              }
            }}
            className="w-24 rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none"
          />
          <span className="block text-[11px] text-text-muted">
            Leads with no contact for this long become sweep candidates (1–60).
          </span>
        </label>
      </div>

      <p className="text-xs text-secondary h-4" aria-live="polite">
        {pending ? "Saving..." : saved ? "Saved ✓" : ""}
      </p>
    </div>
  );
}
