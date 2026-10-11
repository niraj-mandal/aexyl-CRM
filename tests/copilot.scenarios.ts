/**
 * Aexyl Copilot scenario tests — persona grounding + write-action safety.
 *
 * Runs against the real database with a dedicated ephemeral workspace (same
 * harness pattern as tests/agents.scenarios.ts) so it never touches live data.
 * Covers the copilot spec's critical flows:
 *
 *   1. Write-action token: issue → execute → success + audit row (via="copilot")
 *   2. Token is single-use (replay fails)
 *   3. Unknown/garbage tokens fail identically (no oracle)
 *   4. Workspace/session isolation (cross-workspace token rejected)
 *   5. Fast-confirm gate (anti-stray-click) burns the token
 *   6. Snapshot grounding: lead analysis answer only cites snapshot fields
 *   7. Proposal normalization: aliases accepted, broken payloads dropped
 *   9. Sheet parse + header auto-map (csv/xlsx, value shapes, URL conversion)
 *  10. Sheet sessions + import-intent routing (binding, no-oracle, no hijack)
 *  11. IMPORT_SHEET_LEADS end-to-end (rows, dedupe, audits, re-import)
 *
 * Usage: npx tsx --env-file=.env.local tests/copilot.scenarios.ts
 * Exit code 0 = all scenarios passed.
 */
