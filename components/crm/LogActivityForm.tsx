"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, StickyNote, Loader2 } from "lucide-react";
import { createActivityAction } from "@/app/actions/crm.actions";

const TYPES = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
] as const;

/**
 * Inline activity logger for lead / deal / contact detail pages.
 * Persists a real activity row and refreshes the server-rendered timeline.
 */
export function LogActivityForm({
  entityType,
  entityId,
}: {
  entityType: "lead" | "deal" | "contact";
  entityId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("NOTE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center space-x-2 rounded-md bg-surface-elevated text-text-primary border border-border-strong px-4 py-2 text-sm font-medium hover:bg-surface-elevated/80 transition"
      >
        <Plus className="h-4 w-4" />
        <span>Log Activity</span>
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createActivityAction({
        entityType,
        entityId,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setOpen(false);
      setTitle("");
      setDescription("");
      setType("NOTE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log activity");
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
        <span className="flex items-center text-xs font-semibold text-text-primary">
          <StickyNote className="h-3.5 w-3.5 mr-1.5 text-primary" />
          Log Activity
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>

      <div className="flex space-x-2">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              type === t.value
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-surface-lowest border-border-subtle text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Discovery call with CTO)"
        required
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Details (optional)"
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
      />

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="w-full inline-flex items-center justify-center space-x-2 rounded-md bg-text-primary text-background px-4 py-2 text-xs font-semibold hover:bg-text-secondary transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{saving ? "Saving..." : "Save Activity"}</span>
      </button>
    </form>
  );
}
