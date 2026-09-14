/**
 * Agent Registry — declarative definitions of Aexyl's agents. Each agent gets:
 * identity, prompt (versioned), tool allowlist, planner (LLM via the gateway
 * with a deterministic fallback), and conservative autonomy defaults.
 *
 * Adding a new agent = adding an entry here + provisioning it per workspace.
 */
import { z } from "zod";
import { db } from "@/db";
import { agents, automationRules } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { AgentRuntime, type AgentPlan } from "./core/runtime/runtime";
import { getTool } from "./core/registry/tools";
import { fenceExternalContent } from "@/lib/ai/gateway";

export interface AgentDefinition {
  key: string;
  name: string;
  description: string;
  version: string;
  /** Conservative default autonomy: L1 recommend. */
  defaultAutonomy: number;
  defaultAllowedTools: string[];
  defaultDailyRunLimit: number;
  defaultMaxTokensPerRun: number;
  defaultDailyBudgetMicroUsd: number;
  /** Builds the LLM planner for this agent's objective. */
  planner: (objective: string, ctx: { summary: string; data: Record<string, unknown> }) => {
    system: string;
    user: string;
  };
  /** Deterministic fallback plan when the LLM/gateway is unavailable. */
  fallbackPlan: (objective: string, ctx: { summary: string; data: Record<string, unknown> }) => AgentPlan;
}

const PlanOutputSchema = z.object({
  summary: z.string(),
  actions: z.array(
    z.object({
      step: z.number(),
      description: z.string(),
      toolId: z.string().nullable(),
      toolArguments: z.record(z.string(), z.unknown()).nullable(),
      riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      requiresApproval: z.boolean().optional(),
    })
  ),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  confidenceEvidence: z.array(z.string()).default([]),
});

export { PlanOutputSchema };

const PLAN_INSTRUCTIONS = `You are an Aexyl agent planner. Using ONLY the PROVIDED CONTEXT (real workspace data), produce a short executable plan.
Rules:
- toolId must be one of the ALLOWED TOOLS listed, or null for a pure analysis step.
- toolArguments must match the tool's purpose. Use EXACT ids from the context where relevant.
- Mutating tools (update/create/move/send) must set requiresApproval=true.
- Never invent companies, leads, deals, numbers, or capabilities. Data lives only in PROVIDED CONTEXT.
- 2-5 actions max. Confidence reflects evidence quality in the context.
Respond with JSON: {"summary":"...","actions":[{"step":1,"description":"...","toolId":"an allowed tool id or null","toolArguments":{}}],"confidence":"LOW|MEDIUM|HIGH","confidenceEvidence":["..."]}`;

