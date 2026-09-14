"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFlagAction } from "@/app/actions/production.actions";

export function FlagToggle({
  flagKey,
  label,
  description,
  enabled,
}: {
  flagKey: string;
  label: string;
  description: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      await toggleFlagAction(flagKey, !enabled);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="font-mono-code text-[11px] text-text-primary">{label}</p>
        <p className="mt-0.5 text-[10px] text-text-muted">{description}</p>
      </div>
      <button
        onClick={toggle}
        disabled={pending}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          enabled ? "border-primary/50 bg-primary/30" : "border-border-subtle bg-surface-high/50"
        }`}
        aria-label={`Toggle ${label}`}
        aria-pressed={enabled}
      >
        <span
          className={`absolute top-0.5 rounded-full bg-white transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}
