"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, Copy, Check, X, Link2, MailCheck, UserCheck } from "lucide-react";
import {
  createInviteAction,
  revokeInviteAction,
  approveJoinRequestAction,
  rejectJoinRequestAction,
} from "@/app/actions/invite.actions";
import { publicAppOrigin } from "@/lib/app-url";

export interface PendingInvite {
  id: string;
  email: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: { firstName: string | null; lastName: string | null } | null;
}

/** Copied links must open on the production site, not the preview URL you're browsing. */
function inviteUrl(token: string) {
  const origin = publicAppOrigin() ?? (typeof window === "undefined" ? "" : window.location.origin);
  return `${origin}/invite/${token}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Email form + one-click copy of the acceptance link. */
export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    token: string;
    emailSent: boolean;
    emailError?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const invite = await createInviteAction({ email });
        if (!invite.ok) {
          setError(invite.error);
          return;
        }
        setCreated({
          email: invite.email,
          token: invite.token,
          emailSent: invite.emailSent,
          emailError: invite.emailError,
        });
        setEmail("");
        router.refresh();
      } catch {
        setError("Couldn't create the invite. Please try again.");
      }
    });
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't access the clipboard — copy the link manually.");
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          required
          className="flex-1 rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="inline-flex items-center space-x-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          <span>{pending ? "Inviting…" : "Invite"}</span>
        </button>
      </form>
      {error && <p className="text-xs text-danger">{error}</p>}

      {created && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            created.emailSent
              ? "border-secondary/30 bg-secondary/5"
              : "border-primary/30 bg-primary/5"
          }`}
        >
          {created.emailSent ? (
            <p className="flex items-center text-xs text-secondary">
              <MailCheck className="mr-2 h-3.5 w-3.5 shrink-0" />
              Invitation email sent to <span className="font-medium text-text-primary mx-1">{created.email}</span> —
              they&apos;ll get the link in their inbox. The link stays valid for 7 days.
            </p>
          ) : (
            <p className="text-xs text-text-secondary">
              Invite created for <span className="font-medium text-text-primary">{created.email}</span>.{" "}
              {created.emailError ?? "Email couldn&apos;t be sent."} Share the link directly:
            </p>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-surface-lowest border border-border-subtle px-2 py-1.5 text-xs font-mono-code text-text-secondary">
              {inviteUrl(created.token)}
            </code>
            <button
              onClick={() => copy(created.token)}
              className="inline-flex items-center space-x-1 rounded-md border border-border-strong px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition"
            >
              {copied ? <Check className="h-3 w-3 text-secondary" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy link"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pending invite row: email, invited-by, expiry, copy link, revoke. */
export function PendingInviteRow({ invite }: { invite: PendingInvite }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const revoke = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await revokeInviteAction(invite.id);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Couldn't revoke the invite. Please try again.");
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't access the clipboard.");
    }
  };

  const inviter = [invite.invitedBy?.firstName, invite.invitedBy?.lastName].filter(Boolean).join(" ");

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle border-dashed bg-surface-low/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-text-secondary truncate flex items-center">
          <Link2 className="mr-2 h-3 w-3 text-tertiary shrink-0" />
          {invite.email}
        </p>
        <p className="text-xs text-text-muted">
          pending · invited by {inviter || "—"} · expires {formatDate(invite.expiresAt)}
        </p>
        {error && <p className="text-xs text-danger mt-0.5">{error}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={copy}
          title="Copy invite link"
          className="rounded-md p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-elevated transition"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-secondary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={revoke}
          disabled={pending}
          title="Revoke invite"
          className="rounded-md p-1.5 text-text-muted hover:text-danger hover:bg-surface-elevated transition disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export interface JoinRequest {
  id: string;
  email: string;
  name: string | null;
  signedInEmail: string | null;
  acceptedAt: string;
}

/** An accepted invite waiting for a member to cross-check and approve it. */
export function JoinRequestRow({ request }: { request: JoinRequest }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (approve: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = approve ? await approveJoinRequestAction(request.id) : await rejectJoinRequestAction(request.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const accepted = new Date(request.acceptedAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-secondary/40 bg-secondary/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary truncate flex items-center">
          <UserCheck className="mr-2 h-3.5 w-3.5 text-secondary shrink-0" />
          {request.name ?? request.email}
        </p>
        <p className="text-xs text-text-muted truncate">
          signed in as {request.signedInEmail ?? request.email} · accepted {accepted}
        </p>
        {error && <p className="text-xs text-danger mt-0.5">{error}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => act(true)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-secondary/20 px-2.5 py-1.5 text-xs font-semibold text-secondary hover:bg-secondary/30 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
        </button>
        <button
          onClick={() => act(false)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:text-danger disabled:opacity-50"
        >
          <X className="h-3 w-3" /> Reject
        </button>
      </div>
    </div>
  );
}
