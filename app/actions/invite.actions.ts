"use server";

import crypto from "crypto";
import { db } from "@/db";
import { workspaceInvites, workspaceMemberships, users, workspaces, leads, deals, companies, discoveryCandidates, projects, tasks } from "@/db/schema";
import { leadCity } from "@/lib/maps";
import { eq, and, desc, inArray } from "drizzle-orm";
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

/**
 * Removes someone from the team: their access ends and everything they own (leads, deals, companies,
 * projects, tasks) moves to the admin doing it, so nothing is orphaned. Admin-only; not yourself, not the owner.
 */
export async function removeMemberAction(membershipId: string) {
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
  if (membership.userId === userId) return { ok: false as const, error: "You can't remove yourself." };
  const member = await db.query.users.findFirst({ where: eq(users.id, membership.userId), columns: { email: true } });
  if (isOwnerEmail(member?.email)) return { ok: false as const, error: "The workspace owner can't be removed." };

  const from = membership.userId;
  const moved = await db.transaction(async (tx) => {
    const now = new Date();
    const owned = <T extends typeof leads | typeof deals | typeof companies | typeof projects>(t: T) =>
      and(eq(t.workspaceId, workspaceId), eq(t.ownerId, from));
    const l = await tx.update(leads).set({ ownerId: userId, updatedAt: now }).where(owned(leads)).returning({ id: leads.id });
    await tx.update(deals).set({ ownerId: userId, updatedAt: now }).where(owned(deals));
    await tx.update(companies).set({ ownerId: userId, updatedAt: now }).where(owned(companies));
    await tx.update(projects).set({ ownerId: userId, updatedAt: now }).where(owned(projects));
    await tx.update(tasks).set({ assignedToId: userId, updatedAt: now }).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.assignedToId, from)));
    await tx.delete(workspaceMemberships).where(eq(workspaceMemberships.id, membership.id));
    return l.length;
  });
  // Ends their access on this server now; other servers drop their cached context within a minute.
  clearContextCache();
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "MEMBER", membership.id, { removedUserId: from, leadsMoved: moved });
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true as const, leadsMoved: moved };
}

type PlacedLead = { id: string; ownerId: string | null; state: string; city: string };

/**
 * Every lead with its state and city. The city is the one the Leads page shows (leadCity); the state comes
 * from the discovery source ("gym in Saharsa, Bihar, India"), else from a known state named in the address.
 */
async function placedLeads(workspaceId: string): Promise<PlacedLead[]> {
  const rows = await db
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      source: leads.source,
      location: companies.location,
      candidateCity: discoveryCandidates.city,
    })
    .from(leads)
    .leftJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(discoveryCandidates, and(eq(discoveryCandidates.leadId, leads.id), eq(discoveryCandidates.workspaceId, workspaceId)))
    .where(eq(leads.workspaceId, workspaceId));
  const stateOf = (r: (typeof rows)[number]) => r.source?.match(/, ([A-Za-z ]+), India$/)?.[1] ?? null;
  const known = [...new Set(rows.map(stateOf).filter((x): x is string => Boolean(x)))];
  const seen = new Set<string>();
  const out: PlacedLead[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue; // a lead can match several discovery records
    seen.add(r.id);
    const text = `${r.candidateCity ?? ""} ${r.location ?? ""} ${r.source ?? ""}`.toLowerCase();
    const state = stateOf(r) ?? known.find((k) => text.includes(k.toLowerCase())) ?? "Other";
    out.push({ id: r.id, ownerId: r.ownerId, state, city: leadCity(r) });
  }
  // e.g. "Jalandhar Gym Leads" names no state, but other Jalandhar leads say Punjab.
  const cityState = new Map(out.filter((o) => o.state !== "Other").map((o) => [o.city, o.state]));
  for (const o of out) if (o.state === "Other") o.state = cityState.get(o.city) ?? "Other";
  return out;
}

type Owners = Record<string, number>;
const count = (owners: Owners, id: string | null) => {
  if (id) owners[id] = (owners[id] ?? 0) + 1;
};

/** Lead counts per state and city and who holds them, for the Team page's assignment tool. Admin-only. */
export async function getLeadPlacesAction() {
  const { workspaceId } = await requireAdmin();
  const states = new Map<string, { state: string; total: number; owners: Owners; cities: Map<string, { city: string; total: number; owners: Owners }> }>();
  for (const l of await placedLeads(workspaceId)) {
    const s = states.get(l.state) ?? { state: l.state, total: 0, owners: {}, cities: new Map() };
    s.total++;
    count(s.owners, l.ownerId);
    const c = s.cities.get(l.city) ?? { city: l.city, total: 0, owners: {} };
    c.total++;
    count(c.owners, l.ownerId);
    s.cities.set(l.city, c);
    states.set(l.state, s);
  }
  return [...states.values()]
    .map((s) => ({ ...s, cities: [...s.cities.values()].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => (a.state === "Other" ? 1 : b.state === "Other" ? -1 : b.total - a.total));
}

/**
 * Gives leads (and the deals on them) to one team member: all leads, one state, or one city in a state.
 * Admin-only; the member must belong to this workspace. Sales members then see only theirs.
 */
export async function assignLeadsAction(place: { state?: string; city?: string }, memberUserId: string) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e) {
    if (e instanceof AdminOnlyError) return { ok: false as const, error: e.message };
    throw e;
  }
  const { workspaceId, userId } = ctx;
  const state = String(place.state ?? "").trim();
  const city = String(place.city ?? "").trim();
  if (city && !state) return { ok: false as const, error: "Pick the state first." };
  const member = await db.query.workspaceMemberships.findFirst({
    where: and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, String(memberUserId))),
  });
  if (!member) return { ok: false as const, error: "That person isn't on this team." };

  const ids = (await placedLeads(workspaceId))
    .filter((l) => (!state || l.state === state) && (!city || l.city === city))
    .map((l) => l.id);
  if (ids.length === 0) return { ok: false as const, error: "No leads in that place." };
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.update(leads).set({ ownerId: member.userId, updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.id, chunk)));
    await db.update(deals).set({ ownerId: member.userId, updatedAt: new Date() }).where(and(eq(deals.workspaceId, workspaceId), inArray(deals.leadId, chunk)));
  }
  await ActivityService.logAudit(workspaceId, userId, "ASSIGN", "LEAD_BATCH", member.userId, { state: state || "ALL", city: city || null, leads: ids.length });
  revalidatePath("/settings");
  revalidatePath("/sales/leads");
  revalidatePath("/");
  return { ok: true as const, assigned: ids.length };
}
