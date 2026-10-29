"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, Copy, Check, X, Link2, MailCheck, UserCheck } from "lucide-react";
import {
  createInviteAction,
  revokeInviteAction,
  approveJoinRequestAction,
  rejectJoinRequestAction,
  setMemberRoleAction,
  assignLeadsAction,
  removeMemberAction,
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
  // Least privilege by default: a new teammate is Sales unless you choose Admin.
  const [role, setRole] = useState<"SALES" | "ADMIN">("SALES");
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
        const invite = await createInviteAction({ email, role });
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
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          required
          className="min-w-[12rem] flex-1 rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "SALES" | "ADMIN")}
          aria-label="Role"
          className="rounded-md bg-surface-lowest border border-border-subtle px-2 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none"
        >
          <option value="SALES">Sales (no revenue)</option>
          <option value="ADMIN">Admin (everything)</option>
        </select>
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="inline-flex items-center space-x-2 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
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

/** Admin/Sales switch on a member row. Sales members never see money or admin tools. */
export function MemberRoleSelect({ membershipId, isSales, disabled }: { membershipId: string; isSales: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={isSales ? "SALES" : "ADMIN"}
        disabled={disabled || pending}
        aria-label="Member role"
        onChange={(e) => {
          const next = e.target.value as "SALES" | "ADMIN";
          setError(null);
          startTransition(async () => {
            const res = await setMemberRoleAction(membershipId, next);
            if (!res.ok) setError(res.error);
            router.refresh();
          });
        }}
        className="rounded-md bg-surface-lowest border border-border-subtle px-2 py-1 text-xs text-text-primary focus:border-primary/60 focus:outline-none disabled:opacity-60"
      >
        <option value="ADMIN">Admin</option>
        <option value="SALES">Sales</option>
      </select>
      {error && <p className="max-w-[180px] text-right text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Two-step remove: "Remove" → "Remove Nishan? Their leads move to you." → Yes / No. */
export function RemoveMemberButton({ membershipId, name }: { membershipId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={() => setConfirming(true)} className="text-xs text-text-muted hover:text-danger">
          Remove
        </button>
        {error && <p className="max-w-[200px] text-right text-xs text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex max-w-[200px] flex-col items-end gap-1.5 text-right" role="group" aria-label={`Remove ${name}`}>
      <p className="text-xs text-text-secondary">Remove {name}? They lose access and their leads, deals and tasks move to you.</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await removeMemberAction(membershipId);
              if (!res.ok) {
                setError(res.error);
                setConfirming(false);
              }
              router.refresh();
            })
          }
          className="inline-flex items-center gap-1 rounded bg-danger px-2.5 py-1 text-xs font-bold text-white hover:bg-danger/90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Remove
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded border border-border-subtle px-2.5 py-1 text-xs text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>
    </div>
  );
}

type Owners = Record<string, number>;
export type LeadPlace = { state: string; total: number; owners: Owners; cities: { city: string; total: number; owners: Owners }[] };

/** Give all leads, one state, or one city/town to anyone on the team (admins included). */
export function AssignLeads({
  places,
  members,
}: {
  places: LeadPlace[];
  members: { userId: string; name: string; isSales: boolean }[];
}) {
  const router = useRouter();
  const [state, setState] = useState(""); // "" = all leads
  const [city, setCity] = useState(""); // "" = the whole state
  const [member, setMember] = useState(members.find((m) => m.isSales)?.userId ?? members[0]?.userId ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "someone";
  const holders = (owners: Owners) => Object.entries(owners).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${nameOf(id)} ${n}`).join(", ") || "unassigned";
  const sel = "min-h-10 rounded-md bg-surface-lowest border border-border-subtle px-2 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none disabled:opacity-50";

  if (places.length === 0) return <p className="text-xs text-text-muted">No leads yet.</p>;

  const all = places.reduce((n, p) => n + p.total, 0);
  const picked = places.find((p) => p.state === state);
  const count = !picked ? all : city ? (picked.cities.find((c) => c.city === city)?.total ?? 0) : picked.total;
  const label = !picked ? "all leads" : city ? `${city} leads` : `${state} leads`;

  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-xs text-text-secondary">
        {places.map((p) => (
          <li key={p.state}>
            <details className="group">
              <summary className="cursor-pointer list-none py-0.5 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="mr-1 inline-block text-text-muted transition-transform group-open:rotate-90">›</span>
                <span className="font-medium text-text-primary">{p.state}</span> · {p.total} lead{p.total === 1 ? "" : "s"}: {holders(p.owners)}
              </summary>
              <ul className="mb-1 ml-4 mt-1 space-y-0.5 border-l border-border-subtle pl-3">
                {p.cities.map((c) => (
                  <li key={c.city}>
                    <button
                      type="button"
                      onClick={() => {
                        setState(p.state);
                        setCity(c.city);
                        setResult(null);
                      }}
                      className="text-left hover:text-primary"
                      title={`Pick ${c.city}`}
                    >
                      {c.city} · {c.total}: {holders(c.owners)}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setCity("");
            setResult(null);
          }}
          aria-label="State"
          className={sel}
        >
          <option value="">All leads ({all})</option>
          {places.map((p) => (
            <option key={p.state} value={p.state}>{p.state} ({p.total})</option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!picked} aria-label="City or town" className={sel}>
          <option value="">{picked ? `Whole state (${picked.total})` : "Any city"}</option>
          {picked?.cities.map((c) => (
            <option key={c.city} value={c.city}>{c.city} ({c.total})</option>
          ))}
        </select>
        <span className="text-xs text-text-muted">to</span>
        <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Teammate" className={sel}>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}{m.isSales ? " (Sales)" : " (Admin)"}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !member || count === 0}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const res = await assignLeadsAction({ state, city }, member);
              setResult(res.ok ? { ok: true, text: `${res.assigned} ${label} now belong to ${nameOf(member)}.` } : { ok: false, text: res.error });
              router.refresh();
            });
          }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition disabled:bg-surface-high disabled:text-text-muted"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Give {count} to {nameOf(member).split(" ")[0]}
        </button>
      </div>
      {result && <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
      <p className="text-xs text-text-muted">
        Open a state to see its cities; click a city to pick it. Sales members see only their own leads. New leads stay with whoever imported them until you assign again.
      </p>
    </div>
  );
}
