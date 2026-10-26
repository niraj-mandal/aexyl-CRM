"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies, contacts, deals, discoveryCandidates, leads, projects } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";
import { leadCity, placeFromLeadSource } from "@/lib/maps";
import { normalizePhone } from "@/services/discovery/normalizer";
import { CrmService, LEAD_POTENTIAL_ORDER, ProjectService } from "@/services/crm.service";
import {
  PitchWriterService,
  type PitchLanguage,
  type PitchTone,
} from "@/services/ai/pitch-writer.service";

export interface OutreachLead {
  id: string;
  businessName: string;
  phone: string | null;
  email: string | null;
  area: string | null;
  websiteStatus: string | null;
  status: string;
  temperature: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  score: number;
  /** City to narrow a Google Maps lookup when the lead has no address. */
  place: string | null;
  city: string | null;
  /** Import notes (rating, reviews, web presence) that personalise the call script. */
  notes: string | null;
}

/** Leads for the pitch writer: contactable ones first, then newest. */
export async function getOutreachLeadsAction(): Promise<OutreachLead[]> {
  const { workspaceId } = await requireWorkspace();

  // One round trip: the discovery record (phone/address/website status) is joined in.
  const joined = await db
      .select({
        id: leads.id,
        businessName: companies.name,
        location: companies.location,
        website: companies.website,
        phone: contacts.phone,
        email: contacts.email,
        status: leads.status,
        temperature: leads.temperature,
        lastContactedAt: leads.lastContactedAt,
        nextFollowUpAt: leads.nextFollowUpAt,
        score: leads.score,
        source: leads.source,
        notes: leads.notes,
        candidateCity: discoveryCandidates.city,
        candidatePhone: discoveryCandidates.phone,
        candidateAddress: discoveryCandidates.address,
        candidateWebsiteStatus: discoveryCandidates.websiteStatus,
      })
      .from(leads)
      .innerJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(
        discoveryCandidates,
        and(eq(discoveryCandidates.leadId, leads.id), eq(discoveryCandidates.workspaceId, workspaceId)),
      )
      .where(eq(leads.workspaceId, workspaceId))
      // Same "best potential first" order as the Leads list, so My Day and Call session pick the best gyms.
      .orderBy(...LEAD_POTENTIAL_ORDER)
      .limit(800);

  // A lead can match more than one discovery record; keep the first.
  const seen = new Set<string>();
  const rows = joined.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  const list: OutreachLead[] = rows.map((r) => {
    const c = { phone: r.candidatePhone, address: r.candidateAddress, websiteStatus: r.candidateWebsiteStatus };
    return {
      id: r.id,
      businessName: r.businessName,
      phone: r.phone || c?.phone || null,
      email: r.email || null,
      area: r.location || c?.address || null,
      websiteStatus: c?.websiteStatus ?? (r.website ? null : "NO_WEBSITE"),
      status: r.status,
      temperature: r.temperature,
      lastContactedAt: r.lastContactedAt ? r.lastContactedAt.toISOString() : null,
      nextFollowUpAt: r.nextFollowUpAt ? r.nextFollowUpAt.toISOString() : null,
      score: r.score,
      place: r.location || c?.address || placeFromLeadSource(r.source),
      city: leadCity(r),
      notes: r.notes,
    };
  });
  list.sort((a, b) => Number(Boolean(b.phone || b.email)) - Number(Boolean(a.phone || a.email)));

  return list;
}

const TONES = new Set<PitchTone>(["friendly", "professional"]);
const LANGUAGES = new Set<PitchLanguage>(["english", "hinglish", "hindi"]);

export async function generatePitchAction(
  leadId: string,
  input: { offer: string; senderName: string; tone: string; language: string },
) {
  const { workspaceId } = await requireWorkspace();
  const ctx = await PitchWriterService.getContext(workspaceId, String(leadId));
  if (!ctx) return { ok: false as const, error: "Lead not found." };

  const offer = String(input.offer ?? "").trim().slice(0, 400);
  const senderName = String(input.senderName ?? "").trim().slice(0, 80);
  if (!offer) return { ok: false as const, error: "Describe what you offer first." };
  if (!senderName) return { ok: false as const, error: "Add your name so the message can introduce you." };

  const pitch = await PitchWriterService.write(ctx, {
    offer,
    senderName,
    tone: TONES.has(input.tone as PitchTone) ? (input.tone as PitchTone) : "friendly",
    language: LANGUAGES.has(input.language as PitchLanguage) ? (input.language as PitchLanguage) : "english",
  });
  return { ok: true as const, pitch, lead: { phone: ctx.phone, email: ctx.email, businessName: ctx.businessName } };
}

