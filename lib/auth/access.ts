/**
 * Ownership checks for Sales members: they may only act on leads and deals assigned to them.
 * Admins pass straight through. Server-side, so a guessed id can't reach someone else's gym.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deals, leads } from "@/db/schema";

type Ctx = { isSales: boolean; userId: string; workspaceId: string };

export class NotYoursError extends Error {
  constructor() {
    super("This gym is assigned to someone else.");
    this.name = "NotYoursError";
  }
}

export async function assertOwnsLead(ctx: Ctx, leadId: string | null | undefined) {
  if (!ctx.isSales || !leadId) return;
  const [row] = await db.select({ ownerId: leads.ownerId }).from(leads)
    .where(and(eq(leads.id, String(leadId)), eq(leads.workspaceId, ctx.workspaceId))).limit(1);
  if (!row || row.ownerId !== ctx.userId) throw new NotYoursError();
}

export async function assertOwnsDeal(ctx: Ctx, dealId: string | null | undefined) {
  if (!ctx.isSales || !dealId) return;
  const [row] = await db.select({ ownerId: deals.ownerId }).from(deals)
    .where(and(eq(deals.id, String(dealId)), eq(deals.workspaceId, ctx.workspaceId))).limit(1);
  if (!row || row.ownerId !== ctx.userId) throw new NotYoursError();
}
