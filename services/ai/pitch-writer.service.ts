/**
 * Per-lead outreach pitch writer: drafts a WhatsApp message and an email from
 * the lead's real CRM data (name, area, website status). Calls use the fixed
 * script in lib/call-script.ts instead.
 * Drafts only — nothing is sent from here; the operator sends manually.
 */

import { db } from "@/db";
import { companies, contacts, discoveryCandidates, leads } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { LlmService } from "./llm.service";

export type PitchTone = "friendly" | "professional";
export type PitchLanguage = "english" | "hinglish" | "hindi";

export interface PitchOptions {
  offer: string;
  senderName: string;
  tone: PitchTone;
  language: PitchLanguage;
}

export interface LeadPitchContext {
  leadId: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  area: string | null;
  category: string | null;
  website: string | null;
  websiteStatus: string | null;
}

export interface LeadPitch {
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
  engine: "llm" | "template";
}

const WEBSITE_FACT: Record<string, string> = {
  NO_WEBSITE: "has no website",
  BROKEN_WEBSITE: "has a website that doesn't load",
  POOR_WEBSITE: "has a basic, outdated website",
  BASIC_WEBSITE: "has a simple website",
  GOOD_WEBSITE: "already has a good website",
};

const LANGUAGE_RULE: Record<PitchLanguage, string> = {
  english: "Write in simple, natural Indian English.",
  hinglish: "Write in Hinglish (Hindi words in Latin script mixed with English), the way small-business owners in India text.",
  hindi: "Write in Hindi (Devanagari script), simple and conversational.",
};

