/**
 * Agent Context Builder — gathers ONLY the data relevant to the objective.
 * Never the whole workspace; never secrets. Memory is retrieved per-entity
 * and capped; external content is never included raw.
 */
import { CrmService } from "@/services/crm.service";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import { retrieveRelevantMemory } from "../runtime/runtime";

export class AgentContextBuilder {
  static async build(params: {
    workspaceId: string;
    agentKey: string;
    objective: string;
    inputContext: Record<string, unknown>;
    userId: string;
  }): Promise<{ summary: string; data: Record<string, unknown> }> {
    const { workspaceId, agentKey, inputContext } = params;
    const DAY = 86_400_000;
    const now = Date.now();

    switch (agentKey) {
      case "sales":
      case "followup": {
        const leads = await CrmService.getLeads(workspaceId, 100);
        const active = leads.filter((l) => l.status !== "CONVERTED" && l.status !== "LOST");
        const withAge = active.map((l) => ({
          id: l.id,
          company: l.company?.name ?? null,
          contact: l.contact ? `${l.contact.firstName ?? ""} ${l.contact.lastName ?? ""}`.trim() : null,
          email: l.contact?.email ?? null,
          status: l.status,
          stage: l.stage,
          score: l.score,
          temperature: l.temperature,
          daysSinceContact: l.lastContactedAt ? Math.floor((now - new Date(l.lastContactedAt).getTime()) / DAY) : null,
          nextFollowUpAt: l.nextFollowUpAt,
        }));
        const leadId = typeof inputContext.leadId === "string" ? inputContext.leadId : null;
        const memories = leadId
          ? await retrieveRelevantMemory({ workspaceId, entityType: "lead", entityId: leadId, limit: 4 })
          : await retrieveRelevantMemory({ workspaceId, scope: undefined, limit: 3 } as never).catch(() => []);
        return {
          summary: `Loaded ${withAge.length} active leads${leadId ? " + focus lead detail" : ""}${memories.length ? ` + ${memories.length} memories` : ""}`,
          data: { leads: withAge.slice(0, 30), focusLeadId: leadId, memories: memories.map((m) => m.content) },
        };
      }

      case "operations": {
        const projects = await (await import("@/services/crm.service")).ProjectService.getProjects(workspaceId);
        const atRisk = projects.filter((p) => p.health === "AT_RISK" || p.health === "OFF_TRACK");
        const overdue = projects.filter((p) => p.dueDate && new Date(p.dueDate).getTime() < now && p.status !== "DELIVERED");
        return {
          summary: `Loaded ${projects.length} projects (${atRisk.length} at-risk, ${overdue.length} overdue)`,
          data: {
            projects: projects.slice(0, 20).map((p) => ({
              id: p.id,
              name: p.name,
              client: p.company?.name ?? null,
              status: p.status,
              health: p.health,
              progress: p.progress,
              dueDate: p.dueDate,
              daysOverdue: p.dueDate && p.status !== "DELIVERED" ? Math.max(0, Math.floor((now - new Date(p.dueDate).getTime()) / DAY)) : 0,
            })),
          },
        };
      }

      case "scout": {
        const companies = await CrmService.getCompanies(workspaceId, 200);
        return {
          summary: `Loaded ${companies.length} known companies for dedupe`,
          data: { knownDomains: companies.filter((c) => c.website).map((c) => c.website) },
        };
      }

      case "outreach": {
        // Focus lead: explicit id, else the hottest active lead — the planner
        // must always have a REAL target so prepare_email can't hallucinate one.
        const explicitId = typeof inputContext.leadId === "string" ? inputContext.leadId : null;
        let lead = explicitId ? await CrmService.getLeadById(workspaceId, explicitId) : null;
        if (!lead) {
          const all = await CrmService.getLeads(workspaceId, 100);
          const best = all
            .filter((l) => l.status !== "CONVERTED" && l.status !== "LOST")
            .sort((a, b) => b.score - a.score)[0];
          lead = best ? await CrmService.getLeadById(workspaceId, best.id) : null;
        }
        if (!lead) return { summary: "No active lead with contactable email found", data: { lead: null } };
        const contactName = lead.contact ? `${lead.contact.firstName ?? ""} ${lead.contact.lastName ?? ""}`.trim() : null;
        return {
          summary: `Loaded lead context for ${lead.company?.name ?? "prospect"}${contactName ? ` (${contactName})` : ""}`,
          data: {
            lead: {
              // Real ids/values — the planner copies these verbatim; the
              // runtime re-grounds them server-side before execution anyway.
              id: lead.id,
              company: lead.company?.name ?? null,
              industry: lead.company?.industry ?? null,
              location: lead.company?.location ?? null,
              contact: contactName,
              email: lead.contact?.email ?? null,
              status: lead.status,
              score: lead.score,
              notes: (lead.notes ?? "").slice(0, 300),
            },
          },
        };
      }

      case "executive":
      default: {
        const audit = await AiAgentService.auditPipelineRisk(workspaceId);
        const projects = await (await import("@/services/crm.service")).ProjectService.getProjects(workspaceId);
        return {
          summary: `Loaded pipeline audit (${audit.metrics.openDealsCount} open deals) + ${projects.length} projects`,
          data: {
            metrics: audit.metrics,
            insights: audit.insights.slice(0, 5).map((i) => ({ title: i.title, severity: i.severity, description: i.description })),
            projects: projects.slice(0, 10).map((p) => ({ name: p.name, status: p.status, health: p.health, progress: p.progress })),
          },
        };
      }
    }
  }
}
