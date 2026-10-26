/**
 * My Day planning, run on the server so the dashboard downloads only the ~20 gyms it shows,
 * not the whole lead list. Leads must arrive best-potential first (getOutreachLeadsAction).
 */
import type { OutreachLead } from "@/app/actions/outreach.actions";

const CLOSED = new Set(["CONVERTED", "LOST", "UNQUALIFIED"]);
export const NEW_PER_DAY = 15;
const HOT_RANK: Record<string, number> = { QUALIFIED: 3, CONTACTED: 2, NURTURE: 1, NEW: 0 };

/** Open leads closest to signing: furthest stage first, best potential within a stage. */
export function pickHotLeads(leads: OutreachLead[], limit = 6) {
  return leads
    .filter((l) => l.status in HOT_RANK)
    .sort((a, b) => HOT_RANK[b.status] - HOT_RANK[a.status]) // stable: keeps potential order
    .slice(0, limit);
}

/**
 * Today's follow-ups and the best never-contacted leads to pitch. `startOfToday` is the
 * caller's local midnight, so "today" follows the user's clock, not the server's.
 */
export function planToday(leads: OutreachLead[], startOfToday: Date) {
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000 - 1);
  const open = leads.filter((l) => !CLOSED.has(l.status));

  const followUps = open
    .filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= endOfToday)
    .sort((a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime());

  const contactedToday = leads.filter((l) => l.lastContactedAt && new Date(l.lastContactedAt) >= startOfToday).length;
  const neverContacted = open.filter((l) => !l.lastContactedAt && !followUps.includes(l));
  const reachable = neverContacted.filter((l) => l.phone || l.email);

  return {
    followUps,
    toContact: reachable.slice(0, NEW_PER_DAY),
    hot: pickHotLeads(leads),
    moreReachable: Math.max(0, reachable.length - NEW_PER_DAY),
    noContactCount: neverContacted.length - reachable.length,
    contactedToday,
  };
}

export type TodayPlan = ReturnType<typeof planToday>;
