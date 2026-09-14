"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { completeTaskAction } from "@/app/actions/crm.actions";

/** Inline complete control for agent/operator tasks on My Day. */
export function CompleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-secondary">
        <CheckCircle2 className="h-3 w-3" /> Done
      </span>
    );
  }

  return (
    <button
      title={`Complete: ${title}`}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          await completeTaskAction(taskId);
          setDone(true);
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1 rounded border border-secondary/40 bg-secondary/10 px-2 py-1 text-[10px] font-semibold text-secondary hover:bg-secondary/20 disabled:opacity-50 transition-colors"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      Complete
    </button>
  );
}
