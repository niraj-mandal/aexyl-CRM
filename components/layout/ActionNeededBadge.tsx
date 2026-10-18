"use client";

import { useAlerts } from "@/lib/hooks/use-alerts";

/** Pending approvals + recent failed runs, from the shared alerts poller. */
export function useActionNeededCount() {
  const { pending, failedRuns } = useAlerts();
  return { pending, failedRuns };
}

/** Amber pill with the pending-approval count (hidden at zero). */
export function ActionNeededBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-tertiary px-1 font-mono-code text-[11px] font-bold text-white shadow-[0_0_10px_rgba(255,185,95,0.45)]"
      title={`${count} agent action${count === 1 ? "" : "s"} awaiting your approval`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