export function planFromModel(raw: unknown): AgentPlan {
  const parsed = PlanOutputSchema.parse(raw);
  // Normalize tool ids: small models occasionally emit garbage like
  // "communication.prepare_message|null" (copying placeholder text) or stray
  // whitespace. Trim and take the segment before any pipe so a known-good id
  // still executes; anything genuinely unknown is downgraded to analysis-only.
  const normalizeToolId = (id: string | null): string | null => {
    if (!id) return null;
    const cleaned = id.trim().split("|")[0].trim();
    return cleaned.length > 0 ? cleaned : null;
  };
  return {
    summary: parsed.summary.slice(0, 500),
    actions: parsed.actions.slice(0, 8).map((a, i) => {
      // Reliability guard: models occasionally invent tool ids that do not
      // exist in the registry. Rather than guaranteeing a FAILED tool call,
      // downgrade the step to pure analysis (the description still carries
      // the finding); the policy engine re-checks every real tool call.
      const toolId = normalizeToolId(a.toolId);
      const known = toolId ? Boolean(getTool(toolId)) : true;
      return {
        step: a.step || i + 1,
        description: known ? a.description.slice(0, 300) : `${a.description.slice(0, 240)} (analysis only — model referenced unavailable tool "${toolId}")`,
        toolId: known ? toolId : null,
        toolArguments: known ? a.toolArguments : null,
        riskLevel: a.riskLevel ?? "LOW",
        requiresApproval: known ? (a.requiresApproval ?? false) : false,
      };
    }),
    confidence: parsed.confidence,
    confidenceEvidence: parsed.confidenceEvidence.slice(0, 5),
    requiresApproval: parsed.actions.some((a) => a.requiresApproval) ?? false,
  };
}

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    key: "scout",
    name: "Scout Agent",
    description: "Discovers and researches potential businesses matching the workspace ICP; prepares prospects for review.",
    version: "v1",
    defaultAutonomy: 1,
    defaultAllowedTools: ["research.web_search", "crm.search_companies", "intelligence.get_business_metrics"],
    defaultDailyRunLimit: 20,
    defaultMaxTokensPerRun: 15000,
    defaultDailyBudgetMicroUsd: 1_000_000,
    planner: (objective, ctx) => ({
      system: PLAN_INSTRUCTIONS,
      user: `AGENT: Scout Agent\nOBJECTIVE: ${objective}\nALLOWED TOOLS: ${["research.web_search", "crm.search_companies"].join(", ")}\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 3000)}\nProduce the plan JSON.`,
    }),
    fallbackPlan: (objective, ctx) => ({
      summary: `Deterministic scout plan: run web research for "${objective.slice(0, 80)}", dedupe against ${Array.isArray(ctx.data.knownDomains) ? ctx.data.knownDomains.length : 0} known companies.`,
      actions: [
        { step: 1, description: `Research prospects: ${objective.slice(0, 120)}`, toolId: "research.web_search", toolArguments: { query: objective.slice(0, 180), maxResults: 6 }, riskLevel: "MEDIUM", requiresApproval: false },
        { step: 2, description: "Present discovered prospects for review (no records created without approval)", toolId: null, toolArguments: null, riskLevel: "LOW", requiresApproval: false },
      ],
      confidence: "MEDIUM",
      confidenceEvidence: ["deterministic plan (LLM unavailable)"],
      requiresApproval: false,
    }),
  },
  {
    key: "sales",
    name: "Sales Agent",
    description: "Analyzes leads and pipeline, prioritizes prospects, recommends next actions, identifies stalled deals.",
    version: "v1",
    defaultAutonomy: 1,
    defaultAllowedTools: ["crm.search_leads", "crm.get_lead", "crm.search_deals", "intelligence.get_business_metrics", "intelligence.get_insights"],
    defaultDailyRunLimit: 50,
    defaultMaxTokensPerRun: 20000,
    defaultDailyBudgetMicroUsd: 2_000_000,
    planner: (objective, ctx) => ({
      system: PLAN_INSTRUCTIONS,
      user: `AGENT: Sales Agent\nOBJECTIVE: ${objective}\nALLOWED TOOLS: ${["crm.search_leads", "crm.get_lead", "crm.search_deals", "intelligence.get_business_metrics"].join(", ")}\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 4000)}\nProduce the plan JSON.`,
    }),
    fallbackPlan: (_objective, ctx) => {
      const leads = Array.isArray(ctx.data.leads) ? (ctx.data.leads as { id: string; company: string | null; score: number; daysSinceContact: number | null }[]) : [];
      const hot = [...leads].sort((a, b) => b.score - a.score).slice(0, 3);
      return {
        summary: `Prioritized ${leads.length} active leads; top: ${hot.map((h) => h.company).filter(Boolean).join(", ") || "none"}.`,
        actions: hot.map((h, i) => ({
          step: i + 1,
          description: `High-priority: ${h.company ?? "lead"} (score ${h.score}${h.daysSinceContact !== null ? `, ${h.daysSinceContact}d since contact` : ", never contacted"}) — schedule follow-up.`,
          toolId: null,
          toolArguments: null,
          riskLevel: "LOW",
          requiresApproval: false,
        })),
        confidence: "MEDIUM",
        confidenceEvidence: ["deterministic scoring by lead score + recency"],
        requiresApproval: false,
      };
    },
  },
  {
    key: "outreach",
    name: "Outreach Agent",
    description: "Prepares personalized outreach drafts from real lead context. Sending requires explicit approval.",
    version: "v1",
    defaultAutonomy: 2,
    defaultAllowedTools: ["crm.get_lead", "communication.prepare_email", "communication.send_email"],
    defaultDailyRunLimit: 30,
    defaultMaxTokensPerRun: 20000,
    defaultDailyBudgetMicroUsd: 2_000_000,
    planner: (objective, ctx) => {
      const lead = (ctx.data.lead ?? null) as {
        id?: string;
        email?: string | null;
        phone?: string | null;
        hasEmail?: boolean;
        hasPhone?: boolean;
        contact?: string | null;
        company?: string | null;
      } | null;
      let target: string;
      if (lead?.id && lead?.email) {
        target = `The target lead is in PROVIDED CONTEXT as "lead". It has a real email. Use lead.email ("${lead.email}") for toEmail and lead.id ("${lead.id}") for leadId EXACTLY — copy the characters verbatim, never invent an address or id. Call communication.prepare_email once.${lead.contact ? ` Address the body to ${lead.contact}.` : ""}`;
      } else if (lead?.id && lead?.phone) {
        target = `The target lead is in PROVIDED CONTEXT as "lead". It has NO email on file but has phone "${lead.phone}". Call communication.prepare_message ONCE with toPhone set to lead.phone ("${lead.phone}") and leadId set to lead.id ("${lead.id}") EXACTLY — copy verbatim, never invent. channel: "WHATSAPP" (Indian SMB default). The body is a SHORT first-touch WhatsApp message (2-4 sentences, no subject field). Ground every claim in PROVIDED CONTEXT only.${lead.contact ? ` Address it to ${lead.contact}.` : ""}`;
      } else {
        target = `No contactable lead exists in the context. Produce an analysis-only plan with toolId=null explaining what data is missing. Do NOT call prepare_email or prepare_message.`;
      }
      return {
        system: PLAN_INSTRUCTIONS + "\nNEVER fabricate company facts, names, case studies, emails, phone numbers, or previous conversations. Ground every claim in PROVIDED CONTEXT.",
        user: `AGENT: Outreach Agent\nOBJECTIVE: ${objective}\nALLOWED TOOLS: communication.prepare_email, communication.prepare_message, communication.send_email\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 3000)}\n${target}\nProduce the plan JSON with exactly ONE draft action (no duplicate sends).`,
      };
    },
    fallbackPlan: (_o, ctx) => {
      const lead = (ctx.data.lead ?? null) as {
        id?: string;
        company?: string | null;
        email?: string | null;
        phone?: string | null;
        contact?: string | null;
        industry?: string | null;
        location?: string | null;
      } | null;
      // No real target → analysis-only plan. Never draft to a fabricated address.
      if (!lead?.id || (!lead.email && !lead.phone)) {
        return {
          summary: "No contactable lead found in the workspace — nothing to draft.",
          actions: [{ step: 1, description: "No lead with an email or phone exists; enrich the lead record first.", toolId: null, toolArguments: null, riskLevel: "LOW", requiresApproval: false }],
          confidence: "HIGH",
          confidenceEvidence: ["context builder found zero contactable leads"],
          requiresApproval: false,
        };
      }
      if (lead.email) {
        return {
          summary: `Deterministic outreach draft for ${lead.company ?? "prospect"} — generic template (LLM unavailable; edit before approving).`,
          actions: [
            {
              step: 1,
              description: `Prepare email draft for ${lead.email}`,
              toolId: "communication.prepare_email",
              toolArguments: {
                toEmail: lead.email,
                leadId: lead.id,
                subject: `Quick question for ${lead.company ?? "your team"}`,
                body: `Hi ${lead.contact ?? "there"},\n\nWe help teams like ${lead.company ?? "yours"} streamline operations. Open to a short call this week?\n\n— Aexyl`,
                purpose: "initial_outreach",
              },
              riskLevel: "LOW",
              requiresApproval: false,
            },
          ],
          confidence: "LOW",
          confidenceEvidence: ["deterministic template from real lead record"],
          requiresApproval: false,
        };
      }
      return {
        summary: `Deterministic WhatsApp draft for ${lead.company ?? "prospect"} — template from the real lead record (LLM unavailable; edit before approving).`,
        actions: [
          {
            step: 1,
            description: `Prepare WhatsApp draft for ${lead.phone}`,
            toolId: "communication.prepare_message",
            toolArguments: {
              toPhone: lead.phone,
              channel: "WHATSAPP",
              leadId: lead.id,
              body: `Hi${lead.contact ? ` ${lead.contact}` : " there"}, I'm reaching out from Aexyl — we help${lead.industry ? ` ${lead.industry.toLowerCase()}` : " local businesses"} like${lead.location ? ` those in ${lead.location}` : " yours"} manage leads and follow-ups so inquiries don't slip through. Would a quick look at how that works be useful?`,
              purpose: "initial_outreach",
            },
            riskLevel: "MEDIUM",
            requiresApproval: true,
          },
        ],
        confidence: "LOW",
        confidenceEvidence: ["deterministic template from real lead record (phone-only contact)"],
        requiresApproval: false,
      };
    },
  },
  {
    key: "followup",
    name: "Follow-up Agent",
    description: "Monitors follow-up dates and stale conversations; prepares follow-up drafts and escalates neglect.",
    version: "v1",
    defaultAutonomy: 1,
    defaultAllowedTools: ["crm.search_leads", "crm.update_lead", "crm.create_activity", "communication.prepare_email"],
    defaultDailyRunLimit: 50,
    defaultMaxTokensPerRun: 20000,
    defaultDailyBudgetMicroUsd: 2_000_000,
    planner: (objective, ctx) => ({
      system: PLAN_INSTRUCTIONS,
      user: `AGENT: Follow-up Agent\nOBJECTIVE: ${objective}\nALLOWED TOOLS: ${["crm.update_lead", "crm.create_activity", "communication.prepare_email"].join(", ")}\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 4000)}\nProduce the plan JSON. Prefer scheduling follow-ups (update_lead with nextFollowUpAt, requiresApproval=true) over sending anything.`,
    }),
    fallbackPlan: (_o, ctx) => {
      const leads = Array.isArray(ctx.data.leads) ? (ctx.data.leads as { id: string; company: string | null; daysSinceContact: number | null }[]) : [];
      const stale = leads.filter((l) => l.daysSinceContact === null || l.daysSinceContact >= 7).slice(0, 5);
      return {
        summary: `${stale.length} lead${stale.length === 1 ? "" : "s"} overdue for follow-up.`,
        actions: stale.map((l, i) => ({
          step: i + 1,
          description: `Schedule follow-up for ${l.company ?? "lead"} (quiet ${l.daysSinceContact ?? "∞"}d)`,
          toolId: "crm.update_lead",
          toolArguments: { leadId: l.id, nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString() },
          riskLevel: "MEDIUM",
          requiresApproval: true,
        })),
        confidence: stale.length > 0 ? "HIGH" : "LOW",
        confidenceEvidence: ["days-since-contact computed from real activity timestamps"],
        requiresApproval: stale.length > 0,
      };
    },
  },
  {
    key: "operations",
    name: "Operations Agent",
    description: "Monitors projects, detects blockers and overdue work, recommends operational actions.",
    version: "v1",
    defaultAutonomy: 1,
    defaultAllowedTools: ["projects.search_projects", "projects.create_task", "intelligence.get_business_metrics"],
    defaultDailyRunLimit: 40,
    defaultMaxTokensPerRun: 20000,
    defaultDailyBudgetMicroUsd: 2_000_000,
    planner: (objective, ctx) => ({
      system: PLAN_INSTRUCTIONS,
      user: `AGENT: Operations Agent\nOBJECTIVE: ${objective}\nALLOWED TOOLS: ${["projects.search_projects", "projects.create_task"].join(", ")}\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 3500)}\nProduce the plan JSON.`,
    }),
    fallbackPlan: (_o, ctx) => {
      const projects = Array.isArray(ctx.data.projects) ? (ctx.data.projects as { id: string; name: string; health: string; daysOverdue: number }[]) : [];
      const risky = projects.filter((p) => p.health === "AT_RISK" || p.health === "OFF_TRACK" || p.daysOverdue > 0).slice(0, 4);
      return {
        summary: risky.length > 0 ? `${risky.length} project${risky.length === 1 ? "" : "s"} need operational attention.` : "All projects healthy.",
        actions: risky.map((p, i) => ({
          step: i + 1,
          description: `Create recovery task for "${p.name}" (${p.health}${p.daysOverdue > 0 ? `, ${p.daysOverdue}d overdue` : ""})`,
          toolId: "projects.create_task",
          toolArguments: { title: `Recovery plan: ${p.name}`, priority: "HIGH", dueInDays: 2 },
          riskLevel: "MEDIUM",
          requiresApproval: false,
        })),
        confidence: risky.length > 0 ? "HIGH" : "MEDIUM",
        confidenceEvidence: ["health and due dates read from live project records"],
        requiresApproval: false,
      };
    },
  },
  {
    key: "executive",
    name: "Executive Agent",
    description: "Executive-level business awareness: briefings, risks, opportunities, strategic recommendations.",
    version: "v1",
    defaultAutonomy: 0,
    defaultAllowedTools: ["intelligence.get_daily_briefing", "intelligence.get_business_metrics", "intelligence.get_insights", "crm.search_deals", "projects.search_projects"],
    defaultDailyRunLimit: 30,
    defaultMaxTokensPerRun: 25000,
    defaultDailyBudgetMicroUsd: 2_000_000,
    planner: (objective, ctx) => ({
      system: PLAN_INSTRUCTIONS,
      user: `AGENT: Executive Agent (OBSERVE ONLY — autonomy L0, no mutations)\nOBJECTIVE: ${objective}\nALLOWED TOOLS: intelligence read tools only\nPROVIDED CONTEXT: ${JSON.stringify(ctx.data).slice(0, 4500)}\nProduce the plan JSON (analysis steps only, toolId=null).`,
    }),
    fallbackPlan: (_o, ctx) => ({
      summary: `Executive read-out from ${ctx.summary}.`,
      actions: [
        { step: 1, description: "Summarize pipeline health and top risks from the audit", toolId: null, toolArguments: null, riskLevel: "LOW", requiresApproval: false },
      ],
      confidence: "MEDIUM",
      confidenceEvidence: ["deterministic summary of live metrics"],
      requiresApproval: false,
    }),
  },
];