import { db } from "@/db";
import {
  workspaces,
  roles,
  workspaceMemberships,
  users,
  companies,
  contacts,
  leads,
  auditLogs,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import {
  CopilotWriteService,
  isWriteKind,
  normalizeWriteProposal,
  summarizeProposal,
  type CopilotWriteProposal,
} from "@/services/ai/copilot-writes";
import { SheetImportService, type ParsedSheet } from "@/services/ai/sheet-import.service";
import { AiAgentService } from "@/services/ai/ai-agent.service";
import * as XLSX from "xlsx";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\nAEXYL COPILOT SCENARIO TESTS\n===========================");

  // --- isolated test workspace + operator -----------------------------------
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Copilot Scenario Tests", slug: `copilot-tests-${Date.now()}` })
    .returning();
  const ws2 = (await db
    .insert(workspaces)
    .values({ name: "Copilot Tests Other WS", slug: `copilot-tests-b-${Date.now()}` })
    .returning())[0];

  const [role] = await db
    .insert(roles)
    .values({ workspaceId: ws.id, name: "Test Owner" })
    .returning();

  const clerkId = `copilot-test-${Date.now()}`;
  const [operator] = await db
    .insert(users)
    .values({ clerkId, email: `${clerkId}@aexyl.test`, firstName: "Copilot", lastName: "Tester" })
    .returning();

  await db.insert(workspaceMemberships).values({
    userId: operator.id,
    workspaceId: ws.id,
    roleId: role.id,
  });

  const [company] = await db
    .insert(companies)
    .values({
      workspaceId: ws.id,
      name: "Scenario Fitness Co",
      industry: "gyms",
      status: "ACTIVE",
      ownerId: operator.id,
    })
    .returning();

  const [contact] = await db
    .insert(contacts)
    .values({
      workspaceId: ws.id,
      companyId: company.id,
      firstName: "Sam",
      lastName: "Prospect",
      email: "sam@scenariofitness.test",
    })
    .returning();

  const [lead] = await db
    .insert(leads)
    .values({
      workspaceId: ws.id,
      companyId: company.id,
      contactId: contact.id,
      status: "NEW",
      stage: "NEW",
      score: 20,
      temperature: "HOT",
      ownerId: operator.id,
    })
    .returning();

  try {
    // ---------------------------------------------------------------------
    // 1. CREATE_FOLLOW_UP: issue → execute → DB updated + audit row
    // ---------------------------------------------------------------------
    console.log("\n[1] CREATE_FOLLOW_UP end-to-end");
    const followUpProposal: CopilotWriteProposal = {
      kind: "CREATE_FOLLOW_UP",
      leadName: company.name,
      dueInDays: 3,
    };
    const token = CopilotWriteService.issue(followUpProposal, ws.id, operator.id);
    // The anti-stray-click gate rejects confirms younger than 2.5s — wait it out.
    await new Promise((r) => setTimeout(r, 2_600));
    const res = await CopilotWriteService.execute(token, ws.id, operator.id);
    check("execute succeeds", res.success, res.message);
    check("message names the lead", res.success && res.message.includes(company.name), res.message);
    check("revalidate paths suggested", Array.isArray(res.revalidatePaths) && res.revalidatePaths.includes("/my-day"));

    const [leadAfter] = await db.select().from(leads).where(eq(leads.id, lead.id));
    const scheduledAt = leadAfter.nextFollowUpAt ? new Date(leadAfter.nextFollowUpAt).getTime() : 0;
    const expectedAround = Date.now() + 3 * 86_400_000;
    check(
      "nextFollowUpAt set ~3 days out",
      Math.abs(scheduledAt - expectedAround) < 60_000,
      `got ${leadAfter.nextFollowUpAt}`,
    );

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.entityId, lead.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    check("audit row exists", Boolean(audit));
    check("audit action CREATE/FOLLOW_UP", audit?.action === "CREATE" && audit?.entity === "FOLLOW_UP", JSON.stringify(audit ? { action: audit.action, entity: audit.entity } : null));
    check("audit via=copilot", Boolean(audit && (audit.metadata as Record<string, unknown> | null)?.via === "copilot"));

    // ---------------------------------------------------------------------
    // 2. Replay: the spent token must fail
    // ---------------------------------------------------------------------
    console.log("\n[2] Token single-use");
    const replay = await CopilotWriteService.execute(token, ws.id, operator.id);
    check("replay fails", !replay.success, replay.message);
    const [leadAfterReplay] = await db.select().from(leads).where(eq(leads.id, lead.id));
    check(
      "no state change on replay",
      new Date(leadAfterReplay.nextFollowUpAt!).getTime() === scheduledAt,
    );

    // ---------------------------------------------------------------------
    // 3. Unknown tokens fail identically (no oracle)
    // ---------------------------------------------------------------------
    console.log("\n[3] Unknown token");
    const bogus1 = await CopilotWriteService.execute("not-a-real-token", ws.id, operator.id);
    const bogus2 = await CopilotWriteService.execute("", ws.id, operator.id);
    check("garbage token fails", !bogus1.success);
    check("empty token fails", !bogus2.success);
    check(
      "identical failure messages (no oracle)",
      bogus1.message === bogus2.message,
    );

    // ---------------------------------------------------------------------
    // 4. Session isolation: token bound to workspace + user
    // ---------------------------------------------------------------------
    console.log("\n[4] Session isolation");
    const token2 = CopilotWriteService.issue(
      { kind: "CREATE_FOLLOW_UP", leadName: company.name, dueInDays: 1 },
      ws.id,
      operator.id,
    );
    const crossWs = await CopilotWriteService.execute(token2, ws2.id, operator.id);
    check("cross-workspace execution rejected", !crossWs.success, crossWs.message);
    // Single-attempt semantics: ANY execute attempt pops the token (even a
    // failed cross-session probe), so a stolen token cannot be iterated on.
    const burned = await CopilotWriteService.execute(token2, ws.id, operator.id);
    check("token burned by first attempt (no probing)", !burned.success, burned.message);
    // A legitimate owner flow still works end-to-end.
    const token2b = CopilotWriteService.issue(
      { kind: "CREATE_FOLLOW_UP", leadName: company.name, dueInDays: 1 },
      ws.id,
      operator.id,
    );
    await new Promise((r) => setTimeout(r, 2_600));
    const legit = await CopilotWriteService.execute(token2b, ws.id, operator.id);
    check("legitimate owner execute succeeds", legit.success, legit.message);

    // ---------------------------------------------------------------------
    // 5. Fast-confirm gate burns the token
    // ---------------------------------------------------------------------
    console.log("\n[5] Anti-stray-click gate");
    const token3 = CopilotWriteService.issue(
      { kind: "CREATE_FOLLOW_UP", leadName: company.name, dueInDays: 1 },
      ws.id,
      operator.id,
    );
    const fast = await CopilotWriteService.execute(token3, ws.id, operator.id);
    check("sub-2.5s confirm rejected", !fast.success, fast.message);
    const afterFast = await CopilotWriteService.execute(token3, ws.id, operator.id);
    check("token burned by fast attempt", !afterFast.success, afterFast.message);

    // ---------------------------------------------------------------------
    // 6. UPDATE_DEAL_STAGE on a nonexistent deal fails honestly
    // ---------------------------------------------------------------------
    console.log("\n[6] Honest failure on missing entity");
    const token4 = CopilotWriteService.issue(
      { kind: "UPDATE_DEAL_STAGE", dealName: "Ghost Deal XYZ", stage: "WON" },
      ws.id,
      operator.id,
    );
    const res4 = await CopilotWriteService.execute(token4, ws.id, operator.id);
    check("fast confirm still rejected for stage proposal", !res4.success, res4.message);
    const token5 = CopilotWriteService.issue(
      { kind: "UPDATE_DEAL_STAGE", dealName: "Ghost Deal XYZ", stage: "WON" },
      ws.id,
      operator.id,
    );
    await new Promise((r) => setTimeout(r, 2_600));
    const res5 = await CopilotWriteService.execute(token5, ws.id, operator.id);
    check("missing deal → honest failure", !res5.success && res5.message.includes("Ghost Deal XYZ"), res5.message);

    // ---------------------------------------------------------------------
    // 7. Snapshot grounding: every company/lead the model could cite exists
    // ---------------------------------------------------------------------
    console.log("\n[7] Snapshot grounding");
    // Scenario [4]'s legitimate execute re-scheduled this lead — read current state.
    const [leadNow] = await db.select().from(leads).where(eq(leads.id, lead.id));
    const snapshot = await AiAgentService["buildWorkspaceSnapshot"](ws.id);
    check("snapshot exposes leads", snapshot.leads.length === 1);
    check("lead carries nextFollowUpAt", "nextFollowUpAt" in snapshot.leads[0]);
    check(
      "nextFollowUpAt is the scheduled date",
      snapshot.leads[0].nextFollowUpAt ===
        (leadNow.nextFollowUpAt ? new Date(leadNow.nextFollowUpAt).toISOString().slice(0, 10) : null),
      `snapshot=${snapshot.leads[0].nextFollowUpAt} db=${leadNow.nextFollowUpAt}`,
    );
    check("snapshot exposes companies", snapshot.companies.length === 1);

    // Deterministic tier must answer leads questions without an LLM.
    const det = await AiAgentService.processCopilotCommand(ws.id, "summarize my leads", []);
    check("deterministic tier answers", typeof det.answer === "string" && det.answer.length > 0);

    // ---------------------------------------------------------------------
    // 8. Proposal normalization: aliases + broken payloads
    // ---------------------------------------------------------------------
    console.log("\n[8] Proposal normalization");
    const good = normalizeWriteProposal("CREATE_FOLLOW_UP", { lead_name: " Some Co ", due_in_days: "5" });
    check("alias fields accepted", good?.leadName === "Some Co" && good?.dueInDays === 5, JSON.stringify(good));
    const broken = normalizeWriteProposal("CREATE_FOLLOW_UP", { dueInDays: 5 });
    check("missing leadName → null (card dropped)", broken === null);
    const brokenStage = normalizeWriteProposal("UPDATE_DEAL_STAGE", { deal: "X" });
    check("stage proposal without stage → null", brokenStage === null);

    // ---------------------------------------------------------------------
    // 9. Sheet parsing + header auto-map (pure, no DB)
    // ---------------------------------------------------------------------
    console.log("\n[9] Sheet parse + header auto-map");
    const csvRich = [
      "Company Name,Contact Name,Email,Phone,Website,City,Custom Field",
      "Acme Labs,Jane Doe,jane@acmelabs.io,+1 555 123 4567,acmelabs.io,Austin,hello world",
      "Beta Co,John Smith,john@betaco.com,,,Delhi,",
      ",,,,,,", // fully-empty row must be dropped
    ].join("\n");
    const rich = SheetImportService.parseSheetBuffer("rich.csv", new TextEncoder().encode(csvRich));
    check("csv parses", rich.ok, rich.ok ? "" : rich.error);
    if (rich.ok) {
      check("headers extracted", rich.sheet.headers.length === 7, JSON.stringify(rich.sheet.headers));
      check("empty rows dropped", rich.sheet.rows.length === 2, String(rich.sheet.rows.length));
      const cands = SheetImportService.mapRowsToCandidates(rich.sheet);
      check("every data row mapped", cands.length === 2, String(cands.length));
      const [a, b] = cands;
      check(
        "company/contact/email mapped",
        a?.companyName === "Acme Labs" && a?.contactName === "Jane Doe" && a?.emails[0] === "jane@acmelabs.io",
        JSON.stringify(a),
      );
      check("phone/location mapped", a?.phones[0] === "+1 555 123 4567" && a?.location === "Austin", JSON.stringify(a));
      check("website normalized to https", a?.website === "https://acmelabs.io", a?.website ?? "none");
      check("unmatched column preserved", (a?.description ?? "").includes("Custom Field: hello world"), a?.description ?? "none");
      check("company row maps", b?.companyName === "Beta Co" && b?.emails[0] === "john@betaco.com", JSON.stringify(b));
      check("sheet rows carry WARM priority", a?.priority === "Warm");
    }

    // People-only sheet: bare "Name" becomes the company.
    const people = SheetImportService.parseSheetBuffer(
      "people.csv",
      new TextEncoder().encode("Name,Email\nAda Lovelace,ada@example.com"),
    );
    if (people.ok) {
      const [p] = SheetImportService.mapRowsToCandidates(people.sheet);
      check("bare Name → company", p?.companyName === "Ada Lovelace", p?.companyName ?? "none");
    } else {
      check("people csv parses", false, people.error);
    }

    // Company sheet: bare "Name" becomes the contact.
    const coSheet = SheetImportService.parseSheetBuffer(
      "co.csv",
      new TextEncoder().encode("Company,Name,Email\nZeta Inc,Carol Chan,carol@zeta.test"),
    );
    if (coSheet.ok) {
      const [p] = SheetImportService.mapRowsToCandidates(coSheet.sheet);
      check(
        "Name with Company column → contact",
        p?.companyName === "Zeta Inc" && p?.contactName === "Carol Chan",
        JSON.stringify(p),
      );
    } else {
      check("company csv parses", false, coSheet.error);
    }

    // Real-world domain-prefixed headers (the live Jorhat sheet broke on
    // "Gym Name" before this rule existed).
    const gymSheet = SheetImportService.parseSheetBuffer(
      "gym.csv",
      new TextEncoder().encode(
        "Gym Name,Address,Contact Number,Rating\nFitness Palace - Gym & MMA,JB Rd Jorhat Assam,+91 60013 51963,4.5\nOX GYM,Atilagaon Jorhat Assam,+91 88768 43608,",
      ),
    );
    if (gymSheet.ok) {
      const [g] = SheetImportService.mapRowsToCandidates(gymSheet.sheet);
      check(
        "Gym Name header → company",
        g?.companyName === "Fitness Palace - Gym & MMA" &&
          (g?.location ?? "").includes("Jorhat") &&
          g?.phones[0] === "+91 60013 51963",
        JSON.stringify(g),
      );
      check("unmatched Rating column preserved", (g?.description ?? "").includes("Rating: 4.5"), g?.description ?? "none");
    } else {
      check("gym csv parses", false, gymSheet.error);
    }

    // Anonymous columns rescued by value shapes (the Name column maps normally).
    const shape = SheetImportService.parseSheetBuffer(
      "shape.csv",
      new TextEncoder().encode(
        "Name,Anonymous1,Anonymous2\nAda Lovelace,alice@x.com,555-867-5309\nBob Builder,bob@y.com,555-222-3333",
      ),
    );
    if (shape.ok) {
      const [c] = SheetImportService.mapRowsToCandidates(shape.sheet);
      check(
        "value-shape fallback claims email/phone",
        c?.companyName === "Ada Lovelace" && c?.emails[0] === "alice@x.com" && c?.phones[0] === "555-867-5309",
        JSON.stringify(c),
      );
    } else {
      check("shape csv parses", false, shape.error);
    }

    // XLSX round-trip.
    const xa = XLSX.utils.aoa_to_sheet([["Company", "Email"], ["Xlsx Co", "x@xlsx.test"]]);
    const xwb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(xwb, xa, "Sheet1");
    const xbytes = new Uint8Array(XLSX.write(xwb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const xparsed = SheetImportService.parseSheetBuffer("book.xlsx", xbytes);
    check(
      "xlsx parses",
      xparsed.ok && xparsed.sheet.rows.length === 1 && xparsed.sheet.headers[0] === "Company",
      xparsed.ok ? "" : xparsed.error,
    );

    // Empty / header-only sheets fail honestly.
    const empty = SheetImportService.parseSheetBuffer("e.csv", new TextEncoder().encode(",,\n,,"));
    check("empty sheet → honest error", !empty.ok);
    const headerOnly = SheetImportService.parseSheetBuffer("h.csv", new TextEncoder().encode("A,B\n"));
    check("header-only sheet → honest error", !headerOnly.ok);

    // Sheets URL → CSV export conversion.
    const u1 = SheetImportService.sheetUrlToExport("https://docs.google.com/spreadsheets/d/1AbC_xyz-123/edit#gid=0&single=true");
    check("edit URL + gid → export csv with gid", u1 === "https://docs.google.com/spreadsheets/d/1AbC_xyz-123/export?format=csv&gid=0", u1 ?? "null");
    const u2 = SheetImportService.sheetUrlToExport("https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing");
    check("sharing URL → export csv", u2 === "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv", u2 ?? "null");
    check("non-Sheets URL rejected", SheetImportService.sheetUrlToExport("https://example.com/x") === null);

    // Batch dedupe: email first, else company::contact.
    const batchSheet: Pick<ParsedSheet, "fileName" | "headers" | "rows"> = {
      fileName: "batch.csv",
      headers: ["Company", "Name", "Email"],
      rows: [
        ["Dup Co", "Ann One", "ann@dup.test"],
        ["Dup Co", "Ann Clone", "ann@dup.test"], // same email → dup
        ["Other Co", "Bob", ""],
        ["Other Co", "Bob", ""], // identical company::contact → dup
        ["Third Co", "Cara", ""],
      ],
    };
    const batch = SheetImportService.dedupeBatch(SheetImportService.mapRowsToCandidates(batchSheet));
    check("batch dedupe by email + company::contact", batch.length === 3, String(batch.length));

    // ---------------------------------------------------------------------
    // 10. Sheet sessions + import-intent routing (deterministic)
    // ---------------------------------------------------------------------
    console.log("\n[10] Sheet sessions + routing");
    const sessionParsed = SheetImportService.parseSheetBuffer(
      "session.csv",
      new TextEncoder().encode("Name,Email\nAda Lovelace,ada@example.com"),
    );
    check("session csv parses", sessionParsed.ok, sessionParsed.ok ? "" : sessionParsed.error);
    if (sessionParsed.ok) {
      const s = SheetImportService.storeSession(ws.id, operator.id, sessionParsed.sheet);
      check("session stored + retrieved", SheetImportService.getSession(s.sheetId, ws.id, operator.id)?.rowCount === 1);
      check("foreign workspace rejected (no oracle)", SheetImportService.getSession(s.sheetId, ws2.id, operator.id) === null);
      check("foreign user rejected", SheetImportService.getSession(s.sheetId, ws.id, "someone-else") === null);
      check("unknown id rejected", SheetImportService.getSession("not-a-sheet", ws.id, operator.id) === null);

      const intent = AiAgentService["isSheetImportIntent"];
      check("sheet import phrase detected", intent("add all the data from the google sheet to the leads", false));
      check("quantifier+data phrase with attachment detected", intent("add all the data to the leads", true));
      check("attached sheet never hijacks ordinary writes", !intent("add this lead to the pipeline", true));
      check("ordinary ask is not a sheet import", !intent("what should I do today", true));
      check("discovery ask without sheet is not an import", !intent("find dental clinics in Austin", false));

      const noAttach = await AiAgentService.processCopilotCommand(
        ws.id,
        "add all the data from the google sheet to the leads",
        [],
        null,
      );
      check("import ask w/o attachment → attach hint", /attach/i.test(noAttach.answer), noAttach.answer);
      check("no import card without attachment", !noAttach.suggestedActions?.some((a) => a.actionType === "IMPORT_SHEET_LEADS"));

      const withAttach = await AiAgentService.processCopilotCommand(
        ws.id,
        "add all the data from the google sheet to the leads",
        [],
        s,
      );
      const card = withAttach.suggestedActions?.find((a) => a.actionType === "IMPORT_SHEET_LEADS");
      check("import ask w/ attachment → deterministic import card", Boolean(card), withAttach.answer);
      check("import card is a write kind", isWriteKind(card?.actionType ?? ""));
    }

    // ---------------------------------------------------------------------
    // 11. IMPORT_SHEET_LEADS end-to-end (token → rows + audits + idempotency)
    // ---------------------------------------------------------------------
    console.log("\n[11] IMPORT_SHEET_LEADS end-to-end");
    const csvImp = [
      "Company,Name,Email,Phone,Location",
      "Sheet Co One,Alice One,alice@sheetco.test,+1 555 000 0001,Portugal",
      "Sheet Co Two,Bob Two,bob@sheetco.test,,Berlin",
      "Sheet Co One,Alice Clone,alice@sheetco.test,,", // duplicate email inside the sheet
    ].join("\n");
    const impParsed = SheetImportService.parseSheetBuffer("sheet.csv", new TextEncoder().encode(csvImp));
    check("import csv parses", impParsed.ok, impParsed.ok ? "" : impParsed.error);
    if (impParsed.ok) {
      const s2 = SheetImportService.storeSession(ws.id, operator.id, impParsed.sheet);
      const normImp = normalizeWriteProposal("IMPORT_SHEET_LEADS", {});
      check("proposal normalizes from empty payload", normImp?.kind === "IMPORT_SHEET_LEADS");
      check(
        "proposal summary names file + rows",
        normImp !== null &&
          summarizeProposal({ ...normImp, sheetFileName: "sheet.csv", sheetRowCount: 3 }) ===
            "Import 3 rows from sheet.csv as leads",
      );

      const t1 = CopilotWriteService.issue(
        { kind: "IMPORT_SHEET_LEADS", sheetId: s2.sheetId, sheetFileName: s2.fileName, sheetRowCount: s2.rowCount },
        ws.id,
        operator.id,
      );
      await new Promise((r) => setTimeout(r, 2_600));
      const ex1 = await CopilotWriteService.execute(t1, ws.id, operator.id);
      check("import executes", ex1.success, ex1.message);
      check("message reports counts + duplicate", ex1.message.includes("Imported 2 of 3") && /duplicate/.test(ex1.message), ex1.message);
      check("revalidate paths suggested", Array.isArray(ex1.revalidatePaths) && ex1.revalidatePaths?.includes("/leads"));

      const wsLeads = await db.select().from(leads).where(eq(leads.workspaceId, ws.id));
      check("2 new leads created (1 seed + 2)", wsLeads.length === 3, String(wsLeads.length));
      const wsContacts = await db.select().from(contacts).where(eq(contacts.workspaceId, ws.id));
      check("contact names split from sheet", wsContacts.some((c) => c.firstName === "Alice" && c.lastName === "One"));
      const wsCompanies = await db.select().from(companies).where(eq(companies.workspaceId, ws.id));
      check(
        "companies created from sheet",
        wsCompanies.filter((c) => c.name.startsWith("Sheet Co")).length === 2,
        String(wsCompanies.length),
      );

      const [sheetAudit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.entity, "SHEET_IMPORT")))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      check(
        "SHEET_IMPORT summary audit via=copilot",
        sheetAudit?.action === "CREATE" && (sheetAudit?.metadata as Record<string, unknown> | null)?.via === "copilot",
      );
      check(
        "summary audit carries imported count",
        Number((sheetAudit?.metadata as Record<string, unknown> | null)?.imported) === 2,
      );

      const leadAudits = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.entity, "LEAD"), eq(auditLogs.action, "CREATE")));
      const sheetLeadAudits = leadAudits.filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return m?.via === "copilot" && m?.sheetFile === "sheet.csv";
      });
      check("per-lead audits via=copilot with sheetFile", sheetLeadAudits.length === 2, String(sheetLeadAudits.length));

      // Re-import the same session → idempotent (contact-email dedupe).
      const t2 = CopilotWriteService.issue(
        { kind: "IMPORT_SHEET_LEADS", sheetId: s2.sheetId, sheetFileName: s2.fileName, sheetRowCount: s2.rowCount },
        ws.id,
        operator.id,
      );
      await new Promise((r) => setTimeout(r, 2_600));
      const ex2 = await CopilotWriteService.execute(t2, ws.id, operator.id);
      check("re-import reports 0 of 3", ex2.success && ex2.message.includes("Imported 0 of 3"), ex2.message);
      const afterReimport = await db.select().from(leads).where(eq(leads.workspaceId, ws.id));
      check("no rows created on re-import", afterReimport.length === 3, String(afterReimport.length));

      // Second contact at an EXISTING sheet company → company reused, contact added.
      const again = SheetImportService.parseSheetBuffer(
        "sheet.csv",
        new TextEncoder().encode("Company,Name,Email\nSheet Co One,Carol Three,carol@sheetco.test"),
      );
      if (again.ok) {
        const s3 = SheetImportService.storeSession(ws.id, operator.id, again.sheet);
        const t3 = CopilotWriteService.issue(
          { kind: "IMPORT_SHEET_LEADS", sheetId: s3.sheetId, sheetFileName: s3.fileName, sheetRowCount: s3.rowCount },
          ws.id,
          operator.id,
        );
        await new Promise((r) => setTimeout(r, 2_600));
        const ex3 = await CopilotWriteService.execute(t3, ws.id, operator.id);
        check("second contact import succeeds", ex3.success && ex3.message.includes("Imported 1 of 1"), ex3.message);
        const coCount = await db
          .select()
          .from(companies)
          .where(and(eq(companies.workspaceId, ws.id), eq(companies.name, "Sheet Co One")));
        check("existing company reused (not duplicated)", coCount.length === 1, String(coCount.length));
        const carol = await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.workspaceId, ws.id), eq(contacts.email, "carol@sheetco.test")));
        check("new contact added under existing company", carol.length === 1, String(carol.length));
      } else {
        check("follow-up csv parses", false, again.error);
      }

      // Session bound to another workspace → honest failure, no writes.
      const sOther = SheetImportService.storeSession(ws2.id, operator.id, impParsed.sheet);
      const t4 = CopilotWriteService.issue(
        { kind: "IMPORT_SHEET_LEADS", sheetId: sOther.sheetId, sheetFileName: sOther.fileName, sheetRowCount: sOther.rowCount },
        ws.id,
        operator.id,
      );
      await new Promise((r) => setTimeout(r, 2_600));
      const ex4 = await CopilotWriteService.execute(t4, ws.id, operator.id);
      check("foreign sheet session rejected", !ex4.success && /attach/i.test(ex4.message), ex4.message);

      // Replay dies like every other write token.
      const replay = await CopilotWriteService.execute(t1, ws.id, operator.id);
      check("import token single-use", !replay.success, replay.message);
    }

    // ---------------------------------------------------------------------
  } finally {
    // --- teardown: remove every row this suite created ----------------------
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws.id));
    await db.delete(leads).where(eq(leads.workspaceId, ws.id));
    await db.delete(contacts).where(eq(contacts.workspaceId, ws.id));
    await db.delete(companies).where(eq(companies.workspaceId, ws.id));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, ws.id));
    await db.delete(roles).where(eq(roles.workspaceId, ws.id));
    await db.delete(users).where(eq(users.id, operator.id));
    await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    await db.delete(workspaces).where(eq(workspaces.id, ws2.id));
  }

  console.log(`\n===========================\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SCENARIO HARNESS ERROR:", err);
  process.exit(1);
});
