"use client";

import { useEffect, useState } from "react";
import { actionNeededSummaryAction } from "@/app/actions/agents.actions";

/**
 * Live "action needed" count for always-visible chrome (sidebar badge, header
 * pin). Polls a cheap workspace-scoped summary every 30s so pending agent
 * approvals are surfaced wherever the user is — not buried in the Agents
 * section. Non-critical chrome: failures are swallowed.
 */
export function useActionNeededCount(pollMs = 30_000) {
  const [state, setState] = useState<{ pending: number; failedRuns: number }>({
    pending: 0,
    failedRuns: 0,
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await actionNeededSummaryAction();
        if (alive) setState({ pending: res.pending, failedRuns: res.failedRuns });
      } catch {
        // badge is non-critical chrome
      }
    };
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

  return state;
}

/** Amber pill with the pending-approval count (hidden at zero). */
export function ActionNeededBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-tertiary px-1 font-mono-code text-[9px] font-bold text-white shadow-[0_0_10px_rgba(255,185,95,0.45)]"
      title={`${count} agent action${count === 1 ? "" : "s"} awaiting your approval`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
