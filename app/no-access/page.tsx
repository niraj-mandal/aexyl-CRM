import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { GlassPanel } from "@/components/ui/glass-card";
import { Body } from "@/components/ui/typography";
import Link from "next/link";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { workspaceInvites } from "@/db/schema";
import { getVerifiedPrimaryEmail, hasWorkspaceAccess } from "@/lib/auth/workspace";
import { ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (await hasWorkspaceAccess()) redirect("/");

  const email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress;

  // Only the verified owner of the invited address is shown their own invite link.
  const verifiedEmail = await getVerifiedPrimaryEmail();
  const awaitingApproval = verifiedEmail
    ? await db.query.workspaceInvites.findFirst({
        where: and(eq(workspaceInvites.email, verifiedEmail), eq(workspaceInvites.status, "AWAITING_APPROVAL")),
      })
    : null;
  const pendingInvite = verifiedEmail
    ? await db.query.workspaceInvites.findFirst({
        where: and(
          eq(workspaceInvites.email, verifiedEmail),
          eq(workspaceInvites.status, "PENDING"),
          gt(workspaceInvites.expiresAt, new Date()),
        ),
        orderBy: [desc(workspaceInvites.createdAt)],
      })
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <GlassPanel className="max-w-md w-full text-center p-10">
        <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-xl bg-danger/10 text-danger">
          <ShieldAlert className="h-7 w-7" />
        </div>
        {awaitingApproval ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-text-primary">Waiting for approval</h1>
            <Body className="mt-2 text-sm">
              You accepted the invite as <span className="font-medium text-text-primary">{email}</span>. The workspace owner
              has been notified — refresh this page once they approve your access.
            </Body>
          </>
        ) : pendingInvite ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-text-primary">You have a pending invite</h1>
            <Body className="mt-2 text-sm">
              <span className="font-medium text-text-primary">{email}</span> was invited to join the workspace.
            </Body>
            <Link
              href={`/invite/${pendingInvite.token}`}
              className="mt-6 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-black hover:bg-primary/90 transition"
            >
              Open invite and join
            </Link>
          </>
        ) : (
          <>
        <h1 className="mt-5 text-lg font-semibold text-text-primary">This CRM is invite-only</h1>
        <Body className="mt-2 text-sm">
          {email ? <span className="font-medium text-text-primary">{email}</span> : "This account"} doesn&apos;t have
          access. Ask the workspace owner for an invite link, then open it while signed in with the invited account.
        </Body>
        <SignOutButton redirectUrl="/sign-in">
          <button className="mt-6 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-black hover:bg-primary/90 transition">
            Sign out and use another account
          </button>
        </SignOutButton>
          </>
        )}
      </GlassPanel>
    </div>
  );
}
