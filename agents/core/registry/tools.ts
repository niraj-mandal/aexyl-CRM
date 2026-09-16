/**
 * Agent Tool Registry — typed, permissioned, auditable tools.
 *
 * Agents NEVER touch the database directly (no raw SQL, no drizzle imports in
 * agent code). They call tools; tools call domain services; services enforce
 * workspace isolation. Every tool call flows through the policy engine.
 */
import { z } from "zod";

export type ToolCategory = "crm" | "sales" | "projects" | "intelligence" | "research" | "communication";
export type ToolRisk = "LOW" | "MEDIUM" | "HIGH";

export interface AgentToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  riskLevel: ToolRisk;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  requiredPermission: string;
  /** Max calls per day per agent (0 = registry default). */
  defaultDailyLimit: number;
  inputSchema: z.ZodType<unknown>;
  /** Executes the tool. Receives validated args + workspace scope. */
  execute: (args: unknown, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  workspaceId: string;
  userId: string;
  runId: string;
  dryRun: boolean;
}

// --- input schemas -----------------------------------------------------------

const uuidSchema = z.string().uuid();
const searchText = z.string().min(2).max(200);

export const TOOL_SCHEMAS = {
  search_leads: z.object({ query: searchText, limit: z.number().int().min(1).max(25).default(10) }),
  get_lead: z.object({ leadId: uuidSchema }),
  update_lead: z.object({
    leadId: uuidSchema,
    status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "NURTURE", "CONVERTED", "LOST"]).optional(),
    stage: z.string().max(40).optional(),
    temperature: z.enum(["COLD", "WARM", "HOT"]).optional(),
    score: z.number().int().min(0).max(100).optional(),
    nextFollowUpAt: z.string().datetime().optional(),
    notes: z.string().max(2000).optional(),
  }),
  create_activity: z.object({
    leadId: uuidSchema.optional(),
    dealId: uuidSchema.optional(),
    type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "OUTREACH", "FOLLOW_UP", "STAGE_CHANGE", "STATUS_CHANGE"]),
    title: z.string().min(3).max(200),
    description: z.string().max(2000).optional(),
  }),
  search_deals: z.object({ query: searchText, limit: z.number().int().min(1).max(25).default(10) }),
  move_deal_stage: z.object({
    dealId: uuidSchema,
    stage: z.enum(["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]),
  }),
  search_companies: z.object({ query: searchText, limit: z.number().int().min(1).max(25).default(10) }),
  create_company: z.object({
    name: z.string().min(2).max(160),
    website: z.string().url().max(300).optional(),
    industry: z.string().max(120).optional(),
    location: z.string().max(200).optional(),
    size: z.string().max(60).optional(),
    source: z.string().max(160).optional(),
    notes: z.string().max(2000).optional(),
  }),
  search_projects: z.object({ query: searchText, limit: z.number().int().min(1).max(25).default(10) }),
  create_task: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(2000).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    dueInDays: z.number().int().min(0).max(365).optional(),
    dealId: uuidSchema.optional(),
    leadId: uuidSchema.optional(),
  }),
  get_insights: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
  get_attention_items: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
  get_business_metrics: z.object({}),
  get_daily_briefing: z.object({}),
  web_search: z.object({ query: searchText, maxResults: z.number().int().min(1).max(8).default(5) }),
  discover_local_leads: z.object({
    category: searchText,
    city: searchText,
    maxResults: z.number().int().min(1).max(20).default(10),
  }),
  prepare_email: z.object({
    toEmail: z.string().email(),
    subject: z.string().min(3).max(200),
    body: z.string().min(10).max(5000),
    leadId: uuidSchema.optional(),
    purpose: z.string().max(200).default("outreach"),
  }),
  prepare_message: z.object({
    toPhone: z.string().regex(/^\+?[0-9][0-9 ()-]{6,18}$/, "must be a real phone number"),
    channel: z.enum(["WHATSAPP", "SMS"]).default("WHATSAPP"),
    body: z.string().min(10).max(2000),
    leadId: uuidSchema.optional(),
    purpose: z.string().max(200).default("initial_outreach"),
  }),
  send_email: z.object({
    approvalId: uuidSchema,
  }),
} as const;

// --- registry ----------------------------------------------------------------

import { CrmService, ProjectService } from "@/services/crm.service";
import { ActivityService } from "@/services/activity.service";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import { LeadDiscoveryService } from "@/services/ai/lead-discovery.service";
import { LocalLeadDiscoveryService } from "@/services/ai/local-lead-discovery.service";
import { sendRawEmail } from "@/services/email.service";
import { db } from "@/db";
import { agentApprovals } from "@/db/schema";
import { eq } from "drizzle-orm";

