/**
 * Copilot write-action service — the execution half of the copilot's action
 * protocol. Proposals are issued as server-held, single-use, 10-minute tokens;
 * the client never carries proposal content, so nothing can be tampered with
 * or replayed between proposal and confirmation.
 *
 * Execution resolves entities BY NAME against real workspace-scoped rows and
 * audits every write with via="copilot". Kept free of Next.js request-context
 * APIs (revalidatePath runs in the calling server action) so it is directly
 * unit/scenario-testable — see tests/copilot.scenarios.ts.
 */
import { CrmService } from "@/services/crm.service";
import { ActivityService } from "@/services/activity.service";
import { SheetImportService, SHEET_IMPORT_MAX_ROWS } from "@/services/ai/sheet-import.service";
import { LeadImportService } from "@/services/ai/lead-import.service";
import { SequenceEngineService } from "@/services/ai/sequence-engine.service";
import { BdrEngineService } from "@/services/ai/bdr-engine.service";
import { sendRawEmail } from "@/services/email.service";

export type CopilotWriteKind =
  | "UPDATE_DEAL_STAGE"
  | "LOG_ACTIVITY"
  | "CREATE_TASK"
  | "CREATE_FOLLOW_UP"
  | "IMPORT_SHEET_LEADS"
  | "CREATE_LEAD"
  | "CREATE_DEAL"
  | "CREATE_COMPANY"
  | "CREATE_CONTACT"
  | "UPDATE_LEAD"
  | "UPDATE_DEAL"
  | "UPDATE_CONTACT"
  | "UPDATE_COMPANY"
  | "DELETE_LEAD"
  | "DELETE_DEAL"
  | "SEND_EMAIL"
  | "ENROLL_SEQUENCE"
  | "CREATE_SEQUENCE"
  | "HANDLE_OBJECTION"
  | "ANALYZE_INTENT";

export interface CopilotWriteProposal {
  kind: CopilotWriteKind;
  // UPDATE_DEAL_STAGE
  dealName?: string;
  stage?: string;
  // LOG_ACTIVITY / CREATE_TASK / CREATE_FOLLOW_UP
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
  // CREATE_TASK / CREATE_FOLLOW_UP
  dueInDays?: number;
  // IMPORT_SHEET_LEADS — ALL fields bound server-side at issue time from the
  // validated sheet session; nothing here ever comes from the client.
  sheetId?: string;
  sheetFileName?: string;
  sheetRowCount?: number;
  sheetPreview?: string[][];
  // CREATE_LEAD
  companyName?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactJobTitle?: string;
  industry?: string;
  location?: string;
  website?: string;
  source?: string;
  // CREATE_DEAL
  dealValue?: number;
  expectedCloseDate?: string;
  companyId?: string;
  leadId?: string;
  // CREATE_COMPANY
  companySize?: string;
  // CREATE_CONTACT
  phone?: string;
  // UPDATE_LEAD
  leadScore?: number;
  leadTemperature?: string;
  leadStatus?: string;
  // UPDATE_DEAL
  dealValueStr?: string;
  // UPDATE_CONTACT / UPDATE_COMPANY — reuse existing fields
  // SEND_EMAIL
  emailTo?: string;
  emailSubject?: string;
  emailBody?: string;
  // ENROLL_SEQUENCE
  sequenceId?: string;
  sequenceName?: string;
  // CREATE_SEQUENCE
  targetProfile?: string;
  valueProp?: string;
  // HANDLE_OBJECTION
  objectionText?: string;
  // ANALYZE_INTENT — just needs leadName
}

export interface CopilotWriteResult {
  success: boolean;
  message: string;
  entityId?: string;
  /** Paths the calling server action should revalidate after success. */
  revalidatePaths?: string[];
}

export const DEAL_STAGES = ["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export const ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "OUTREACH", "FOLLOW_UP"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const WRITE_KIND_SET = new Set<string>([
  "UPDATE_DEAL_STAGE", "LOG_ACTIVITY", "CREATE_TASK", "CREATE_FOLLOW_UP", "IMPORT_SHEET_LEADS",
  "CREATE_LEAD", "CREATE_DEAL", "CREATE_COMPANY", "CREATE_CONTACT",
  "UPDATE_LEAD", "UPDATE_DEAL", "UPDATE_CONTACT", "UPDATE_COMPANY",
  "DELETE_LEAD", "DELETE_DEAL", "SEND_EMAIL",
  "ENROLL_SEQUENCE", "CREATE_SEQUENCE", "HANDLE_OBJECTION", "ANALYZE_INTENT",
]);
export function isWriteKind(t: string): t is CopilotWriteKind {
  return WRITE_KIND_SET.has(t);
}

