"use server";

import { db } from "@/db";
import { companies, contacts, deals, leads, projects, workspaces } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { CrmService, ProjectService } from "@/services/crm.service";
import { ActivityService } from "@/services/activity.service";
import { LeadScoringService } from "@/services/sales/lead-scoring.service";
import { requireWorkspace } from "@/lib/auth/workspace";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// AGENT TASKS
// ---------------------------------------------------------------------------

export async function completeTaskAction(taskId: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const done = await CrmService.completeTask(workspaceId, taskId);
  if (done) {
    await ActivityService.logAudit(workspaceId, userId, "UPDATE", "TASK", done.id, {
      via: "operator",
      field: "status",
      to: "DONE",
      title: done.title,
    });
  }
  revalidatePath("/my-day");
  return { success: Boolean(done) };
}

// ---------------------------------------------------------------------------
// REAL-TIME DASHBOARD DATA
// ---------------------------------------------------------------------------

export async function getRealtimeDashboardDataAction() {
  try {
    const { workspaceId } = await requireWorkspace();
    const stats = await CrmService.getRealtimeStats(workspaceId);
    return { success: true, data: stats };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load dashboard telemetry",
    };
  }
}

export async function getPriorityQueueAction() {
  const { workspaceId } = await requireWorkspace();
  const queue = await CrmService.getPriorityQueue(workspaceId);
  revalidatePath("/my-day");
  return queue;
}

// ---------------------------------------------------------------------------
// COMPANIES
// ---------------------------------------------------------------------------

export async function createCompanyAction(data: Omit<typeof companies.$inferInsert, "workspaceId" | "ownerId">) {
  const { userId, workspaceId } = await requireWorkspace();
  const company = await CrmService.createCompany(workspaceId, { ...data, ownerId: userId });
  await ActivityService.logAudit(workspaceId, userId, "CREATE", "COMPANY", company.id);
  revalidatePath("/clients");
  revalidatePath("/sales/companies");
  return company;
}

export async function updateCompanyAction(companyId: string, data: Partial<Omit<typeof companies.$inferInsert, "workspaceId">>) {
  const { userId, workspaceId } = await requireWorkspace();
  const company = await CrmService.updateCompany(workspaceId, companyId, data);
  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "COMPANY", company.id);
  revalidatePath("/clients");
  revalidatePath(`/sales/companies/${companyId}`);
  return company;
}

export async function deleteCompanyAction(companyId: string) {
  const { userId, workspaceId } = await requireWorkspace();
  const company = await CrmService.deleteCompany(workspaceId, companyId);
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "COMPANY", companyId);
  revalidatePath("/clients");
  revalidatePath("/sales/companies");
  return company;
}

// ---------------------------------------------------------------------------
// CONTACTS
// ---------------------------------------------------------------------------

export async function createContactAction(data: Omit<typeof contacts.$inferInsert, "workspaceId">) {
  const { userId, workspaceId } = await requireWorkspace();
  const contact = await CrmService.createContact(workspaceId, data);
  await ActivityService.logAudit(workspaceId, userId, "CREATE", "CONTACT", contact.id);
  revalidatePath("/sales/contacts");
  return contact;
}

export async function updateContactAction(contactId: string, data: Partial<Omit<typeof contacts.$inferInsert, "workspaceId">>) {
  const { userId, workspaceId } = await requireWorkspace();
  const contact = await CrmService.updateContact(workspaceId, contactId, data);
  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "CONTACT", contact.id);
  revalidatePath("/sales/contacts");
  return contact;
}

export async function deleteContactAction(contactId: string) {
  const { userId, workspaceId } = await requireWorkspace();
  const contact = await CrmService.deleteContact(workspaceId, contactId);
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "CONTACT", contactId);
  revalidatePath("/sales/contacts");
  return contact;
}

// ---------------------------------------------------------------------------
// LEADS
// ---------------------------------------------------------------------------