export class PitchWriterService {
  static async getContext(workspaceId: string, leadId: string): Promise<LeadPitchContext | null> {
    const [row] = await db
      .select({
        leadId: leads.id,
        businessName: companies.name,
        companyWebsite: companies.website,
        companyLocation: companies.location,
        industry: companies.industry,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        contactPhone: contacts.phone,
        contactEmail: contacts.email,
      })
      .from(leads)
      .innerJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)))
      .limit(1);
    if (!row) return null;

    const [candidate] = await db
      .select({
        address: discoveryCandidates.address,
        city: discoveryCandidates.city,
        phone: discoveryCandidates.phone,
        category: discoveryCandidates.category,
        websiteStatus: discoveryCandidates.websiteStatus,
      })
      .from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.leadId, leadId), eq(discoveryCandidates.workspaceId, workspaceId)))
      .orderBy(desc(discoveryCandidates.createdAt))
      .limit(1);

    const contactName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    return {
      leadId: row.leadId,
      businessName: row.businessName,
      // Placeholder names from imports ("Operator", "Unknown") aren't real people.
      contactName: contactName && !/^(operator|unknown|n\/a|team\b.*)$/i.test(contactName) ? contactName : null,
      phone: row.contactPhone || candidate?.phone || null,
      email: row.contactEmail || null,
      area: row.companyLocation || candidate?.address || candidate?.city || null,
      category: row.industry || candidate?.category || null,
      website: row.companyWebsite || null,
      websiteStatus: candidate?.websiteStatus ?? (row.companyWebsite ? null : "NO_WEBSITE"),
    };
  }

  static async write(ctx: LeadPitchContext, opts: PitchOptions): Promise<LeadPitch> {
    if (LlmService.getStatus().available) {
      const drafted = await PitchWriterService.writeWithLlm(ctx, opts);
      if (drafted) return drafted;
    }
    return PitchWriterService.template(ctx, opts);
  }

  private static facts(ctx: LeadPitchContext): string[] {
    return [
      `Business name: ${ctx.businessName}`,
      ctx.category ? `Type of business: ${ctx.category}` : null,
      ctx.area ? `Location: ${ctx.area}` : null,
      ctx.contactName ? `Owner/contact name: ${ctx.contactName}` : "Owner/contact name: unknown (do not invent one)",
      ctx.websiteStatus && WEBSITE_FACT[ctx.websiteStatus]
        ? `Website: the business ${WEBSITE_FACT[ctx.websiteStatus]}${ctx.website ? ` (${ctx.website})` : ""}`
        : ctx.website
          ? `Website: ${ctx.website}`
          : null,
    ].filter((f): f is string => f !== null);
  }

  private static async writeWithLlm(ctx: LeadPitchContext, opts: PitchOptions): Promise<LeadPitch | null> {
    const system = `You write short, honest cold-outreach drafts for a small agency in India contacting local businesses.
Rules:
- Use ONLY the facts provided. Never invent statistics, results, prices, clients, testimonials, reviews, or the owner's name.
- Be specific to this business (name, area, website situation). No generic marketing fluff, no hype words.
- Tone: ${opts.tone === "friendly" ? "warm, casual and respectful, like a local person reaching out" : "polite and professional, but still brief and human"}.
- ${LANGUAGE_RULE[opts.language]}
- whatsapp: under 500 characters, 2-4 short lines, introduce the sender, one concrete reason for reaching out, end with a low-pressure yes/no question. At most one emoji.
- emailSubject: under 60 characters, no clickbait.
- emailBody: under 120 words, signed with the sender name.
Respond with a single JSON object: {"whatsapp": string, "emailSubject": string, "emailBody": string}.`;

    const user = `SENDER: ${opts.senderName}
WHAT WE OFFER: ${opts.offer}

LEAD FACTS:
${PitchWriterService.facts(ctx).map((f) => `- ${f}`).join("\n")}

Write the three drafts now.`;

    // Free models occasionally return malformed drafts; one retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await LlmService.completeJson(system, user);
      if (!result.ok || !result.text) continue;
      const pitch = PitchWriterService.parseDrafts(LlmService.parseJsonLoose(result.text));
      if (pitch) return pitch;
    }
    return null;
  }

  private static parseDrafts(parsed: Record<string, unknown> | null): LeadPitch | null {
    // Models sometimes return a draft as {"Greeting": "...", ...} instead of one string.
    const text = (v: unknown): string | null => {
      if (typeof v === "string") return v.trim() || null;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const lines = Object.entries(v as Record<string, unknown>)
          .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(" / ") : String(val)}`)
          .join("\n\n");
        return lines.trim() || null;
      }
      return null;
    };
    const whatsapp = text(parsed?.whatsapp)?.slice(0, 1200);
    const emailSubject = text(parsed?.emailSubject)?.slice(0, 120);
    const emailBody = text(parsed?.emailBody)?.slice(0, 3000);
    if (!whatsapp || !emailSubject || !emailBody) return null;
    return { whatsapp, emailSubject, emailBody, engine: "llm" };
  }

  /** No-AI fallback built strictly from known facts. */
  private static template(ctx: LeadPitchContext, opts: PitchOptions): LeadPitch {
    const greeting = ctx.contactName ? `Hi ${ctx.contactName.split(" ")[0]}` : "Hi";
    const where = ctx.area ? ` in ${ctx.area.split(",")[0]}` : "";
    const websiteLine =
      ctx.websiteStatus === "NO_WEBSITE"
        ? `I noticed ${ctx.businessName} doesn't have a website yet, so people searching online${where} can't easily find you.`
        : ctx.websiteStatus === "BROKEN_WEBSITE"
          ? `I noticed the ${ctx.businessName} website isn't loading right now, so people searching online can't reach you.`
          : ctx.websiteStatus === "POOR_WEBSITE"
            ? `I came across the ${ctx.businessName} website and think it could bring you a lot more enquiries.`
            : `I came across ${ctx.businessName}${where} and wanted to reach out.`;

    const whatsapp = `${greeting}, I'm ${opts.senderName}. ${websiteLine}\n\n${opts.offer}\n\nWould you be open to a quick chat this week?`;

    return {
      whatsapp,
      emailSubject: `A website idea for ${ctx.businessName}`.slice(0, 60),
      emailBody: `${greeting},\n\n${websiteLine}\n\n${opts.offer}\n\nWould you be open to a 10-minute call this week?\n\nBest,\n${opts.senderName}`,
      engine: "template",
    };
  }
}
