"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageCircle, Phone, X } from "lucide-react";
import { markContactedAction, unmarkContactedAction } from "@/app/actions/outreach.actions";
import { queueWithUndo } from "@/components/ui/undo-toast";

/**
 * "Reached out" tick box for a lead. Ticking asks Call or WhatsApp and logs the contact
 * (next follow-up in 3 days); unticking undoes it. Both wait 5 s with Undo before saving.
 */
export function ReachedOutToggle({ leadId, name, done }: { leadId: string; name: string; done: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  const [choosing, setChoosing] = useState(false);

  const tick = (channel: "CALL" | "WHATSAPP") => {
    setChoosing(false);
    setChecked(true);
    queueWithUndo(
      `Reached out · ${name} (${channel === "CALL" ? "call" : "WhatsApp"})`,
      async () => {
        const res = await markContactedAction(leadId, channel, "Ticked as reached out");
        return res.ok ? { ok: true, message: "Logged. Next follow-up in 3 days." } : res;
      },
      { onDone: () => router.refresh(), onUndo: () => setChecked(false) },
    );
  };

  const untick = () => {
    setChecked(false);
    queueWithUndo(`Not reached out · ${name}`, () => unmarkContactedAction(leadId), {
      onDone: () => router.refresh(),
      onUndo: () => setChecked(true),
    });
  };

  return (
    <span className="relative inline-flex items-center gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? `Reached out to ${name}. Click to untick` : `Mark ${name} as reached out`}
        title={checked ? "Reached out (click to untick)" : "Mark as reached out"}
        onClick={() => (checked ? untick() : setChoosing((v) => !v))}
        className={`relative flex h-5 w-5 shrink-0 items-center before:absolute before:-inset-2.5 before:content-[''] sm:before:hidden justify-center rounded-md border-2 transition-colors ${
          checked ? "border-success bg-success text-white" : "border-border-strong hover:border-primary"
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      {choosing && (
        <span
          role="group"
          aria-label="How did you reach them?"
          className="absolute left-7 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 rounded-lg border border-border-subtle bg-[var(--surface-glass-floating)] p-1 shadow-xl backdrop-blur-xl animate-in fade-in duration-150"
          onKeyDown={(e) => e.key === "Escape" && setChoosing(false)}
        >
          <button
            type="button"
            autoFocus
            onClick={() => tick("CALL")}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-success/10 px-3 py-2 text-xs sm:px-2 sm:py-1 font-medium text-success hover:bg-success/20"
          >
            <Phone className="h-3 w-3" /> Call
          </button>
          <button
            type="button"
            onClick={() => tick("WHATSAPP")}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-success/10 px-3 py-2 text-xs sm:px-2 sm:py-1 font-medium text-success hover:bg-success/20"
          >
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </button>
          <button type="button" onClick={() => setChoosing(false)} aria-label="Cancel" className="rounded-md p-2 sm:p-1 text-text-muted hover:bg-[var(--fill-hover)]">
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </span>
  );
}
