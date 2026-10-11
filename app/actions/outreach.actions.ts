"use server";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companies, contacts, discoveryCandidates, leads } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";
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
}

/** Leads for the pitch writer: contactable ones first, then newest. */
export async function getOutreachLeadsAction(): Promise<OutreachLead[]> {
  const { workspaceId } = await requireWorkspace();

  const rows = await db
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
      })
      .from(leads)
      .innerJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(contacts, eq(contacts.id, leads.contactId))
      .where(eq(leads.workspaceId, workspaceId))
      .orderBy(desc(leads.createdAt))
      .limit(300);

  const ids = rows.map((r) => r.id);
  const candidates = ids.length
    ? await db
        .select({
          leadId: discoveryCandidates.leadId,
          phone: discoveryCandidates.phone,
          address: discoveryCandidates.address,
          websiteStatus: discoveryCandidates.websiteStatus,
        })
        .from(discoveryCandidates)
        .where(
          and(
            eq(discoveryCandidates.workspaceId, workspaceId),
            isNotNull(discoveryCandidates.leadId),
            inArray(discoveryCandidates.leadId, ids),
          ),
        )
    : [];
  const byLead = new Map(candidates.map((c) => [c.leadId, c]));

  const list: OutreachLead[] = rows.map((r) => {
    const c = byLead.get(r.id);
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
