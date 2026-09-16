import { CrmService, ProjectService } from "../crm.service";
import { LlmService } from "./llm.service";

/** Client-executable copilot action payload (navigation, discovery, and write proposals). */
export interface CopilotActionPayload {
  url?: string;
  /** Lead-discovery directives. */
  query?: string;
  industry?: string;
  location?: string;
  /** Local (Google Places) discovery directives. */
  category?: string;
  city?: string;
  /** Write-action proposals — resolved BY NAME server-side after user confirmation. */
  dealName?: string;
  leadName?: string;
  stage?: string;
  activityType?: string;
  title?: string;
  description?: string;
  taskTitle?: string;
  taskDescription?: string;
  priority?: string;
  dueInDays?: number;
  [key: string]: unknown;
}

export interface CopilotAction {
  label: string;
  actionType:
    | "NAVIGATE"
    | "UPDATE_DEAL_STAGE"
    | "CREATE_TASK"
    | "SEND_EMAIL"
    | "RUN_SWEEP"
    | "DISCOVER_LEADS"
    | "DISCOVER_LOCAL_LEADS"
    | "LOG_ACTIVITY";
  payload: CopilotActionPayload;
}

export interface CopilotResponse {
  answer: string;
  suggestedActions?: CopilotAction[];
  dataContext?: Record<string, unknown>;
}

/** One prior conversation turn (oldest first), bounded by the caller. */
export interface CopilotTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AuditInsight {
  id: string;
  preset: string;
  title: string;
  severity: "HIGH" | "WARNING" | "NORMAL" | "LOW" | "EXPANSION";
  description: string;
  actionLabel: string;
  detailUrl?: string;
}

export interface PipelineAudit {
  success: boolean;
  auditedAt: string;
  metrics: {
    totalDealsAnalyzed: number;
    openDealsCount: number;
    stalledDealsCount: number;
    dealStalenessIndex: string;
    totalRevenueAtRisk: number;
    openPipelineValue: number;
    highPriorityLeadsCount: number;
    activeLeadsCount: number;
    winRate: string;
    avgDealAgeDays: number;
    hotLeadRatio: string;
  };
  insights: AuditInsight[];
  stalledDealDetails: {
    id: string;
    name: string;
    company: string;
    stage: string;
    value: number;
    daysSinceUpdate: number;
  }[];
  closingSoonDeals: {
    id: string;
    name: string;
    company: string;
    stage: string;
    value: number;
    expectedCloseDate: string;
  }[];
}

