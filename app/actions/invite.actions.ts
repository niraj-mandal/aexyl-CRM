"use server";

import crypto from "crypto";
import { db } from "@/db";
import { workspaceInvites, workspaceMemberships, users, workspaces, leads, deals } from "@/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, getVerifiedPrimaryEmail, ensureLocalUser, adminRole, salesRole, AdminOnlyError, clearContextCache, isOwnerEmail } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";
import { NotificationService } from "@/services/notification.service";
import { sendInviteEmail, isEmailConfigured } from "@/services/email.service";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { publicAppOrigin } from "@/lib/app-url";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns { ok: false, error } instead of throwing: Next.js hides thrown
 * server-action messages in production ("Minified React error #441").
 *
 * Creates a PENDING invite with a cryptographically random token and returns
 * the shareable acceptance URL. No email provider is configured, so the UI
 * presents this link for copy-to-share delivery.
 */
export async function createInviteAction(input: { email: string; role?: "ADMIN" | "SALES" }) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminOnlyError) return { ok: false as const, error: e.message };
    throw e;
  }
  const { userId, workspaceId } = ctx;
  const email = input.email.trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { ok: false as const, error: "Enter a valid email address." };
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
      return { ok: false as const, error: `${email} is already a member of this workspace.` };
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

  // Sales members never see money or admin tools; everyone else is an admin.
  const defaultRole = input.role === "SALES" ? await salesRole(workspaceId) : await adminRole(workspaceId);

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

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "INVITE", invite.id, { email, role: defaultRole?.name });

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
    // Always the production site (never a protected preview URL); the live
    // request host is only a fallback for local dev, where ports change.
    let baseUrl = publicAppOrigin();
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
    ok: true as const,
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
  const { workspaceId } = await requireAdmin();
  return db.query.workspaceInvites.findMany({
    where: and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "PENDING")),
    orderBy: [desc(workspaceInvites.createdAt)],
    with: { invitedBy: { columns: { firstName: true, lastName: true } } },
  });
}

/** Marks an invite REVOKED. Only the inviting workspace can do this. */
export async function revokeInviteAction(inviteId: string) {
  const { userId, workspaceId } = await requireAdmin();

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

  if (!revoked) return { ok: false as const, error: "Invite not found or already handled." };

  await ActivityService.logAudit(workspaceId, userId, "DELETE", "INVITE", inviteId, {
    email: revoked.email,
  });
  revalidatePath("/settings");
  revalidatePath("/settings?tab=Team");
  return { ok: true as const };
}

/**
 * Accepts an invite by token. The signed-in user's verified email must match
 * the invited address. Accepting creates a join request: the invitee gets no
 * access until a workspace member approves it in Settings → Team.
 * Returns a result instead of throwing (Next.js hides thrown messages in production).
 */
