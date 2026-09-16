"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { AiAgentService, type CopilotTurn } from "@/services/ai/ai-agent.service";
import { LeadDiscoveryService, type DiscoveredLead } from "@/services/ai/lead-discovery.service";
import { LocalLeadDiscoveryService } from "@/services/ai/local-lead-discovery.service";
import { CrmService } from "@/services/crm.service";
import { LeadScoringService } from "@/services/sales/lead-scoring.service";
import { ActivityService } from "@/services/activity.service";
import { revalidatePath } from "next/cache";

export async function runPipelineStrategicAuditAction() {
  const { workspaceId } = await requireWorkspace();
  const auditResult = await AiAgentService.auditPipelineRisk(workspaceId);
  revalidatePath("/intelligence");
  revalidatePath("/");
  return auditResult;
}

export async function enrichLeadAiAction(leadId: string) {
  const { workspaceId } = await requireWorkspace();
  return await AiAgentService.enrichAndScoreLead(workspaceId, leadId);
}

export async function generateOutreachSequenceAction(targetProfile: string, valueProp: string) {
  return await AiAgentService.generateOutreachSequence(targetProfile, valueProp);
}

interface HistoryTurnInput {
  role?: unknown;
  text?: unknown;
}

function isWriteKind(t: string): t is CopilotWriteProposal["kind"] {
  return t === "UPDATE_DEAL_STAGE" || t === "LOG_ACTIVITY" || t === "CREATE_TASK";
}

/**
 * Small models drift off the payload contract. Accept common aliases, strip
 * empty fields, and return null when a proposal is un-salvageable (missing
 * required fields) so a broken confirm card never reaches the user.
 */
/** Human summary of a write proposal, shown on its confirm card. */
function summarizeProposal(p: CopilotWriteProposal): string {
  switch (p.kind) {
    case "UPDATE_DEAL_STAGE":
      return `${p.dealName} → ${(p.stage ?? "?").replace(/_/g, " ")}`;
    case "LOG_ACTIVITY":
      return `${(p.activityType ?? "note").replace(/_/g, " ")} on ${p.leadName ?? p.dealNameForActivity}: ${p.title}`;
    case "CREATE_TASK":
      return `${p.taskTitle}${p.priority && p.priority !== "MEDIUM" ? ` · ${p.priority.toLowerCase()} priority` : ""}${typeof p.dueInDays === "number" ? ` · due in ${p.dueInDays}d` : ""}`;
  }
}

function normalizeWriteProposal(kind: CopilotWriteProposal["kind"], raw: Record<string, unknown>): CopilotWriteProposal | null {
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim().slice(0, 300);
    }
    return undefined;
  };
  const p: CopilotWriteProposal = { kind };
  if (kind === "UPDATE_DEAL_STAGE") {
    p.dealName = str("dealName", "deal", "deal_name");
    p.stage = str("stage", "newStage", "toStage", "targetStage")?.toUpperCase();
    if (!p.dealName || !p.stage) return null;
  } else if (kind === "LOG_ACTIVITY") {
    p.leadName = str("leadName", "lead", "lead_name");
    p.dealNameForActivity = str("dealNameForActivity", "dealName", "deal", "deal_name");
    p.activityType = str("activityType", "type", "activity_type")?.toUpperCase();
    p.title = str("title", "activityTitle");
    p.description = str("description", "notes", "body");
    if (!p.title || (!p.leadName && !p.dealNameForActivity)) return null;
  } else {
    p.taskTitle = str("taskTitle", "title", "task", "name");
    p.taskDescription = str("taskDescription", "description", "notes");
    p.priority = str("priority")?.toUpperCase();
    p.dealName = str("dealName", "deal", "deal_name");
    p.leadName = str("leadName", "lead", "lead_name");
    const due = raw.dueInDays ?? raw.due_in_days ?? raw.dueDays;
    const dueDays = typeof due === "number" ? due : typeof due === "string" && /^\d+$/.test(due) ? Number(due) : undefined;
    if (typeof dueDays === "number") p.dueInDays = dueDays;
    if (!p.taskTitle) return null;
  }
  return p;
}