const CHANNELS = new Set(["WHATSAPP", "CALL", "EMAIL"]);

const FOLLOW_UP_AFTER_DAYS = 3;

/** Records that the operator reached out (they send the message themselves). */
export async function markContactedAction(leadId: string, channel: string, message?: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const ch = CHANNELS.has(channel) ? channel : "WHATSAPP";

  const [lead] = await db
    .select({ id: leads.id, status: leads.status, contactId: leads.contactId })
    .from(leads)
    .where(and(eq(leads.id, String(leadId)), eq(leads.workspaceId, workspaceId)))
    .limit(1);
  if (!lead) return { ok: false as const, error: "Lead not found." };

  const now = new Date();
  await db
    .update(leads)
    .set({
      lastContactedAt: now,
      // Most replies come on the 2nd–3rd touch, so every contact queues the next one.
      nextFollowUpAt: new Date(now.getTime() + FOLLOW_UP_AFTER_DAYS * 86_400_000),
      status: lead.status === "NEW" ? "CONTACTED" : lead.status,
      updatedAt: now,
    })
    .where(and(eq(leads.id, lead.id), eq(leads.workspaceId, workspaceId)));

  await ActivityService.createActivity(workspaceId, {
    workspaceId,
    leadId: lead.id,
    contactId: lead.contactId,
    actorId: userId,
    type: "OUTREACH",
    title: `Outreach via ${ch === "CALL" ? "phone call" : ch === "EMAIL" ? "email" : "WhatsApp"}`,
    description: message ? String(message).slice(0, 2000) : null,
    metadata: { channel: ch, source: "pitch_writer" },
  });

  revalidatePath("/outreach");
  revalidatePath("/sales/leads");
  return { ok: true as const, contactedAt: now.toISOString() };
}

/** Reverses "reached out" (the Leads tick box): back to New, follow-up cleared. History is kept. */
export async function unmarkContactedAction(leadId: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const [lead] = await db
    .select({ id: leads.id, status: leads.status, contactId: leads.contactId })
    .from(leads)
    .where(and(eq(leads.id, String(leadId)), eq(leads.workspaceId, workspaceId)))
    .limit(1);
  if (!lead) return { ok: false as const, error: "Lead not found." };

  await db
    .update(leads)
    .set({
      lastContactedAt: null,
      nextFollowUpAt: null,
      // Only undo the automatic NEW → CONTACTED step; later stages were set on purpose.
      status: lead.status === "CONTACTED" ? "NEW" : lead.status,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, lead.id), eq(leads.workspaceId, workspaceId)));

  await ActivityService.createActivity(workspaceId, {
    workspaceId,
    leadId: lead.id,
    contactId: lead.contactId,
    actorId: userId,
    type: "NOTE",
    title: "Marked as not reached out",
    metadata: { source: "reach_toggle" },
  });

  revalidatePath("/sales/leads");
  revalidatePath("/");
  return { ok: true as const, message: "Unticked. Back to New." };
}

/** Saves a phone number found manually (e.g. via Google Maps) onto the lead's contact. */
export async function setLeadPhoneAction(leadId: string, rawPhone: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const digits = String(rawPhone ?? "").replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(digits)) return { ok: false as const, error: "Enter a valid phone number (7–15 digits)." };
  const phone = normalizePhone(digits) ?? digits;

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, String(leadId)), eq(leads.workspaceId, workspaceId)),
    with: { company: { columns: { name: true } } },
  });
  if (!lead) return { ok: false as const, error: "Lead not found." };

  const now = new Date();
  if (lead.contactId) {
    await db
      .update(contacts)
      .set({ phone, updatedAt: now })
      .where(and(eq(contacts.id, lead.contactId), eq(contacts.workspaceId, workspaceId)));
  } else {
    const [contact] = await db
      .insert(contacts)
      .values({ workspaceId, companyId: lead.companyId, firstName: `Team ${lead.company?.name ?? "Lead"}`, phone })
      .returning({ id: contacts.id });
    await db.update(leads).set({ contactId: contact.id, updatedAt: now }).where(eq(leads.id, lead.id));
  }

  await ActivityService.logAudit(workspaceId, userId, "UPDATE", "LEAD", lead.id, { phone });
  revalidatePath("/sales/leads");
  return { ok: true as const, phone };
}