export function getAgentDefinition(key: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((a) => a.key === key);
}

/**
 * Idempotent per-workspace provisioning. Safe to call on every page load of
 * /agents — creates missing agents and the kill-switch marker only.
 */
export async function ensureWorkspaceAgents(workspaceId: string) {
  for (const def of AGENT_DEFINITIONS) {
    const existing = await db.query.agents.findFirst({
      where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, def.key)),
    });
    if (!existing) {
      await db.insert(agents).values({
        workspaceId,
        agentKey: def.key,
        name: def.name,
        description: def.description,
        version: def.version,
        enabled: true,
        autonomyLevel: def.defaultAutonomy,
        allowedTools: def.defaultAllowedTools,
        toolRateLimits: {},
        dailyRunLimit: def.defaultDailyRunLimit,
        maxTokensPerRun: def.defaultMaxTokensPerRun,
        dailyBudgetMicroUsd: def.defaultDailyBudgetMicroUsd,
        requiresApprovalForWrites: true,
      });
    }
  }
  // Kill-switch marker row (enabled=true means agents allowed; toggling
  // enabled=false on THIS row is the workspace kill switch).
  const killSwitch = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "__kill_switch")),
  });
  if (!killSwitch) {
    await db.insert(agents).values({
      workspaceId,
      agentKey: "__kill_switch",
      name: "Kill Switch",
      description: "Workspace-level emergency stop for all agents",
      version: "v1",
      enabled: true,
      autonomyLevel: 0,
      allowedTools: [],
      toolRateLimits: {},
      dailyRunLimit: -1,
      maxTokensPerRun: 0,
      dailyBudgetMicroUsd: 0,
      requiresApprovalForWrites: true,
    });
  }

  // Default automation rules (idempotent per workspace+rule name).
  const salesAgent = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "sales")),
  });
  const followupAgent = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "followup")),
  });
  const operationsAgent = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "operations")),
  });
  const defaultRules = [
    salesAgent && { agentId: salesAgent.id, name: "New lead analysis", eventType: "lead.created", conditions: {}, actionPolicy: "prepare_only", cooldownSeconds: 3600 },
    followupAgent && { agentId: followupAgent.id, name: "Hot lead goes stale", eventType: "lead.stale", conditions: { temperature: "HOT" }, actionPolicy: "prepare_only", cooldownSeconds: 21600 },
    operationsAgent && { agentId: operationsAgent.id, name: "Project at risk", eventType: "project.at_risk", conditions: {}, actionPolicy: "prepare_only", cooldownSeconds: 21600 },
  ].filter(Boolean) as { agentId: string; name: string; eventType: string; conditions: Record<string, unknown>; actionPolicy: string; cooldownSeconds: number }[];

  for (const rule of defaultRules) {
    const existing = await db.query.automationRules.findFirst({
      where: and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.name, rule.name)),
    });
    if (!existing) {
      await db.insert(automationRules).values({ workspaceId, ...rule });
    }
  }
}

/** True when the workspace kill switch is engaged (marker row disabled). */
export async function isKillSwitchEngaged(workspaceId: string): Promise<boolean> {
  const killSwitch = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "__kill_switch")),
  });
  return Boolean(killSwitch && !killSwitch.enabled);
}

export { AgentRuntime, fenceExternalContent };