/** Human summary of a write proposal, shown on its confirm card. */
export function summarizeProposal(p: CopilotWriteProposal): string {
  switch (p.kind) {
    case "UPDATE_DEAL_STAGE":
      return `${p.dealName} → ${(p.stage ?? "?").replace(/_/g, " ")}`;
    case "LOG_ACTIVITY":
      return `${(p.activityType ?? "note").replace(/_/g, " ")} on ${p.leadName ?? p.dealNameForActivity}: ${p.title}`;
    case "CREATE_FOLLOW_UP":
      return `Follow up on ${p.leadName ?? "?"}${typeof p.dueInDays === "number" ? ` in ${p.dueInDays}d` : ""}`;
    case "CREATE_TASK":
      return `${p.taskTitle}${p.priority && p.priority !== "MEDIUM" ? ` · ${p.priority.toLowerCase()} priority` : ""}${typeof p.dueInDays === "number" ? ` · due in ${p.dueInDays}d` : ""}`;
    case "IMPORT_SHEET_LEADS":
      return `Import ${p.sheetRowCount ?? "?"} row${p.sheetRowCount === 1 ? "" : "s"} from ${p.sheetFileName ?? "attached sheet"} as leads`;
    case "CREATE_LEAD":
      return `New lead: ${p.companyName ?? "?"}${p.contactFirstName ? ` (${p.contactFirstName} ${p.contactLastName ?? ""})` : ""}`;
    case "CREATE_DEAL":
      return `New deal: ${p.dealName ?? "?"}${p.dealValue ? ` · $${p.dealValue.toLocaleString()}` : ""}`;
    case "CREATE_COMPANY":
      return `New company: ${p.companyName ?? "?"}${p.industry ? ` · ${p.industry}` : ""}`;
    case "CREATE_CONTACT":
      return `New contact: ${p.contactFirstName ?? ""} ${p.contactLastName ?? ""}${p.contactEmail ? ` (${p.contactEmail})` : ""}`.trim();
    case "UPDATE_LEAD":
      return `Update lead: ${p.leadName ?? "?"}${p.leadStatus ? ` → ${p.leadStatus}` : ""}${p.leadTemperature ? ` · ${p.leadTemperature}` : ""}`;
    case "UPDATE_DEAL":
      return `Update deal: ${p.dealName ?? "?"}${p.stage ? ` → ${p.stage}` : ""}${p.dealValue ? ` · $${p.dealValue.toLocaleString()}` : ""}`;
    case "UPDATE_CONTACT":
      return `Update contact: ${p.contactFirstName ?? ""} ${p.contactLastName ?? ""}`.trim() || "Update contact";
    case "UPDATE_COMPANY":
      return `Update company: ${p.companyName ?? "?"}`;
    case "DELETE_LEAD":
      return `Delete lead: ${p.leadName ?? "?"}`;
    case "DELETE_DEAL":
      return `Delete deal: ${p.dealName ?? "?"}`;
    case "SEND_EMAIL":
      return `Email to ${p.emailTo ?? "?"}: ${p.emailSubject ?? "(no subject)"}`;
    case "ENROLL_SEQUENCE":
      return `Enroll ${p.leadName ?? "?"} in sequence${p.sequenceName ? ` "${p.sequenceName}"` : ""}`;
    case "CREATE_SEQUENCE":
      return `Generate outreach sequence for ${p.targetProfile ?? "?"}`;
    case "HANDLE_OBJECTION":
      return `Handle objection from ${p.leadName ?? "?"}`;
    case "ANALYZE_INTENT":
      return `Analyze intent for ${p.leadName ?? "?"}`;
  }
}

/**
 * Small models drift off the payload contract. Accept common aliases, strip
 * empty fields, and return null when a proposal is un-salvageable (missing
 * required fields) so a broken confirm card never reaches the user.
 */
