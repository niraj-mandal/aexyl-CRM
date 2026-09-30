"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, CheckCircle2 } from "lucide-react";
import { confirmLeadForMeetingAction } from "@/app/actions/crm.actions";

function defaultSlot(): string {
  // Tomorrow 10:00 local, in datetime-local format.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One click to confirm a lead: promotes it to QUALIFIED, books the meeting
 * against this lead/contact, then routes straight to the Calendar month that
 * will show it. The meeting persists as a real MEETING activity — nothing is
 * claimed before the write succeeds.
 */
export function ConfirmLeadButton({
  leadId,
  companyName,
  contactName,
}: {
  leadId: string;
  companyName: string;
  contactName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(
    `Intro call — ${contactName ? `${contactName} @ ` : ""}${companyName}`
  );
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
      const { when: iso } = await confirmLeadForMeetingAction({
        leadId,
        title: title.trim(),
        when,
        description: description.trim() || undefined,
      });
      // Route straight to the calendar for the month hosting the meeting.
      const d = new Date(iso);
      router.push(`/calendar?y=${d.getFullYear()}&m=${d.getMonth() + 1}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm lead");
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center space-x-2 rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition shadow-[0_0_15px_rgba(43,102,255,0.35)]"
      >
        <CalendarCheck className="h-4 w-4" />
        <span>Confirm lead &amp; book meeting</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-low p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center text-xs font-semibold text-text-primary">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-primary" />
          Confirm lead &amp; book meeting
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-text-muted hover:text-text-primary"
          disabled={saving}
        >
          Cancel
        </button>
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">Meeting title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">Date &amp; time</label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary [color-scheme:dark] focus:border-primary/60 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">Agenda (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Agenda, attendees, links…"
          className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none resize-none"
        />
      </div>

      <p className="text-[11px] text-text-muted leading-relaxed">
        Sets this lead to <span className="text-text-secondary">QUALIFIED</span> and adds the
        meeting to the Calendar + this lead&rsquo;s timeline.
      </p>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <button
        type="submit"
        disabled={saving || !title.trim() || !when}
        className="w-full inline-flex items-center justify-center space-x-2 rounded-md bg-primary text-white px-4 py-2 text-xs font-semibold hover:bg-primary/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{saving ? "Confirming…" : "Confirm → open calendar"}</span>
      </button>
    </form>
  );
}
