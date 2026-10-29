/**
 * Turns audit-log rows into plain English for Settings → Activity log, and sorts them into filter groups.
 * Agent background entries (runs, approval requests) form their own group, hidden by default.
 */
export const LOG_GROUPS = { all: "All", leads: "Leads", team: "Team", deals: "Deals", agent: "AI agents" } as const;
export type LogGroup = keyof typeof LOG_GROUPS;

const TEAM = new Set(["INVITE", "MEMBER", "MEMBER_ROLE", "WORKSPACE"]);
const DEALS = new Set(["DEAL", "PROJECT", "TASK", "LEAD_TO_DEAL"]);

export function logGroup(action: string, entity: string, metadata: unknown): Exclude<LogGroup, "all"> {
  const via = (metadata as { via?: string } | null)?.via;
  if (/^(AGENT|APPROVAL|TOOL_)/.test(action) || entity.startsWith("AGENT") || via === "agent_tool") return "agent";
  if (TEAM.has(entity)) return "team";
  if (DEALS.has(entity)) return "deals";
  return "leads";
}

type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const NOUN: Record<string, string> = {
  LEAD: "lead",
  DEAL: "deal",
  COMPANY: "company",
  CONTACT: "contact",
  PROJECT: "project",
  TASK: "task",
  ACTIVITY: "activity",
  EMAIL: "email",
  INVITE: "invite",
  FOLLOW_UP: "follow-up",
  ENROLLMENT: "sequence enrollment",
  CALL_SCRIPT: "call script",
  SHEET_IMPORT: "sheet import",
};
const VERB: Record<string, string> = {
  CREATE: "added",
  UPDATE: "updated",
  DELETE: "deleted",
  CONFIRM: "confirmed",
  GENERATE: "generated",
  APPROVE: "approved",
  REJECT: "rejected",
  ACCEPT: "accepted",
};

/**
 * One sentence without the actor ("deleted lead Tank's Gym"). `name` is the record's current name when it
 * still exists; deletes carry their own name in metadata.
 */
export function describeLog(row: { action: string; entity: string; metadata: unknown }, name: string | null, person: string | null): string {
  const m = (row.metadata ?? {}) as Meta;
  const label = name ?? str(m.name) ?? str(m.leadName) ?? str(m.dealName) ?? str(m.company) ?? null;
  const what = (noun: string) => (label ? `${noun} ${label}` : `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`);
  switch (`${row.action} ${row.entity}`) {
    case "ASSIGN LEAD_BATCH": {
      const place = str(m.city) ?? (m.state === "ALL" ? null : str(m.state));
      return `gave ${plural(num(m.leads) ?? 0, place ? `${place} lead` : "lead")} to ${person ?? "a teammate"}`;
    }
    case "DELETE MEMBER":
      return `removed ${person ?? "a team member"} from the team${num(m.leadsMoved) ? ` and took over their ${plural(num(m.leadsMoved)!, "lead")}` : ""}`;
    case "UPDATE MEMBER_ROLE":
      return `made ${person ?? "a team member"} ${str(m.role) === "Sales" ? "Sales" : "an admin"}`;
    case "CREATE INVITE":
      return `invited ${str(m.email) ?? "someone"}${str(m.role) ? ` as ${m.role}` : ""}`;
    case "ACCEPT INVITE":
      return "accepted their invite";
    case "APPROVE INVITE":
      return `approved ${str(m.email) ?? "a new member"}`;
    case "REJECT INVITE":
      return `rejected ${str(m.email) ?? "a join request"}`;
    case "DELETE INVITE":
      return `cancelled the invite for ${str(m.email) ?? "someone"}`;
    case "UPDATE WORKSPACE":
      return "changed workspace settings";
    case "AGENTIC_SWEEP LEAD_BATCH":
      return `ran the follow-up sweep (${plural(num(m.scheduled) ?? 0, "follow-up")} scheduled)`;
    case "CONVERT LEAD_TO_DEAL":
      return `turned ${what("lead")} into a deal`;
    case "UPDATE DEAL":
      return str(m.newStage) ? `moved ${what("deal")} to ${String(m.newStage).toLowerCase().replace(/_/g, " ")}` : `updated ${what("deal")}`;
    case "CREATE LEAD":
      return m.via === "ai_discovery" ? `added ${what("lead")} from discovery` : `added ${what("lead")}`;
    case "DELETE LEAD":
      return `deleted ${what("lead")}${str(m.reason) ? ` (${m.reason})` : ""}`;
    case "CREATE EMAIL":
      return `sent an email${str(m.to) ? ` to ${m.to}` : ""}`;
  }
  if (row.action.startsWith("AGENT_RUN_")) return `AI agent run ${row.action.slice(10).toLowerCase().replace(/_/g, " ")}`;
  if (row.action.startsWith("APPROVAL_")) return `AI action ${row.action.slice(9).toLowerCase()}${str(m.toolName) ? ` (${m.toolName})` : ""}`;
  const verb = VERB[row.action] ?? row.action.toLowerCase().replace(/_/g, " ");
  return `${verb} ${what(NOUN[row.entity] ?? row.entity.toLowerCase().replace(/_/g, " "))}`;
}

const RUN_VERB: Record<string, string> = { CREATE: "added", DELETE: "deleted", UPDATE: "updated" };

/**
 * Folds 3+ back-to-back entries by the same person with the same action on the same kind of record
 * within 30 minutes of each other (e.g. a discovery import of 29 gyms) into one line that names the first few.
 */
export function collapseRuns<T extends { actorId: string; action: string; entity: string; text: string; name: string | null; at: Date }>(lines: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    const same = (k: number) =>
      lines[k].actorId === lines[i].actorId &&
      lines[k].action === lines[i].action &&
      lines[k].entity === lines[i].entity &&
      // Separate imports stay separate lines: a 30-minute gap ends the run.
      Math.abs(lines[k - 1].at.getTime() - lines[k].at.getTime()) <= 30 * 60_000;
    while (j < lines.length && same(j)) j++;
    const run = lines.slice(i, j);
    const noun = NOUN[lines[i].entity];
    if (run.length >= 3 && noun && RUN_VERB[lines[i].action]) {
      const named = run.map((r) => r.name).filter(Boolean).slice(0, 3);
      const rest = run.length - named.length;
      out.push({
        ...run[0],
        text: `${RUN_VERB[lines[i].action]} ${plural(run.length, noun)}${named.length ? `: ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}` : ""}`,
      });
    } else out.push(...run);
    i = j;
  }
  return out;
}
