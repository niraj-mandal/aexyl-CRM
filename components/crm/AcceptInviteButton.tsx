"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { acceptInviteAction } from "@/app/actions/invite.actions";

export function AcceptInviteButton({ token, workspaceName }: { token: string; workspaceName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const accept = () => {
    setError(null);
    startTransition(async () => {
      try {
        await acceptInviteAction(token);
        setDone(true);
        setTimeout(() => router.push("/"), 1200);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to accept invite");
      }
    });
  };

  if (done) {
    return (
      <p className="flex items-center justify-center text-sm font-medium text-secondary">
        <CheckCircle2 className="mr-2 h-4 w-4" /> You&apos;re in — taking you to {workspaceName}…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={accept}
        disabled={pending}
        className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? "Joining…" : `Accept & join ${workspaceName}`}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
