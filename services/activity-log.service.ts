import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, contacts, deals, leads, projects, users, workspaceMemberships } from "@/db/schema";
import { collapseRuns, describeLog, type LogGroup } from "@/lib/activity-log";

// Mirrors logGroup() in lib/activity-log.ts, so the filter runs in SQL.
const AGENT = sql`(${auditLogs.action} ~ '^(AGENT|APPROVAL|TOOL_)' or ${auditLogs.entity} like 'AGENT%' or coalesce(${auditLogs.metadata}->>'via', '') = 'agent_tool')`;
const TEAM = ["INVITE", "MEMBER", "MEMBER_ROLE", "WORKSPACE"];
const DEALS = ["DEAL", "PROJECT", "TASK", "LEAD_TO_DEAL"];

function groupWhere(group: LogGroup) {
  if (group === "agent") return AGENT;
  const human = sql`not ${AGENT}`;
  if (group === "team") return and(human, inArray(auditLogs.entity, TEAM));
  if (group === "deals") return and(human, inArray(auditLogs.entity, DEALS));
  if (group === "leads") return and(human, sql`${auditLogs.entity} not in (${sql.join([...TEAM, ...DEALS].map((e) => sql`${e}`), sql`, `)})`);
  return human;
}

const fullName = (u: { firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(" ") || null;

export class ActivityLogService {
  /** Latest entries in plain English, with the record or person each one is about. */
  static async list(workspaceId: string, group: LogGroup, limit = 50) {
    // Fetch extra: runs of the same action (a discovery import) fold into one line below.
    const rows = await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.workspaceId, workspaceId), groupWhere(group)),
      orderBy: [desc(auditLogs.createdAt)],
      limit: limit * 20,
      with: { actor: { columns: { firstName: true, lastName: true } } },
    });

    const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity).map((r) => r.entityId))].filter((id) => /^[0-9a-f-]{36}$/.test(id));
    const leadIds = [...new Set([...ids("LEAD"), ...ids("LEAD_TO_DEAL")])];
    // People an entry is about: the receiver of an assignment, a re-roled or removed member.
    const personIds = [
      ...ids("LEAD_BATCH"),
      ...rows.flatMap((r) => (r.entity === "MEMBER" ? [String((r.metadata as { removedUserId?: string } | null)?.removedUserId ?? "")] : [])),
    ].filter((id) => /^[0-9a-f-]{36}$/.test(id));
    const membershipIds = ids("MEMBER_ROLE");
    const none = Promise.resolve([] as { id: string; name: string | null }[]);

    const [leadNames, dealNames, companyNames, contactNames, projectNames, people, roleChanges] = await Promise.all([
      leadIds.length
        ? db.select({ id: leads.id, name: companies.name }).from(leads).leftJoin(companies, eq(companies.id, leads.companyId)).where(inArray(leads.id, leadIds))
        : none,
      ids("DEAL").length ? db.select({ id: deals.id, name: deals.name }).from(deals).where(inArray(deals.id, ids("DEAL"))) : none,
      ids("COMPANY").length ? db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids("COMPANY"))) : none,
      ids("CONTACT").length
        ? db
            .select({ id: contacts.id, name: sql<string>`trim(concat(${contacts.firstName}, ' ', ${contacts.lastName}))` })
            .from(contacts)
            .where(inArray(contacts.id, ids("CONTACT")))
        : none,
      ids("PROJECT").length ? db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids("PROJECT"))) : none,
      personIds.length ? db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, personIds)) : Promise.resolve([]),
      membershipIds.length
        ? db
            .select({ id: workspaceMemberships.id, firstName: users.firstName, lastName: users.lastName })
            .from(workspaceMemberships)
            .innerJoin(users, eq(users.id, workspaceMemberships.userId))
            .where(inArray(workspaceMemberships.id, membershipIds))
        : Promise.resolve([]),
    ]);
    const names = new Map<string, string | null>([...leadNames, ...dealNames, ...companyNames, ...contactNames, ...projectNames].map((r) => [r.id, r.name]));
    const persons = new Map([...people, ...roleChanges].map((p) => [p.id, fullName(p)]));

    const lines = rows.map((r) => {
      const personKey = r.entity === "MEMBER" ? String((r.metadata as { removedUserId?: string } | null)?.removedUserId ?? "") : r.entityId;
      return {
        id: r.id,
        action: r.action,
        actor: fullName(r.actor ?? { firstName: null, lastName: null }) ?? "System",
        text: describeLog(r, names.get(r.entityId) ?? null, persons.get(personKey) ?? null),
        at: r.createdAt,
        entity: r.entity,
        actorId: r.actorId,
        name: names.get(r.entityId) ?? null,
      };
    });
    return collapseRuns(lines).slice(0, limit);
  }
}