export async function createLeadAction(data: Omit<typeof leads.$inferInsert, "workspaceId" | "score" | "ownerId">) {
  const { userId, workspaceId } = await requireWorkspace();
  
  // Calculate initial score
  const score = LeadScoringService.calculateScore(data, undefined);
  
  const lead = await CrmService.createLead(workspaceId, { 
    ...data, 
    score,
    ownerId: userId // Default to creator if not assigned
  });

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "LEAD", lead.id);

  // Closed loop: publish the domain event for the agentic layer (never throws).
  const { publishAndMaybeProcess } = await import("@/agents/events/bus");
  await publishAndMaybeProcess({
    eventType: "lead.created",
    entityType: "lead",
    entityId: lead.id,
    payload: { temperature: lead.temperature, score: lead.score, status: lead.status, company: data.companyId ?? null },
  });

  revalidatePath("/leads");
  revalidatePath("/sales/leads");
  revalidatePath("/");
  return lead;
}

export async function updateLeadAction(leadId: string, data: Partial<Omit<typeof leads.$inferInsert, "workspaceId">>) {
  const { userId, workspaceId } = await requireWorkspace();
  const lead = await CrmService.updateLead(workspaceId, leadId, data);
  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "LEAD", lead.id);
  revalidatePath("/leads");
  revalidatePath("/sales/leads");
  return lead;
}

export async function deleteLeadAction(leadId: string) {
  const { userId, workspaceId } = await requireWorkspace();
  const lead = await CrmService.deleteLead(workspaceId, leadId);
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "LEAD", leadId);
  revalidatePath("/leads");
  revalidatePath("/sales/leads");
  return lead;
}

export async function convertLeadToDealAction(leadId: string, dealData: Partial<Omit<typeof deals.$inferInsert, "workspaceId" | "leadId" | "ownerId">>) {
  const { userId, workspaceId } = await requireWorkspace();
  const deal = await CrmService.convertLeadToDeal(workspaceId, leadId, dealData);
  await ActivityService.logAudit(workspaceId, userId, "CONVERT", "LEAD_TO_DEAL", leadId, { dealId: deal.id });
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/sales/deals");
  return deal;
}

// ---------------------------------------------------------------------------
// DEALS (PIPELINE)
// ---------------------------------------------------------------------------

export async function createDealAction(data: Omit<typeof deals.$inferInsert, "workspaceId" | "ownerId">) {
  const { userId, workspaceId } = await requireWorkspace();
  const deal = await CrmService.createDeal(workspaceId, { ...data, ownerId: userId });
  await ActivityService.logAudit(workspaceId, userId, "CREATE", "DEAL", deal.id);
  revalidatePath("/pipeline");
  revalidatePath("/sales/deals");
  revalidatePath("/");
  return deal;
}

export async function updateDealAction(dealId: string, data: Partial<Omit<typeof deals.$inferInsert, "workspaceId">>) {
  const { userId, workspaceId } = await requireWorkspace();
  const deal = await CrmService.updateDeal(workspaceId, dealId, data);
  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "DEAL", deal.id);
  revalidatePath("/pipeline");
  revalidatePath("/sales/deals");
  return deal;
}

export async function updateDealStageAction(dealId: string, newStage: string) {
  const { userId, workspaceId } = await requireWorkspace();

  // Get the old deal (workspace-scoped) to record the change activity
  const oldDeal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)),
  });

  if (!oldDeal) {
    throw new Error("Deal not found in this workspace");
  }

  const deal = await CrmService.updateDealStage(workspaceId, dealId, newStage);
  
  if (oldDeal && oldDeal.stage !== newStage) {
    await ActivityService.createActivity(workspaceId, {
      workspaceId,
      actorId: userId,
      dealId: deal.id,
      type: "STAGE_CHANGE",
      title: "Stage Changed",
      description: `Moved from ${oldDeal.stage} to ${newStage}`,
      metadata: { previous_stage: oldDeal.stage, new_stage: newStage }
    });
  }

  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "DEAL", deal.id, { field: "stage", newStage });
  revalidatePath("/pipeline");
  revalidatePath("/sales/deals");
  revalidatePath("/");
  return deal;
}

