"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { resolveIncidentAction } from "@/app/actions/production.actions";

export function ResolveIncidentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await resolveIncidentAction(incidentId);
          router.refresh();
        })
      }
      disabled={pending}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      {pending ? "Resolving…" : "Resolve"}
    </button>
  );
}
