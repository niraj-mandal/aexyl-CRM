import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { contacts, discoveryCandidates, leads as leadsTable } from "@/db/schema";
import { CrmService, ProjectService } from "../crm.service";
import { COPILOT_SYSTEM_PROMPT } from "./copilot-persona";
import { LlmService, type LlmImage } from "./llm.service";
import { SheetImportService, type SheetSession } from "./sheet-import.service";
import { SequenceEngineService } from "./sequence-engine.service";
import { BdrEngineService } from "./bdr-engine.service";
import { IcpService } from "./icp.service";

/** Client-executable copilot action payload (navigation, discovery, and write proposals). */
export interface CopilotActionPayload {
  url?: string;
  /** Lead-discovery directives. */
  query?: string;
  industry?: string;
  location?: string;
  /** Local (OpenStreetMap) discovery directives. */
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
  actionType: string;
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
    contactableLeadsCount: number;
    readyToContactCount: number;
    followUpsDueCount: number;
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

const AUDIT_CACHE_MS = 5 * 60_000;
const auditCache = new Map<string, { at: number; result: Promise<PipelineAudit> }>();

export class AiAgentService {
  /**
   * Performs an automated pipeline strategic risk audit using database telemetry.
   * Every metric and insight is derived from live workspace data — no canned copy.
   */
  /**
   * Cached audit for passive views (Daily brief, attention badge): the full audit
   * is several cross-region round trips, so reuse a result for a few minutes and
   * share one in-flight run between concurrent callers.
   */
  static auditPipelineRiskCached(workspaceId: string, maxAgeMs = AUDIT_CACHE_MS): Promise<PipelineAudit> {
    const hit = auditCache.get(workspaceId);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.result;
    const result = AiAgentService.auditPipelineRisk(workspaceId);
    auditCache.set(workspaceId, { at: Date.now(), result });
    result.catch(() => auditCache.delete(workspaceId));
    return result;
  }

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
    const money = (n: number) => "₹" + n.toLocaleString("en-IN");
    const HIGH_VALUE_DEAL = 100_000;

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

    const highValueOpenDeals = openDeals.filter((d) => num(d.value) >= HIGH_VALUE_DEAL);
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

    // Contact sources live on the contact row or on the discovery record that created the lead.
    const [contactRows, candidateRows] = await Promise.all([
      db
        .select({ leadId: leadsTable.id, phone: contacts.phone, email: contacts.email })
        .from(leadsTable)
        .leftJoin(contacts, eq(contacts.id, leadsTable.contactId))
        .where(eq(leadsTable.workspaceId, workspaceId)),
      db
        .select({ leadId: discoveryCandidates.leadId, phone: discoveryCandidates.phone, meta: discoveryCandidates.discoveryMetadata })
        .from(discoveryCandidates)
        .where(and(eq(discoveryCandidates.workspaceId, workspaceId), isNotNull(discoveryCandidates.leadId))),
    ]);
    const contactableIds = new Set<string>();
    for (const r of contactRows) if (r.phone || r.email) contactableIds.add(r.leadId);
    for (const r of candidateRows) {
      const meta = (r.meta ?? {}) as { email?: string | null; socials?: unknown[] };
      if (r.leadId && (r.phone || meta.email || (Array.isArray(meta.socials) && meta.socials.length > 0))) {
        contactableIds.add(r.leadId);
      }
    }
    const contactableLeads = activeLeads.filter((l) => contactableIds.has(l.id));
    const unreachableLeads = activeLeads.filter((l) => !contactableIds.has(l.id));
    const readyToContact = contactableLeads.filter((l) => !l.lastContactedAt);
    const followUpsDue = activeLeads.filter(
      (l) => l.lastContactedAt && (!l.nextFollowUpAt || new Date(l.nextFollowUpAt).getTime() < now)
    );

    // --- Insights, derived from actual conditions ---------------------------
    const insights: AuditInsight[] = [];

    if (readyToContact.length > 0) {
      const names = readyToContact.slice(0, 3).map((l) => l.company?.name).filter(Boolean).join(", ");
      insights.push({
        id: "LEAD-01",
        preset: "Ready to Contact",
        title: `${readyToContact.length} lead${readyToContact.length > 1 ? "s" : ""} with contact details, never contacted`,
        severity: "HIGH",
        description: `Your quickest wins: a phone, email or social profile is on file but nobody has reached out yet${names ? ` (e.g. ${names})` : ""}. Write a pitch and send it.`,
        actionLabel: "Write Pitches",
        detailUrl: "/outreach",
      });
    }

