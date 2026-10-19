import Link from "next/link";
import { GlassPanel } from "@/components/ui/glass-card";
import { MonoLabel, Body } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { getVerifiedPrimaryEmail } from "@/lib/auth/workspace";
import { db } from "@/db";
import { workspaceInvites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AcceptInviteButton } from "@/components/crm/AcceptInviteButton";
import { UserPlus, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

function formatExpiry(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { userId } = await auth();

  const invite = await db.query.workspaceInvites.findFirst({
    where: eq(workspaceInvites.token, token),
    with: {
      workspace: { columns: { name: true, slug: true } },
      invitedBy: { columns: { firstName: true, lastName: true } },
    },
  });

  const signedInEmail = userId ? await getVerifiedPrimaryEmail() : null;
  const invalid = !invite || invite.status !== "PENDING";
  const expired = !invalid && invite.expiresAt.getTime() < new Date().getTime();

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <GlassPanel className="max-w-md w-full text-center p-10">
        <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UserPlus className="h-7 w-7" />
        </div>

        {invite?.status === "AWAITING_APPROVAL" || invite?.status === "REJECTED" ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-text-primary">
              {invite.status === "REJECTED" ? "Request not approved" : "Waiting for approval"}
            </h1>
            <Body className="mt-2 text-sm">
              {invite.status === "REJECTED"
                ? "The workspace owner didn't approve this request. Contact them if you think this is a mistake."
                : `You've accepted the invite for ${invite.email}. The owner has been notified and will approve your access shortly — then open the CRM.`}
            </Body>
            <Link
              href="/"
              className="mt-6 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition"
            >
              Open the CRM
            </Link>
          </>
        ) : invalid || expired ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-text-primary">
              {expired ? "This invite has expired" : "Invite not found"}
            </h1>
            <Body className="mt-2 text-sm">
              {expired
                ? "Ask the workspace owner to send a fresh invite link."
                : "The link may have been revoked or already used."}
            </Body>
            <Link
              href="/"
              className="mt-6 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition"
            >
              Go to Aexyl
            </Link>
          </>
        ) : (
          <>
            <MonoLabel className="text-primary block mb-2">Workspace invitation</MonoLabel>
            <h1 className="text-lg font-semibold text-text-primary">
              Join {invite.workspace?.name ?? "Aexyl"}
            </h1>
            <Body className="mt-2 text-sm">
              {[invite.invitedBy?.firstName, invite.invitedBy?.lastName].filter(Boolean).join(" ") || "A member"}{" "}
              invited <span className="font-medium text-text-primary">{invite.email}</span> to collaborate.
            </Body>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Badge variant="outline" className="font-mono-code text-xs">
                EXPIRES {formatExpiry(invite.expiresAt)}
              </Badge>
              <Badge variant="secondary" className="font-mono-code text-xs">
                <ShieldCheck className="mr-1 h-3 w-3" /> SINGLE-USE
              </Badge>
            </div>

            <div className="mt-6">
              {userId && signedInEmail !== invite.email.trim().toLowerCase() ? (
                <div className="space-y-3">
                  <p className="text-xs text-danger">
                    You&apos;re signed in as <span className="font-medium">{signedInEmail ?? "an unverified email"}</span>.
                    This invite only works for <span className="font-medium">{invite.email}</span>.
                  </p>
                  <SignOutButton redirectUrl={`/sign-in?redirect_url=/invite/${token}`}>
                    <button className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition">
                      Sign out and switch to {invite.email}
                    </button>
                  </SignOutButton>
                </div>
              ) : userId ? (
                <AcceptInviteButton token={token} workspaceName={invite.workspace?.name ?? "Aexyl"} />
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">Sign in first — then you&apos;ll land back here.</p>
                  <Link
                    href={`/sign-in?redirect_url=/invite/${token}`}
                    className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand/90 transition"
                  >
                    Sign in to accept
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </GlassPanel>
    </div>
  );
}