function tool(def: AgentToolDefinition): AgentToolDefinition {
  return def;
}

export const AGENT_TOOLS: Record<string, AgentToolDefinition> = Object.fromEntries(
  [
    // --- CRM ---
    tool({
      id: "crm.search_leads",
      name: "Search Leads",
      description: "Search active leads by company/contact/notes text",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.crm.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.search_leads,
      execute: async (args, ctx) => {
        const { query, limit } = TOOL_SCHEMAS.search_leads.parse(args);
        const all = await CrmService.getLeads(ctx.workspaceId, 100);
        const q = query.toLowerCase();
        return all
          .filter(
            (l) =>
              (l.company?.name ?? "").toLowerCase().includes(q) ||
              `${l.contact?.firstName ?? ""} ${l.contact?.lastName ?? ""}`.toLowerCase().includes(q) ||
              (l.notes ?? "").toLowerCase().includes(q)
          )
          .slice(0, limit)
          .map((l) => ({
            id: l.id,
            company: l.company?.name ?? null,
            contact: l.contact ? `${l.contact.firstName ?? ""} ${l.contact.lastName ?? ""}`.trim() : null,
            status: l.status,
            stage: l.stage,
            score: l.score,
            temperature: l.temperature,
            lastContactedAt: l.lastContactedAt,
          }));
      },
    }),
    tool({
      id: "crm.get_lead",
      name: "Get Lead",
      description: "Fetch one lead with company, contact, activities",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.crm.read",
      defaultDailyLimit: 300,
      inputSchema: TOOL_SCHEMAS.get_lead,
      execute: async (args, ctx) => {
        const { leadId } = TOOL_SCHEMAS.get_lead.parse(args);
        const lead = await CrmService.getLeadById(ctx.workspaceId, leadId);
        if (!lead) throw new Error("Lead not found in this workspace");
        return lead;
      },
    }),
    tool({
      id: "crm.update_lead",
      name: "Update Lead",
      description: "Mutate lead status/stage/temperature/follow-up",
      category: "crm",
      riskLevel: "MEDIUM",
      requiresApproval: true,
      supportsDryRun: true,
      requiredPermission: "tools.crm.write",
      defaultDailyLimit: 60,
      inputSchema: TOOL_SCHEMAS.update_lead,
      execute: async (args, ctx) => {
        const parsed = TOOL_SCHEMAS.update_lead.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldUpdate: parsed };
        const { leadId, nextFollowUpAt, notes, ...rest } = parsed;
        const updated = await CrmService.updateLead(ctx.workspaceId, leadId, {
          ...rest,
          ...(nextFollowUpAt ? { nextFollowUpAt: new Date(nextFollowUpAt) } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date(),
        });
        if (!updated) throw new Error("Lead not found in this workspace");
        await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "UPDATE", "LEAD", leadId, {
          via: "agent_tool",
          runId: ctx.runId,
          changes: rest,
        });
        // Verification step: read back and confirm
        const verify = await CrmService.getLeadById(ctx.workspaceId, leadId);
        return { updated: true, verified: verify ? { status: verify.status, stage: verify.stage, temperature: verify.temperature } : null };
      },
    }),
    tool({
      id: "crm.create_activity",
      name: "Create Activity",
      description: "Log a note/call/email/meeting on a lead or deal",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: true,
      requiredPermission: "tools.crm.write",
      defaultDailyLimit: 100,
      inputSchema: TOOL_SCHEMAS.create_activity,
      execute: async (args, ctx) => {
        const parsed = TOOL_SCHEMAS.create_activity.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldCreate: parsed };
        const activity = await ActivityService.createActivity(ctx.workspaceId, {
          workspaceId: ctx.workspaceId,
          leadId: parsed.leadId ?? null,
          dealId: parsed.dealId ?? null,
          actorId: ctx.userId,
          type: parsed.type,
          title: parsed.title,
          description: parsed.description ?? null,
          metadata: { via: "agent_tool", runId: ctx.runId },
        });
        await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "CREATE", "ACTIVITY", activity.id, {
          via: "agent_tool",
          runId: ctx.runId,
          type: parsed.type,
        });
        return { created: true, activityId: activity.id };
      },
    }),
    tool({
      id: "crm.search_deals",
      name: "Search Deals",
      description: "Search deals by name/company",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.crm.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.search_deals,
      execute: async (args, ctx) => {
        const { query, limit } = TOOL_SCHEMAS.search_deals.parse(args);
        const all = await CrmService.getPipeline(ctx.workspaceId);
        const q = query.toLowerCase();
        return all
          .filter((d) => d.name.toLowerCase().includes(q) || (d.company?.name ?? "").toLowerCase().includes(q))
          .slice(0, limit)
          .map((d) => ({
            id: d.id,
            name: d.name,
            company: d.company?.name ?? null,
            stage: d.stage,
            value: d.value,
            expectedCloseDate: d.expectedCloseDate,
          }));
      },
    }),
    tool({
      id: "crm.move_deal_stage",
      name: "Move Deal Stage",
      description: "Move a deal to another pipeline stage",
      category: "crm",
      riskLevel: "HIGH",
      requiresApproval: true,
      supportsDryRun: true,
      requiredPermission: "tools.crm.write",
      defaultDailyLimit: 30,
      inputSchema: TOOL_SCHEMAS.move_deal_stage,
      execute: async (args, ctx) => {
        const { dealId, stage } = TOOL_SCHEMAS.move_deal_stage.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldMove: { dealId, stage } };
        const updated = await CrmService.updateDealStage(ctx.workspaceId, dealId, stage);
        if (!updated) throw new Error("Deal not found in this workspace");
        await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "UPDATE", "DEAL", dealId, {
          via: "agent_tool",
          runId: ctx.runId,
          field: "stage",
          to: stage,
        });
        return { moved: true, stage: updated.stage };
      },
    }),
    tool({
      id: "crm.search_companies",
      name: "Search Companies",
      description: "Search companies by name/industry",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.crm.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.search_companies,
      execute: async (args, ctx) => {
        const { query, limit } = TOOL_SCHEMAS.search_companies.parse(args);
        const all = await CrmService.getCompanies(ctx.workspaceId, 200);
        const q = query.toLowerCase();
        return all
          .filter((c) => c.name.toLowerCase().includes(q) || (c.industry ?? "").toLowerCase().includes(q))
          .slice(0, limit)
          .map((c) => ({ id: c.id, name: c.name, industry: c.industry, location: c.location, size: c.size }));
      },
    }),
    tool({
      id: "crm.create_company",
      name: "Create Company",
      description: "Create a company record (e.g. discovered prospect)",
      category: "crm",
      riskLevel: "MEDIUM",
      requiresApproval: true,
      supportsDryRun: true,
      requiredPermission: "tools.crm.write",
      defaultDailyLimit: 40,
      inputSchema: TOOL_SCHEMAS.create_company,
      execute: async (args, ctx) => {
        const parsed = TOOL_SCHEMAS.create_company.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldCreate: parsed };
        // Dedupe by website domain before creating
        if (parsed.website) {
          const existing = await CrmService.findCompanyByWebsite(ctx.workspaceId, parsed.website);
          if (existing) return { created: false, duplicateOf: existing.name, companyId: existing.id };
        }
        const company = await CrmService.createCompany(ctx.workspaceId, { ...parsed, ownerId: ctx.userId });
        await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "CREATE", "COMPANY", company.id, {
          via: "agent_tool",
          runId: ctx.runId,
          name: company.name,
        });
        return { created: true, companyId: company.id };
      },
    }),

    // --- PROJECTS ---
    tool({
      id: "projects.search_projects",
      name: "Search Projects",
      description: "Search delivery projects by name/client",
      category: "projects",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.projects.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.search_projects,
      execute: async (args, ctx) => {
        const { query, limit } = TOOL_SCHEMAS.search_projects.parse(args);
        const projects = await ProjectService.getProjects(ctx.workspaceId);
        const q = query.toLowerCase();
        return projects
          .filter((p) => p.name.toLowerCase().includes(q) || (p.company?.name ?? "").toLowerCase().includes(q))
          .slice(0, limit)
          .map((p) => ({
            id: p.id,
            name: p.name,
            client: p.company?.name ?? null,
            status: p.status,
            health: p.health,
            progress: p.progress,
            dueDate: p.dueDate,
          }));
      },
    }),
    tool({
      id: "projects.create_task",
      name: "Create Task",
      description: "Create an agent/operator task, optionally linked to a deal/lead",
      category: "projects",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      supportsDryRun: true,
      requiredPermission: "tools.projects.write",
      defaultDailyLimit: 60,
      inputSchema: TOOL_SCHEMAS.create_task,
      execute: async (args, ctx) => {
        const parsed = TOOL_SCHEMAS.create_task.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldCreate: parsed };
        const task = await CrmService.createTask(ctx.workspaceId, {
          title: parsed.title,
          description: parsed.description ?? null,
          priority: parsed.priority,
          dueAt: parsed.dueInDays !== undefined ? new Date(Date.now() + parsed.dueInDays * 86_400_000) : null,
          dealId: parsed.dealId ?? null,
          leadId: parsed.leadId ?? null,
          createdBy: "copilot",
          assignedToId: ctx.userId,
        });
        await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "CREATE", "TASK", task.id, {
          via: "agent_tool",
          runId: ctx.runId,
          title: task.title,
        });
        return { created: true, taskId: task.id };
      },
    }),

    // --- INTELLIGENCE ---
    tool({
      id: "intelligence.get_insights",
      name: "Get Insights",
      description: "Latest strategic insights from the pipeline audit engine",
      category: "intelligence",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.intelligence.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.get_insights,
      execute: async (args, ctx) => {
        const { limit } = TOOL_SCHEMAS.get_insights.parse(args);
        const audit = await AiAgentService.auditPipelineRisk(ctx.workspaceId);
        return audit.insights.slice(0, limit).map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          description: i.description,
          detailUrl: i.detailUrl ?? null,
        }));
      },
    }),
    tool({
      id: "intelligence.get_attention_items",
      name: "Get Attention Items",
      description: "Current items flagged as needing operator attention",
      category: "intelligence",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.intelligence.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.get_attention_items,
      execute: async (args, ctx) => {
        const { limit } = TOOL_SCHEMAS.get_attention_items.parse(args);
        const audit = await AiAgentService.auditPipelineRisk(ctx.workspaceId);
        return audit.insights
          .filter((i) => i.severity === "HIGH" || i.severity === "WARNING")
          .slice(0, limit)
          .map((i) => ({ id: i.id, title: i.title, severity: i.severity, description: i.description }));
      },
    }),
    tool({
      id: "intelligence.get_business_metrics",
      name: "Get Business Metrics",
      description: "Core pipeline + lead metrics snapshot",
      category: "intelligence",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.intelligence.read",
      defaultDailyLimit: 200,
      inputSchema: TOOL_SCHEMAS.get_business_metrics,
      execute: async (_args, ctx) => {
        const deals = await CrmService.getPipeline(ctx.workspaceId);
        const leads = await CrmService.getLeads(ctx.workspaceId, 100);
        const num = (v: string | null | undefined) => parseFloat(v || "0") || 0;
        const open = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
        const won = deals.filter((d) => d.stage === "WON");
        return {
          openPipelineValue: open.reduce((a, d) => a + num(d.value), 0),
          openDeals: open.length,
          wonDeals: won.length,
          winRatePct: deals.length > 0 ? Math.round((won.length / deals.length) * 100) : 0,
          activeLeads: leads.filter((l) => l.status !== "CONVERTED" && l.status !== "LOST").length,
        };
      },
    }),
    tool({
      id: "intelligence.get_daily_briefing",
      name: "Get Daily Briefing",
      description: "Executive briefing metrics (pipeline, risks, attention)",
      category: "intelligence",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.intelligence.read",
      defaultDailyLimit: 100,
      inputSchema: TOOL_SCHEMAS.get_daily_briefing,
      execute: async (_args, ctx) => {
        const audit = await AiAgentService.auditPipelineRisk(ctx.workspaceId);
        return {
          metrics: audit.metrics,
          topInsights: audit.insights.slice(0, 4).map((i) => ({ title: i.title, severity: i.severity, description: i.description })),
          stalledDeals: audit.stalledDealDetails.slice(0, 3),
          closingSoon: audit.closingSoonDeals.slice(0, 3),
        };
      },
    }),

    // --- RESEARCH (external, untrusted content) ---
    tool({
      id: "research.web_search",
      name: "Web Search",
      description: "Discover public companies matching a target description",
      category: "research",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.external_research",
      defaultDailyLimit: 20,
      inputSchema: TOOL_SCHEMAS.web_search,
      execute: async (args) => {
        const { query, maxResults } = TOOL_SCHEMAS.web_search.parse(args);
        const result = await LeadDiscoveryService.discover({ query, maxResults });
        return {
          success: result.success,
          llmUsed: result.llmUsed,
          notes: result.notes,
          leads: result.leads.map((l) => ({
            companyName: l.companyName,
            website: l.website,
            industry: l.industry,
            location: l.location,
            description: l.description?.slice(0, 300) ?? null,
            emails: l.emails,
            phones: l.phones,
            fitScore: l.fitScore,
            fitReason: l.fitReason,
          })),
        };
      },
    }),

    tool({
      id: "research.discover_local_leads",
      name: "Discover Local Leads",
      description:
        "Find local businesses by category + city via Google Places. Qualification signal: missing website/phone plus rating and review count (Hot/Warm/Cold tier).",
      category: "research",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.external_research",
      defaultDailyLimit: 20,
      inputSchema: TOOL_SCHEMAS.discover_local_leads,
      execute: async (args) => {
        const { category, city, maxResults } = TOOL_SCHEMAS.discover_local_leads.parse(args);
        const result = await LocalLeadDiscoveryService.discover({ category, city, maxResults });
        return {
          success: result.success,
          llmUsed: result.llmUsed,
          notes: result.notes,
          leads: result.leads.map((l) => ({
            companyName: l.companyName,
            website: l.website,
            industry: l.industry,
            location: l.location,
            phone: l.phone,
            rating: l.rating,
            reviewCount: l.reviewCount,
            placeId: l.placeId,
            priority: l.priority,
            priorityReason: l.priorityReason,
            // Model-generated, labeled; distinct from the factual fields above.
            hook: l.hook,
            fitScore: l.fitScore,
          })),
        };
      },
    }),

    // --- COMMUNICATION ---
    tool({
      id: "communication.prepare_email",
      name: "Prepare Email",
      description: "Prepare an email draft (never sends without approval)",
      category: "communication",
      riskLevel: "LOW",
      requiresApproval: false,
      supportsDryRun: false,
      requiredPermission: "tools.communication.prepare",
      defaultDailyLimit: 60,
      inputSchema: TOOL_SCHEMAS.prepare_email,
      execute: async (args) => {
        const parsed = TOOL_SCHEMAS.prepare_email.parse(args);
        return { prepared: true, draft: parsed, note: "Draft stored — sending requires an approved send_email call." };
      },
    }),
    tool({
      id: "communication.prepare_message",
      name: "Prepare Message",
      description:
        "Prepare a WhatsApp/SMS first-touch message DRAFT for a lead. Draft-only: nothing is sent. Produces an approval request; a human reviews and finalizes the sanctioned text in the Approval Center.",
      category: "communication",
      riskLevel: "MEDIUM",
      requiresApproval: true,
      supportsDryRun: true,
      requiredPermission: "tools.communication.prepare",
      defaultDailyLimit: 40,
      inputSchema: TOOL_SCHEMAS.prepare_message,
      execute: async (args) => {
        const parsed = TOOL_SCHEMAS.prepare_message.parse(args);
        return {
          prepared: true,
          draft: parsed,
          note: "Draft stored for human review — this system never auto-sends WhatsApp/SMS; delivery is a separate, explicitly approved future integration.",
        };
      },
    }),
    tool({
      id: "communication.send_email",
      name: "Send Email",
      description: "Send an APPROVED email draft via the configured provider. The draft content comes from the approval record — arguments cannot change it.",
      category: "communication",
      riskLevel: "HIGH",
      requiresApproval: true,
      supportsDryRun: true,
      requiredPermission: "tools.communication.send",
      defaultDailyLimit: 10,
      inputSchema: TOOL_SCHEMAS.send_email,
      execute: async (args, ctx) => {
        const { approvalId } = TOOL_SCHEMAS.send_email.parse(args);
        if (ctx.dryRun) return { dryRun: true, wouldSend: { approvalId } };
        // The ONLY trusted source of the email content is the approval record.
        const [approval] = await db
          .select()
          .from(agentApprovals)
          .where(eq(agentApprovals.id, approvalId))
          .limit(1);
        if (!approval || approval.status !== "APPROVED") {
          throw new Error("send_email requires an APPROVED approval record");
        }
        if (approval.workspaceId !== ctx.workspaceId) {
          throw new Error("Cross-workspace send blocked");
        }
        const draft = (approval.proposedArguments ?? {}) as { toEmail?: string; subject?: string; body?: string };
        if (!draft.toEmail || !draft.subject || !draft.body) {
          throw new Error("Approval record missing email draft fields");
        }
        const result = await sendRawEmail({ to: draft.toEmail, subject: draft.subject, html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${draft.body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c))}</div>` });
        if (result.sent) {
          await ActivityService.logAudit(ctx.workspaceId, ctx.userId, "CREATE", "EMAIL", approvalId, {
            via: "agent_tool",
            runId: ctx.runId,
            to: draft.toEmail,
            subject: draft.subject,
            messageId: result.messageId ?? null,
          });
        }
        return result;
      },
    }),
  ].map((t) => [t.id, t])
);

export function getTool(id: string): AgentToolDefinition | undefined {
  return AGENT_TOOLS[id];
}

export function listToolIds(): string[] {
  return Object.keys(AGENT_TOOLS);
}