export type LeadOutcome = "INTERESTED" | "NOT_NOW" | "NOT_INTERESTED" | "WON";
const OUTCOMES = new Set<LeadOutcome>(["INTERESTED", "NOT_NOW", "NOT_INTERESTED", "WON"]);
const DAY_MS = 86_400_000;

/**
 * Records how a conversation went and moves the lead along the funnel:
 * Interested → deal; Not now → nurture, retry in 30 days; Not interested → lost;
 * Won → deal won + a website project.
 */
export async function setLeadOutcomeAction(leadId: string, outcome: string) {
  const { workspaceId, userId } = await requireWorkspace();
  if (!OUTCOMES.has(outcome as LeadOutcome)) return { ok: false as const, error: "Unknown outcome." };

  const lead = await CrmService.getLeadById(workspaceId, String(leadId));
  if (!lead) return { ok: false as const, error: "Lead not found." };
  const name = lead.company?.name ?? "Prospect";
  const now = new Date();

  const existingDeal = await db.query.deals.findFirst({
    where: and(eq(deals.leadId, lead.id), eq(deals.workspaceId, workspaceId)),
  });
  const ensureDeal = async () =>
    existingDeal ??
    (await CrmService.convertLeadToDeal(workspaceId, lead.id, {
      name: `Website for ${name}`,
      stage: "QUALIFIED",
      probability: 30,
    }));

  let message: string;
  if (outcome === "INTERESTED") {
    await ensureDeal();
    await CrmService.updateLead(workspaceId, lead.id, { status: "QUALIFIED", lastContactedAt: now, nextFollowUpAt: new Date(now.getTime() + 2 * DAY_MS) });
    message = "Deal created in your Pipeline. Follow-up set for 2 days.";
  } else if (outcome === "NOT_NOW") {
    await CrmService.updateLead(workspaceId, lead.id, { status: "NURTURE", lastContactedAt: now, nextFollowUpAt: new Date(now.getTime() + 30 * DAY_MS) });
    message = "Moved to nurture. It'll come back in Today's list in 30 days.";
  } else if (outcome === "NOT_INTERESTED") {
    await CrmService.updateLead(workspaceId, lead.id, { status: "LOST", lastContactedAt: now, nextFollowUpAt: null });
    message = "Marked as lost.";
  } else {
    const deal = await ensureDeal();
    await db
      .update(deals)
      .set({ stage: "WON", probability: 100, updatedAt: now })
      .where(and(eq(deals.id, deal.id), eq(deals.workspaceId, workspaceId)));
    const hasProject = await db.query.projects.findFirst({
      where: and(eq(projects.dealId, deal.id), eq(projects.workspaceId, workspaceId)),
    });
    if (!hasProject) {
      await ProjectService.createProject(workspaceId, {
        companyId: lead.companyId,
        dealId: deal.id,
        name: `Website for ${name}`,
        ownerId: userId,
      });
    }
    await CrmService.updateLead(workspaceId, lead.id, { status: "CONVERTED", lastContactedAt: now, nextFollowUpAt: null });
    message = "Won! Deal closed and a website project was created.";
  }

  await ActivityService.createActivity(workspaceId, {
    workspaceId,
    leadId: lead.id,
    actorId: userId,
    type: "STAGE_CHANGE",
    title: `Outcome: ${outcome.replace("_", " ").toLowerCase()}`,
    metadata: { outcome, source: "lead_outcome" },
  });

  for (const path of ["/", "/sales/leads", "/sales/pipeline", "/sales/deals", "/projects"]) revalidatePath(path);
  return { ok: true as const, message };
}