export async function acceptInviteAction(
  token: string,
): Promise<{ ok: true; workspaceId: string; awaitingApproval: boolean } | { ok: false; error: string }> {
  const clerkId = (await auth()).userId;
  if (!clerkId) return { ok: false, error: "Sign in to accept this invite." };

  const invite = await db.query.workspaceInvites.findFirst({
    where: eq(workspaceInvites.token, token),
  });
  if (!invite || invite.status !== "PENDING") {
    return { ok: false, error: "This invite is not valid anymore." };
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This invite has expired. Ask the owner for a new one." };
  }

  // Invite-only: the link is bound to the invited address, not to whoever holds it.
  const email = await getVerifiedPrimaryEmail();
  if (!email || email !== invite.email.trim().toLowerCase()) {
    return {
      ok: false,
      error: `This invite is for ${invite.email}, but you're signed in as ${email ?? "an unverified email"}. Sign out and sign in with ${invite.email}.`,
    };
  }

  const dbUser = await ensureLocalUser(clerkId, email);
  const existingMembership = await db.query.workspaceMemberships.findFirst({
    where: and(eq(workspaceMemberships.workspaceId, invite.workspaceId), eq(workspaceMemberships.userId, dbUser.id)),
  });

  // Claim the invite atomically: the status UPDATE only succeeds once.
  const [claimed] = await db
    .update(workspaceInvites)
    .set({
      status: existingMembership ? "ACCEPTED" : "AWAITING_APPROVAL",
      acceptedById: dbUser.id,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(workspaceInvites.id, invite.id), eq(workspaceInvites.status, "PENDING")))
    .returning();
  if (!claimed) return { ok: false, error: "This invite was already used." };

  await ActivityService.logAudit(invite.workspaceId, dbUser.id, "ACCEPT", "INVITE", invite.id, { email: invite.email });

  if (existingMembership) {
    revalidatePath("/settings");
    return { ok: true, workspaceId: invite.workspaceId, awaitingApproval: false };
  }

  const name = [dbUser.firstName, dbUser.lastName].filter(Boolean).join(" ").trim();
  await NotificationService.notifyWorkspace({
    workspaceId: invite.workspaceId,
    type: "TEAM",
    title: `${name || invite.email} accepted your invite — approve to give access`,
    body: `${name ? `${name} (${invite.email})` : invite.email} signed in with the invited Google account and is waiting for approval. Check it's the right person, then approve or reject in Settings → Team.`,
    link: "/settings?tab=Team",
    dedupeKey: `join-request-${invite.id}`,
  });

  revalidatePath("/settings");
  return { ok: true, workspaceId: invite.workspaceId, awaitingApproval: true };
}

/** Invitees who accepted and are waiting for a member to approve them. */
export async function getJoinRequestsAction() {
  const { workspaceId } = await requireAdmin();
  return db.query.workspaceInvites.findMany({
    where: and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "AWAITING_APPROVAL")),
    orderBy: [desc(workspaceInvites.acceptedAt)],
    with: {
      acceptedBy: { columns: { id: true, firstName: true, lastName: true, email: true } },
      invitedBy: { columns: { firstName: true, lastName: true } },
    },
  });
}

export async function approveJoinRequestAction(inviteId: string) {
  const { workspaceId, userId } = await requireAdmin();

  const [approved] = await db
    .update(workspaceInvites)
    .set({ status: "ACCEPTED", updatedAt: new Date() })
    .where(and(
      eq(workspaceInvites.id, String(inviteId)),
      eq(workspaceInvites.workspaceId, workspaceId),
      eq(workspaceInvites.status, "AWAITING_APPROVAL"),
    ))
    .returning();
  if (!approved?.acceptedById) return { ok: false as const, error: "Request not found or already handled." };

  const roleId = approved.roleId ?? (await adminRole(workspaceId))?.id;
  if (!roleId) return { ok: false as const, error: "Workspace has no role configured." };

  const existing = await db.query.workspaceMemberships.findFirst({
    where: and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, approved.acceptedById)),
  });
  if (!existing) {
    await db.insert(workspaceMemberships).values({ workspaceId, userId: approved.acceptedById, roleId });
  }

  await ActivityService.logAudit(workspaceId, userId, "APPROVE", "INVITE", approved.id, { email: approved.email });
  await NotificationService.notify({
    workspaceId,
    userId: approved.acceptedById,
    type: "TEAM",
    title: "Your access was approved — welcome to Aexyl",
    body: "You can now use the CRM.",
    link: "/",
  });

  revalidatePath("/settings");
  return { ok: true as const };
}

