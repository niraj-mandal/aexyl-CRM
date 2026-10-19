"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, CheckCircle2, Loader2 } from "lucide-react";
import { queueStaleFollowUpsAction } from "@/app/actions/crm.actions";

/**
 * Agentic one-click action: schedules follow-ups for every stale/unattended
 * lead in the workspace and logs an activity trail for each.
 */
export function SweepButton({
  onDone,
  label = "Schedule follow-ups",
  className,
}: {
  onDone?: (report: Awaited<ReturnType<typeof queueStaleFollowUpsAction>>) => void;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const report = await queueStaleFollowUpsAction();
      setResult(
        report.scheduled > 0
          ? `${report.scheduled} follow-up${report.scheduled === 1 ? "" : "s"} scheduled (${report.skipped} already current)`
          : `All ${report.totalActive} active leads are current — nothing to schedule`
      );
      onDone?.(report);
      router.refresh();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex items-center space-x-3">
      {result && (
        <span className="flex items-center text-xs text-secondary font-mono-code">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
          {result}
        </span>
      )}
      <button
        onClick={run}
        disabled={running}
        className={
          className ??
          "inline-flex items-center justify-center space-x-2 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50 transition-all"
        }
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        <span>{running ? "Sweeping..." : label}</span>
      </button>
    </div>
  );
}
