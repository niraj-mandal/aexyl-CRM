"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, contacts, leads } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";
import { LlmService } from "@/services/ai/llm.service";

/**
 * AI Call Script (pitch: "Built-In Call Scripts / Pre-filled outreach scripts
 * for every lead"). Generates a per-lead phone script grounded in the lead's
 * REAL CRM data — company, contact, temperature, score, source, notes, and the
 * discovery signals (rating, no-website hook) when present.
 *
 * Honesty rules, same as the rest of the AI layer:
 *  - LLM unavailable → deterministic script from the same real fields (never
 *    fabricated "facts"), clearly labeled heuristic.
 *  - The script is a CONVERSATION AID, not verified facts — the UI says so.
 *  - Generation is audited.
 */

export interface CallScript {
  opener: string;
  discoveryQuestions: string[];
  pitch: string;
  objectionHandling: { objection: string; response: string }[];
  close: string;
  source: "llm" | "heuristic";
}

function buildContextBlock(input: {
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  temperature: string;
  score: number;
  status: string;
  stage: string | null;
  source: string | null;
  notes: string | null;
}): string {
  return [
    `Company: ${input.companyName}`,
    input.contactName ? `Contact: ${input.contactName}` : "Contact: (none on file)",
    input.email ? `Email: ${input.email}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    `Temperature: ${input.temperature}`,
    `Score: ${input.score}`,
    `Status: ${input.status}`,
    input.stage ? `Stage: ${input.stage}` : null,
    input.source ? `Source: ${input.source}` : null,
    input.notes ? `Notes: ${input.notes.slice(0, 600)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function heuristicScript(input: {
  companyName: string;
  contactName: string | null;
  temperature: string;
  score: number;
  notes: string | null;
}): CallScript {
  const greet = input.contactName ? `Hi ${input.contactName}` : `Hi, is this ${input.companyName}?`;
  const hook =
    input.notes?.match(/AI-generated[^:]*: ([^\n]+)/)?.[1] ??
    (input.temperature === "HOT"
      ? "you've been on our radar as a high-priority business"
      : "I'm reaching out to a select group of local businesses");
  return {
    opener: `${greet}, this is [YOUR NAME] from Aexyl. Did I catch you at an okay time? — Reason for the call: ${hook}.`,
    discoveryQuestions: [
      "How are new customers finding you today — walk-ins, word of mouth, online?",
      "Do you have a website, or does most of your booking happen over the phone?",
      "What's the biggest thing holding back growth right now?",
    ],
    pitch: `Keep it concrete: mention that businesses like ${input.companyName} typically win more bookings with a simple, professional web presence — no technical work on their side. Do NOT invent case studies, client names, or numbers.`,
    objectionHandling: [
      { objection: "\"We get enough business already.\"", response: "That's great — most of our clients said the same before a slow month. This is about making growth predictable, not just busy." },
      { objection: "\"How much is this?\"", response: "Depends on what you need — simplest option is a one-time setup, no monthly lock-in. Can I ask two quick questions to size it right?" },
      { objection: "\"Send me an email instead.\"", response: "Happy to — what's the best address, and what specifically should I include so it's actually useful?" },
    ],
    close: `"Would it make sense to do a quick walkthrough this week? I can show you exactly what this would look like for ${input.companyName} — 15 minutes, no commitment."`,
    source: "heuristic",
  };
}

export async function generateCallScriptAction(leadId: string): Promise<
  { ok: true; script: CallScript } | { ok: false; error: string }
> {
  const { workspaceId, userId } = await requireWorkspace();

  const [row] = await db
    .select({
      lead: leads,
      company: companies,
      contact: contacts,
    })
    .from(leads)
    .leftJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
    .limit(1);

  if (!row) return { ok: false, error: "Lead not found." };

  const input = {
    companyName: row.company?.name ?? "this business",
    contactName: row.contact ? `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim() : null,
    email: row.contact?.email ?? null,
    phone: row.contact?.phone ?? null,
    temperature: row.lead.temperature,
    score: row.lead.score,
    status: row.lead.status,
    stage: row.lead.stage,
    source: row.lead.source,
    notes: row.lead.notes,
  };

  let script: CallScript;
  const contextBlock = buildContextBlock(input);
  const result = await LlmService.completeJson(
    `You write phone call scripts for a small agency selling websites/digital presence to local businesses. Return STRICT JSON:
{"opener":"...","discoveryQuestions":["...","...","..."],"pitch":"...","objectionHandling":[{"objection":"...","response":"..."}],"close":"..."}
Rules: 2-4 objections. Ground EVERYTHING in the lead context — never invent ratings, reviews, case studies, client names, or numbers. If a fact isn't in the context, speak generically. Keep each field conversational (a person will read it aloud).`,
    `LEAD CONTEXT:\n${contextBlock}`
  );

  if (result.ok && result.text) {
    const parsed = LlmService.parseJsonLoose(result.text) as Partial<CallScript> | null;
    if (parsed?.opener && Array.isArray(parsed.discoveryQuestions) && parsed.pitch && parsed.close) {
      script = {
        opener: String(parsed.opener),
        discoveryQuestions: parsed.discoveryQuestions.map(String).slice(0, 5),
        pitch: String(parsed.pitch),
        objectionHandling: (parsed.objectionHandling ?? [])
          .filter((o): o is { objection: string; response: string } =>
            Boolean(o && typeof o === "object" && "objection" in o && "response" in o))
          .slice(0, 4),
        close: String(parsed.close),
        source: "llm",
      };
    } else {
      script = heuristicScript(input);
    }
  } else {
    script = heuristicScript(input);
  }

  await ActivityService.logAudit(workspaceId, userId, "GENERATE", "CALL_SCRIPT", leadId, {
    via: "ai",
    scriptSource: script.source,
  });

  return { ok: true, script };
}