export function normalizeWriteProposal(kind: CopilotWriteKind, raw: Record<string, unknown>): CopilotWriteProposal | null {
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
  } else if (kind === "CREATE_FOLLOW_UP") {
    p.leadName = str("leadName", "lead", "lead_name");
    if (!p.leadName) return null;
    const due = raw.dueInDays ?? raw.due_in_days ?? raw.dueDays;
    const dueDays = typeof due === "number" ? due : typeof due === "string" && /^\d+$/.test(due) ? Number(due) : undefined;
    if (typeof dueDays === "number") p.dueInDays = dueDays;
  } else if (kind === "IMPORT_SHEET_LEADS") {
    return p;
  } else if (kind === "CREATE_LEAD") {
    p.companyName = str("companyName", "company", "company_name");
    p.contactFirstName = str("contactFirstName", "firstName", "first_name");
    p.contactLastName = str("contactLastName", "lastName", "last_name");
    p.contactEmail = str("contactEmail", "email");
    p.contactJobTitle = str("contactJobTitle", "jobTitle", "job_title", "role");
    p.industry = str("industry");
    p.location = str("location", "city", "region");
    p.website = str("website", "url");
    p.source = str("source");
    if (!p.companyName && !p.contactFirstName) return null;
  } else if (kind === "CREATE_DEAL") {
    p.dealName = str("dealName", "deal", "deal_name", "name");
    p.stage = str("stage")?.toUpperCase() || "QUALIFIED";
    p.leadName = str("leadName", "lead", "lead_name");
    p.companyName = str("companyName", "company", "company_name");
    const val = raw.dealValue ?? raw.value ?? raw.amount;
    if (typeof val === "number") p.dealValue = val;
    else if (typeof val === "string") { const n = parseFloat(val.replace(/[,$]/g, "")); if (!isNaN(n)) p.dealValue = n; }
    p.expectedCloseDate = str("expectedCloseDate", "closeDate", "close_date");
    if (!p.dealName) return null;
  } else if (kind === "CREATE_COMPANY") {
    p.companyName = str("companyName", "company", "name");
    p.industry = str("industry");
    p.location = str("location", "city");
    p.website = str("website", "url");
    p.companySize = str("size", "companySize");
    if (!p.companyName) return null;
  } else if (kind === "CREATE_CONTACT") {
    p.contactFirstName = str("contactFirstName", "firstName", "first_name");
    p.contactLastName = str("contactLastName", "lastName", "last_name");
    p.contactEmail = str("contactEmail", "email");
    p.contactJobTitle = str("contactJobTitle", "jobTitle", "job_title", "role");
    p.phone = str("phone", "phoneNumber");
    p.companyName = str("companyName", "company");
    if (!p.contactFirstName && !p.contactEmail) return null;
  } else if (kind === "UPDATE_LEAD") {
    p.leadName = str("leadName", "lead", "lead_name");
    p.leadStatus = str("leadStatus", "status")?.toUpperCase();
    p.leadTemperature = str("leadTemperature", "temperature")?.toUpperCase();
    const score = raw.leadScore ?? raw.score;
    if (typeof score === "number") p.leadScore = Math.min(100, Math.max(0, score));
    if (!p.leadName) return null;
  } else if (kind === "UPDATE_DEAL") {
    p.dealName = str("dealName", "deal", "deal_name");
    p.stage = str("stage")?.toUpperCase();
    const val = raw.dealValue ?? raw.value ?? raw.amount;
    if (typeof val === "number") p.dealValue = val;
    else if (typeof val === "string") { const n = parseFloat(val.replace(/[,$]/g, "")); if (!isNaN(n)) p.dealValue = n; }
    p.expectedCloseDate = str("expectedCloseDate", "closeDate", "close_date");
    if (!p.dealName) return null;
  } else if (kind === "UPDATE_CONTACT") {
    p.contactFirstName = str("contactFirstName", "firstName", "first_name");
    p.contactLastName = str("contactLastName", "lastName", "last_name");
    p.contactEmail = str("contactEmail", "email");
    p.contactJobTitle = str("contactJobTitle", "jobTitle", "job_title", "role");
    p.phone = str("phone", "phoneNumber");
    p.leadName = str("leadName", "lead");
    if (!p.contactEmail && !p.contactFirstName && !p.leadName) return null;
  } else if (kind === "UPDATE_COMPANY") {
    p.companyName = str("companyName", "company", "name");
    p.industry = str("industry");
    p.location = str("location", "city");
    p.website = str("website", "url");
    p.companySize = str("size", "companySize");
    if (!p.companyName) return null;
  } else if (kind === "DELETE_LEAD") {
    p.leadName = str("leadName", "lead", "lead_name");
    if (!p.leadName) return null;
  } else if (kind === "DELETE_DEAL") {
    p.dealName = str("dealName", "deal", "deal_name");
    if (!p.dealName) return null;
  } else if (kind === "SEND_EMAIL") {
    p.emailTo = str("emailTo", "to", "email", "recipientEmail");
    p.emailSubject = str("emailSubject", "subject");
    p.emailBody = str("emailBody", "body", "message", "content");
    p.leadName = str("leadName", "lead");
    if (!p.emailTo || !p.emailBody) return null;
  } else if (kind === "ENROLL_SEQUENCE") {
    p.leadName = str("leadName", "lead", "lead_name");
    p.sequenceName = str("sequenceName", "sequence", "sequence_name");
    p.sequenceId = str("sequenceId", "sequence_id");
    if (!p.leadName) return null;
  } else if (kind === "CREATE_SEQUENCE") {
    p.targetProfile = str("targetProfile", "target", "target_profile");
    p.valueProp = str("valueProp", "value_prop", "valueProposition");
    if (!p.targetProfile) return null;
  } else if (kind === "HANDLE_OBJECTION") {
    p.leadName = str("leadName", "lead", "lead_name");
    p.objectionText = str("objectionText", "objection", "text");
    if (!p.leadName || !p.objectionText) return null;
  } else if (kind === "ANALYZE_INTENT") {
    p.leadName = str("leadName", "lead", "lead_name");
    if (!p.leadName) return null;
  } else {
    // CREATE_TASK (default)
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

/** Default follow-up horizon when the proposal doesn't specify one (matches the stale-lead sweep cadence). */
const DEFAULT_FOLLOW_UP_DAYS = 7;

/**
 * Server-held pending proposals: token → proposal + issuing session. Single-use,
 * 10-minute expiry, workspace-and-user bound.
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

export class CopilotWriteService {
  /** Arms a proposal and returns its single-use token. */
  static issue(proposal: CopilotWriteProposal, workspaceId: string, userId: string): string {
    // Sweep expired tokens opportunistically
    const now = Date.now();
    for (const [k, v] of pendingWrites) if (v.expiresAt < now) pendingWrites.delete(k);
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
    pendingWrites.set(token, { proposal, workspaceId, userId, issuedAt: now, expiresAt: now + WRITE_TOKEN_TTL_MS });
    return token;
  }

  /**
   * Executes ONE confirmed proposal. The token is popped first: unknown,
   * expired, spent, or wrong-session tokens all fail identically — no oracle,
   * no replay. Entities are resolved by name; the caller can never pass raw
   * IDs or a workspaceId.
   */
  static async execute(writeToken: string, workspaceId: string, userId: string): Promise<CopilotWriteResult> {
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
          return {
            success: true,
            message: `"${deal.name}" moved ${deal.stage} → ${stage}.`,
            entityId: deal.id,
            revalidatePaths: ["/pipeline", "/deals", "/"],
          };
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
          return {
            success: true,
            message: `Logged ${type.toLowerCase()} "${title}".`,
            entityId: activity.id,
            revalidatePaths: ["/my-day"],
          };
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
          return {
            success: true,
            message: `Task "${taskTitle}" created${dueInDays !== null ? ` — due in ${dueInDays} day${dueInDays === 1 ? "" : "s"}` : ""}.`,
            entityId: task.id,
            revalidatePaths: ["/my-day"],
          };
        }

        case "CREATE_FOLLOW_UP": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) {
            return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          }
          const dueInDays =
            typeof proposal.dueInDays === "number" && proposal.dueInDays >= 0 && proposal.dueInDays <= 365
              ? Math.round(proposal.dueInDays)
              : DEFAULT_FOLLOW_UP_DAYS;
          const nextAt = new Date(Date.now() + dueInDays * 86_400_000);
          const updated = await CrmService.updateLead(workspaceId, lead.id, { nextFollowUpAt: nextAt });
          if (!updated) {
            return { success: false, message: `Follow-up for "${lead.company?.name ?? "lead"}" could not be scheduled.` };
          }
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "FOLLOW_UP", lead.id, {
            via: "copilot",
            leadId: lead.id,
            nextFollowUpAt: nextAt.toISOString(),
            dueInDays,
            previousFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
          });
          const label = lead.company?.name ?? "the lead";
          return {
            success: true,
            message: `Follow-up scheduled for ${label} — ${dueInDays === 0 ? "today" : `in ${dueInDays} day${dueInDays === 1 ? "" : "s"}`}.`,
            entityId: lead.id,
            revalidatePaths: ["/my-day", "/calendar", "/leads"],
          };
        }

        case "IMPORT_SHEET_LEADS": {
          const sheet = SheetImportService.getSession(proposal.sheetId, workspaceId, userId);
          if (!sheet) {
            return { success: false, message: "The attached spreadsheet expired or was replaced — attach it again and ask me to propose the import once more." };
          }
          const candidates = SheetImportService.mapRowsToCandidates(sheet);
          const batch = SheetImportService.dedupeBatch(candidates);
          const toImport = batch.slice(0, SHEET_IMPORT_MAX_ROWS);
          const inBatchDuplicates = candidates.length - batch.length;
          const overflow = batch.length - toImport.length;
          const rowsWithoutName = sheet.rowCount - candidates.length;
          let imported = 0;
          let duplicates = 0;
          let failed = 0;
          for (const candidate of toImport) {
            const r = await LeadImportService.importCandidate(workspaceId, userId, candidate, { mode: "sheet", sheetFileName: sheet.fileName });
            if (r.ok) imported++;
            else if (r.skipped) duplicates++;
            else failed++;
          }
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "SHEET_IMPORT", sheet.sheetId, {
            via: "copilot", sheetFile: sheet.fileName, rows: sheet.rowCount, imported, duplicates: duplicates + inBatchDuplicates, failed, rowsWithoutName,
          });
          const detail = [
            duplicates + inBatchDuplicates > 0 ? `${duplicates + inBatchDuplicates} duplicate${duplicates + inBatchDuplicates === 1 ? "" : "s"} skipped` : null,
            failed > 0 ? `${failed} failed` : null,
            rowsWithoutName > 0 ? `${rowsWithoutName} had no usable name` : null,
            overflow > 0 ? `${overflow} over the ${SHEET_IMPORT_MAX_ROWS}-row cap left unimported` : null,
          ].filter(Boolean).join(", ");
          return {
            success: true,
            message: `Imported ${imported} of ${sheet.rowCount} row${sheet.rowCount === 1 ? "" : "s"} from ${sheet.fileName}${detail ? ` (${detail})` : ""}.`,
            entityId: sheet.sheetId,
            revalidatePaths: ["/leads", "/companies", "/"],
          };
        }

        case "CREATE_LEAD": {
          const companyName = String(proposal.companyName ?? "").trim();
          if (!companyName && !proposal.contactFirstName) return { success: false, message: "Need a company name or contact name." };
          let companyId: string | undefined;
          if (companyName) {
            const existing = await CrmService.findCompanyByName(workspaceId, companyName);
            if (existing) {
              companyId = existing.id;
            } else {
              const newCo = await CrmService.createCompany(workspaceId, {
                name: companyName, industry: proposal.industry ?? null, location: proposal.location ?? null,
                website: proposal.website ?? null, size: proposal.companySize ?? null, status: "PROSPECT",
              });
              companyId = newCo.id;
            }
          }
          let contactId: string | undefined;
          if (proposal.contactEmail || proposal.contactFirstName) {
            if (proposal.contactEmail) {
              const existing = await CrmService.findContactByEmail(workspaceId, proposal.contactEmail);
              if (existing) { contactId = existing.id; }
            }
            if (!contactId) {
              const newContact = await CrmService.createContact(workspaceId, {
                firstName: proposal.contactFirstName ?? "Unknown",
                lastName: proposal.contactLastName ?? null,
                email: proposal.contactEmail ?? null,
                jobTitle: proposal.contactJobTitle ?? null,
                companyId: companyId ?? null,
              });
              contactId = newContact.id;
            }
          }
          const lead = await CrmService.createLead(workspaceId, {
            companyId: companyId ?? null, contactId: contactId ?? null,
            source: proposal.source ?? "COPILOT", status: "NEW", stage: "UNQUALIFIED",
            score: 50, temperature: "WARM",
          });
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "LEAD", lead.id, { via: "copilot", companyName });
          return { success: true, message: `Lead created: ${companyName || proposal.contactFirstName || "new lead"}.`, entityId: lead.id, revalidatePaths: ["/leads", "/companies", "/"] };
        }

        case "CREATE_DEAL": {
          const dealName = String(proposal.dealName ?? "").trim();
          if (!dealName) return { success: false, message: "Deal needs a name." };
          const stg = String(proposal.stage ?? "QUALIFIED").toUpperCase();
          if (!(DEAL_STAGES as readonly string[]).includes(stg)) return { success: false, message: `Invalid stage "${stg}".` };
          let compId: string | null = null;
          if (proposal.companyName) {
            const co = await CrmService.findCompanyByName(workspaceId, proposal.companyName);
            compId = co?.id ?? null;
          }
          let ldId: string | null = null;
          if (proposal.leadName) {
            const ld = await CrmService.findLeadByName(workspaceId, proposal.leadName);
            ldId = ld?.id ?? null;
          }
          const deal = await CrmService.createDeal(workspaceId, {
            name: dealName, stage: stg, value: proposal.dealValue ? String(proposal.dealValue) : null,
            companyId: compId, leadId: ldId,
            expectedCloseDate: proposal.expectedCloseDate ? new Date(proposal.expectedCloseDate) : null,
          });
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "DEAL", deal.id, { via: "copilot", dealName, stage: stg });
          return { success: true, message: `Deal "${dealName}" created in ${stg}.`, entityId: deal.id, revalidatePaths: ["/pipeline", "/deals", "/"] };
        }

        case "CREATE_COMPANY": {
          const name = String(proposal.companyName ?? "").trim();
          if (!name) return { success: false, message: "Company needs a name." };
          const existing = await CrmService.findCompanyByName(workspaceId, name);
          if (existing) return { success: false, message: `Company "${name}" already exists.` };
          const co = await CrmService.createCompany(workspaceId, {
            name, industry: proposal.industry ?? null, location: proposal.location ?? null,
            website: proposal.website ?? null, size: proposal.companySize ?? null, status: "PROSPECT",
          });
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "COMPANY", co.id, { via: "copilot", name });
          return { success: true, message: `Company "${name}" created.`, entityId: co.id, revalidatePaths: ["/companies", "/"] };
        }

        case "CREATE_CONTACT": {
          const firstName = String(proposal.contactFirstName ?? "").trim();
          const email = proposal.contactEmail?.trim();
          if (!firstName && !email) return { success: false, message: "Contact needs a name or email." };
          if (email) {
            const existing = await CrmService.findContactByEmail(workspaceId, email);
            if (existing) return { success: false, message: `Contact with email ${email} already exists.` };
          }
          let compId: string | null = null;
          if (proposal.companyName) {
            const co = await CrmService.findCompanyByName(workspaceId, proposal.companyName);
            compId = co?.id ?? null;
          }
          const contact = await CrmService.createContact(workspaceId, {
            firstName: firstName || "Unknown", lastName: proposal.contactLastName ?? null,
            email: email ?? null, jobTitle: proposal.contactJobTitle ?? null,
            phone: proposal.phone ?? null, companyId: compId,
          });
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "CONTACT", contact.id, { via: "copilot" });
          const contactLabel = `${firstName} ${proposal.contactLastName ?? ""}`.trim();
          return { success: true, message: `Contact "${contactLabel}" created.`, entityId: contact.id, revalidatePaths: ["/contacts", "/"] };
        }

        case "UPDATE_LEAD": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          const updates: Record<string, unknown> = {};
          if (proposal.leadStatus) updates.status = proposal.leadStatus;
          if (proposal.leadTemperature) updates.temperature = proposal.leadTemperature;
          if (typeof proposal.leadScore === "number") updates.score = proposal.leadScore;
          if (Object.keys(updates).length === 0) return { success: false, message: "No fields to update." };
          await CrmService.updateLead(workspaceId, lead.id, updates);
          await ActivityService.logAudit(workspaceId, userId, "UPDATE", "LEAD", lead.id, { via: "copilot", ...updates });
          return { success: true, message: `Lead "${proposal.leadName}" updated.`, entityId: lead.id, revalidatePaths: ["/leads", "/"] };
        }

        case "UPDATE_DEAL": {
          const deal = await CrmService.findDealByName(workspaceId, String(proposal.dealName ?? ""));
          if (!deal) return { success: false, message: `No deal matching "${proposal.dealName}" found.` };
          const updates: Record<string, unknown> = {};
          if (proposal.stage && (DEAL_STAGES as readonly string[]).includes(proposal.stage)) updates.stage = proposal.stage;
          if (typeof proposal.dealValue === "number") updates.value = String(proposal.dealValue);
          if (proposal.expectedCloseDate) updates.expectedCloseDate = new Date(proposal.expectedCloseDate);
          if (Object.keys(updates).length === 0) return { success: false, message: "No fields to update." };
          await CrmService.updateDeal(workspaceId, deal.id, updates);
          await ActivityService.logAudit(workspaceId, userId, "UPDATE", "DEAL", deal.id, { via: "copilot", ...updates });
          return { success: true, message: `Deal "${deal.name}" updated.`, entityId: deal.id, revalidatePaths: ["/pipeline", "/deals", "/"] };
        }

        case "UPDATE_CONTACT": {
          let contactId: string | null = null;
          if (proposal.leadName) {
            const lead = await CrmService.findLeadByName(workspaceId, proposal.leadName);
            contactId = lead?.contactId ?? null;
          } else if (proposal.contactEmail) {
            const contact = await CrmService.findContactByEmail(workspaceId, proposal.contactEmail);
            contactId = contact?.id ?? null;
          }
          if (!contactId) return { success: false, message: "Contact not found — specify a lead name or contact email." };
          const updates: Record<string, unknown> = {};
          if (proposal.contactFirstName) updates.firstName = proposal.contactFirstName;
          if (proposal.contactLastName) updates.lastName = proposal.contactLastName;
          if (proposal.contactJobTitle) updates.jobTitle = proposal.contactJobTitle;
          if (proposal.phone) updates.phone = proposal.phone;
          if (proposal.contactEmail && !proposal.leadName) updates.email = proposal.contactEmail;
          if (Object.keys(updates).length === 0) return { success: false, message: "No fields to update." };
          await CrmService.updateContact(workspaceId, contactId, updates);
          await ActivityService.logAudit(workspaceId, userId, "UPDATE", "CONTACT", contactId, { via: "copilot", ...updates });
          return { success: true, message: `Contact updated.`, entityId: contactId, revalidatePaths: ["/contacts", "/"] };
        }

        case "UPDATE_COMPANY": {
          const co = await CrmService.findCompanyByName(workspaceId, String(proposal.companyName ?? ""));
          if (!co) return { success: false, message: `No company matching "${proposal.companyName}" found.` };
          const updates: Record<string, unknown> = {};
          if (proposal.industry) updates.industry = proposal.industry;
          if (proposal.location) updates.location = proposal.location;
          if (proposal.website) updates.website = proposal.website;
          if (proposal.companySize) updates.size = proposal.companySize;
          if (Object.keys(updates).length === 0) return { success: false, message: "No fields to update." };
          await CrmService.updateCompany(workspaceId, co.id, updates);
          await ActivityService.logAudit(workspaceId, userId, "UPDATE", "COMPANY", co.id, { via: "copilot", ...updates });
          return { success: true, message: `Company "${co.name}" updated.`, entityId: co.id, revalidatePaths: ["/companies", "/"] };
        }

        case "DELETE_LEAD": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          await CrmService.deleteLead(workspaceId, lead.id);
          await ActivityService.logAudit(workspaceId, userId, "DELETE", "LEAD", lead.id, { via: "copilot", leadName: proposal.leadName });
          return { success: true, message: `Lead "${proposal.leadName}" deleted.`, entityId: lead.id, revalidatePaths: ["/leads", "/"] };
        }

        case "DELETE_DEAL": {
          const deal = await CrmService.findDealByName(workspaceId, String(proposal.dealName ?? ""));
          if (!deal) return { success: false, message: `No deal matching "${proposal.dealName}" found.` };
          await CrmService.deleteDeal(workspaceId, deal.id);
          await ActivityService.logAudit(workspaceId, userId, "DELETE", "DEAL", deal.id, { via: "copilot", dealName: proposal.dealName });
          return { success: true, message: `Deal "${proposal.dealName}" deleted.`, entityId: deal.id, revalidatePaths: ["/pipeline", "/deals", "/"] };
        }

        case "SEND_EMAIL": {
          const to = String(proposal.emailTo ?? "").trim();
          if (!to || !to.includes("@")) return { success: false, message: "Invalid email address." };
          const subject = String(proposal.emailSubject ?? "").trim() || "From AEXYL CRM";
          const body = String(proposal.emailBody ?? "").trim();
          if (body.length < 5) return { success: false, message: "Email body too short." };
          await sendRawEmail({ to, subject, html: body.replace(/\n/g, "<br>"), text: body });
          let leadId: string | null = null;
          if (proposal.leadName) {
            const lead = await CrmService.findLeadByName(workspaceId, proposal.leadName);
            leadId = lead?.id ?? null;
          }
          await ActivityService.createActivity(workspaceId, {
            workspaceId, leadId, dealId: null, actorId: userId,
            type: "EMAIL", title: `Email: ${subject}`, description: body.slice(0, 500),
            metadata: { via: "copilot", to },
          });
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "EMAIL", to, { via: "copilot", to, subject });
          return { success: true, message: `Email sent to ${to}.`, revalidatePaths: ["/my-day"] };
        }

        case "ENROLL_SEQUENCE": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          let seqId = proposal.sequenceId;
          if (!seqId && proposal.sequenceName) {
            const sequences = await SequenceEngineService.getSequences(workspaceId);
            const match = sequences.find((s) => s.name.toLowerCase().includes(proposal.sequenceName!.toLowerCase()));
            seqId = match?.id;
          }
          if (!seqId) return { success: false, message: "Sequence not found — specify a sequence name." };
          const result = await SequenceEngineService.enrollLead({ workspaceId, sequenceId: seqId, leadId: lead.id, contactId: lead.contactId ?? undefined });
          if (!result.enrolled) return { success: false, message: result.reason ?? "Enrollment failed." };
          await ActivityService.logAudit(workspaceId, userId, "CREATE", "ENROLLMENT", result.enrollmentId!, { via: "copilot", sequenceId: seqId, leadName: proposal.leadName });
          return { success: true, message: `${proposal.leadName} enrolled in the sequence.`, entityId: result.enrollmentId, revalidatePaths: ["/bdr", "/leads"] };
        }

        case "CREATE_SEQUENCE": {
          const target = String(proposal.targetProfile ?? "").trim();
          const vp = String(proposal.valueProp ?? "").trim();
          if (!target) return { success: false, message: "Specify a target profile for the sequence." };
          const result = await SequenceEngineService.generateSequence({ workspaceId, userId, targetProfile: target, valueProp: vp || target });
          return { success: true, message: `Sequence "${result.sequence.name}" created with ${result.steps.length} steps.`, entityId: result.sequence.id, revalidatePaths: ["/bdr"] };
        }

        case "HANDLE_OBJECTION": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          const result = await BdrEngineService.handleObjection({ workspaceId, leadId: lead.id, objectionText: String(proposal.objectionText ?? "") });
          return { success: true, message: `**${result.category}** objection handled:\n\n${result.response}${result.followUpQuestion ? `\n\n💡 Follow-up: ${result.followUpQuestion}` : ""}${result.escalate ? "\n\n⚠️ Escalation recommended." : ""}`, revalidatePaths: ["/leads"] };
        }

        case "ANALYZE_INTENT": {
          const lead = await CrmService.findLeadByName(workspaceId, String(proposal.leadName ?? ""));
          if (!lead) return { success: false, message: `No lead matching "${proposal.leadName}" found.` };
          const result = await BdrEngineService.analyzeLeadIntent({ workspaceId, leadId: lead.id });
          if (!result) return { success: false, message: "Intent analysis failed." };
          return { success: true, message: `Intent score: **${result.score}/100** · Recommendation: **${result.recommendation}**\n\n${result.reasoning}`, revalidatePaths: ["/leads"] };
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
}
