import { db } from "@/db";
import { companies, contacts, leads, deals, projects, tasks, outboundCampaigns, outboundSteps, outboundEnrollments, outboundMessages, outboundReplies } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// PROJECT DELIVERY
// ---------------------------------------------------------------------------

export class ProjectService {
  /** All workspace projects, newest first, with client + owner + source deal. */
  static async getProjects(workspaceId: string) {
    return db.query.projects.findMany({
      where: eq(projects.workspaceId, workspaceId),
      orderBy: [desc(projects.createdAt)],
      with: {
        company: { columns: { name: true } },
        owner: { columns: { firstName: true, lastName: true } },
        deal: { columns: { name: true, value: true } },
      },
    });
  }

  static async createProject(workspaceId: string, data: Omit<typeof projects.$inferInsert, "workspaceId">) {
    const [project] = await db.insert(projects).values({ ...data, workspaceId }).returning();
    return project;
  }

  static async updateProject(workspaceId: string, projectId: string, data: Partial<typeof projects.$inferInsert>) {
    const [project] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
      .returning();
    return project;
  }

  static async deleteProject(workspaceId: string, projectId: string) {
    const [project] = await db
      .delete(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
      .returning();
    return project;
  }
}

// ---------------------------------------------------------------------------
// CRM CORE
// ---------------------------------------------------------------------------

export class CrmService {
  
  // ---------------------------------------------------------------------------
  // COMPANIES
  // ---------------------------------------------------------------------------
  
  static async getCompanies(workspaceId: string, limit = 50, offset = 0) {
    return db.query.companies.findMany({
      where: eq(companies.workspaceId, workspaceId),
      orderBy: [desc(companies.createdAt)],
      limit,
      offset,
      with: {
        contacts: { columns: { id: true } },
        leads: { columns: { id: true } },
        deals: { columns: { id: true, value: true } },
        owner: { columns: { firstName: true, lastName: true, email: true } }
      }
    });
  }