    if (followUpsDue.length > 0) {
      const noDate = followUpsDue.filter((l) => !l.nextFollowUpAt).length;
      insights.push({
        id: "LEAD-02",
        preset: "Follow-up Discipline",
        title: `${followUpsDue.length} contacted lead${followUpsDue.length > 1 ? "s" : ""} need a follow-up`,
        severity: "WARNING",
        description: noDate === followUpsDue.length
          ? `You reached out, but no follow-up date is set. Most replies come after the second or third touch, so schedule the next one.`
          : `${followUpsDue.length - noDate} follow-up${followUpsDue.length - noDate === 1 ? " is" : "s are"} overdue and ${noDate} contacted lead${noDate === 1 ? " has" : "s have"} no follow-up date.`,
        actionLabel: "Review Leads",
        detailUrl: "/sales/leads",
      });
    }

    if (unreachableLeads.length > 0) {
      insights.push({
        id: "LEAD-03",
        preset: "Contactability",
        title: `${unreachableLeads.length} of ${activeLeads.length} active leads have no contact details`,
        severity: activeLeads.length > 0 && unreachableLeads.length > activeLeads.length * 0.5 ? "WARNING" : "NORMAL",
        description: `No phone, email or social profile is on file for these. Look them up on Google Maps or Instagram before outreach, or point discovery at a city or category with richer listings.`,
        actionLabel: "Open Lead Discovery",
        detailUrl: "/bdr",
      });
    }