export async function deleteDealAction(dealId: string) {
  const { userId, workspaceId } = await requireWorkspace();
  const deal = await CrmService.deleteDeal(workspaceId, dealId);
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "DEAL", dealId);
  revalidatePath("/pipeline");
  revalidatePath("/sales/deals");
  return deal;
}

// ---------------------------------------------------------------------------
// AI OUTREACH GENERATOR
// ---------------------------------------------------------------------------

export async function generateAiOutreachAction(targetProfile: string, valueProp: string) {
  const emailSubject = `Quick question regarding CRM velocity for ${targetProfile.split(" ")[0] || "your team"}`;
  const emailBody = `Hi, noticed your focus on ${valueProp}. Most operations leaders we partner with see an immediate 28% velocity increase when integrating automated priority queue telemetry...`;

  return {
    success: true,
    data: {
      subject: emailSubject,
      body: emailBody,
      targetProfile,
      generatedAt: new Date().toISOString(),
    }
  };
}

// ---------------------------------------------------------------------------
// AGENTIC OPERATIONS
// ---------------------------------------------------------------------------

const SWEEP_FOLLOW_UP_DAYS = 2;

/**
 * Agentic follow-up sweep: scans every active lead, schedules a follow-up for
 * stale/unattended ones (quiet past the workspace's stale-lead window or never
 * contacted), writes the next follow-up date, and logs an OUTREACH activity per
 * lead. Honors the workspace's automation settings (sweepEnabled, intervals).
 * Returns a report.
 */
export async function queueStaleFollowUpsAction() {
  const { userId, workspaceId } = await requireWorkspace();

  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (workspace && !workspace.sweepEnabled) {
    return { scheduled: 0, skipped: 0, totalActive: 0, leads: [], disabled: true };
  }
  const followUpDays = workspace?.sweepFollowUpDays ?? SWEEP_FOLLOW_UP_DAYS;
  const staleDays = workspace?.staleLeadDays ?? 7;

  const sevenDaysAgo = new Date(Date.now() - staleDays * 864e5);

  const activeLeads = await db.query.leads.findMany({
    where: and(eq(leads.workspaceId, workspaceId), sql`${leads.status} not in ('CONVERTED', 'LOST')`),
    with: { company: { columns: { name: true } }, contact: { columns: { firstName: true, lastName: true, email: true } } },
  });

  const now = Date.now();
  const targets = activeLeads.filter((l) => {
    // Skip leads that already have a future follow-up scheduled — re-running
    // the sweep must not duplicate outreach.
    if (l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() > now) return false;
    return !l.lastContactedAt || new Date(l.lastContactedAt).getTime() < sevenDaysAgo.getTime();
  });

  let scheduled = 0;
  for (const lead of targets) {
    const nextAt = new Date(now + followUpDays * 864e5);
    await CrmService.updateLead(workspaceId, lead.id, { nextFollowUpAt: nextAt });
    await ActivityService.createActivity(workspaceId, {
      workspaceId,
      actorId: userId,
      leadId: lead.id,
      type: "OUTREACH",
      title: "Agentic follow-up scheduled",
      description: `Copilot scheduled a follow-up for ${nextAt.toLocaleDateString()} (lead was ${lead.lastContactedAt ? "7+ days quiet" : "never contacted"}).`,
      metadata: { source: "agentic_sweep", previousFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null },
    });
    scheduled += 1;
  }

  await ActivityService.logAudit(workspaceId, userId, "AGENTIC_SWEEP", "LEAD_BATCH", workspaceId, { scheduled });
  revalidatePath("/my-day");
  revalidatePath("/sales/leads");
  revalidatePath("/");

  return {
    scheduled,
    skipped: activeLeads.length - scheduled,
    totalActive: activeLeads.length,
    leads: targets.map((l) => ({
      id: l.id,
      company: l.company?.name || "Unknown",
      contact: l.contact ? `${l.contact.firstName} ${l.contact.lastName ?? ""}`.trim() : "—",
    })),
  };
}