export async function sendCopilotPromptAction(prompt: string, history: HistoryTurnInput[] = []) {
  const { workspaceId, userId } = await requireWorkspace();

  // Trust nothing from the client: keep the last 10 turns, only valid roles,
  // plain-text bodies capped at 600 chars each (~turn budget for the prompt).
  const safeHistory: CopilotTurn[] = (Array.isArray(history) ? history : [])
    .slice(-10)
    .filter(
      (t): t is { role: "user" | "assistant"; text: string } =>
        typeof t?.role === "string" &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t?.text === "string"
    )
    .map((t) => ({
      role: t.role,
      text: t.text.replace(/<[^>]*>/g, "").slice(0, 600),
    }))
    .filter((t) => t.text.trim().length > 0);

  const response = await AiAgentService.processCopilotCommand(workspaceId, prompt, safeHistory);

  // Arm any write-proposals: replace client-visible payloads with unforgeable,
  // single-use tokens. The client never carries the proposal content.
  if (response.suggestedActions) {
    const armed: typeof response.suggestedActions = [];
    for (const action of response.suggestedActions) {
      if (!isWriteKind(action.actionType)) {
        armed.push(action);
        continue;
      }
      const proposal = normalizeWriteProposal(action.actionType, action.payload);
      if (!proposal) continue; // un-salvageable — drop the card, keep the answer
      const token = issueWriteToken(proposal, workspaceId, userId);
      armed.push({ ...action, payload: { writeToken: token, summary: summarizeProposal(proposal) } });
    }
    response.suggestedActions = armed;
  }

  return response;
}

export async function discoverLeadsAction(query: string, industry?: string, location?: string) {
  await requireWorkspace();
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { success: false as const, error: "Describe who to look for (min 3 characters)." };
  }
  // Network pipeline — bounded by per-fetch timeouts inside the service.
  return await LeadDiscoveryService.discover({
    query: trimmed.slice(0, 300),
    industry: industry?.slice(0, 120),
    location: location?.slice(0, 120),
    maxResults: 6,
  });
}

/**
 * Local-business discovery via Google Places (Hot/Warm/Cold tiered on the
 * missing-web-presence signal). Fails soft — without GOOGLE_PLACES_API_KEY the
 * result carries an honest note instead of an error.
 */
export async function discoverLocalLeadsAction(category: string, city: string, maxResults?: number) {
  await requireWorkspace();
  return await LocalLeadDiscoveryService.discover({
    category: category.trim().slice(0, 120),
    city: city.trim().slice(0, 120),
    maxResults: maxResults ?? 10,
  });
}

export interface ImportLeadCandidate {
  companyName: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  description: string | null;
  emails: string[];
  phones: string[];
  linkedin: string | null;
  fitScore: number;
  sourceQuery: string;
  sourceUrl: string | null;
  /** Local-discovery extras (Google Places). Optional so the web-search pipeline is unchanged. */
  placeId?: string;
  rating?: number | null;
  reviewCount?: number | null;
  priority?: string;
  /** Why this tier — cited factual signals (missing website, review count). */
  priorityReason?: string | null;
  /** LLM-generated outreach hook — labeled model-generated, stored in notes, never a factual field. */
  hook?: string | null;
}

// ---------------------------------------------------------------------------
// COPILOT WRITE-ACTIONS (explicit user confirmation required; fully audited)
// ---------------------------------------------------------------------------

export interface CopilotWriteProposal {
  kind: "UPDATE_DEAL_STAGE" | "LOG_ACTIVITY" | "CREATE_TASK";
  // UPDATE_DEAL_STAGE
  dealName?: string;
  stage?: string;
  // LOG_ACTIVITY / CREATE_TASK
  leadName?: string;
  dealNameForActivity?: string;
  // LOG_ACTIVITY
  activityType?: string;
  title?: string;
  description?: string;
  // CREATE_TASK
  taskTitle?: string;
  taskDescription?: string;
  priority?: string;
  dueInDays?: number;
}

export interface CopilotWriteResult {
  success: boolean;
  message: string;
  entityId?: string;
}

