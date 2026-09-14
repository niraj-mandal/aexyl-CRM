"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, X } from "lucide-react";
import {
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
} from "@/app/actions/crm.actions";

const STATUSES = ["ONBOARDING", "IN_PROGRESS", "BLOCKED", "DELIVERED", "CANCELLED"] as const;
const HEALTHS = ["HEALTHY", "AT_RISK", "OFF_TRACK"] as const;

export interface ProjectRecord {
  id: string;
  name: string;
  code: string | null;
  status: string;
  progress: number;
  health: string;
  budget: string | null;
  dueDate: string | null;
  notes: string | null;
  company: { name: string } | null;
  owner: { firstName: string | null; lastName: string | null } | null;
}

/** "New Project" trigger + inline create form with real companies to attach to. */
export function CreateProjectButton({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [budget, setBudget] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 transition-all"
      >
        <Plus className="h-4 w-4" />
        <span>New Project</span>
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProjectAction({
        name: name.trim(),
        companyId: companyId || undefined,
        budget: budget ? Number(budget) : undefined,
        dueDate: dueDate || undefined,
      });
      setOpen(false);
      setName("");
      setCompanyId("");
      setBudget("");
      setDueDate("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-low p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">New Project</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name (e.g. Client Portal Build)"
        required
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
      />
      <div className="flex space-x-2">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="flex-1 rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        >
          <option value="">No client</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="1000"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="Budget $"
          className="w-28 rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
        />
      </div>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        title="Due date"
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="w-full inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed transition"
      >
        {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {saving ? "Creating..." : "Create Project"}
      </button>
    </form>
  );
}

/** Inline progress + status + health controls on each project card. */
export function ProjectControls({ project }: { project: ProjectRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const update = async (input: { progress?: number; status?: string; health?: string }) => {
    setBusy(true);
    try {
      await updateProjectAction(project.id, input);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${project.code ?? project.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteProjectAction(project.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={project.status}
        onChange={(e) => update({ status: e.target.value })}
        disabled={busy}
        className="rounded-md bg-surface-lowest border border-border-subtle px-2 py-1 text-[10px] font-mono-code text-text-primary focus:border-primary/60 focus:outline-none disabled:opacity-50"
        title="Status"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      <select
        value={project.health}
        onChange={(e) => update({ health: e.target.value })}
        disabled={busy}
        className="rounded-md bg-surface-lowest border border-border-subtle px-2 py-1 text-[10px] font-mono-code text-text-primary focus:border-primary/60 focus:outline-none disabled:opacity-50"
        title="Health"
      >
        {HEALTHS.map((h) => (
          <option key={h} value={h}>
            {h.replace("_", " ")}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        max="100"
        defaultValue={project.progress}
        key={project.progress}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && v !== project.progress) update({ progress: v });
        }}
        disabled={busy}
        className="w-16 rounded-md bg-surface-lowest border border-border-subtle px-2 py-1 text-[10px] font-mono-code text-text-primary focus:border-primary/60 focus:outline-none disabled:opacity-50"
        title="Progress % (blur to save)"
      />
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-md p-1 text-text-muted hover:text-danger transition disabled:opacity-50"
        title="Delete project"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
