"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteLeadAction } from "@/app/actions/crm.actions";

/**
 * Per-row delete for the leads table. Two-stage confirm (click → "Sure?" →
 * executes) keeps stray clicks harmless; the actual deletion is the existing
 * audited, workspace-scoped deleteLeadAction.
 */
export function DeleteLeadButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        const deleted = await deleteLeadAction(leadId);
        if (!deleted) {
          setError("Not found");
          setConfirming(false);
          return;
        }
        router.refresh();
      } catch {
        setError("Failed");
        setConfirming(false);
      }
    });
  };

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <span className="max-w-[140px] truncate text-[10px] text-text-muted" title={`Delete "${leadName}"?`}>
          Delete {leadName}?
        </span>
        <button
          onClick={handleDelete}
          disabled={pending}
          className="rounded bg-danger px-2 py-1 text-[10px] font-bold text-white hover:bg-danger/90 disabled:opacity-50 transition-colors"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded border border-border-subtle px-2 py-1 text-[10px] text-text-muted hover:text-text-primary transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-[10px] text-danger">{error}</span>}
      <button
        onClick={(e) => {
          if (!e.nativeEvent.isTrusted) return; // stray/synthetic clicks can't arm
          setConfirming(true);
        }}
        disabled={pending}
        aria-label={`Delete lead ${leadName}`}
        title={`Delete ${leadName}`}
        className="rounded p-1.5 text-text-muted opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus:opacity-100 focus:outline-none transition-all disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
