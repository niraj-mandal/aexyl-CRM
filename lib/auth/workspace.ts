import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users, workspaces, roles, workspaceMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";

type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
};

// The DB is a cross-region round trip (~280ms each), and every server action
// calls this, so cache the resolved identity briefly per process.
const CONTEXT_TTL_MS = 60_000;
const contextCache = new Map<string, { value: WorkspaceContext; expiresAt: number }>();

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    throw new Error("Unauthorized");
  }

  const cached = contextCache.get(clerkId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [existing] = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      workspaceId: workspaceMemberships.workspaceId,
    })
    .from(users)
    .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  const value = existing
    ? {
        userId: existing.userId,
        workspaceId: existing.workspaceId,
        clerkId,
        firstName: existing.firstName ?? null,
        lastName: existing.lastName ?? null,
      }
    : await provisionWorkspaceContext(clerkId);

  contextCache.set(clerkId, { value, expiresAt: Date.now() + CONTEXT_TTL_MS });
  return value;
}

async function provisionWorkspaceContext(clerkId: string): Promise<WorkspaceContext> {
  // Check if user exists in database
  let dbUser = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkId),
  });

  if (!dbUser) {
    const clerkUser = await currentUser();
    const primaryEmail =
      clerkUser?.emailAddresses?.find((e) => e.id === clerkUser?.primaryEmailAddressId)?.emailAddress ||
      clerkUser?.emailAddresses?.[0]?.emailAddress ||
      `${clerkId}@example.com`;
    const firstName = clerkUser?.firstName || "Operator";
    const lastName = clerkUser?.lastName || "";

    // The account may already exist (e.g. created by seeding with the same
    // email). Link the Clerk identity to it instead of violating the unique
    // email constraint. Otherwise provision a brand-new user.
    const existingByEmail = await db.query.users.findFirst({
      where: eq(users.email, primaryEmail),
    });

    if (existingByEmail) {
      const [linked] = await db
        .update(users)
        .set({ clerkId, firstName: existingByEmail.firstName ?? firstName, lastName: existingByEmail.lastName ?? lastName, updatedAt: new Date() })
        .where(eq(users.id, existingByEmail.id))
        .returning();
      dbUser = linked;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({ clerkId, email: primaryEmail, firstName, lastName })
        .returning();
      dbUser = newUser;
    }
  }

  // Check if user has an active workspace membership
  let membership = await db.query.workspaceMemberships.findFirst({
    where: eq(workspaceMemberships.userId, dbUser.id),
  });

  if (!membership) {
    // Check if a default workspace already exists
    let defaultWorkspace = await db.query.workspaces.findFirst();

    if (!defaultWorkspace) {
      const [newWorkspace] = await db.insert(workspaces).values({
        name: "Aexyl Global",
        slug: "aexyl-global",
      }).returning();
      defaultWorkspace = newWorkspace;
    }

    // Check if role exists for this workspace
    let ownerRole = await db.query.roles.findFirst({
      where: eq(roles.workspaceId, defaultWorkspace.id),
    });

    if (!ownerRole) {
      const [newRole] = await db.insert(roles).values({
        workspaceId: defaultWorkspace.id,
        name: "Workspace Owner",
      }).returning();
      ownerRole = newRole;
    }

    // Assign membership
    const [newMembership] = await db.insert(workspaceMemberships).values({
      workspaceId: defaultWorkspace.id,
      userId: dbUser.id,
      roleId: ownerRole.id,
    }).returning();

    membership = newMembership;
  }

  return {
    userId: dbUser.id,
    workspaceId: membership.workspaceId,
    clerkId,
    firstName: dbUser.firstName ?? null,
    lastName: dbUser.lastName ?? null,
  };
}