    if (stalledDeals.length > 0) {
      const worst = [...stalledDeals].sort(
        (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      )[0];
      const daysIdle = Math.floor((now - new Date(worst.updatedAt).getTime()) / DAY);
      insights.push({
        id: "OPT-01",
        preset: "Pipeline Velocity",
        title: `${stalledDeals.length} stalled deal${stalledDeals.length > 1 ? "s" : ""} need follow-up`,
        severity: totalRevenueAtRisk >= HIGH_VALUE_DEAL ? "HIGH" : "WARNING",
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
        description: neverTouched === staleLeads.length
          ? `None of ${neverTouched === 1 ? "this lead" : `these ${neverTouched} leads`} has been contacted yet. First touches drive the fastest conversion lift.`
          : neverTouched > 0
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
        title: `${highValueOpenDeals.length} high-value deal${highValueOpenDeals.length > 1 ? "s" : ""} in play (₹1L+)`,
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
        contactableLeadsCount: contactableLeads.length,
        readyToContactCount: readyToContact.length,
        followUpsDueCount: followUpsDue.length,
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
    history: CopilotTurn[] = [],
    sheet: SheetSession | null = null,
    images: LlmImage[] = [],
    opts: { hideMoney?: boolean; ownerId?: string } = {}
  ): Promise<CopilotResponse> {
    // Sales members: the snapshot is built without money and only from their own leads and deals.
    const snapshot = await AiAgentService.buildWorkspaceSnapshot(workspaceId, Boolean(opts.hideMoney), opts.ownerId);

    // Screenshots need a vision model; keyword intents can't see them, so skip straight to it.
    if (images.length > 0) {
      if (!LlmService.getVisionStatus().available) {
        return {
          answer:
            "I can't read screenshots yet — no vision-capable AI is configured. Add OPENROUTER_API_KEY (or OPENAI_API_KEY) to the environment, then try again.",
          dataContext: { intent: "vision_unavailable" },
        };
      }
      const sheetBlock = sheet ? SheetImportService.buildSheetContextBlock(sheet) : null;
      const visionResponse = await AiAgentService.llmCopilotResponse(prompt, snapshot, history, sheetBlock, images);
      return (
        visionResponse ?? {
          answer:
            "I couldn't read that screenshot right now — the free vision model may be busy. Please try again in a moment.",
          dataContext: { intent: "vision_failed" },
        }
      );
    }

    // Spreadsheet flows sit BEFORE web discovery: "generate leads from the
    // sheet" must never be hijacked by the discovery intent matcher. The
    // import branch is deterministic — it works with or without an LLM.
    if (AiAgentService.isSheetImportIntent(prompt, Boolean(sheet))) {
      if (!sheet) {
        return {
          answer:
            "No spreadsheet is attached to this session yet — attach the Google Sheet with the 📎 button (a .csv/.xlsx export) or paste its share link as a message, then ask me to add it to the leads.",
          dataContext: { intent: "sheet_attach_needed" },
        };
      }
      return AiAgentService.sheetImportResponse(sheet);
    }
    const mentionsSheet = AiAgentService.mentionsSheet(prompt);

    // Lead-discovery intent is detected before the LLM so it works with or
    // without a provider — the drawer executes DISCOVER_LEADS either way.
    if (AiAgentService.isDiscoveryIntent(prompt)) {
      // A sheet was referenced but none is attached → honest attach hint.
      if (mentionsSheet && !sheet) {
        return {
          answer:
            "You referenced a spreadsheet, but none is attached — attach it with the 📎 button (or paste its share link) and I'll work from its rows.",
          dataContext: { intent: "sheet_attach_needed" },
        };
      }
      // Sheet attached AND referenced → this is a read/analysis ask about the
      // sheet, not a request to scrape the web. Fall through to the LLM (with
      // the sheet context) or the sheet summary below.
      if (!sheet) {
        // "find gyms in Jorhat" / "scrape cafes in Mumbai" → OpenStreetMap local
        // pipeline (category + city shape) when the prompt parses cleanly.
        const local = AiAgentService.parseLocalDiscoveryIntent(prompt);
        if (local) {
          const isGoogleAsk = /\b(google\s*maps?|gmaps|google\s*places?|maps)\b/i.test(prompt);
          return {
            answer: isGoogleAsk
              ? `Google Maps discovery: I'll search Google Places for "${local.category}" in ${local.city} — you'll get ratings, review counts, photos, and phone numbers. Results are tiered Hot/Warm/Cold. You approve what enters the CRM.`
              : `Local discovery: I'll find "${local.category}" in ${local.city} and tier them Hot/Warm/Cold. Choose Google Maps (richer data: ratings, reviews) or OpenStreetMap (free, no key needed).`,
            suggestedActions: [
              {
                label: `🗺️ Google Maps: ${local.category} in ${local.city}`,
                actionType: "DISCOVER_GOOGLE_LEADS",
                payload: { category: local.category, city: local.city },
              },
              {
                label: `📍 OpenStreetMap (free): ${local.category} in ${local.city}`,
                actionType: "DISCOVER_LOCAL_LEADS",
                payload: { category: local.category, city: local.city },
              },
              {
                label: "🔎 Broad web research instead",
                actionType: "DISCOVER_LEADS",
                payload: { query: prompt.trim().slice(0, 300) },
              },
            ],
            dataContext: { intent: "local_lead_discovery", category: local.category, city: local.city },
          };
        }
        return AiAgentService.discoveryResponse(prompt, snapshot.llmAvailable);
      }
    }

    if (snapshot.llmAvailable) {
      const sheetBlock = sheet ? SheetImportService.buildSheetContextBlock(sheet) : null;
      const llmResponse = await AiAgentService.llmCopilotResponse(prompt, snapshot, history, sheetBlock);
      if (llmResponse) return llmResponse;
    }

    // Attached sheet, no LLM (or the LLM failed) → deterministic sheet summary.
    if (sheet && mentionsSheet) return AiAgentService.sheetSummaryResponse(sheet);

    return AiAgentService.deterministicResponse(prompt, snapshot);
  }

  /** True when the prompt refers to a spreadsheet or its parts. */
  private static mentionsSheet(prompt: string): boolean {
    return /\b(sheet|sheets|spreadsheet|csv|excel|rows?|columns?|cells|attach(?:ed|ment)?|upload(?:ed|ing)?)\b/i.test(prompt);
  }

  /**
   * True when the operator wants the attached spreadsheet's rows IN the CRM
   * as leads. Requires an import verb + a lead target, plus either an
   * explicit sheet reference or (when a sheet is attached) an all-quantifier
   * paired with a data noun — so an attached sheet never hijacks ordinary
   * writes like "add this lead to the pipeline".
   */
  private static isSheetImportIntent(prompt: string, hasSheet: boolean): boolean {
    const q = prompt.toLowerCase();
    const sheetRef = /\b(sheet|sheets|spreadsheet|csv|excel|rows?|columns?|cells|attach(?:ed|ment)?|upload(?:ed)?)\b/.test(q);
    if (!sheetRef && !hasSheet) return false;
    const verb = /\b(add|import|insert|upload|create|sync|push|load|migrate|bring|enter|put)\b/.test(q);
    const target = /\bleads?\b/.test(q);
    if (!verb || !target) return false;
    if (sheetRef) return true;
    const quantifier = /\b(all|every|everything|these|those)\b/.test(q);
    const dataNoun = /\b(data|rows|entries|records|list|table)\b/.test(q);
    return quantifier && dataNoun;
  }

  /** Deterministic import proposal — shown before the LLM so the ask works even on a flaky provider. */
  private static sheetImportResponse(sheet: SheetSession): CopilotResponse {
    const cols = sheet.headers.slice(0, 6).join(", ") + (sheet.headers.length > 6 ? ", …" : "");
    return {
      answer: `Spreadsheet attached: ${sheet.fileName} — ${sheet.rowCount} row${sheet.rowCount === 1 ? "" : "s"} × ${sheet.headers.length} columns (${cols}). Each row imports as one lead (company + contact), deduped by contact email and company website, so existing records are skipped. Nothing is written until you confirm the proposal below.`,
      suggestedActions: [
        { label: `📊 Import ${sheet.rowCount} rows as leads`, actionType: "IMPORT_SHEET_LEADS", payload: {} },
      ],
      dataContext: { intent: "sheet_import", rows: sheet.rowCount },
    };
  }

  /** Read-side fallback (no LLM): a factual summary of the attached sheet. */
  private static sheetSummaryResponse(sheet: SheetSession): CopilotResponse {
    const first = (sheet.rows[0] ?? [])
      .map((v, i) => `${sheet.headers[i] ?? `col ${i + 1}`}=${v || "blank"}`)
      .slice(0, 8)
      .join(", ");
    return {
      answer: `Attached spreadsheet "${sheet.fileName}": ${sheet.rowCount} row${sheet.rowCount === 1 ? "" : "s"} × ${sheet.headers.length} columns. Headers: ${sheet.headers.join(" · ")}. First row: ${first}. The full sheet is held server-side — ask me anything about it, or say "add all the data from the sheet to the leads" to import every row.`,
      suggestedActions: [
        { label: `📊 Import ${sheet.rowCount} rows as leads`, actionType: "IMPORT_SHEET_LEADS", payload: {} },
        { label: "Open Leads board", actionType: "NAVIGATE", payload: { url: "/leads" } },
      ],
      dataContext: { intent: "sheet_summary", rows: sheet.rowCount },
    };
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
    const category = AiAgentService.cleanDiscoveryToken(m[1])
      .replace(/\s+(businesses|companies|shops|stores|prospects|leads)$/i, "")
      .trim();
    const city = AiAgentService.cleanDiscoveryToken(m[2]).trim();
    if (category.length < 2 || city.length < 2) return null;
    if (/\b(my|our|stale|hot|warm|deal|deals|pipeline|contact|contacts)\b/i.test(category)) return null;
    return { category: category.slice(0, 120), city: city.slice(0, 120) };
  }

  private static cleanDiscoveryToken(raw: string): string {
    return raw
      .replace(/[?.!,]+$/, "")
      // Strip filter clauses: "who dont have website", "the ones without a website", etc.
      .replace(/\s+(?:the\s+)?(?:ones?\s+)?(?:who|that|which|whose|where)\s+(?:don'?t|dont|do not|doesn'?t|doesnt|does not|have no|has no|lack|lacking|need|without|with no|having no|not having|are missing|is missing)\b.*$/i, "")
      .replace(/\s+(?:the\s+)?(?:ones?\s+)?(?:without|with no|having no|not having|lacking|missing)\s+\w.*$/i, "")
      // Strip source qualifiers: "on google maps", "from gmaps", "via openstreetmap"
      .replace(/\s+(?:on|from|via|using|through|with)\s+(?:google|gmaps|osm|openstreetmap|open street map|maps|places|the internet|web).*$/i, "")
      // Strip trailing filler: articles, pronouns, prepositions left over after other strips
      .replace(/\s+(?:the|a|an|those|these|some|all|any|their|its|and|or|but|so|for|to|of|ones?)$/i, "")
      .trim();
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
  private static async buildWorkspaceSnapshot(workspaceId: string, hideMoney = false, ownerId?: string) {
    const [deals, leads, allCompanies, projects, openTasks, sequences, icpProfile] = await Promise.all([
      CrmService.getPipeline(workspaceId, ownerId),
      CrmService.getLeads(workspaceId, 100, 0, ownerId),
      CrmService.getCompanies(workspaceId, 100),
      ProjectService.getProjects(workspaceId),
      CrmService.getOpenTasks(workspaceId, 15),
      SequenceEngineService.getSequences(workspaceId).catch(() => []),
      IcpService.getActiveProfile(workspaceId).catch(() => null),
    ]);
    let bdrStats: Awaited<ReturnType<typeof BdrEngineService.getDashboardStats>> | null = null;
    try { bdrStats = await BdrEngineService.getDashboardStats(workspaceId); } catch { /* non-critical */ }

    // A Sales member only hears about the gyms on their own leads.
    const mineIds = new Set(leads.map((l) => l.companyId));
    const companies = ownerId ? allCompanies.filter((c) => mineIds.has(c.id)) : allCompanies;
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
      moneyHidden: hideMoney,
      pipelineValue: hideMoney ? null : openDeals.reduce((a, d) => a + num(d.value), 0),
      wonValue: hideMoney ? null : deals.filter((d) => d.stage === "WON").reduce((a, d) => a + num(d.value), 0),
      winRate:
        deals.length > 0
          ? Math.round((deals.filter((d) => d.stage === "WON").length / deals.length) * 100)
          : 0,
      deals: deals.slice(0, 25).map((d) => ({
        name: d.name,
        company: d.company?.name ?? null,
        stage: d.stage,
        value: hideMoney ? null : num(d.value),
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
        nextFollowUpAt: l.nextFollowUpAt ? new Date(l.nextFollowUpAt).toISOString().slice(0, 10) : null,
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
      sequences: sequences.slice(0, 10).map((s) => ({
        name: s.name,
        status: s.status,
        channel: s.channel,
        totalEnrolled: s.totalEnrolled,
        totalReplied: s.totalReplied,
        totalMeetings: s.totalMeetings,
      })),
      bdr: bdrStats ? {
        activeSequences: bdrStats.sequences.activeSequences,
        totalEnrolled: bdrStats.enrollments.active,
        replyRate: bdrStats.replyRate,
        meetingRate: bdrStats.meetingRate,
        hotLeadCount: bdrStats.hotLeadCount,
        recentSignals: bdrStats.signals.recentSignals,
      } : null,
      icpProfile: icpProfile ? {
        businessDescription: icpProfile.businessDescription,
        idealCustomerProfile: icpProfile.idealCustomerProfile,
      } : null,
    };
  }

  private static async llmCopilotResponse(
    prompt: string,
    snapshot: Awaited<ReturnType<typeof AiAgentService.buildWorkspaceSnapshot>>,
    history: CopilotTurn[],
    sheetBlock: string | null = null,
    images: LlmImage[] = []
  ): Promise<CopilotResponse | null> {
    const system = snapshot.moneyHidden
      ? `${COPILOT_SYSTEM_PROMPT}

This operator is on the sales team and is not allowed to see money. Deal values, revenue and budgets are not provided. Never state, estimate or infer any amount of money; if asked, say that revenue figures are only visible to admins.`
      : COPILOT_SYSTEM_PROMPT;

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
    leads: snapshot.leads,
    companies: snapshot.companies,
    projects: snapshot.projects,
    openTasks: snapshot.openTasks,
    sequences: snapshot.sequences,
    bdr: snapshot.bdr,
    icpProfile: snapshot.icpProfile,
  },
  null,
  1
)}
${sheetBlock ? `\n${sheetBlock}\n` : ""}${
      images.length > 0
        ? `\nATTACHED SCREENSHOT(S): ${images.length} image(s) follow. Read them carefully and use what they show to answer. Only state what is actually visible; say so if something is unreadable.\n`
        : ""
    }
OPERATOR QUESTION: ${prompt}`;

    const result = await LlmService.completeJson(system, user, images);
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || typeof parsed.answer !== "string" || parsed.answer.length === 0) return null;

    const rawActions = Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [];
    const allowedTypes = new Set([
      "NAVIGATE", "RUN_SWEEP", "DISCOVER_LEADS", "DISCOVER_LOCAL_LEADS", "DISCOVER_GOOGLE_LEADS",
      "UPDATE_DEAL_STAGE", "LOG_ACTIVITY", "CREATE_TASK", "CREATE_FOLLOW_UP", "IMPORT_SHEET_LEADS",
      "CREATE_LEAD", "CREATE_DEAL", "CREATE_COMPANY", "CREATE_CONTACT",
      "UPDATE_LEAD", "UPDATE_DEAL", "UPDATE_CONTACT", "UPDATE_COMPANY",
      "DELETE_LEAD", "DELETE_DEAL", "SEND_EMAIL",
      "ENROLL_SEQUENCE", "CREATE_SEQUENCE", "HANDLE_OBJECTION", "ANALYZE_INTENT",
      "ENRICH_LEAD", "CAMPAIGN_ANALYTICS",
    ]);
    const allowedUrls = new Set([
      "/", "/my-day", "/leads", "/pipeline", "/companies", "/contacts", "/deals",
      "/outreach", "/clients", "/projects", "/intelligence", "/attention", "/settings", "/bdr",
    ]);
    const suggestedActions: CopilotAction[] = [];
    for (const ra of rawActions) {
      if (suggestedActions.length >= 4) break;
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
      if (a.actionType === "DISCOVER_LOCAL_LEADS" || a.actionType === "DISCOVER_GOOGLE_LEADS") {
        const parsed = AiAgentService.parseLocalDiscoveryIntent(prompt);
        if (typeof payload.category !== "string" || payload.category.trim().length < 2) {
          payload.category = parsed?.category ?? prompt.slice(0, 120);
        }
        if (typeof payload.city !== "string" || payload.city.trim().length < 2) {
          payload.city = parsed?.city ?? "";
        }
        if (payload.city.trim().length < 2) continue;
      }
      // Write proposals: sanitize string fields the executor will read.
      if (allowedTypes.has(a.actionType) && a.actionType !== "NAVIGATE" && a.actionType !== "RUN_SWEEP" && a.actionType !== "DISCOVER_LEADS" && a.actionType !== "DISCOVER_LOCAL_LEADS" && a.actionType !== "DISCOVER_GOOGLE_LEADS" && a.actionType !== "ENRICH_LEAD" && a.actionType !== "CAMPAIGN_ANALYTICS") {
        const stringFields = [
          "dealName", "leadName", "dealNameForActivity", "stage", "activityType", "title", "description",
          "taskTitle", "taskDescription", "priority", "companyName", "contactFirstName", "contactLastName",
          "contactEmail", "contactJobTitle", "industry", "location", "website", "source", "expectedCloseDate",
          "companySize", "phone", "leadStatus", "leadTemperature", "emailTo", "emailSubject", "emailBody",
          "sequenceName", "sequenceId", "targetProfile", "valueProp", "objectionText",
        ] as const;
        for (const key of stringFields) {
          if (typeof payload[key] === "string") payload[key] = (payload[key] as string).slice(0, 500);
        }
        if (typeof payload.dueInDays !== "number" || !Number.isFinite(payload.dueInDays)) delete payload.dueInDays;
        if (typeof payload.dealValue !== "number" || !Number.isFinite(payload.dealValue)) delete payload.dealValue;
        if (typeof payload.leadScore !== "number" || !Number.isFinite(payload.leadScore)) delete payload.leadScore;
      }
      suggestedActions.push({ label: a.label, actionType: a.actionType as CopilotAction["actionType"], payload });
    }

    return {
      answer: parsed.answer.slice(0, 3000),
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
    // Sales members: counts only, never amounts.
    const openLine = snapshot.pipelineValue === null ? `${c.openDeals} open deals` : `${money(snapshot.pipelineValue)} open across ${c.openDeals} deals`;

    if (query.includes("risk") || query.includes("stale") || query.includes("audit")) {
      return {
        answer: `Pipeline audit: ${openLine}; ${c.staleDeals} stalled 7+ days, ${c.staleLeads} lead${c.staleLeads === 1 ? "" : "s"} overdue for contact, win rate ${snapshot.winRate}%. I can schedule the overdue follow-ups now.`,
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
      answer: `Aexyl Copilot active (deterministic engine — add an LLM key in .env.local for full conversational reasoning). Live telemetry: ${openLine}, ${c.activeLeads} leads (${c.hotLeads} hot), ${c.companies} companies, ${c.projects} projects. Win rate ${snapshot.winRate}%. Ask me to audit risk, summarize leads, or discover new prospects from the web.`,
      suggestedActions: [
        { label: "Run Strategic Audit", actionType: "NAVIGATE", payload: { url: "/intelligence" } },
        { label: "Find new prospects on the web", actionType: "DISCOVER_LEADS", payload: { query: "B2B companies needing automation services" } },
      ],
      dataContext: { counts: c },
    };
  }
}
