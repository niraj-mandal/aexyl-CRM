import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users, workspaces, roles, workspaceMemberships } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SALES_ROLE } from "./roles";

export { SALES_ROLE };

type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
  /** The member's role name. */
  role: string;
  /**
   * Sales team members work leads and calls but never see money (deal values, revenue,
   * budgets) and can't manage the team, settings or delete records. Enforced server-side.
   */
  isSales: boolean;
};


/**
 * Access is invite-only. A Clerk sign-in alone grants nothing: the user must
 * already hold a workspace membership (created by accepting an invite), or be
 * a configured owner email, which may bootstrap the workspace.
 */
// Founders: always admins, can't be removed or demoted. AUTH_OWNER_EMAILS (comma-separated) replaces this list.
const OWNER_EMAILS = (process.env.AUTH_OWNER_EMAILS ?? "nirazx30@gmail.com,nirajm863@gmail.com,sameerchoudhury999@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export class AccessDeniedError extends Error {
  constructor() {
    super("Access denied: this CRM is invite-only.");
    this.name = "AccessDeniedError";
  }
}

// The DB is a cross-region round trip (~280ms each), and every server action
// calls this, so cache the resolved identity briefly per process.
const CONTEXT_TTL_MS = 60_000;
const contextCache = new Map<string, { value: WorkspaceContext; expiresAt: number }>();

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && OWNER_EMAILS.includes(email.trim().toLowerCase());
}

/** The signed-in user's primary email, only if Clerk has verified it. */
export async function getVerifiedPrimaryEmail(): Promise<string | null> {
  const clerkUser = await currentUser();
  const primary = clerkUser?.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") return null;
  return primary.emailAddress.trim().toLowerCase();
}

async function findMemberContext(clerkId: string): Promise<WorkspaceContext | null> {
  const [row] = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      workspaceId: workspaceMemberships.workspaceId,
      role: roles.name,
    })
    .from(users)
    .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
    .innerJoin(roles, eq(roles.id, workspaceMemberships.roleId))
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    clerkId,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    role: row.role,
    isSales: row.role === SALES_ROLE,
  };
}

/**
 * Finds or creates the local user row for the signed-in Clerk identity,
 * linking by verified email. Callers must have already decided the person is
 * allowed in (owner email or valid invite) — this grants no access itself.
 */
export async function ensureLocalUser(clerkId: string, email: string) {
  const byClerk = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) });
  if (byClerk) return byClerk;

  const clerkUser = await currentUser();
  const firstName = clerkUser?.firstName || "Operator";
  const lastName = clerkUser?.lastName || "";

  const byEmail = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (byEmail) {
    const [linked] = await db
      .update(users)
      .set({
        clerkId,
        firstName: byEmail.firstName ?? firstName,
        lastName: byEmail.lastName ?? lastName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, byEmail.id))
      .returning();
    return linked;
  }

  const [created] = await db.insert(users).values({ clerkId, email, firstName, lastName }).returning();
  return created;
}

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    throw new Error("Unauthorized");
  }

  const cached = contextCache.get(clerkId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = (await findMemberContext(clerkId)) ?? (await bootstrapOwner(clerkId));
  contextCache.set(clerkId, { value, expiresAt: Date.now() + CONTEXT_TTL_MS });
  return value;
}

/**
 * Keeps the local name in step with the Clerk profile (edited via "Manage
 * account"), so the CRM shows the current name. Writes only when it changed.
 */
export async function syncProfileName(profile: { firstName: string | null; lastName: string | null }) {
  const ctx = await requireWorkspace();
  const firstName = profile.firstName?.trim() || null;
  const lastName = profile.lastName?.trim() || null;
  if (!firstName) return;
  if (firstName === ctx.firstName && (lastName ?? "") === (ctx.lastName ?? "")) return;

  await db
    .update(users)
    .set({ firstName, lastName: lastName ?? "", updatedAt: new Date() })
    .where(eq(users.id, ctx.userId));
  contextCache.set(ctx.clerkId, {
    value: { ...ctx, firstName, lastName: lastName ?? "" },
    expiresAt: Date.now() + CONTEXT_TTL_MS,
  });
}

/** Non-throwing check for layouts: is the signed-in user allowed in? */
export async function hasWorkspaceAccess(): Promise<boolean> {
  try {
    await requireWorkspace();
    return true;
  } catch (error) {
    if (error instanceof AccessDeniedError) return false;
    throw error;
  }
}

/** Only an owner email may get a membership without an invite. */
async function bootstrapOwner(clerkId: string): Promise<WorkspaceContext> {
  const email = await getVerifiedPrimaryEmail();
  if (!isOwnerEmail(email)) throw new AccessDeniedError();

  const dbUser = await ensureLocalUser(clerkId, email!);

  let workspace = await db.query.workspaces.findFirst();
  if (!workspace) {
    [workspace] = await db.insert(workspaces).values({ name: "Aexyl Global", slug: "aexyl-global" }).returning();
  }

  let ownerRole = await adminRole(workspace.id);
  if (!ownerRole) {
    [ownerRole] = await db.insert(roles).values({ workspaceId: workspace.id, name: "Workspace Owner" }).returning();
  }

  await db.insert(workspaceMemberships).values({
    workspaceId: workspace.id,
    userId: dbUser.id,
    roleId: ownerRole.id,
  });

  return {
    userId: dbUser.id,
    workspaceId: workspace.id,
    clerkId,
    firstName: dbUser.firstName ?? null,
    lastName: dbUser.lastName ?? null,
    role: ownerRole.name,
    isSales: false,
  };
}

/** Thrown when a sales team member calls something only admins may do. */
export class AdminOnlyError extends Error {
  constructor() {
    super("Only admins can do that.");
    this.name = "AdminOnlyError";
  }
}

/** Like requireWorkspace, but only for admins (team, settings, deletes, money). */
export async function requireAdmin(): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace();
  if (ctx.isSales) throw new AdminOnlyError();
  return ctx;
}

/** For admin-only pages: Sales members are sent to Today instead of seeing an error. */
export async function requireAdminPage(): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace();
  if (ctx.isSales) redirect("/");
  return ctx;
}

/** The workspace's admin role (any role that isn't Sales), or undefined if none exists yet. */
export async function adminRole(workspaceId: string) {
  return db.query.roles.findFirst({ where: and(eq(roles.workspaceId, workspaceId), ne(roles.name, SALES_ROLE)) });
}

/** The workspace's Sales role, created on first use. */
export async function salesRole(workspaceId: string) {
  const existing = await db.query.roles.findFirst({ where: and(eq(roles.workspaceId, workspaceId), eq(roles.name, SALES_ROLE)) });
  if (existing) return existing;
  const [created] = await db.insert(roles).values({ workspaceId, name: SALES_ROLE }).returning();
  return created;
}

/** Forget cached identities so a role change applies on the next request. */
export function clearContextCache() {
  contextCache.clear();
}
