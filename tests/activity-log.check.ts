// Self-check for the Activity log wording and groups: `npx tsx tests/activity-log.check.ts`
import assert from "node:assert/strict";
import { collapseRuns, describeLog, logGroup } from "../lib/activity-log";

const row = (action: string, entity: string, metadata: unknown = null) => ({ action, entity, metadata });

assert.equal(describeLog(row("ASSIGN", "LEAD_BATCH", { state: "Punjab", city: null, leads: 409 }), null, "Nishan"), "gave 409 Punjab leads to Nishan");
assert.equal(describeLog(row("ASSIGN", "LEAD_BATCH", { state: "ALL", city: null, leads: 1 }), null, "Akash"), "gave 1 lead to Akash");
assert.equal(describeLog(row("DELETE", "LEAD", { reason: "no contact details" }), "Dojang", null), "deleted lead Dojang (no contact details)");
assert.equal(describeLog(row("DELETE", "DEAL"), null, null), "deleted a deal");
assert.equal(describeLog(row("CREATE", "INVITE", { email: "a@b.com", role: "Sales" }), null, null), "invited a@b.com as Sales");
assert.equal(describeLog(row("UPDATE", "DEAL", { newStage: "CALL_BOOKED" }), "Tank's Gym", null), "moved deal Tank's Gym to call booked");

assert.equal(logGroup("AGENT_RUN_COMPLETED", "AGENT_RUN", null), "agent");
assert.equal(logGroup("UPDATE", "LEAD", { via: "agent_tool" }), "agent");
assert.equal(logGroup("DELETE", "MEMBER", null), "team");
assert.equal(logGroup("DELETE", "DEAL", null), "deals");
assert.equal(logGroup("CREATE", "LEAD", { via: "ai_discovery" }), "leads");
const t0 = Date.parse("2026-10-30T10:00:00Z");
const line = (actorId: string, action: string, name: string, min = 0) => ({ actorId, action, entity: "LEAD", text: `x ${name}`, name, at: new Date(t0 - min * 60_000) });
const folded = collapseRuns([line("u1", "CREATE", "A"), line("u1", "CREATE", "B"), line("u1", "CREATE", "C"), line("u1", "CREATE", "D"), line("u2", "DELETE", "E")]);
assert.equal(folded.length, 2);
assert.equal(folded[0].text, "added 4 leads: A, B, C and 1 more");
assert.equal(collapseRuns([line("u1", "CREATE", "A"), line("u1", "CREATE", "B")]).length, 2);
// A 2-hour gap splits two imports.
assert.equal(collapseRuns([line("u1", "CREATE", "A"), line("u1", "CREATE", "B", 1), line("u1", "CREATE", "C", 2), line("u1", "CREATE", "D", 120), line("u1", "CREATE", "E", 121), line("u1", "CREATE", "F", 122)]).length, 2);
assert.equal(describeLog(row("CREATE", "ACTIVITY"), null, null), "added an activity");
console.log("activity-log: ok");