const DEAL_STAGES = ["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "OUTREACH", "FOLLOW_UP"] as const;
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/**
 * Server-held pending proposals. The client receives only a token — the
 * proposal payload NEVER round-trips through the client, so nothing can be
 * tampered with between proposal and confirmation, and execution is
 * impossible without an unspent token. Single-use, 10-minute expiry.
 */
const pendingWrites = new Map<
  string,
  { proposal: CopilotWriteProposal; workspaceId: string; userId: string; issuedAt: number; expiresAt: number }
>();
const WRITE_TOKEN_TTL_MS = 10 * 60 * 1000;
/**
 * Minimum age before a token may be spent. Stray/synthetic click bursts land
 * within milliseconds of the card rendering; a human who reads the summary
 * never confirms that fast. Attempts below the gate BURN the token.
 */
const WRITE_MIN_AGE_MS = 2_500;

function issueWriteToken(proposal: CopilotWriteProposal, workspaceId: string, userId: string): string {
  // Sweep expired tokens opportunistically
  const now = Date.now();
  for (const [k, v] of pendingWrites) if (v.expiresAt < now) pendingWrites.delete(k);
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  pendingWrites.set(token, { proposal, workspaceId, userId, issuedAt: now, expiresAt: now + WRITE_TOKEN_TTL_MS });
  return token;
}

/**
 * Executes ONE copilot-proposed write after the user clicked Confirm in the
 * drawer. The proposal itself is server-held — the client presents only a
 * single-use token, so nothing can be tampered with or replayed. Entities are
 * resolved BY NAME against real workspace-scoped rows server-side; the client
 * can never pass raw IDs or a workspaceId. Every successful write lands in
 * audit_logs with via="copilot".
 */
export async function executeCopilotWriteAction(writeToken: string): Promise<CopilotWriteResult> {
  const { workspaceId, userId } = await requireWorkspace();

  // Pop the token: single-use by construction. Unknown, expired, spent, or
  // wrong-workspace tokens all fail identically — no oracle, no replay.
  const pending = pendingWrites.get(writeToken);
  pendingWrites.delete(writeToken);
  if (!pending || pending.expiresAt < Date.now()) {
    return { success: false, message: "This proposal expired or was already used. Ask the Copilot again." };
  }
  if (pending.workspaceId !== workspaceId || pending.userId !== userId) {
    return { success: false, message: "This proposal belongs to a different session." };
  }
  // Anti-stray-click gate: reject implausibly-fast confirmations outright.
  // The token is burned either way — one attempt per proposal, ever.
  if (Date.now() - pending.issuedAt < WRITE_MIN_AGE_MS) {
    return { success: false, message: "Confirmation rejected as accidental (too fast). Ask the Copilot to propose it again." };
  }
  const proposal = pending.proposal;

  try {
    switch (proposal.kind) {
      case "UPDATE_DEAL_STAGE": {
        const stage = String(proposal.stage ?? "").toUpperCase();
        if (!(DEAL_STAGES as readonly string[]).includes(stage)) {
          return { success: false, message: `Invalid stage "${stage}".` };
        }
        const deal = await CrmService.findDealByName(workspaceId, String(proposal.dealName ?? ""));
        if (!deal) {
          return { success: false, message: `No deal matching "${proposal.dealName}" found in this workspace.` };
        }
        if (deal.stage === stage) {
          return { success: false, message: `"${deal.name}" is already in ${stage}.` };
        }
        const updated = await CrmService.updateDealStage(workspaceId, deal.id, stage);
        if (!updated) {
          return { success: false, message: `Deal "${deal.name}" could not be updated.` };
        }
        await ActivityService.logAudit(workspaceId, userId, "UPDATE", "DEAL", deal.id, {
          via: "copilot",
          field: "stage",
          from: deal.stage,
          to: stage,
          dealName: deal.name,
        });
        revalidatePath("/pipeline");
        revalidatePath("/deals");
        revalidatePath("/");
        return { success: true, message: `"${deal.name}" moved ${deal.stage} → ${stage}.`, entityId: deal.id };
      }

      case "LOG_ACTIVITY": {
        const type = String(proposal.activityType ?? "NOTE").toUpperCase();
        if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) {
          return { success: false, message: `Invalid activity type "${type}".` };
        }
        const title = String(proposal.title ?? "").trim().slice(0, 200);
        if (title.length < 3) {
          return { success: false, message: "Activity needs a title (min 3 chars)." };
        }
        // Attach to a lead (by company/contact name) or a deal (by name) — exactly one.
        let leadId: string | null = null;
        let dealId: string | null = null;
        if (proposal.leadName) {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          leadId = lead.id;
        } else if (proposal.dealNameForActivity || proposal.dealName) {
          // Models sometimes put the target in dealName — accept it as fallback.
          const targetName = String(proposal.dealNameForActivity ?? proposal.dealName);
          const deal = await CrmService.findDealByName(workspaceId, targetName);
          if (!deal) return { success: false, message: `No deal matching "${targetName}" found.` };
          dealId = deal.id;
        } else {
          return { success: false, message: "Say which lead or deal this activity belongs to." };
        }
        const activity = await ActivityService.createActivity(workspaceId, {
          workspaceId,
          leadId,
          dealId,
          actorId: userId,
          type,
          title,
          description: String(proposal.description ?? "").slice(0, 2000) || null,
          metadata: { via: "copilot" },
        });
        await ActivityService.logAudit(workspaceId, userId, "CREATE", "ACTIVITY", activity.id, {
          via: "copilot",
          type,
          title,
          leadId,
          dealId,
        });
        revalidatePath("/my-day");
        return { success: true, message: `Logged ${type.toLowerCase()} "${title}".`, entityId: activity.id };
      }

      case "CREATE_TASK": {
        const taskTitle = String(proposal.taskTitle ?? "").trim().slice(0, 200);
        if (taskTitle.length < 3) {
          return { success: false, message: "Task needs a title (min 3 chars)." };
        }
        const priority = String(proposal.priority ?? "MEDIUM").toUpperCase();
        const safePriority = (TASK_PRIORITIES as readonly string[]).includes(priority) ? priority : "MEDIUM";
        const dueInDays =
          typeof proposal.dueInDays === "number" && proposal.dueInDays >= 0 && proposal.dueInDays <= 365
            ? Math.round(proposal.dueInDays)
            : null;
        let dealId: string | null = null;
        let leadId: string | null = null;
        if (proposal.dealName) {
          const deal = await CrmService.findDealByName(workspaceId, String(proposal.dealName));
          if (!deal) return { success: false, message: `No deal matching "${proposal.dealName}" found.` };
          dealId = deal.id;
        } else if (proposal.leadName) {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          leadId = lead.id;
        }
        const task = await CrmService.createTask(workspaceId, {
          title: taskTitle,
          description: String(proposal.taskDescription ?? "").slice(0, 2000) || null,
          priority: safePriority,
          dueAt: dueInDays === null ? null : new Date(Date.now() + dueInDays * 86_400_000),
          dealId,
          leadId,
          createdBy: "copilot",
          assignedToId: userId,
        });
        await ActivityService.logAudit(workspaceId, userId, "CREATE", "TASK", task.id, {
          via: "copilot",
          title: taskTitle,
          priority: safePriority,
          dueInDays,
          dealId,
          leadId,
        });
        revalidatePath("/my-day");
        return { success: true, message: `Task "${taskTitle}" created${dueInDays !== null ? ` — due in ${dueInDays} day${dueInDays === 1 ? "" : "s"}` : ""}.`, entityId: task.id };
      }

      default:
        return { success: false, message: "Unknown write-action kind." };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message.slice(0, 200) : "Write-action failed.",
    };
  }
}