/**
 * Persists a user-logged activity (note, call, email, meeting) against a lead,
 * deal, or contact, and stamps the lead's lastContactedAt when applicable.
 */
export async function createActivityAction(input: {
  entityType: "lead" | "deal" | "contact";
  entityId: string;
  type: string;
  title: string;
  description?: string;
}) {
  const { userId, workspaceId } = await requireWorkspace();

  const activity = await ActivityService.createActivity(workspaceId, {
    workspaceId,
    actorId: userId,
    leadId: input.entityType === "lead" ? input.entityId : undefined,
    dealId: input.entityType === "deal" ? input.entityId : undefined,
    contactId: input.entityType === "contact" ? input.entityId : undefined,
    type: input.type,
    title: input.title,
    description: input.description || null,
  });

  if (input.entityType === "lead") {
    await CrmService.updateLead(workspaceId, input.entityId, { lastContactedAt: new Date() });
  }

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "ACTIVITY", activity.id, {
    entityType: input.entityType,
    activityType: input.type,
  });

  revalidatePath("/sales/leads");
  revalidatePath("/my-day");
  revalidatePath(`/sales/${input.entityType}s/${input.entityId}`);
  return activity;
}

// ---------------------------------------------------------------------------
// WORKSPACE SETTINGS
// ---------------------------------------------------------------------------

export async function getWorkspaceSettingsAction() {
  const { workspaceId } = await requireWorkspace();
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      sweepEnabled: true,
      sweepFollowUpDays: true,
      staleLeadDays: true,
    },
  });
  if (!workspace) throw new Error("Workspace not found");
  return workspace;
}

export async function updateWorkspaceSettingsAction(input: {
  name?: string;
  sweepEnabled?: boolean;
  sweepFollowUpDays?: number;
  staleLeadDays?: number;
}) {
  const { userId, workspaceId } = await requireWorkspace();

  const data: {
    name?: string;
    sweepEnabled?: boolean;
    sweepFollowUpDays?: number;
    staleLeadDays?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw new Error("Workspace name must be at least 2 characters");
    data.name = name;
  }
  if (input.sweepEnabled !== undefined) data.sweepEnabled = input.sweepEnabled;
  if (input.sweepFollowUpDays !== undefined) {
    data.sweepFollowUpDays = Math.max(1, Math.min(30, Math.round(input.sweepFollowUpDays)));
  }
  if (input.staleLeadDays !== undefined) {
    data.staleLeadDays = Math.max(1, Math.min(60, Math.round(input.staleLeadDays)));
  }

  const [updated] = await db
    .update(workspaces)
    .set(data)
    .where(eq(workspaces.id, workspaceId))
    .returning({
      name: workspaces.name,
      sweepEnabled: workspaces.sweepEnabled,
      sweepFollowUpDays: workspaces.sweepFollowUpDays,
      staleLeadDays: workspaces.staleLeadDays,
    });

  if (!updated) throw new Error("Workspace not found");

  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "WORKSPACE", workspaceId, data as Record<string, unknown>);
  revalidatePath("/settings");
  revalidatePath("/");
  return updated;
}

// ---------------------------------------------------------------------------
// PROJECT DELIVERY
// ---------------------------------------------------------------------------

/**
 * Creates a real project record. `code` is auto-assigned as PRJ-### when the
 * caller doesn't supply one, derived from the workspace's project count.
 */
