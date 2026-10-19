"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import { acceptInviteAction } from "@/app/actions/invite.actions";

export function AcceptInviteButton({ token, workspaceName }: { token: string; workspaceName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"joined" | "awaiting" | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptInviteAction(token);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.awaitingApproval) {
          setDone("awaiting");
          return;
        }
        setDone("joined");
        setTimeout(() => router.push("/"), 1200);
      } catch {
        setError("Something went wrong accepting the invite. Please try again.");
      }
    });
  };

  if (done === "awaiting") {
    return (
      <div className="space-y-1">
        <p className="flex items-center justify-center text-sm font-medium text-secondary">
          <CheckCircle2 className="mr-2 h-4 w-4" /> Request sent
        </p>
        <p className="text-xs text-text-muted">
          The {workspaceName} owner has been notified. You&apos;ll get access as soon as they approve — then just open the CRM.
        </p>
      </div>
    );
  }

  if (done === "joined") {
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
        className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
      >
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? "Joining…" : `Accept & join ${workspaceName}`}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