/**
 * Imports one discovered lead into the CRM as a real company + contact + lead.
 * Dedupes by website domain, auto-scores via LeadScoringService, and audits
 * every created row with the discovery source.
 */
export async function importDiscoveredLeadAction(candidate: ImportLeadCandidate) {
  const { workspaceId, userId } = await requireWorkspace();

  if (typeof candidate?.companyName !== "string" || candidate.companyName.trim().length === 0) {
    return { success: false as const, error: "Company name is required." };
  }

  // Dedupe: skip if a company with the same website domain already exists.
  if (candidate.website) {
    const existing = await CrmService.findCompanyByWebsite(workspaceId, candidate.website);
    if (existing) {
      return { success: false as const, error: `Already in CRM as "${existing.name}".` };
    }
  } else if (candidate.placeId) {
    // Website-less local businesses have no domain to dedupe on — fall back to
    // an exact company-name match within the workspace.
    const existing = await CrmService.findCompanyByName(workspaceId, candidate.companyName);
    if (existing) {
      return { success: false as const, error: `Already in CRM as "${existing.name}".` };
    }
  }

  // Real, per-place details go in company notes verbatim (no inference): the
  // Google rating/review count, Maps link, placeId, and the labeled LLM hook.
  const localNotes = [
    candidate.description,
    typeof candidate.rating === "number" ? `Google rating: ${candidate.rating}★` : null,
    typeof candidate.reviewCount === "number" ? `Google reviews: ${candidate.reviewCount}` : null,
    candidate.sourceUrl ? `Maps: ${candidate.sourceUrl}` : null,
    candidate.placeId ? `place_id: ${candidate.placeId}` : null,
    candidate.hook ? `Suggested hook (AI-generated, verify before use): ${candidate.hook}` : null,
  ]
    .filter(Boolean)
    .join("\n") || null;

  const company = await CrmService.createCompany(workspaceId, {
    name: candidate.companyName.trim().slice(0, 160),
    website: candidate.website,
    industry: candidate.industry,
    location: candidate.location,
    size: candidate.size,
    source: `AI Discovery: ${candidate.sourceQuery.slice(0, 100)}`,
    notes: localNotes,
    ownerId: userId,
  });

  // Primary contact from the strongest found email/phone.
  const primaryEmail = candidate.emails[0] ?? null;
  const primaryPhone = candidate.phones[0] ?? null;
  let contactId: string | null = null;
  if (primaryEmail || primaryPhone) {
    const nameParts = candidate.companyName.trim().split(/\s+/);
    const contact = await CrmService.createContact(workspaceId, {
      companyId: company.id,
      firstName: "Team",
      lastName: candidate.companyName.trim().slice(0, 60),
      email: primaryEmail,
      phone: primaryPhone,
      notes: candidate.linkedin ? `LinkedIn: ${candidate.linkedin}` : null,
    });
    contactId = contact.id;
    void nameParts;
  }

  // Score with the deterministic engine: WARM baseline + discovery contact signals.
  const score = LeadScoringService.calculateScore(
    { temperature: "WARM", stage: "NEW", status: "NEW" },
    {
      email: primaryEmail ?? undefined,
      phone: primaryPhone ?? undefined,
      linkedinUrl: candidate.linkedin ?? undefined,
      jobTitle: undefined,
    }
  );

  const lead = await CrmService.createLead(workspaceId, {
    companyId: company.id,
    contactId,
    ownerId: userId,
    source: `AI Discovery: ${candidate.sourceQuery.slice(0, 100)}`,
    status: "NEW",
    stage: "NEW",
    score,
    temperature: candidate.fitScore >= 70 ? "WARM" : "COLD",
    notes: [
      candidate.description ? candidate.description.slice(0, 500) : "Discovered by Aexyl Lead Discovery.",
      `Fit: ${candidate.fitScore}/100.`,
      candidate.priority ? `Local priority: ${candidate.priority}.` : null,
      candidate.priorityReason ? `Why: ${candidate.priorityReason}` : null,
      candidate.hook ? `Suggested hook (AI-generated, verify before use): ${candidate.hook}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  await ActivityService.logAudit(workspaceId, userId, "CREATE", "LEAD", lead.id, {
    via: "ai_discovery",
    company: company.name,
    website: candidate.website,
    sourceQuery: candidate.sourceQuery,
    fitScore: candidate.fitScore,
    sourceUrl: candidate.sourceUrl,
    placeId: candidate.placeId ?? null,
    priority: candidate.priority ?? null,
  });

  revalidatePath("/leads");
  revalidatePath("/companies");
  revalidatePath("/");
  return { success: true as const, leadId: lead.id, companyId: company.id, score };
}  /** Bulk import helper: imports every candidate, reporting per-item outcomes. */
export async function importDiscoveredLeadsAction(candidates: ImportLeadCandidate[]) {
  const results: { companyName: string; ok: boolean; error?: string; leadId?: string }[] = [];
  for (const candidate of candidates.slice(0, 20)) {
    try {
      const r = await importDiscoveredLeadAction(candidate);
      results.push(
        r.success
          ? { companyName: candidate.companyName, ok: true, leadId: r.leadId }
          : { companyName: candidate.companyName, ok: false, error: r.error }
      );
    } catch (error) {
      results.push({
        companyName: candidate.companyName,
        ok: false,
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  }
  return { results, imported: results.filter((r) => r.ok).length };
}

export type { DiscoveredLead };
