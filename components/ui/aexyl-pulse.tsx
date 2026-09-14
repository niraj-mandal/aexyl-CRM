"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useRealtimeTelemetry } from "@/lib/hooks/use-realtime-telemetry";

type AexylPulseState = "idle" | "analyzing" | "important" | "approval";

interface AexylPulseProps {
  state?: AexylPulseState;
  className?: string;
}

const stateConfig = {
  idle: {
    color: "bg-secondary",
    ringColor: "bg-secondary/40",
    pulse: true,
  },
  analyzing: {
    color: "bg-primary",
    ringColor: "bg-primary/40",
    pulse: true,
  },
  important: {
    color: "bg-tertiary",
    ringColor: "bg-tertiary/40",
    pulse: true,
  },
  approval: {
    color: "bg-danger",
    ringColor: "bg-danger/40",
    pulse: true,
  },
};

export function AexylPulse({ state = "idle", className }: AexylPulseProps) {
  const config = stateConfig[state];
  const { connected, latencyMs, stats } = useRealtimeTelemetry();

  const status = connected ? "LIVE" : "OFFLINE";

  return (
    <div className={cn("inline-flex items-center space-x-2.5 rounded-full bg-surface-low border border-border-subtle px-3 py-1 text-[11px] font-mono-code tracking-[0.04em]", className)}>
      <div className="relative flex h-3.5 w-3.5 items-center justify-center">
        {config.pulse && (
          <motion.span
            className={cn("absolute inline-flex h-full w-full rounded-full opacity-75", config.ringColor)}
            animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full shadow-sm",
            connected ? config.color : "bg-danger"
          )}
        />
      </div>
      <span className="text-text-secondary">
        AEXYL {status} — {stats ? `${latencyMs}ms` : "no stream"}
      </span>
    </div>
  );
}
