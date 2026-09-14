"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldBan, ShieldCheck } from "lucide-react";
import { setKillSwitchAction } from "@/app/actions/agents.actions";

/**
 * Workspace-level emergency stop for all agents. Engaging it blocks new runs
 * (policy engine) and cancels queued runs; the state is persisted server-side.
 */
export function KillSwitchButton({ engaged }: { engaged: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const toggle = () => {
    startTransition(async () => {
      await setKillSwitchAction(!engaged);
      router.refresh();
      setConfirming(false);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {confirming ? (
        <>
          <span className="text-[11px] text-text-muted">
            {engaged ? "Re-enable all agents?" : "Disable ALL agents in this workspace?"}
          </span>
          <button
            onClick={toggle}
            disabled={pending}
            className="rounded-lg border border-tertiary/40 bg-tertiary/10 px-3 py-1.5 text-[11px] font-semibold text-tertiary transition-colors hover:bg-tertiary/20 disabled:opacity-50"
          >
            {pending ? "Working…" : "Confirm"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-border-subtle px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-high/50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-high/40 px-4 py-2 text-[11px] font-semibold text-text-secondary transition-all hover:border-tertiary/40 hover:text-tertiary"
        >
          {engaged ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <ShieldBan className="h-3.5 w-3.5" />
          )}
          {engaged ? "Re-enable Agents" : "Disable All Agents"}
        </button>
      )}
    </div>
  );
}
