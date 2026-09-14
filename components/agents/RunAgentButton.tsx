"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";
import { runAgentAction } from "@/app/actions/agents.actions";

/**
 * "Run" trigger on each agent card in the Command Center. Executes the agent
 * synchronously via the runtime and surfaces the resulting run's outcome.
 */
export function RunAgentButton({ agentKey, disabled }: { agentKey: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await runAgentAction(
        agentKey,
        defaultObjective(agentKey),
        undefined
      );
      if (result && "blocked" in result && result.blocked) {
        setError(result.blocked);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending || disabled}
        className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
        title={disabled ? "Agent is disabled in settings" : "Run this agent now"}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {pending ? "Running…" : "Run"}
      </button>
      {error && <p className="max-w-[220px] text-right text-[10px] text-tertiary">{error}</p>}
    </div>
  );
}

function defaultObjective(agentKey: string): string {
  switch (agentKey) {
    case "scout":
      return "Discover new prospects matching our ICP and prepare them for review.";
    case "sales":
      return "Prioritize today's leads and recommend next actions.";
    case "outreach":
      return "Prepare an outreach draft for our hottest lead.";
    case "followup":
      return "Check for overdue follow-ups and prepare drafts.";
    case "operations":
      return "Review project health and flag operational risks.";
    case "executive":
      return "Brief me on the current state of the business.";
    default:
      return "Run a standard cycle.";
  }
}
