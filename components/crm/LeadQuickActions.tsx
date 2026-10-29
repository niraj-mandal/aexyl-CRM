"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Phone, Plus, X } from "lucide-react";
import { setLeadOutcomeAction, setLeadPhoneAction } from "@/app/actions/outreach.actions";
import { queueWithUndo } from "@/components/ui/undo-toast";
import { celebrate } from "@/components/ui/celebrate";

/** Shows the lead's phone, or an inline "+ Add phone" to paste one found on Google Maps. */
export function LeadPhoneEditor({ leadId, phone }: { leadId: string; phone: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (phone && !editing) {
    return (
      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 whitespace-nowrap py-2 text-xs text-success hover:underline sm:py-0">
        <Phone className="h-3 w-3" /> {phone}
      </a>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded border border-dashed border-border-subtle px-2 py-1.5 text-xs text-text-muted hover:text-primary sm:px-1.5 sm:py-0.5 hover:border-primary/40"
      >
        <Plus className="h-3 w-3" /> Add phone
      </button>
    );
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await setLeadPhoneAction(leadId, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      setValue("");
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="tel"
          inputMode="tel"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          placeholder="+91 98xxx xxxxx"
          aria-label="Phone number"
          className="w-32 rounded border border-border-subtle bg-surface-low px-1.5 py-0.5 text-xs text-text-primary focus:border-primary focus:outline-none"
        />
        <button type="submit" disabled={pending || !value.trim()} aria-label="Save phone" className="rounded p-1 text-success hover:bg-success/10 disabled:opacity-40">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="rounded p-1 text-text-muted hover:bg-surface-high">
          <X className="h-3 w-3" />
        </button>
      </div>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export const OUTCOME_OPTIONS = [
  { value: "INTERESTED", label: "Interested → deal", done: "Interested" },
  { value: "NOT_NOW", label: "Not now → 30 days", done: "Not now" },
  { value: "NOT_INTERESTED", label: "Not interested", done: "Not interested" },
  { value: "WON", label: "Won → project", done: "Won" },
];

/** Records an outcome after a 5 s undo window. */
export function recordOutcome(leadId: string, outcome: string, name: string, opts: { onDone?: () => void; onUndo?: () => void } = {}) {
  const done = OUTCOME_OPTIONS.find((o) => o.value === outcome)?.done ?? outcome;
  // A won gym deserves a moment: confetti once the save actually succeeds.
  const onDone = outcome === "WON" ? () => { celebrate(); opts.onDone?.(); } : opts.onDone;
  queueWithUndo(`${done} · ${name}`, () => setLeadOutcomeAction(leadId, outcome), { ...opts, onDone });
}

/** One-click result of a conversation; moves the lead to deal / nurture / lost / won. */
export function LeadOutcomeSelect({ leadId, name, onDone }: { leadId: string; name: string; onDone?: () => void }) {
  const router = useRouter();

  return (
    <select
      defaultValue=""
      onChange={(e) => {
        if (e.target.value)
          recordOutcome(leadId, e.target.value, name, {
            onDone: () => {
              router.refresh();
              onDone?.();
            },
          });
        e.target.value = "";
      }}
      aria-label="Record outcome"
      className="rounded border border-border-subtle bg-surface-low px-1.5 py-0.5 text-xs text-text-secondary focus:border-primary focus:outline-none"
    >
      <option value="" disabled>Outcome…</option>
      {OUTCOME_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