  static async getCompanyById(workspaceId: string, companyId: string) {
    return db.query.companies.findFirst({
      where: and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)),
      with: {
        contacts: true,
        leads: true,
        deals: true,
      }
    });
  }

  /** Finds a company in the workspace by website domain (used for discovery dedupe). */
  /** Exact (case-insensitive) name match — dedupe for website-less local businesses. */
  static async findCompanyByName(workspaceId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return db.query.companies.findFirst({
      where: and(eq(companies.workspaceId, workspaceId), sql`lower(${companies.name}) = lower(${trimmed})`),
    });
  }

  static async findCompanyByWebsite(workspaceId: string, website: string) {
    const domain = website
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    if (!domain) return null;
    return db.query.companies.findFirst({
      where: and(
        eq(companies.workspaceId, workspaceId),
        sql`lower(${companies.website}) like ${"%" + domain + "%"}`
      ),
    });
  }

  // --- Agent task management (copilot write-actions + operator to-dos) -------

  static async createTask(workspaceId: string, data: Omit<typeof tasks.$inferInsert, "workspaceId">) {
    const [task] = await db.insert(tasks).values({ ...data, workspaceId }).returning();
    return task;
  }

  static async getOpenTasks(workspaceId: string, limit = 20) {
    return db.query.tasks.findMany({
      where: and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, "OPEN")),
      orderBy: [desc(tasks.createdAt)],
      limit,
      with: {
        deal: { columns: { name: true } },
        lead: { columns: { id: true } },
        contact: { columns: { firstName: true, lastName: true } },
      },
    });
  }

  static async completeTask(workspaceId: string, taskId: string) {
    const [done] = await db
      .update(tasks)
      .set({ status: "DONE", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
      .returning();
    return done;
  }

  /** Fuzzy-finds a deal by name (case-insensitive substring) for copilot resolution. */
  static async findDealByName(workspaceId: string, name: string) {
    const needle = name.trim().toLowerCase();
    if (needle.length < 3) return null;
    const all = await db.query.deals.findMany({
      where: eq(deals.workspaceId, workspaceId),
      with: { company: { columns: { name: true } } },
    });
    return (
      all.find((d) => d.name.toLowerCase().includes(needle)) ??
      all.find((d) => `${d.name} ${d.company?.name ?? ""}`.toLowerCase().includes(needle)) ??
      null
    );
  }

  /** Fuzzy-finds an active lead by company or contact name for copilot resolution. */
  static async findLeadByName(workspaceId: string, name: string) {
    const needle = name.trim().toLowerCase();
    if (needle.length < 3) return null;
    const all = await db.query.leads.findMany({
      where: eq(leads.workspaceId, workspaceId),
      with: {
        company: { columns: { name: true } },
        contact: { columns: { firstName: true, lastName: true } },
      },
    });
    return (
      all.find((l) => (l.company?.name ?? "").toLowerCase().includes(needle)) ??
      all.find((l) => `${l.contact?.firstName ?? ""} ${l.contact?.lastName ?? ""}`.toLowerCase().includes(needle)) ??
      null
    );
  }

  static async createCompany(workspaceId: string, data: Omit<typeof companies.$inferInsert, "workspaceId">) {
    const [company] = await db.insert(companies)
      .values({ ...data, workspaceId })
      .returning();
    return company;
  }

  static async updateCompany(workspaceId: string, companyId: string, data: Partial<typeof companies.$inferInsert>) {
    const [updatedCompany] = await db.update(companies)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)))
      .returning();
    return updatedCompany;
  }

  static async deleteCompany(workspaceId: string, companyId: string) {
    const [deleted] = await db.delete(companies)
      .where(and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)))
      .returning();
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // CONTACTS
  // ---------------------------------------------------------------------------

  static async getContacts(workspaceId: string, limit = 50, offset = 0) {
    return db.query.contacts.findMany({
      where: eq(contacts.workspaceId, workspaceId),
      orderBy: [desc(contacts.createdAt)],
      limit,
      offset,
      with: {
        company: { columns: { name: true } }
      }
    });
  }

  static async getContactById(workspaceId: string, contactId: string) {
    return db.query.contacts.findFirst({
      where: and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)),
      with: {
        company: true,
        leads: true,
        activities: true
      }
    });
  }

  static async createContact(workspaceId: string, data: Omit<typeof contacts.$inferInsert, "workspaceId">) {
    const [contact] = await db.insert(contacts)
      .values({ ...data, workspaceId })
      .returning();
    return contact;
  }

  static async updateContact(workspaceId: string, contactId: string, data: Partial<typeof contacts.$inferInsert>) {
    const [updatedContact] = await db.update(contacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
      .returning();
    return updatedContact;
  }

  static async deleteContact(workspaceId: string, contactId: string) {
    const [deleted] = await db.delete(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
      .returning();
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // OUTBOUND OS
  // ---------------------------------------------------------------------------

  static async createPreparedOutboundMessage(workspaceId: string, data: Omit<typeof outboundMessages.$inferInsert, "workspaceId">) {
    const [message] = await db.insert(outboundMessages).values({ ...data, workspaceId }).returning();
    return message;
  }

  static async getOutboundMessage(workspaceId: string, messageId: string) {
    return db.query.outboundMessages.findFirst({
      where: and(eq(outboundMessages.workspaceId, workspaceId), eq(outboundMessages.id, messageId)),
    });
  }

  static async updateOutboundMessage(workspaceId: string, messageId: string, data: Partial<typeof outboundMessages.$inferInsert>) {
    const [updated] = await db.update(outboundMessages).set(data)
      .where(and(eq(outboundMessages.workspaceId, workspaceId), eq(outboundMessages.id, messageId))).returning();
    return updated;
  }

  static async countOutboundSendsToday(workspaceId: string, campaignId: string) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` })
      .from(outboundMessages).innerJoin(outboundEnrollments, eq(outboundMessages.enrollmentId, outboundEnrollments.id))
      .where(and(eq(outboundMessages.workspaceId, workspaceId), eq(outboundEnrollments.campaignId, campaignId),
        eq(outboundMessages.direction, "OUTBOUND"), eq(outboundMessages.status, "SENT"),
        sql`${outboundMessages.sentAt} >= current_date`));
    return row?.count ?? 0;
  }
  static async getOutboundMessages(workspaceId: string, enrollmentId: string) {
    return db.query.outboundMessages.findMany({
      where: and(eq(outboundMessages.workspaceId, workspaceId), eq(outboundMessages.enrollmentId, enrollmentId)),
      orderBy: [desc(outboundMessages.createdAt)],
    });
  }

  static async createOutboundReply(workspaceId: string, data: Omit<typeof outboundReplies.$inferInsert, "workspaceId">) {
    const [reply] = await db.insert(outboundReplies).values({ ...data, workspaceId }).returning();
    return reply;
  }

  static async updateOutboundEnrollmentState(workspaceId: string, enrollmentId: string, data: Partial<typeof outboundEnrollments.$inferInsert>) {
    const [updated] = await db.update(outboundEnrollments)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(outboundEnrollments.workspaceId, workspaceId), eq(outboundEnrollments.id, enrollmentId)))
      .returning();
    return updated;
  }

  static async getOutboundCampaigns(workspaceId: string) {
    return db.query.outboundCampaigns.findMany({
      where: eq(outboundCampaigns.workspaceId, workspaceId),
      orderBy: [desc(outboundCampaigns.updatedAt)],
      with: { steps: true, enrollments: true },
    });
  }

  static async createOutboundCampaign(
    workspaceId: string,
    data: Omit<typeof outboundCampaigns.$inferInsert, "workspaceId">,
  ) {
    const [campaign] = await db.insert(outboundCampaigns).values({ ...data, workspaceId }).returning();
    return campaign;
  }

  static async getOutboundCampaignById(workspaceId: string, campaignId: string) {
    return db.query.outboundCampaigns.findFirst({
      where: and(eq(outboundCampaigns.workspaceId, workspaceId), eq(outboundCampaigns.id, campaignId)),
      with: {
        steps: { orderBy: [outboundSteps.stepNumber] },
        enrollments: {
          with: {
            lead: {
              with: {
                company: { columns: { name: true } },
                contact: { columns: { firstName: true, lastName: true, email: true, jobTitle: true } },
              },
            },
          },
          orderBy: [desc(outboundEnrollments.updatedAt)],
        },
      },
    });
  }

  static async updateOutboundCampaign(
    workspaceId: string,
    campaignId: string,
    data: Partial<typeof outboundCampaigns.$inferInsert>,
  ) {
    const [campaign] = await db.update(outboundCampaigns)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(outboundCampaigns.workspaceId, workspaceId), eq(outboundCampaigns.id, campaignId)))
      .returning();
    return campaign;
  }

  static async createOutboundStep(
    workspaceId: string,
    campaignId: string,
    data: Omit<typeof outboundSteps.$inferInsert, "campaignId">,
  ) {
    const campaign = await db.query.outboundCampaigns.findFirst({
      where: and(eq(outboundCampaigns.id, campaignId), eq(outboundCampaigns.workspaceId, workspaceId)),
    });
    if (!campaign) throw new Error("Campaign not found");
    const [step] = await db.insert(outboundSteps).values({ ...data, campaignId }).returning();
    return step;
  }

  static async enrollLeadInOutboundCampaign(workspaceId: string, campaignId: string, leadId: string) {
    const [enrollment] = await db.insert(outboundEnrollments).values({
      workspaceId,
      campaignId,
      leadId,
      status: "ACTIVE",
      currentStep: 1,
      nextActionAt: new Date(),
    }).onConflictDoNothing().returning();
    if (!enrollment) {
      return db.query.outboundEnrollments.findFirst({
        where: and(
          eq(outboundEnrollments.workspaceId, workspaceId),
          eq(outboundEnrollments.campaignId, campaignId),
          eq(outboundEnrollments.leadId, leadId),
        ),
      });
    }
    return enrollment;
  }

  static async getOutboundQueue(workspaceId: string, limit = 50) {
    return db.query.outboundEnrollments.findMany({
      where: and(
        eq(outboundEnrollments.workspaceId, workspaceId),
        eq(outboundEnrollments.status, "ACTIVE"),
        sql`${outboundEnrollments.nextActionAt} <= now()`,
      ),
      orderBy: [outboundEnrollments.nextActionAt],
      limit,
      with: {
        lead: {
          with: {
            company: { columns: { name: true, website: true, industry: true, location: true } },
            contact: { columns: { firstName: true, lastName: true, email: true, phone: true, jobTitle: true, linkedinUrl: true } },
          },
        },
        campaign: { columns: { name: true, status: true } },
      },
    });
  }

  static async updateOutboundEnrollment(
    workspaceId: string,
    enrollmentId: string,
    data: Partial<typeof outboundEnrollments.$inferInsert>,
  ) {
    const [updated] = await db.update(outboundEnrollments)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(outboundEnrollments.workspaceId, workspaceId), eq(outboundEnrollments.id, enrollmentId)))
      .returning();
    return updated;
  }

  // ---------------------------------------------------------------------------
  // LEADS
  // ---------------------------------------------------------------------------

  /** Real table-wide counts for the leads page stat cards (not the page slice). */
  static async getLeadCounts(workspaceId: string) {
    const rows = await db
      .select({
        status: leads.status,
        temperature: leads.temperature,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId))
      .groupBy(leads.status, leads.temperature);
    return {
      total: rows.reduce((acc, r) => acc + r.count, 0),
      new: rows.filter((r) => r.status === "NEW").reduce((acc, r) => acc + r.count, 0),
      hot: rows.filter((r) => r.temperature === "HOT").reduce((acc, r) => acc + r.count, 0),
    };
  }

  static async getLeads(workspaceId: string, limit = 50, offset = 0) {
    return db.query.leads.findMany({
      where: eq(leads.workspaceId, workspaceId),
      orderBy: [desc(leads.createdAt)],
      limit,
      offset,
      with: {
        company: { columns: { name: true } },
        contact: { columns: { firstName: true, lastName: true, email: true } },
        owner: { columns: { firstName: true, lastName: true } }
      }
    });
  }

  /** Total active-lead count for pagination. */
  static async countLeads(workspaceId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId));
    return row?.n ?? 0;
  }

  static async getLeadById(workspaceId: string, leadId: string) {
    return db.query.leads.findFirst({
      where: and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)),
      with: {
        company: true,
        contact: true,
        owner: true,
        activities: true
      }
    });
  }

  static async createLead(workspaceId: string, data: Omit<typeof leads.$inferInsert, "workspaceId">) {
    const [lead] = await db.insert(leads)
      .values({ ...data, workspaceId })
      .returning();
    return lead;
  }

  static async updateLead(workspaceId: string, leadId: string, data: Partial<typeof leads.$inferInsert>) {
    const [updatedLead] = await db.update(leads)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
      .returning();
    return updatedLead;
  }

  static async deleteLead(workspaceId: string, leadId: string) {
    const [deleted] = await db.delete(leads)
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
      .returning();
    return deleted;
  }

  static async convertLeadToDeal(workspaceId: string, leadId: string, dealData: Partial<typeof deals.$inferInsert>) {
    const lead = await this.getLeadById(workspaceId, leadId);
    if (!lead) throw new Error("Lead not found");

    // Create corresponding deal
    const [deal] = await db.insert(deals).values({
      workspaceId,
      leadId: lead.id,
      companyId: lead.companyId,
      name: dealData.name || `Deal for ${lead.company?.name || 'Prospect'}`,
      value: dealData.value || "50000.00",
      currency: dealData.currency || "USD",
      stage: dealData.stage || "QUALIFIED",
      probability: dealData.probability || 60,
      ownerId: lead.ownerId,
      notes: dealData.notes || lead.notes,
    }).returning();

    // Mark lead status as CONVERTED
    await this.updateLead(workspaceId, leadId, { status: "CONVERTED", stage: "DEAL_CREATED" });

    return deal;
  }

  // ---------------------------------------------------------------------------
  // DEALS (PIPELINE)
  // ---------------------------------------------------------------------------

  static async getPipeline(workspaceId: string) {
    return db.query.deals.findMany({
      where: eq(deals.workspaceId, workspaceId),
      orderBy: [desc(deals.updatedAt)],
      with: {
        company: { columns: { name: true } },
        owner: { columns: { firstName: true, lastName: true } }
      }
    });
  }

  static async getDealById(workspaceId: string, dealId: string) {
    return db.query.deals.findFirst({
      where: and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)),
      with: {
        company: true,
        lead: true,
        owner: true,
        activities: true
      }
    });
  }

  static async createDeal(workspaceId: string, data: Omit<typeof deals.$inferInsert, "workspaceId">) {
    const [deal] = await db.insert(deals)
      .values({ ...data, workspaceId })
      .returning();
    return deal;
  }

  static async updateDeal(workspaceId: string, dealId: string, data: Partial<typeof deals.$inferInsert>) {
    const [updatedDeal] = await db.update(deals)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
      .returning();
    return updatedDeal;
  }

  static async updateDealStage(workspaceId: string, dealId: string, newStage: string) {
    const [deal] = await db.update(deals)
      .set({ stage: newStage, updatedAt: new Date() })
      .where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
      .returning();
    return deal;
  }

  static async deleteDeal(workspaceId: string, dealId: string) {
    const [deleted] = await db.delete(deals)
      .where(and(eq(deals.id, dealId), eq(deals.workspaceId, workspaceId)))
      .returning();
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // REAL-TIME STATS & AGGREGATION
  // ---------------------------------------------------------------------------

  /**
   * Live workspace telemetry computed from PostgreSQL. No mock fallbacks.
   */
  static async getRealtimeStats(
    workspaceId: string,
    user?: { firstName: string | null; lastName: string | null }
  ) {
    const startedAt = Date.now();

    const [dealAgg] = await db
      .select({
        totalValue: sql<string>`coalesce(sum(${deals.value}), 0)`,
        openValue: sql<string>`coalesce(sum(case when ${deals.stage} not in ('WON', 'LOST') then ${deals.value} else 0 end), 0)`,
        total: sql<number>`count(*)::int`,
        won: sql<number>`(count(*) filter (where ${deals.stage} = 'WON'))::int`,
        open: sql<number>`(count(*) filter (where ${deals.stage} not in ('WON', 'LOST')))::int`,
        fresh: sql<number>`(count(*) filter (where ${deals.stage} not in ('WON', 'LOST') and ${deals.updatedAt} > now() - interval '14 days'))::int`,
      })
      .from(deals)
      .where(eq(deals.workspaceId, workspaceId));

    const stageRows = await db
      .select({
        stage: deals.stage,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${deals.value}), 0)`,
      })
      .from(deals)
      .where(eq(deals.workspaceId, workspaceId))
      .groupBy(deals.stage);

    const [leadAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${leads.status} not in ('CONVERTED', 'LOST')))::int`,
        hot: sql<number>`(count(*) filter (where ${leads.temperature} = 'HOT' or ${leads.score} >= 70))::int`,
      })
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId));

    const [companyAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${companies.status} = 'ACTIVE'))::int`,
      })
      .from(companies)
      .where(eq(companies.workspaceId, workspaceId));

    const totalDeals = dealAgg?.total ?? 0;
    const openDeals = dealAgg?.open ?? 0;

    return {
      pipelineRevenue: Math.round(parseFloat(dealAgg?.openValue || "0")),
      totalPipelineValue: Math.round(parseFloat(dealAgg?.totalValue || "0")),
      activeLeads: leadAgg?.active ?? 0,
      hotLeads: leadAgg?.hot ?? 0,
      activeDeals: openDeals,
      activeCompanies: companyAgg?.active ?? 0,
      winRate: totalDeals > 0 ? (((dealAgg?.won ?? 0) / totalDeals) * 100).toFixed(1) + "%" : "—",
      pipelineHealth:
        openDeals > 0 ? ((((dealAgg?.fresh ?? 0)) / openDeals) * 100).toFixed(1) + "%" : "100.0%",
      stageCounts: Object.fromEntries(
        stageRows.map((r) => [r.stage, { count: r.count, value: Math.round(parseFloat(r.value || "0")) }])
      ) as Record<string, { count: number; value: number }>,
      latencyMs: Date.now() - startedAt,
      updatedAt: new Date().toISOString(),
      user: {
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
      },
    };
  }

  /**
   * Work queue computed from real lead/deal state: follow-ups due, hot leads,
   * stale leads, deals closing soon or gone quiet, and recent wins.
   */
  static async getPriorityQueue(workspaceId: string) {
    const openLeads = await db.query.leads.findMany({
      where: and(eq(leads.workspaceId, workspaceId), sql`${leads.status} not in ('CONVERTED', 'LOST')`),
      with: {
        company: { columns: { name: true } },
        contact: { columns: { firstName: true, lastName: true, email: true } },
      },
    });

    const openDeals = await db.query.deals.findMany({
      where: and(eq(deals.workspaceId, workspaceId), sql`${deals.stage} not in ('WON', 'LOST')`),
      with: { company: { columns: { name: true } } },
    });

    const wonDeals = await db.query.deals.findMany({
      where: and(eq(deals.workspaceId, workspaceId), eq(deals.stage, "WON")),
      orderBy: [desc(deals.updatedAt)],
      limit: 5,
      with: { company: { columns: { name: true } } },
    });

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const followUpsDue = openLeads
      .filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= endOfToday)
      .sort(
        (a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime()
      );

    const hotLeads = openLeads
      .filter((l) => l.temperature === "HOT" || l.score >= 70)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const followUpIds = new Set(followUpsDue.map((l) => l.id));
    const staleLeads = openLeads.filter(
      (l) =>
        !followUpIds.has(l.id) &&
        (!l.lastContactedAt || new Date(l.lastContactedAt) < sevenDaysAgo)
    );

    const dealsNeedingAttention = openDeals
      .filter((d) => {
        const closesSoon = d.expectedCloseDate && new Date(d.expectedCloseDate) <= weekAhead;
        const goneQuiet = new Date(d.updatedAt) < sevenDaysAgo;
        return closesSoon || goneQuiet;
      })
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
      .map((d) => ({
        ...d,
        closesThisWeek: Boolean(d.expectedCloseDate && new Date(d.expectedCloseDate) <= weekAhead),
      }));

    return { followUpsDue, hotLeads, staleLeads, dealsNeedingAttention, wonRecently: wonDeals };
  }

  static async getCommandCenterStats(workspaceId: string) {
    return this.getRealtimeStats(workspaceId);
  }

}
