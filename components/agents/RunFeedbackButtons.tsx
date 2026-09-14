"use client";

import { useState, useTransition } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { submitRunFeedbackAction } from "@/app/actions/production.actions";

/**
 * Human feedback loop (spec §27): after a run completes, let the operator rate
 * whether the agent's outcome was helpful. Stored in agent_feedback so
 * prompts/policies can be tuned from real outcomes.
 */
export function RunFeedbackButtons({ runId, existingRating }: { runId: string; existingRating?: string | null }) {
  const [rating, setRating] = useState<string | null>(existingRating ?? null);
  const [pending, startTransition] = useTransition();

  function submit(next: "HELPFUL" | "NOT_HELPFUL") {
    setRating(next);
    startTransition(async () => {
      await submitRunFeedbackAction(runId, next);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono-code text-[10px] text-text-muted">Helpful?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => submit("HELPFUL")}
        aria-pressed={rating === "HELPFUL"}
        className={`rounded-lg border p-1.5 transition-colors ${
          rating === "HELPFUL"
            ? "border-success/50 bg-success/10 text-success"
            : "border-border-subtle/60 text-text-muted hover:text-text-primary"
        }`}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => submit("NOT_HELPFUL")}
        aria-pressed={rating === "NOT_HELPFUL"}
        className={`rounded-lg border p-1.5 transition-colors ${
          rating === "NOT_HELPFUL"
            ? "border-danger/50 bg-danger/10 text-danger"
            : "border-border-subtle/60 text-text-muted hover:text-text-primary"
        }`}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
