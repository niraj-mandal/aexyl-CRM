"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Phone, Plus, X } from "lucide-react";
import { setLeadOutcomeAction, setLeadPhoneAction } from "@/app/actions/outreach.actions";

/** Shows the lead's phone, or an inline "+ Add phone" to paste one found on Google Maps. */
export function LeadPhoneEditor({ leadId, phone }: { leadId: string; phone: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (phone && !editing) {
    return (
      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-xs text-success hover:underline">
        <Phone className="h-3 w-3" /> {phone}
      </a>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded border border-dashed border-border-subtle px-1.5 py-0.5 text-xs text-text-muted hover:text-primary hover:border-primary/40"
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

const OUTCOME_OPTIONS = [
  { value: "INTERESTED", label: "Interested → deal" },
  { value: "NOT_NOW", label: "Not now → 30 days" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "WON", label: "Won → project" },
];

/** One-click result of a conversation; moves the lead to deal / nurture / lost / won. */
export function LeadOutcomeSelect({ leadId, compact, onDone }: { leadId: string; compact?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = (outcome: string) => {
    if (!outcome) return;
    setMessage(null);
    startTransition(async () => {
      const res = await setLeadOutcomeAction(leadId, outcome);
      setMessage(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) {
        router.refresh();
        onDone?.();
      }
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <select
          defaultValue=""
          disabled={pending}
          onChange={(e) => {
            choose(e.target.value);
            e.target.value = "";
          }}
          aria-label="Record outcome"
          className={`rounded border border-border-subtle bg-surface-low px-1.5 py-0.5 text-text-secondary focus:border-primary focus:outline-none disabled:opacity-50 ${compact ? "text-xs" : "text-xs"}`}
        >
          <option value="" disabled>Outcome…</option>
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {pending && <Loader2 className="h-3 w-3 animate-spin text-text-muted" />}
      </div>
      {message && (
        <span role="status" className={`text-xs ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</span>
      )}
    </div>
  );
}
