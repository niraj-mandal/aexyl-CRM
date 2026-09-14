import { db } from "@/db";
import { activities, auditLogs } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export class ActivityService {
  
  static async getActivitiesForEntity(
    workspaceId: string, 
    entityType: 'leadId' | 'dealId' | 'contactId', 
    entityId: string
  ) {
    return db.query.activities.findMany({
      where: and(
        eq(activities.workspaceId, workspaceId),
        eq(activities[entityType], entityId)
      ),
      orderBy: [desc(activities.occurredAt)],
      with: {
        actor: { columns: { firstName: true, lastName: true } }
      }
    });
  }

  static async createActivity(workspaceId: string, data: typeof activities.$inferInsert) {
    const [activity] = await db.insert(activities)
      .values({ ...data, workspaceId })
      .returning();
    return activity;
  }

  // Helper to securely log audit events inside the workspace
  static async logAudit(
    workspaceId: string,
    actorId: string,
    action: string,
    entity: string,
    entityId: string,
    metadata?: Record<string, unknown>
  ) {
    await db.insert(auditLogs).values({
      workspaceId,
      actorId,
      action,
      entity,
      entityId,
      metadata
    });
  }
}