export async function rejectJoinRequestAction(inviteId: string) {
  const { workspaceId, userId } = await requireAdmin();
  const [rejected] = await db
    .update(workspaceInvites)
    .set({ status: "REJECTED", updatedAt: new Date() })
    .where(and(
      eq(workspaceInvites.id, String(inviteId)),
      eq(workspaceInvites.workspaceId, workspaceId),
      eq(workspaceInvites.status, "AWAITING_APPROVAL"),
    ))
    .returning();
  if (!rejected) return { ok: false as const, error: "Request not found or already handled." };

  await ActivityService.logAudit(workspaceId, userId, "REJECT", "INVITE", rejected.id, { email: rejected.email });
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * Switches a member between Admin and Sales. Admin-only; you can't change your own role
 * (so the workspace can never lose its last admin by accident).
 */
export async function setMemberRoleAction(membershipId: string, role: "ADMIN" | "SALES") {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminOnlyError) return { ok: false as const, error: e.message };
    throw e;
  }
  const { workspaceId, userId } = ctx;
  const membership = await db.query.workspaceMemberships.findFirst({
    where: and(eq(workspaceMemberships.id, String(membershipId)), eq(workspaceMemberships.workspaceId, workspaceId)),
  });
  if (!membership) return { ok: false as const, error: "Member not found." };
  if (membership.userId === userId) return { ok: false as const, error: "You can't change your own role." };
  // The workspace owner always stays an admin, so another admin can't lock them out.
  const member = await db.query.users.findFirst({ where: eq(users.id, membership.userId), columns: { email: true } });
  if (role === "SALES" && isOwnerEmail(member?.email)) return { ok: false as const, error: "The workspace owner always stays an admin." };

  const target = role === "SALES" ? await salesRole(workspaceId) : await adminRole(workspaceId);
  if (!target) return { ok: false as const, error: "No admin role exists in this workspace." };
  await db
    .update(workspaceMemberships)
    .set({ roleId: target.id, updatedAt: new Date() })
    .where(eq(workspaceMemberships.id, membership.id));
  clearContextCache();
  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "MEMBER_ROLE", membership.id, { role: target.name });
  revalidatePath("/settings");
  return { ok: true as const };
}

/** "gym in Saharsa, Bihar, India" → Bihar: the state a discovered lead came from. */
const LEAD_STATE_SQL = sql<string | null>`substring(${leads.source} from ', ([A-Za-z ]+), India$')`;

/** Lead counts per state and who holds them, for the Team page's assignment tool. Admin-only. */
export async function getLeadStatesAction() {
  const { workspaceId } = await requireAdmin();
  const rows = (await db
    .select({ state: LEAD_STATE_SQL, ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.workspaceId, workspaceId))
    .groupBy(LEAD_STATE_SQL, leads.ownerId)) as { state: string | null; ownerId: string | null; n: number }[];
  const byState = new Map<string, { state: string; total: number; owners: Record<string, number> }>();
  for (const r of rows) {
    if (!r.state) continue;
    const e = byState.get(r.state) ?? { state: r.state, total: 0, owners: {} };
    e.total += r.n;
    if (r.ownerId) e.owners[r.ownerId] = (e.owners[r.ownerId] ?? 0) + r.n;
    byState.set(r.state, e);
  }
  return [...byState.values()].sort((a, b) => b.total - a.total);
}

/**
 * Gives every lead from one state (and the deals on those leads) to one team member.
 * Admin-only; the member must belong to this workspace. Sales members then see only theirs.
 */
export async function assignLeadsByStateAction(state: string, memberUserId: string) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminOnlyError) return { ok: false as const, error: e.message };
    throw e;
  }
  const { workspaceId, userId } = ctx;
  const cleanState = String(state).trim();
  if (!/^[A-Za-z ]{2,40}$/.test(cleanState)) return { ok: false as const, error: "Pick a state." };
  const member = await db.query.workspaceMemberships.findFirst({
    where: and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, String(memberUserId))),
  });
  if (!member) return { ok: false as const, error: "That person isn't on this team." };

  const moved = await db
    .update(leads)
    .set({ ownerId: member.userId, updatedAt: new Date() })
    .where(and(eq(leads.workspaceId, workspaceId), sql`${LEAD_STATE_SQL} = ${cleanState}`))
    .returning({ id: leads.id });
  if (moved.length > 0) {
    await db
      .update(deals)
      .set({ ownerId: member.userId, updatedAt: new Date() })
      .where(and(eq(deals.workspaceId, workspaceId), inArray(deals.leadId, moved.map((m) => m.id))));
  }
  await ActivityService.logAudit(workspaceId, userId, "ASSIGN", "LEAD_BATCH", member.userId, { state: cleanState, leads: moved.length });
  revalidatePath("/settings");
  revalidatePath("/sales/leads");
  revalidatePath("/");
  return { ok: true as const, assigned: moved.length };
}
