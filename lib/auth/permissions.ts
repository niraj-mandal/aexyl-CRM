// Auth utilities for the future Aexyl CRM
export type Permission = 
  | "sales.read" | "sales.write"
  | "projects.read" | "projects.write"
  | "clients.read" | "clients.write"
  | "marketing.read" | "marketing.write"
  | "ai.use" | "ai.configure"
  | "team.manage" | "workspace.manage";

export type Role = "OWNER" | "ADMIN" | "MEMBER";

/**
 * Placeholder for checking if the current user has a specific permission
 * in the active workspace. This will be connected to the Drizzle DB in future phases.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function hasPermission(userId: string, workspaceId: string, permission: Permission): Promise<boolean> {
  // TODO: Implement actual DB lookup
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function hasRole(userId: string, workspaceId: string, role: Role): Promise<boolean> {
  // TODO: Implement actual DB lookup
  return true;
}
