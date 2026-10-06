/**
 * Agent memory service.
 *
 * Memory is workspace-scoped and explicit: agents can recall durable context,
 * but nothing is silently promoted into memory. Callers choose scope,
 * importance and optional expiry. Expired memories are ignored on reads.
 */
import { db } from "@/db";
import { agentMemory } from "@/db/schema";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";

export type MemoryScope = "workspace" | "agent" | "lead" | "deal" | "company" | "contact" | "project" | "task";

export interface MemoryInput {
  scope: MemoryScope;
  entityType?: string | null;
  entityId?: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  importance?: number;
  expiresAt?: Date | null;
}

export class AgentMemoryService {
  static async remember(workspaceId: string, input: MemoryInput) {
    const content = input.content.trim().slice(0, 4000);
    if (!content) throw new Error("Memory content cannot be empty.");
    const importance = Math.min(5, Math.max(1, Math.round(input.importance ?? 3)));
    const [row] = await db.insert(agentMemory).values({
      workspaceId,
      scope: input.scope,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      content,
      metadata: input.metadata ?? null,
      importance,
      expiresAt: input.expiresAt ?? null,
    }).returning();
    return row;
  }

  static async recall(workspaceId: string, params: {
    scope?: MemoryScope;
    entityType?: string;
    entityId?: string;
    query?: string;
    limit?: number;
  } = {}) {
    const now = new Date();
    const limit = Math.min(50, Math.max(1, params.limit ?? 10));
    const filters = [
      eq(agentMemory.workspaceId, workspaceId),
      or(isNull(agentMemory.expiresAt), gte(agentMemory.expiresAt, now)),
    ];
    if (params.scope) filters.push(eq(agentMemory.scope, params.scope));
    if (params.entityType) filters.push(eq(agentMemory.entityType, params.entityType));
    if (params.entityId) filters.push(eq(agentMemory.entityId, params.entityId));

    let rows = await db.select().from(agentMemory)
      .where(and(...filters))
      .orderBy(desc(agentMemory.importance), desc(agentMemory.createdAt))
      .limit(limit);

    const q = params.query?.trim().toLowerCase();
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);
      rows = rows.filter((row) => terms.some((term) => row.content.toLowerCase().includes(term)));
    }
    return rows;
  }

  static async forget(workspaceId: string, memoryId: string) {
    const [row] = await db.delete(agentMemory)
      .where(and(eq(agentMemory.workspaceId, workspaceId), eq(agentMemory.id, memoryId)))
      .returning({ id: agentMemory.id });
    return row ?? null;
  }

  static async buildContext(workspaceId: string, params: {
    entityType?: string;
    entityId?: string;
    query?: string;
    limit?: number;
  } = {}) {
    const rows = await this.recall(workspaceId, {
      entityType: params.entityType,
      entityId: params.entityId,
      query: params.query,
      limit: params.limit ?? 8,
    });
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      content: row.content,
      importance: row.importance,
      metadata: row.metadata,
    }));
  }
}
