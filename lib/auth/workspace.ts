import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users, workspaces, roles, workspaceMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireWorkspace() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    throw new Error("Unauthorized");
  }

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
