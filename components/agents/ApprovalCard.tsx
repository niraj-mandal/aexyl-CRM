"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { approveAgentActionAction, rejectApprovalAction } from "@/app/actions/agents.actions";

export interface ApprovalItem {
  id: string;
  agentName: string;
  toolName: string;
  actionType: string;
  description: string;
  riskLevel: string;
  proposedArguments: unknown;
  impactSummary: string | null;
  requestedAt: string;
  expiresAt: string;
}

/**
 * One pending agent action awaiting a human decision. This card IS the human
 * approval gate — nothing executes until Approve is clicked.
 */
export function ApprovalCard({ approval }: { approval: ApprovalItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string } | void>) => {
    startTransition(async () => {
      const res = await fn();
      if (res && res.ok === false) {
        setOutcome(res.error ?? "Failed");
      } else {
        router.refresh();
      }
    });
  };

  const riskTone =
    approval.riskLevel === "HIGH"
      ? "text-tertiary border-tertiary/40 bg-tertiary/10"
      : approval.riskLevel === "MEDIUM"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-text-muted border-border-subtle bg-surface-high/50";

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-low/80 backdrop-blur-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-primary">{approval.agentName}</span>
            <span className="font-mono-code text-[10px] text-text-muted">wants to</span>
            <span className="font-mono-code text-[10px] text-primary">{approval.actionType.replace(/_/g, " ")}</span>
            <span className={`rounded border px-1.5 py-0.5 font-mono-code text-[9px] ${riskTone}`}>
              {approval.riskLevel}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-text-secondary">{approval.description}</p>
          {approval.impactSummary && (
            <p className="mt-1 text-[11px] text-text-muted">{approval.impactSummary}</p>
          )}
          <p className="mt-1 font-mono-code text-[10px] text-text-muted/70">
            requested {approval.requestedAt} · expires {approval.expiresAt}
          </p>
        </div>
      </div>

      <button
        onClick={() => setExpanded((e) => !e)}
        className="mt-2 flex items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-secondary"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Review proposed arguments
      </button>
      {expanded && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-subtle/60 bg-surface-lowest/80 p-3 font-mono-code text-[10px] leading-relaxed text-text-secondary scrollbar-thin">
          {JSON.stringify(approval.proposedArguments, null, 2)}
        </pre>
      )}

      {outcome ? (
        <p className="mt-3 text-[11px] text-tertiary">{outcome}</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => run(() => approveAgentActionAction(approval.id))}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {pending ? "Executing…" : "Approve & Execute"}
          </button>
          <button
            onClick={() => run(() => approveAgentActionAction(approval.id, true))}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-high/50 disabled:opacity-50"
            title="Simulate the approved action without side effects"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Dry run
          </button>
          <button
            onClick={() => run(() => rejectApprovalAction(approval.id))}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-tertiary/40 hover:text-tertiary disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