export async function createProjectAction(input: {
  name: string;
  companyId?: string;
  dealId?: string;
  budget?: number;
  dueDate?: string;
  notes?: string;
}) {
  const { userId, workspaceId } = await requireWorkspace();

  const existing = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  const nextNumber =
    existing.reduce((max, p) => {
      const m = /^PRJ-(\d+)$/.exec(p.code ?? "");
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0) + 1;

  const project = await ProjectService.createProject(workspaceId, {
    name: input.name.trim(),
    companyId: input.companyId || undefined,
    dealId: input.dealId || undefined,
    code: `PRJ-${String(nextNumber).padStart(3, "0")}`,
    ownerId: userId,
    budget: input.budget != null ? String(input.budget) : undefined,
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    notes: input.notes?.trim() || undefined,
  });

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "PROJECT", project.id, {
    code: project.code,
  });
  revalidatePath("/projects");
  return project;
}

/**
 * Updates mutable project fields. When status moves to DELIVERED the
 * deliveredAt timestamp is stamped automatically; leaving that status clears it.
 */
export async function updateProjectAction(
  projectId: string,
  input: {
    progress?: number;
    status?: string;
    health?: string;
    notes?: string;
  }
) {
  const { userId, workspaceId } = await requireWorkspace();

  const data: { progress?: number; status?: string; health?: string; notes?: string; deliveredAt?: Date | null } = {};
  if (input.progress != null) data.progress = Math.max(0, Math.min(100, Math.round(input.progress)));
  if (input.status) {
    data.status = input.status;
    data.deliveredAt = input.status === "DELIVERED" ? new Date() : null;
  }
  if (input.health) data.health = input.health;
  if (input.notes !== undefined) data.notes = input.notes.trim() || undefined;

  const project = await ProjectService.updateProject(workspaceId, projectId, data);
  if (!project) throw new Error("Project not found");

  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "PROJECT", projectId, data);
  revalidatePath("/projects");
  return project;
}

export async function deleteProjectAction(projectId: string) {
  const { userId, workspaceId } = await requireWorkspace();
  const project = await ProjectService.deleteProject(workspaceId, projectId);
  await ActivityService.logAudit(workspaceId, userId, "DELETE", "PROJECT", projectId);
  revalidatePath("/projects");
  return project;
}

// ---------------------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------------------

/**
 * Schedule a meeting. Persisted as a real MEETING activity so it shows up on
 * the Calendar, lead/deal timelines, and agent context. `when` is a local
 * datetime-local string; stored as an instant.
 */
export async function scheduleMeetingAction(input: {
  title: string;
  when: string;
  description?: string;
  entityType?: "lead" | "deal" | "contact";
  entityId?: string;
}) {
  const { userId, workspaceId } = await requireWorkspace();

  const whenDate = new Date(input.when);
  if (!input.title.trim()) throw new Error("Meeting title is required");
  if (Number.isNaN(whenDate.getTime())) throw new Error("Invalid meeting date");

  const leadId = input.entityType === "lead" ? input.entityId : undefined;
  const dealId = input.entityType === "deal" ? input.entityId : undefined;
  const contactId = input.entityType === "contact" ? input.entityId : undefined;

  const activity = await ActivityService.createActivity(workspaceId, {
    workspaceId,
    actorId: userId,
    leadId: leadId ?? null,
    dealId: dealId ?? null,
    contactId: contactId ?? null,
    type: "MEETING",
    title: input.title.trim(),
    description: input.description?.trim() || null,
    occurredAt: whenDate,
  });

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "ACTIVITY", activity.id, {
    entityType: input.entityType ?? "unlinked",
    activityType: "MEETING",
    scheduledFor: whenDate.toISOString(),
  });

  if (input.entityType === "lead" && input.entityId) {
    await CrmService.updateLead(workspaceId, input.entityId, { lastContactedAt: new Date() });
  }

  revalidatePath("/calendar");
  revalidatePath("/my-day");
  return activity;
}
