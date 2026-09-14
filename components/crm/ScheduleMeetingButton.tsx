"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2 } from "lucide-react";
import { scheduleMeetingAction } from "@/app/actions/crm.actions";

function defaultSlot(): string {
  // Tomorrow 10:00 local, in datetime-local format.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Schedule a real meeting: persists a MEETING activity row so it lands on
 * the Calendar, the entity timeline, and agent context — no fake events.
 */
export function ScheduleMeetingButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultSlot());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setSaving(true);
    setError(null);
    try {
      await scheduleMeetingAction({ title: title.trim(), when, description: description.trim() || undefined });
      setOpen(false);
      setTitle("");
      setDescription("");
      setWhen(defaultSlot());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule meeting");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-elevated/80 transition"
            : "inline-flex items-center space-x-2 rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition shadow-[0_0_15px_rgba(43,102,255,0.35)]"
        }
      >
        <CalendarPlus className="h-4 w-4" />
        <span>Schedule meeting</span>
      </button>
    );
  }

  return (
    <div className="glass rounded-xl p-4 sm:p-5 w-full max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono-code uppercase tracking-wider text-text-muted mb-1">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Discovery call with…"
            autoFocus
            className="w-full rounded-md border border-border-strong bg-surface-lowest px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/60"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono-code uppercase tracking-wider text-text-muted mb-1">
            Date &amp; time
          </label>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface-lowest px-3 py-2 text-sm text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-primary/60"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono-code uppercase tracking-wider text-text-muted mb-1">
            Notes (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Agenda, attendees, links…"
            className="w-full rounded-md border border-border-strong bg-surface-lowest px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/60 resize-none"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-elevated transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !when}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
            Save to calendar
          </button>
        </div>
      </form>
    </div>
  );
}
