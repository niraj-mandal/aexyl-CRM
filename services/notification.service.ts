import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

/**
 * Unified in-app notification system (spec §23). Intelligent by construction:
 * callers push digested, actionable items ("N things need your attention"),
 * not raw event spam. Dedupe window prevents notification storms from
 * repeated agent/policy events.
 */
export class NotificationService {
  /**
   * Creates a notification unless an identical unread one exists within the
   * dedupe window (default 30 min). Never throws into the caller.
   */
  static async notify(params: {
    workspaceId: string;
    userId: string;
    type: string;
    title: string;
    body?: string;
    link?: string;
    dedupeKey?: string;
    dedupeWindowMinutes?: number;
  }) {
    try {
      const window = params.dedupeWindowMinutes ?? 30;
      if (params.dedupeKey) {
        const cutoff = new Date(Date.now() - window * 60_000);
        const existing = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(notifications)
          .where(
            and(
              eq(notifications.workspaceId, params.workspaceId),
              eq(notifications.userId, params.userId),
              eq(notifications.type, params.type),
              isNull(notifications.readAt),
              sql`${notifications.content}->>'dedupeKey' = ${params.dedupeKey}`,
              sql`${notifications.createdAt} >= ${cutoff.toISOString()}`
            )
          );
        if ((existing[0]?.n ?? 0) > 0) return;
      }

      await db.insert(notifications).values({
        workspaceId: params.workspaceId,
        userId: params.userId,
        type: params.type,
        content: {
          title: params.title,
          body: params.body ?? null,
          link: params.link ?? null,
          dedupeKey: params.dedupeKey ?? null,
        },
      });
    } catch {
      // Notifications must never break the triggering action.
    }
  }

  /** Notifies every member of the workspace except the acting user. */
  static async notifyWorkspace(params: {
    workspaceId: string;
    exceptUserId?: string;
    type: string;
    title: string;
    body?: string;
    link?: string;
    dedupeKey?: string;
  }) {
    try {
      const memberships = await db.query.workspaceMemberships.findMany({
        where: eq(workspaceMemberships.workspaceId, params.workspaceId),
        columns: { userId: true },
      });
      for (const m of memberships) {
        if (m.userId === params.exceptUserId) continue;
        await NotificationService.notify({ ...params, userId: m.userId });
      }
    } catch {
      // same contract: never throw
    }
  }

  static async list(workspaceId: string, userId: string, limit = 15) {
    return db
      .select()
      .from(notifications)
      .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, userId)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  static async unreadCount(workspaceId: string, userId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt)
        )
      );
    return rows[0]?.n ?? 0;
  }

  static async markRead(workspaceId: string, userId: string, notificationId?: string) {
    if (notificationId) {
      await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
            eq(notifications.id, notificationId)
          )
        );
    } else {
      await db
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notifications.workspaceId, workspaceId),
            eq(notifications.userId, userId),
            isNull(notifications.readAt)
          )
        );
    }
  }
}

// Late import to avoid a circular import with the schema barrel.
import { workspaceMemberships } from "@/db/schema";