export class AiAgentService {
  /**
   * Performs an automated pipeline strategic risk audit using database telemetry.
   * Every metric and insight is derived from live workspace data — no canned copy.
   */
  static async auditPipelineRisk(workspaceId: string): Promise<PipelineAudit> {
    const deals = await CrmService.getPipeline(workspaceId);
    const leads = await CrmService.getLeads(workspaceId, 200);
    const companies = await CrmService.getCompanies(workspaceId, 200);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * DAY;

    const openDeals = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
    const wonDeals = deals.filter((d) => d.stage === "WON");

    const num = (v: string | null | undefined) => parseFloat(v || "0") || 0;
    const money = (n: number) => "$" + n.toLocaleString();

    // Detect stalled open deals (no update in last 7 days)
    const stalledDeals = openDeals.filter(
      (d) => !d.updatedAt || now - new Date(d.updatedAt).getTime() > sevenDaysMs
    );

    // Deals closing within 7 days
    const closingSoon = openDeals
      .filter((d) => d.expectedCloseDate && new Date(d.expectedCloseDate).getTime() - now <= sevenDaysMs)
      .sort(
        (a, b) =>
          new Date(a.expectedCloseDate!).getTime() - new Date(b.expectedCloseDate!).getTime()
      );

    // Deals whose expected close date has already passed while still open
    const overdueDeals = openDeals.filter(
      (d) => d.expectedCloseDate && new Date(d.expectedCloseDate).getTime() < now
    );

    const highValueOpenDeals = openDeals.filter((d) => num(d.value) > 50000);
    const totalRevenueAtRisk = stalledDeals.reduce((acc, d) => acc + num(d.value), 0);
    const openPipelineValue = openDeals.reduce((acc, d) => acc + num(d.value), 0);

    const staleIndex =
      openDeals.length > 0
        ? ((stalledDeals.length / openDeals.length) * 100).toFixed(1) + "%"
        : "0.0%";

    const winRate =
      deals.length > 0 ? ((wonDeals.length / deals.length) * 100).toFixed(1) + "%" : "—";

    const avgDealAgeDays =
      openDeals.length > 0
        ? Math.round(
            openDeals.reduce((acc, d) => acc + (now - new Date(d.createdAt).getTime()), 0) /
              openDeals.length /
              DAY
          )
        : 0;

    const activeLeads = leads.filter((l) => l.status !== "CONVERTED" && l.status !== "LOST");
    const hotLeads = activeLeads.filter((l) => l.temperature === "HOT" || l.score >= 70);
    const staleLeads = activeLeads.filter(
      (l) => !l.lastContactedAt || now - new Date(l.lastContactedAt).getTime() > sevenDaysMs
    );
    const hotLeadRatio =
      activeLeads.length > 0
        ? ((hotLeads.length / activeLeads.length) * 100).toFixed(0) + "%"
        : "0%";

    // --- Insights, derived from actual conditions ---------------------------
    const insights: AuditInsight[] = [];

    if (stalledDeals.length > 0) {
      const worst = [...stalledDeals].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      )[0];
      const daysIdle = Math.floor((now - new Date(worst.updatedAt).getTime()) / DAY);
      insights.push({
        id: "OPT-01",
        preset: "Pipeline Velocity",
        title: `${stalledDeals.length} stalled deal${stalledDeals.length > 1 ? "s" : ""} need follow-up`,
        severity: totalRevenueAtRisk > 50000 ? "HIGH" : "WARNING",
        description: `${money(totalRevenueAtRisk)} of open pipeline has had no activity in 7+ days. Oldest: "${worst.name}" (${worst.company?.name || "No company"}) — idle ${daysIdle} day${daysIdle === 1 ? "" : "s"} in ${worst.stage.replace("_", " ").toLowerCase()}.`,
        actionLabel: "Review Stalled Deals",
        detailUrl: "/sales/pipeline",
      });
    }

    if (overdueDeals.length > 0) {
      insights.push({
        id: "OPT-02",
        preset: "Close Date Discipline",
        title: `${overdueDeals.length} deal${overdueDeals.length > 1 ? "s" : ""} past expected close date`,
        severity: "WARNING",
        description: `${money(overdueDeals.reduce((a, d) => a + num(d.value), 0))} in open deals have expected close dates that already passed. Update the dates or push to close.`,
        actionLabel: "Review Close Dates",
        detailUrl: "/sales/deals",
      });
    }

    if (closingSoon.length > 0) {
      const next = closingSoon[0];
      insights.push({
        id: "OPT-03",
        preset: "Closing Focus",
        title: `${closingSoon.length} deal${closingSoon.length > 1 ? "s" : ""} closing within 7 days`,
        severity: "NORMAL",
        description: `Next up: "${next.name}" (${next.company?.name || "No company"}) — ${money(num(next.value))}, expected ${new Date(next.expectedCloseDate!).toLocaleDateString()}.`,
        actionLabel: "Review Closing Deals",
        detailUrl: "/sales/pipeline",
      });
    }

    if (staleLeads.length > 0) {
      const neverTouched = staleLeads.filter((l) => !l.lastContactedAt).length;
      insights.push({
        id: "OPT-04",
        preset: "Lead Hygiene",
        title: `${staleLeads.length} lead${staleLeads.length > 1 ? "s" : ""} with no recent contact`,
        severity: activeLeads.length > 0 && staleLeads.length > activeLeads.length * 0.5 ? "HIGH" : "WARNING",
        description: neverTouched > 0
          ? `${neverTouched} active lead${neverTouched === 1 ? " has" : "s have"} never been contacted; the rest have gone 7+ days quiet. First follow-ups drive the fastest conversion lift.`
          : `All of these leads have gone 7+ days without contact. Re-engage before they cool further.`,
        actionLabel: "Review Leads",
        detailUrl: "/sales/leads",
      });
    }

    if (highValueOpenDeals.length > 0) {
      const top = [...highValueOpenDeals].sort((a, b) => num(b.value) - num(a.value))[0];
      insights.push({
        id: "OPT-05",
        preset: "Risk Friction",
        title: `${highValueOpenDeals.length} high-value deal${highValueOpenDeals.length > 1 ? "s" : ""} in play (>$50K)`,
        severity: "WARNING",
        description: `${money(highValueOpenDeals.reduce((a, d) => a + num(d.value), 0))} concentrated in high-value deals. Largest: "${top.name}" (${top.company?.name || "No company"}) at ${money(num(top.value))} in ${top.stage.replace("_", " ").toLowerCase()}.`,
        actionLabel: "Review High-Value Deals",
        detailUrl: "/sales/pipeline",
      });
    }

