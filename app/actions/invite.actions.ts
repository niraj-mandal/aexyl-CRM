"use server";

import crypto from "crypto";
import { db } from "@/db";
import { workspaceInvites, workspaceMemberships, users, roles, workspaces } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";
import { sendInviteEmail, isEmailConfigured } from "@/services/email.service";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates a PENDING invite with a cryptographically random token and returns
 * the shareable acceptance URL. No email provider is configured, so the UI
 * presents this link for copy-to-share delivery.
 */
export async function createInviteAction(input: { email: string }) {
  const { userId, workspaceId } = await requireWorkspace();
  const email = input.email.trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    throw new Error("Enter a valid email address");
  }

  // Already a member?
  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existingUser) {
    const membership = await db.query.workspaceMemberships.findFirst({
      where: and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, existingUser.id)
      ),
    });
    if (membership) {
      throw new Error(`${email} is already a member of this workspace`);
    }
  }

  // Supersede prior pending invites for the same email (avoid token sprawl).
  await db
    .update(workspaceInvites)
    .set({ status: "REVOKED", updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        eq(workspaceInvites.email, email),
        eq(workspaceInvites.status, "PENDING")
      )
    );

  // Role: attach the workspace's default role so the member lands somewhere sane.
  const defaultRole = await db.query.roles.findFirst({
    where: eq(roles.workspaceId, workspaceId),
  });

  const [invite] = await db
    .insert(workspaceInvites)
    .values({
      workspaceId,
      email,
      token: crypto.randomBytes(24).toString("base64url"),
      roleId: defaultRole?.id,
      invitedById: userId,
      status: "PENDING",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "INVITE", invite.id, { email });

  // Deliver the link by email when a provider is configured. Failure never
  // fails the invite itself — the UI falls back to the copyable link.
  let emailSent = false;
  let emailError: string | undefined;
  if (isEmailConfigured()) {
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { firstName: true, lastName: true },
    });
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { name: true },
    });
    // Prefer explicit env, else derive from the live request so links are
    // correct on any host/port (dev ports change between restarts).
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      const h = await headers();
      const host = h.get("host");
      if (host) {
        const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
        baseUrl = `${proto}://${host}`;
      }
    }
    const result = await sendInviteEmail({
      to: email,
      inviteUrl: `${baseUrl}/invite/${invite.token}`,
      workspaceName: workspace?.name ?? "Aexyl",
      inviterName:
        [inviter?.firstName, inviter?.lastName].filter(Boolean).join(" ") || "A workspace member",
      expiresAt: invite.expiresAt,
    });
    emailSent = result.sent;
    emailError = result.error;
  } else {
    emailError = "No email provider configured — share the link manually.";
  }

  revalidatePath("/settings");
  revalidatePath("/settings?tab=Team");

  return {
    id: invite.id,
    token: invite.token,
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
    emailSent,
    emailError,
  };
}

/** Pending invites for the current workspace (newest first). */
export async function getPendingInvitesAction() {
  const { workspaceId } = await requireWorkspace();
  return db.query.workspaceInvites.findMany({
    where: and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "PENDING")),
    orderBy: [desc(workspaceInvites.createdAt)],
    with: { invitedBy: { columns: { firstName: true, lastName: true } } },
  });
}

/** Marks an invite REVOKED. Only the inviting workspace can do this. */
export async function revokeInviteAction(inviteId: string) {
  const { userId, workspaceId } = await requireWorkspace();

  const [revoked] = await db
    .update(workspaceInvites)
    .set({ status: "REVOKED", updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        eq(workspaceInvites.status, "PENDING")
      )
    )
    .returning();

  if (!revoked) throw new Error("Invite not found or already handled");

  await ActivityService.logAudit(workspaceId, userId, "DELETE", "INVITE", inviteId, {
    email: revoked.email,
  });
  revalidatePath("/settings");
  revalidatePath("/settings?tab=Team");
  return revoked;
}

/**
 * Accepts an invite by token. Works for signed-in users and completes the
 * Clerk identity link for first-timers via requireWorkspace's provisioning.
 * Creates the membership transactionally (single UPDATE guards double-accept).
 */
export async function acceptInviteAction(token: string) {
  const clerkId = (await auth()).userId;
  if (!clerkId) throw new Error("Sign in to accept this invite");

  const invite = await db.query.workspaceInvites.findFirst({
    where: eq(workspaceInvites.token, token),
  });
  if (!invite || invite.status !== "PENDING") {
    throw new Error("This invite is not valid anymore");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new Error("This invite has expired");
  }

  // Provision/link the local user + default workspace membership plumbing.
  const { userId } = await requireWorkspace();

  // Claim the invite atomically: the status UPDATE only succeeds once.
  const [claimed] = await db
    .update(workspaceInvites)
    .set({
      status: "ACCEPTED",
      acceptedById: userId,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.status, "PENDING")))
    .returning();

  if (!claimed) throw new Error("This invite was just used by someone else");

  // If this user already belongs to the workspace (linked email), don't duplicate.
  const existingMembership = await db.query.workspaceMemberships.findFirst({
    where: and(
      eq(workspaceMemberships.workspaceId, invite.workspaceId),
      eq(workspaceMemberships.userId, userId)
    ),
  });

  if (!existingMembership) {
    // Role from the invite; fall back to the workspace's default role.
    const fallback = invite.roleId
      ? null
      : await db.query.roles.findFirst({
          where: eq(roles.workspaceId, invite.workspaceId),
        });
    const roleId: string = invite.roleId ?? fallback?.id ?? "";
    if (roleId === "") {
      throw new Error("Workspace has no role configured — ask the owner to set one up");
    }
    await db.insert(workspaceMemberships).values({
      workspaceId: invite.workspaceId,
      userId,
      roleId,
    });
  }

  await ActivityService.logAudit(invite.workspaceId, userId, "ACCEPT", "INVITE", invite.id, {
    email: invite.email,
  });

  revalidatePath("/settings");
  revalidatePath("/settings?tab=Team");
  return { workspaceId: invite.workspaceId };
}
