import { db } from "@/db";
import {
  activities,
  deals,
  leads,
  projects,
  tasks,
  companies,
  contacts,
  users,
} from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

export interface CalendarEvent {
  id: string; // unique per calendar entry (may differ from source row id)
  sourceId: string;
  kind: "MEETING" | "TASK" | "DEAL_CLOSE" | "FOLLOW_UP" | "PROJECT_DUE";
  title: string;
  when: string; // ISO timestamp
  allDay: boolean;
  /** Link target for the underlying record, when one exists. */
  href: string | null;
  /** Context line, e.g. company name or deal value. */
  context: string | null;
}

export interface CalendarMonth {
  year: number;
  month: number; // 1-12
  events: CalendarEvent[];
  counts: Record<CalendarEvent["kind"], number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Workspace-scoped calendar feed. Aggregates every dated commitment the
 * agency has in the database for one month — no fabricated data:
 *
 *  - MEETING     activities with type=MEETING (occurredAt is the scheduled time)
 *  - TASK        open tasks with a dueAt
 *  - DEAL_CLOSE  open deals with an expectedCloseDate
 *  - FOLLOW_UP   active leads with nextFollowUpAt (not CONVERTED/LOST)
 *  - PROJECT_DUE active projects with a dueDate
 *
 * Meetings that were logged with a past occurredAt remain in the feed — the
 * grid distinguishes upcoming vs. completed via `when`.
 */
export class CalendarService {
  static async getMonth(workspaceId: string, year: number, month: number): Promise<CalendarMonth> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [
      meetingRows,
      taskRows,
      dealRows,
      leadRows,
      projectRows,
    ] = await Promise.all([
      db
        .select({
          id: activities.id,
          title: activities.title,
          description: activities.description,
          occurredAt: activities.occurredAt,
          dealName: deals.name,
          companyName: companies.name,
          contactFirst: contacts.firstName,
          contactLast: contacts.lastName,
          actorFirst: users.firstName,
        })
        .from(activities)
        .leftJoin(deals, eq(activities.dealId, deals.id))
        .leftJoin(companies, eq(deals.companyId, companies.id))
        .leftJoin(contacts, eq(activities.contactId, contacts.id))
        .leftJoin(users, eq(activities.actorId, users.id))
        .where(
          and(
            eq(activities.workspaceId, workspaceId),
            eq(activities.type, "MEETING"),
            gte(activities.occurredAt, start),
            lt(activities.occurredAt, end)
          )
        ),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          priority: tasks.priority,
          dueAt: tasks.dueAt,
          dealName: deals.name,
          leadCompany: companies.name,
        })
        .from(tasks)
        .leftJoin(deals, eq(tasks.dealId, deals.id))
        .leftJoin(leads, eq(tasks.leadId, leads.id))
        .leftJoin(companies, eq(leads.companyId, companies.id))
        .where(
          and(
            eq(tasks.workspaceId, workspaceId),
            eq(tasks.status, "OPEN"),
            sql`${tasks.dueAt} is not null`,
            gte(tasks.dueAt, start),
            lt(tasks.dueAt, end)
          )
        ),
      db
        .select({
          id: deals.id,
          name: deals.name,
          value: deals.value,
          expectedCloseDate: deals.expectedCloseDate,
          companyName: companies.name,
        })
        .from(deals)
        .leftJoin(companies, eq(deals.companyId, companies.id))
        .where(
          and(
            eq(deals.workspaceId, workspaceId),
            sql`${deals.stage} not in ('WON','LOST')`,
            sql`${deals.expectedCloseDate} is not null`,
            gte(deals.expectedCloseDate, start),
            lt(deals.expectedCloseDate, end)
          )
        ),
      db
        .select({
          id: leads.id,
          companyName: companies.name,
          contactFirst: contacts.firstName,
          contactLast: contacts.lastName,
          nextFollowUpAt: leads.nextFollowUpAt,
        })
        .from(leads)
        .leftJoin(companies, eq(leads.companyId, companies.id))
        .leftJoin(contacts, eq(leads.contactId, contacts.id))
        .where(
          and(
            eq(leads.workspaceId, workspaceId),
            sql`${leads.status} not in ('CONVERTED','LOST')`,
            sql`${leads.nextFollowUpAt} is not null`,
            gte(leads.nextFollowUpAt, start),
            lt(leads.nextFollowUpAt, end)
          )
        ),
      db
        .select({
          id: projects.id,
          name: projects.name,
          code: projects.code,
          dueDate: projects.dueDate,
        })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            sql`${projects.status} not in ('DELIVERED','CANCELLED')`,
            sql`${projects.dueDate} is not null`,
            gte(projects.dueDate, start),
            lt(projects.dueDate, end)
          )
        ),
    ]);

    const events: CalendarEvent[] = [];

    for (const m of meetingRows) {
      const who =
        m.contactFirst || m.contactLast
          ? [m.contactFirst, m.contactLast].filter(Boolean).join(" ")
          : m.companyName || m.dealName || null;
      events.push({
        id: `meeting-${m.id}`,
        sourceId: m.id,
        kind: "MEETING",
        title: m.title,
        when: m.occurredAt.toISOString(),
        allDay: false,
        href: m.dealName ? "/sales/deals" : "/sales/leads",
        context: who,
      });
    }

    for (const t of taskRows) {
      events.push({
        id: `task-${t.id}`,
        sourceId: t.id,
        kind: "TASK",
        title: t.title,
        when: (t.dueAt as Date).toISOString(),
        allDay: true,
        href: "/my-day",
        context: t.dealName || t.leadCompany || (t.priority === "URGENT" || t.priority === "HIGH" ? t.priority : null),
      });
    }

    for (const d of dealRows) {
      events.push({
        id: `deal-${d.id}`,
        sourceId: d.id,
        kind: "DEAL_CLOSE",
        title: `Close: ${d.name}`,
        when: (d.expectedCloseDate as Date).toISOString(),
        allDay: true,
        href: "/sales/pipeline",
        context: d.companyName || (d.value ? `$${Number(d.value).toLocaleString("en-US")}` : null),
      });
    }

    for (const l of leadRows) {
      const who =
        l.contactFirst || l.contactLast
          ? [l.contactFirst, l.contactLast].filter(Boolean).join(" ")
          : l.companyName || "Lead";
      events.push({
        id: `followup-${l.id}`,
        sourceId: l.id,
        kind: "FOLLOW_UP",
        title: `Follow up: ${who}`,
        when: (l.nextFollowUpAt as Date).toISOString(),
        allDay: true,
        href: "/sales/leads",
        context: l.companyName,
      });
    }

    for (const p of projectRows) {
      events.push({
        id: `project-${p.id}`,
        sourceId: p.id,
        kind: "PROJECT_DUE",
        title: `Due: ${p.name}`,
        when: (p.dueDate as Date).toISOString(),
        allDay: true,
        href: "/projects",
        context: p.code,
      });
    }

    events.sort((a, b) => a.when.localeCompare(b.when));

    const counts = { MEETING: 0, TASK: 0, DEAL_CLOSE: 0, FOLLOW_UP: 0, PROJECT_DUE: 0 };
    for (const e of events) counts[e.kind] += 1;

    return { year, month, events, counts };
  }

  /**
   * Upcoming meetings across all future dates — used for the "next meetings"
   * rail so the page shows commitments beyond the visible month.
   */
  static async getUpcomingMeetings(workspaceId: string, limit = 8) {
    const rows = await db
      .select({
        id: activities.id,
        title: activities.title,
        description: activities.description,
        occurredAt: activities.occurredAt,
        companyName: companies.name,
        contactFirst: contacts.firstName,
        contactLast: contacts.lastName,
      })
      .from(activities)
      .leftJoin(deals, eq(activities.dealId, deals.id))
      .leftJoin(companies, eq(deals.companyId, companies.id))
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .where(
        and(
          eq(activities.workspaceId, workspaceId),
          eq(activities.type, "MEETING"),
          gte(activities.occurredAt, new Date(Date.now() - DAY_MS))
        )
      )
      .orderBy(activities.occurredAt)
      .limit(limit);

    return rows.map((m) => {
      const who =
        m.contactFirst || m.contactLast
          ? [m.contactFirst, m.contactLast].filter(Boolean).join(" ")
          : m.companyName || null;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        occurredAt: m.occurredAt,
        context: who,
      };
    });
  }
}