    if (companies.length > 0 && activeLeads.length > 0) {
      const whitespaceAccounts = companies.filter((c) => c.leads.length === 0).length;
      insights.push({
        id: "OPT-06",
        preset: "Account Expansion",
        title: `${activeLeads.length} active lead${activeLeads.length === 1 ? "" : "s"} across ${companies.length} account${companies.length === 1 ? "" : "s"}`,
        severity: "EXPANSION",
        description: `Lead coverage is ${hotLeadRatio} hot across ${companies.length} companies. ${whitespaceAccounts} account${whitespaceAccounts === 1 ? " has" : "s have"} no attached leads — potential whitespace for prospecting.`,
        actionLabel: "Review Accounts",
        detailUrl: "/sales/companies",
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: "OPT-OK",
        preset: "All Clear",
        title: "No risk conditions detected",
        severity: "NORMAL",
        description: `Pipeline is healthy: ${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"} worth ${money(openPipelineValue)}, no stalls, no overdue closes, and lead follow-up is current.`,
        actionLabel: "Open Pipeline",
        detailUrl: "/sales/pipeline",
      });
    }

    return {
      success: true,
      auditedAt: new Date().toISOString(),
      metrics: {
        totalDealsAnalyzed: deals.length,
        openDealsCount: openDeals.length,
        stalledDealsCount: stalledDeals.length,
        dealStalenessIndex: staleIndex,
        totalRevenueAtRisk,
        openPipelineValue,
        highPriorityLeadsCount: hotLeads.length,
        activeLeadsCount: activeLeads.length,
        winRate,
        avgDealAgeDays,
        hotLeadRatio,
      },
      insights,
      stalledDealDetails: [...stalledDeals]
        .sort((a, b) => num(b.value) - num(a.value))
        .slice(0, 5)
        .map((d) => ({
          id: d.id,
          name: d.name,
          company: d.company?.name || "No company",
          stage: d.stage,
          value: num(d.value),
          daysSinceUpdate: Math.floor((now - new Date(d.updatedAt).getTime()) / DAY),
        })),
      closingSoonDeals: closingSoon.slice(0, 5).map((d) => ({
        id: d.id,
        name: d.name,
        company: d.company?.name || "No company",
        stage: d.stage,
        value: num(d.value),
        expectedCloseDate: new Date(d.expectedCloseDate!).toISOString(),
      })),
    };
  }

  /**
   * Enriches lead profile and computes AI Next Best Actions.
   * Uses the LLM when configured; otherwise deterministic heuristics.
   */
  static async enrichAndScoreLead(workspaceId: string, leadId: string) {
    const lead = await CrmService.getLeadById(workspaceId, leadId);
    if (!lead) throw new Error("Lead not found");

    const isHot = lead.temperature === "HOT" || lead.score >= 75;

    if (LlmService.getStatus().available) {
      const result = await LlmService.completeJson(
        `You are a B2B sales strategist. Given a lead record, produce 3 concrete next-best-actions. Respond with JSON: {"icpFitScore": "NN/100", "predictedCloseWindowDays": 21, "nextBestActions": [{"action": "...", "rationale": "...", "priority": "URGENT|HIGH|MEDIUM"}]}`,
        JSON.stringify({
          company: lead.company?.name,
          contact: lead.contact ? { name: `${lead.contact.firstName ?? ""} ${lead.contact.lastName ?? ""}`.trim(), email: lead.contact.email, title: lead.contact.jobTitle } : null,
          status: lead.status,
          stage: lead.stage,
          score: lead.score,
          temperature: lead.temperature,
          daysSinceContact: lead.lastContactedAt ? Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86_400_000) : null,
        })
      );
      if (result.ok && result.text) {
        const parsed = LlmService.parseJsonLoose(result.text);
        if (parsed && Array.isArray(parsed.nextBestActions)) {
          return {
            leadId: lead.id,
            companyName: lead.company?.name || "Prospect",
            aiScore: lead.score,
            icpFitScore: typeof parsed.icpFitScore === "string" ? parsed.icpFitScore : `${lead.score}/100`,
            predictedCloseWindowDays:
              typeof parsed.predictedCloseWindowDays === "number" ? parsed.predictedCloseWindowDays : isHot ? 14 : 30,
            nextBestActions: (parsed.nextBestActions as Record<string, unknown>[])
              .slice(0, 3)
              .map((a) => ({
                action: String(a.action ?? "Follow up"),
                rationale: String(a.rationale ?? ""),
                priority: ["URGENT", "HIGH", "MEDIUM"].includes(String(a.priority)) ? String(a.priority) : "HIGH",
              })),
          };
        }
      }
    }

    return {
      leadId: lead.id,
      companyName: lead.company?.name || "Prospect",
      aiScore: lead.score,
      icpFitScore: isHot ? "94/100 (Optimal)" : "72/100 (Moderate)",
      predictedCloseWindowDays: isHot ? 14 : 30,
      nextBestActions: [
        {
          action: `Follow up with ${lead.contact?.firstName || "the contact"}${lead.contact?.email ? ` at ${lead.contact.email}` : ""}`,
          rationale: lead.lastContactedAt
            ? `Last contact was ${Math.floor((Date.now() - new Date(lead.lastContactedAt).getTime()) / 86_400_000)} days ago.`
            : "Never contacted — first touch drives the fastest lift.",
          priority: isHot ? "URGENT" : "HIGH",
        },
        {
          action: "Send a tailored case study",
          rationale: `${lead.company?.industry || "Their"} industry peers respond well to proof over pitch.`,
          priority: "MEDIUM",
        },
        {
          action: "Book a discovery call",
          rationale: `Score ${lead.score}/100 at ${lead.temperature} — qualify decision authority next.`,
          priority: "MEDIUM",
        },
      ],
    };
  }

  /**
   * Generates a 3-touch AI outreach campaign sequence.
   */
  static async generateOutreachSequence(targetProfile: string, valueProp: string) {
    const company = targetProfile.split(" ")[0] || "your team";

    return {
      subject: `Accelerating velocity for ${company}`,
      sequence: [
        {
          step: 1,
          channel: "EMAIL",
          title: "Initial Priority Value Proposition",
          body: `Hi, noticed your team's focus on ${valueProp}. Most operations leaders we partner with see an immediate 28% velocity increase when integrating automated telemetry pipelines.\n\nWould you be open to a 10-minute preview this Thursday?`,
        },
        {
          step: 2,
          channel: "LINKEDIN",
          title: "InMail Touchpoint",
          body: `Hi! Following up on my email regarding ${valueProp} optimization. Thought you'd appreciate this quick benchmark case study for ${company}.`,
        },
        {
          step: 3,
          channel: "PHONE_SCRIPT",
          title: "Direct Follow-Up Call",
          body: `"Hi, calling from Aexyl regarding our automation preview for ${company}. Reaching out to see if Thursday morning works for a 10-min overview..."`,
        },
      ],
    };
  }

  /** Processes natural language agentic copilot queries against CRM context.
   *
   * Two tiers:
   *  1. LLM tier — when any provider key is configured, the model receives a
   *     live snapshot of the whole workspace (deals, leads, companies, projects,
   *     activity), the recent conversation transcript, plus a strict action
   *     protocol, and answers ANY question.
   *  2. Deterministic tier — keyword intent matching over the same snapshot.
   *     Always available; powers discovery intents even without an LLM.
   */
  static async processCopilotCommand(
    workspaceId: string,
    prompt: string,
    history: CopilotTurn[] = []
  ): Promise<CopilotResponse> {
    const snapshot = await AiAgentService.buildWorkspaceSnapshot(workspaceId);

    // Lead-discovery intent is detected before the LLM so it works with or
    // without a provider — the drawer executes DISCOVER_LEADS either way.
    if (AiAgentService.isDiscoveryIntent(prompt)) {
      // "find gyms in Jorhat" / "scrape cafes in Mumbai" → Google Places local
      // pipeline (category + city shape) when the prompt parses cleanly.
      const local = AiAgentService.parseLocalDiscoveryIntent(prompt);
      if (local) {
        return {
          answer: `Local discovery via Google Places: I'll pull "${local.category}" businesses in ${local.city} and tier them by the missing-web-presence signal — no website or no phone listed, plus Google rating/review traction. Hot/Warm/Cold ranked; you approve what enters the CRM${process.env.GOOGLE_PLACES_API_KEY?.trim() ? "" : " (set GOOGLE_PLACES_API_KEY to enable — the run will report honestly if missing)"}.`,
          suggestedActions: [
            {
              label: `📍 Find local ${local.category} in ${local.city}`,
              actionType: "DISCOVER_LOCAL_LEADS",
              payload: { category: local.category, city: local.city },
            },
            {
              label: "🔎 Prefer broad web research instead",
              actionType: "DISCOVER_LEADS",
              payload: { query: prompt.trim().slice(0, 300) },
            },
          ],
          dataContext: { intent: "local_lead_discovery", category: local.category, city: local.city },
        };
      }
      return AiAgentService.discoveryResponse(prompt, snapshot.llmAvailable);
    }

    if (snapshot.llmAvailable) {
      const llmResponse = await AiAgentService.llmCopilotResponse(prompt, snapshot, history);
      if (llmResponse) return llmResponse;
    }

    return AiAgentService.deterministicResponse(prompt, snapshot);
  }

  /**
   * True when the user is asking the agent to find/scrape NEW prospects.
   * Explicit scraping verbs always trigger; softer "find/get" verbs trigger
   * unless the ask references already-known CRM state ("my stale leads").
   */
  private static isDiscoveryIntent(prompt: string): boolean {
    const q = prompt.toLowerCase();
    if (/\b(scrape|scraping|hunt|hunting|source|sourcing|discover|discovery)\b/.test(q)) return true;
    const softAsk = /\b(find|find me|get me|generate|look for|search for|prospect for|cold email list|build me a list)\b/.test(q);
    if (!softAsk) return false;
    // Referencing existing records → that's a CRM question, not discovery.
    const referencesExisting = /\b(my|our|current|existing|stale|hot|warm|active|top|open|pipeline|deal|deals|contact|contacts)\b/.test(q);
    return !referencesExisting;
  }

  /**
   * Parses a "find <category> in <city>" shape into local-discovery params.
   * Returns null when the prompt doesn't match that shape (the caller then
   * falls back to the general web-search discovery flow).
   */
  private static parseLocalDiscoveryIntent(prompt: string): { category: string; city: string } | null {
    const m =
      /\b(?:find|find me|get me|look for|search for|scrape|source|prospect|discover)(?:\s+(?:me|some|all|local))?\s+(.{2,60}?)\s+(?:in|near|around|at)\s+(.{2,60})$/i.exec(
        prompt.trim()
      );
    if (!m) return null;
    const category = m[1].replace(/\s+(businesses|companies|shops|stores|prospects|leads)$/i, "").trim();
    const city = m[2].replace(/[?.!,]+$/, "").trim();
    // Category must be noun-like (not a CRM question like "my deals in pipeline").
    if (category.length < 2 || city.length < 2) return null;
    if (/\b(my|our|stale|hot|warm|deal|deals|pipeline|contact|contacts)\b/i.test(category)) return null;
    return { category: category.slice(0, 120), city: city.slice(0, 120) };
  }

  /** Builds the discovery intent answer without needing an LLM. */
  private static discoveryResponse(prompt: string, llmAvailable: boolean): CopilotResponse {
    return {
      answer:
        `Engaging the Lead Discovery Engine. I'll plan targeted web searches for "${prompt.trim().slice(0, 160)}", scrape each candidate company's site, and extract contacts, socials, and ICP fit signals${llmAvailable ? " with LLM-graded fit scoring" : ""}. Results come back ranked — you approve what enters the CRM.`,
      suggestedActions: [
        {
          label: "🔎 Launch discovery run",
          actionType: "DISCOVER_LEADS",
          payload: { query: prompt.trim().slice(0, 300) },
        },
        {
          label: "Open Leads board",
          actionType: "NAVIGATE",
          payload: { url: "/leads" },
        },
      ],
      dataContext: { intent: "lead_discovery", llmAvailable },
    };
  }

  /** Live, compact snapshot of everything the copilot can reason about. */
  private static async buildWorkspaceSnapshot(workspaceId: string) {
    const [deals, leads, companies, projects, openTasks] = await Promise.all([
      CrmService.getPipeline(workspaceId),
      CrmService.getLeads(workspaceId, 100),
      CrmService.getCompanies(workspaceId, 100),
      ProjectService.getProjects(workspaceId),
      CrmService.getOpenTasks(workspaceId, 10),
    ]);

    const num = (v: string | null | undefined) => parseFloat(v || "0") || 0;
    const DAY = 86_400_000;
    const now = Date.now();

    const openDeals = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
    const activeLeads = leads.filter((l) => l.status !== "CONVERTED" && l.status !== "LOST");
    const hotLeads = activeLeads.filter((l) => l.temperature === "HOT" || l.score >= 70);
    const staleDeals = openDeals.filter((d) => !d.updatedAt || now - new Date(d.updatedAt).getTime() > 7 * DAY);
    const staleLeads = activeLeads.filter(
      (l) => !l.lastContactedAt || now - new Date(l.lastContactedAt).getTime() > 7 * DAY
    );

    return {
      llmAvailable: LlmService.getStatus().available,
      pipelineValue: openDeals.reduce((a, d) => a + num(d.value), 0),
      wonValue: deals.filter((d) => d.stage === "WON").reduce((a, d) => a + num(d.value), 0),
      winRate:
        deals.length > 0
          ? Math.round((deals.filter((d) => d.stage === "WON").length / deals.length) * 100)
          : 0,
      deals: deals.slice(0, 25).map((d) => ({
        name: d.name,
        company: d.company?.name ?? null,
        stage: d.stage,
        value: num(d.value),
        daysSinceUpdate: d.updatedAt ? Math.floor((now - new Date(d.updatedAt).getTime()) / DAY) : null,
        expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate).toISOString().slice(0, 10) : null,
      })),
      leads: activeLeads.slice(0, 25).map((l) => ({
        company: l.company?.name ?? null,
        contact: l.contact ? `${l.contact.firstName ?? ""} ${l.contact.lastName ?? ""}`.trim() : null,
        email: l.contact?.email ?? null,
        status: l.status,
        stage: l.stage,
        score: l.score,
        temperature: l.temperature,
        daysSinceContact: l.lastContactedAt ? Math.floor((now - new Date(l.lastContactedAt).getTime()) / DAY) : null,
      })),
      companies: companies.slice(0, 25).map((c) => ({
        name: c.name,
        industry: c.industry,
        location: c.location,
        size: c.size,
        status: c.status,
      })),
      projects: projects.slice(0, 15).map((p) => ({
        name: p.name,
        client: p.company?.name ?? null,
        status: p.status,
        health: p.health,
        progress: p.progress,
      })),
      openTasks: openTasks.map((t) => ({
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 10) : null,
        deal: t.deal?.name ?? null,
      })),
      counts: {
        openDeals: openDeals.length,
        activeLeads: activeLeads.length,
        hotLeads: hotLeads.length,
        staleDeals: staleDeals.length,
        staleLeads: staleLeads.length,
        companies: companies.length,
        projects: projects.length,
      },
    };
  }

  private static async llmCopilotResponse(
    prompt: string,
    snapshot: Awaited<ReturnType<typeof AiAgentService.buildWorkspaceSnapshot>>,
    history: CopilotTurn[]
  ): Promise<CopilotResponse | null> {
    const system = `You are Aexyl Copilot, the autonomous revenue-operations agent inside Aexyl, an agency CRM. You answer ANY question the operator asks: CRM analytics, sales strategy, general business questions, writing outreach copy, explaining metrics — everything.

Rules:
- Ground CRM answers in the LIVE WORKSPACE SNAPSHOT provided. Cite real names and numbers from it. Never invent deals, leads, or contacts.
- The RECENT CONVERSATION transcript (when present) is prior context from this session. Resolve pronouns and short follow-ups ("that deal", "the second one", "why?") against it before falling back to the snapshot.
- For non-CRM questions (general knowledge, strategy, copywriting), answer directly with your own knowledge — the snapshot is context, not a cage.
- You may propose up to 3 executable actions. Allowed actionTypes and payloads ONLY:
  - NAVIGATE: {url} — one of /, /my-day, /leads, /pipeline, /companies, /contacts, /deals, /outreach, /clients, /projects, /intelligence, /attention, /settings
  - RUN_SWEEP: {} — schedules follow-ups for every stale lead
  - DISCOVER_LEADS: {query, industry?, location?} — launches web lead discovery; use when the operator wants NEW prospects found/scraped/sourced
  - DISCOVER_LOCAL_LEADS: {category, city} — launches Google Places local-business discovery tiered Hot/Warm/Cold (no-website signal); use for "find gyms in Jorhat"-shaped asks naming a concrete business category and a city
  - UPDATE_DEAL_STAGE: {dealName, stage} — proposes moving a deal to QUALIFIED|CALL_BOOKED|PROPOSAL|NEGOTIATION|WON|LOST. dealName must exactly match a deal name from the snapshot.
  - LOG_ACTIVITY: {leadName OR dealNameForActivity, activityType, title, description?} — proposes logging NOTE|CALL|EMAIL|MEETING|OUTREACH|FOLLOW_UP on a lead or deal from the snapshot.
  - CREATE_TASK: {taskTitle, taskDescription?, priority?, dueInDays?, dealName?/leadName?} — proposes a task (priority LOW|MEDIUM|HIGH|URGENT, dueInDays 0-365).
  Write actions are PROPOSALS ONLY — the operator sees a confirmation card and must click Confirm twice before anything executes. NEVER describe a proposal as done/created/moved — it is only SUGGESTED until the operator confirms (say "I can create…", "Proposed:…"). Reference entities by their exact snapshot names, never by ID. Only propose a write when the operator's intent is clear (asked for it, or explicitly agreed with your suggestion).
- Be concise and operator-grade: direct answers first, numbers with $ and thousands separators, no filler, max ~140 words.
Respond with a single JSON object: {"answer": "...", "suggestedActions": [{"label": "...", "actionType": "...", "payload": {}}]}`;

    const transcript =
      history.length > 0
        ? `RECENT CONVERSATION (oldest first):
${history.map((t) => `${t.role === "user" ? "OPERATOR" : "COPILOT"}: ${t.text}`).join("\n")}

`
        : "";

    const user = `${transcript}LIVE WORKSPACE SNAPSHOT (${new Date().toISOString()}):
${JSON.stringify(
  {
    summary: snapshot.counts,
    openPipelineValue: snapshot.pipelineValue,
    wonValue: snapshot.wonValue,
    winRatePct: snapshot.winRate,
    deals: snapshot.deals,
    leads: snapshot.leads,        companies: snapshot.companies,
        projects: snapshot.projects,
        openTasks: snapshot.openTasks,
      },
  null,
  1
)}

OPERATOR QUESTION: ${prompt}`;

    const result = await LlmService.completeJson(system, user);
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || typeof parsed.answer !== "string" || parsed.answer.length === 0) return null;

    const rawActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [];
    const allowedTypes = new Set([
      "NAVIGATE",
      "RUN_SWEEP",
      "DISCOVER_LEADS",
      "DISCOVER_LOCAL_LEADS",
      "UPDATE_DEAL_STAGE",
      "LOG_ACTIVITY",
      "CREATE_TASK",
    ]);
    const allowedUrls = new Set([
      "/", "/my-day", "/leads", "/pipeline", "/companies", "/contacts", "/deals",
      "/outreach", "/clients", "/projects", "/intelligence", "/attention", "/settings",
    ]);
    const suggestedActions: CopilotAction[] = [];
    for (const ra of rawActions) {
      if (suggestedActions.length >= 3) break;
      if (typeof ra !== "object" || ra === null) continue;
      const a = ra as { label?: unknown; actionType?: unknown; payload?: unknown };
      if (typeof a.actionType !== "string" || !allowedTypes.has(a.actionType)) continue;
      if (typeof a.label !== "string" || a.label.length === 0 || a.label.length > 80) continue;
      const payload = (typeof a.payload === "object" && a.payload !== null ? a.payload : {}) as CopilotActionPayload;
      if (a.actionType === "NAVIGATE") {
        if (typeof payload.url !== "string" || !allowedUrls.has(payload.url)) continue;
      }
      if (a.actionType === "DISCOVER_LEADS" && typeof payload.query !== "string") {
        payload.query = prompt.slice(0, 300);
      }
      if (a.actionType === "DISCOVER_LOCAL_LEADS") {
        // Model-invented category/city are sanitized; fall back to parsing the
        // prompt itself so the action always carries usable parameters.
        const parsed = AiAgentService.parseLocalDiscoveryIntent(prompt);
        if (typeof payload.category !== "string" || payload.category.trim().length < 2) {
          payload.category = parsed?.category ?? prompt.slice(0, 120);
        }
        if (typeof payload.city !== "string" || payload.city.trim().length < 2) {
          payload.city = parsed?.city ?? "";
        }
        if (payload.city.trim().length < 2) continue;
      }
      // Write proposals: sanitize the string fields the executor will read.
      if (a.actionType === "UPDATE_DEAL_STAGE" || a.actionType === "LOG_ACTIVITY" || a.actionType === "CREATE_TASK") {
        for (const key of ["dealName", "leadName", "dealNameForActivity", "stage", "activityType", "title", "description", "taskTitle", "taskDescription", "priority"] as const) {
          if (typeof payload[key] === "string") payload[key] = (payload[key] as string).slice(0, 300);
        }
        if (typeof payload.dueInDays !== "number" || !Number.isFinite(payload.dueInDays)) delete payload.dueInDays;
      }
      suggestedActions.push({ label: a.label, actionType: a.actionType as CopilotAction["actionType"], payload });
    }

    return {
      answer: parsed.answer.slice(0, 2000),
      suggestedActions,
      dataContext: { engine: "llm", model: LlmService.getStatus().model },
    };
  }

  /** Keyword intent engine — always-available fallback. */
  private static deterministicResponse(
    prompt: string,
    snapshot: Awaited<ReturnType<typeof AiAgentService.buildWorkspaceSnapshot>>
  ): CopilotResponse {
    const query = prompt.toLowerCase();
    const c = snapshot.counts;
    const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

    if (query.includes("risk") || query.includes("stale") || query.includes("audit")) {
      return {
        answer: `Pipeline audit: ${money(snapshot.pipelineValue)} open across ${c.openDeals} deals; ${c.staleDeals} stalled 7+ days, ${c.staleLeads} lead${c.staleLeads === 1 ? "" : "s"} overdue for contact, win rate ${snapshot.winRate}%. I can schedule the overdue follow-ups now.`,
        suggestedActions: c.staleLeads > 0
          ? [
              { label: `⚡ Schedule ${c.staleLeads} follow-up${c.staleLeads === 1 ? "" : "s"} now`, actionType: "RUN_SWEEP", payload: {} },
              { label: "View Strategic Audit Page", actionType: "NAVIGATE", payload: { url: "/intelligence" } },
            ]
          : [{ label: "View Strategic Audit Page", actionType: "NAVIGATE", payload: { url: "/intelligence" } }],
        dataContext: { counts: c },
      };
    }

    if (query.includes("lead") || query.includes("prospect")) {
      const top = snapshot.leads[0];
      return {
        answer: `You have ${c.activeLeads} active leads, ${c.hotLeads} HOT (score ≥ 70).${top?.company ? ` Top of the stack: ${top.company}${top.score ? ` (score ${top.score})` : ""}.` : ""} ${c.staleLeads > 0 ? `${c.staleLeads} overdue for contact.` : "All recently touched."} Want me to source new prospects from the web?`,
        suggestedActions: [
          { label: "Open Leads Management", actionType: "NAVIGATE", payload: { url: "/leads" } },
          ...(c.staleLeads > 0 ? [{ label: `⚡ Sweep ${c.staleLeads} stale lead${c.staleLeads === 1 ? "" : "s"}`, actionType: "RUN_SWEEP" as const, payload: {} }] : []),
        ],
        dataContext: { counts: c },
      };
    }

    if (query.includes("company") || query.includes("client")) {
      return {
        answer: `Your workspace tracks ${c.companies} companies and ${c.projects} live project${c.projects === 1 ? "" : "s"}.${snapshot.companies[0]?.name ? ` Flagship account: ${snapshot.companies[0].name}.` : ""}`,
        suggestedActions: [
          { label: "View Clients", actionType: "NAVIGATE", payload: { url: "/clients" } },
          { label: "Open Projects", actionType: "NAVIGATE", payload: { url: "/projects" } },
        ],
        dataContext: { counts: c },
      };
    }

    return {
      answer: `Aexyl Copilot active (deterministic engine — add an LLM key in .env.local for full conversational reasoning). Live telemetry: ${money(snapshot.pipelineValue)} open pipeline across ${c.openDeals} deals, ${c.activeLeads} leads (${c.hotLeads} hot), ${c.companies} companies, ${c.projects} projects. Win rate ${snapshot.winRate}%. Ask me to audit risk, summarize leads, or discover new prospects from the web.`,
      suggestedActions: [
        { label: "Run Strategic Audit", actionType: "NAVIGATE", payload: { url: "/intelligence" } },
        { label: "Find new prospects on the web", actionType: "DISCOVER_LEADS", payload: { query: "B2B companies needing automation services" } },
      ],
      dataContext: { counts: c },
    };
  }
}
