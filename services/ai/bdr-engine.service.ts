import { z } from "zod";
import { AiGateway, fenceExternalContent } from "@/lib/ai/gateway";
import { db } from "@/db";
import {
  leads, contacts, companies, activities, intentSignals,
  sequenceEnrollments, outreachSequences,
} from "@/db/schema";
import { and, eq, lte, desc, sql } from "drizzle-orm";
import { IcpService } from "./icp.service";
import { LeadDiscoveryService } from "./lead-discovery.service";

const ObjectionResponseSchema = z.object({
  category: z.enum(["TIMING", "BUDGET", "AUTHORITY", "NEED", "COMPETITOR", "OTHER"]),
  response: z.string().min(20).max(500),
  followUpQuestion: z.string().optional(),
  escalate: z.boolean(),
});

const IntentAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  signals: z.array(z.object({
    type: z.string(),
    weight: z.number(),
    description: z.string(),
  })),
  recommendation: z.enum(["ESCALATE_TO_AE", "CONTINUE_SEQUENCE", "PAUSE_AND_NURTURE", "REACTIVATE", "DISQUALIFY"]),
  reasoning: z.string(),
});

export class BdrEngineService {
  // ─── ICP-Matched Lead Discovery ─────────────────────────────────────

  static async discoverIcpLeads(params: {
    workspaceId: string;
    maxResults?: number;
  }) {
    const profile = await IcpService.getActiveProfile(params.workspaceId);
    if (!profile) return { leads: [], error: "No active ICP profile. Set up your ICP first." };

    const icpAttrs = profile.idealCustomerProfile as { industry: string; size: string; stage: string; region: string }[];
    const industry = icpAttrs[0]?.industry || "";
    const region = icpAttrs[0]?.region || "";

    const query = `${profile.businessDescription} ${industry} companies ${region}`;
    const result = await LeadDiscoveryService.discover({
      query,
      industry,
      location: region,
      maxResults: params.maxResults ?? 6,
    });

    return {
      leads: result.leads,
      icpProfile: profile,
      notes: result.notes,
    };
  }

  // ─── Smart Objection Handling ───────────────────────────────────────

  static async handleObjection(params: {
    workspaceId: string;
    leadId: string;
    objectionText: string;
    context?: string;
  }) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, params.leadId)).limit(1);
    const contact = lead?.contactId
      ? (await db.select().from(contacts).where(eq(contacts.id, lead.contactId)).limit(1))[0]
      : null;

    const profile = await IcpService.getActiveProfile(params.workspaceId);

    const result = await AiGateway.structuredOutput({
      system: `You are a B2B sales objection handler. Analyze the prospect's objection and craft a response.

Rules:
- Acknowledge the concern genuinely (never dismiss it)
- Reframe around value, not features
- Keep response under 150 words, conversational
- Include a soft follow-up question to keep the conversation going
- Set escalate=true only if the objection indicates a decision-maker needs to be involved
- Categorize: TIMING (not now), BUDGET (too expensive), AUTHORITY (need to check), NEED (don't see value), COMPETITOR (using something else), OTHER`,
      user: `Objection: ${fenceExternalContent("prospect reply", params.objectionText)}
${contact ? `Prospect: ${contact.firstName} ${contact.lastName || ""}, ${contact.jobTitle || "unknown role"}` : ""}
${profile ? `Our value prop: ${profile.businessDescription}` : ""}
${params.context ? `Context: ${params.context}` : ""}`,
      schema: ObjectionResponseSchema,
      workspaceId: params.workspaceId,
    });

    if (result.ok && result.data) {
      await db.insert(intentSignals).values({
        workspaceId: params.workspaceId,
        leadId: params.leadId,
        contactId: lead?.contactId,
        signalType: "OBJECTION",
        score: -5,
        source: "bdr_objection_handler",
        metadata: { category: result.data.category, escalate: result.data.escalate },
      });

      return result.data;
    }

    return {
      category: "OTHER" as const,
      response: "Thanks for sharing that — I completely understand. Let me get back to you with some specific examples that might address your concern. Would later this week work for a quick follow-up?",
      followUpQuestion: "What would need to be true for this to be worth exploring?",
      escalate: false,
    };
  }

  // ─── Intent Detection & Scoring ─────────────────────────────────────

  static async analyzeLeadIntent(params: {
    workspaceId: string;
    leadId: string;
  }) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, params.leadId)).limit(1);
    if (!lead) return null;

    const signals = await db
      .select()
      .from(intentSignals)
      .where(and(
        eq(intentSignals.workspaceId, params.workspaceId),
        eq(intentSignals.leadId, params.leadId),
      ))
      .orderBy(desc(intentSignals.occurredAt))
      .limit(20);

    const recentActivities = await db
      .select()
      .from(activities)
      .where(and(
        eq(activities.workspaceId, params.workspaceId),
        eq(activities.leadId, params.leadId),
      ))
      .orderBy(desc(activities.occurredAt))
      .limit(10);

    const contact = lead.contactId
      ? (await db.select().from(contacts).where(eq(contacts.id, lead.contactId)).limit(1))[0]
      : null;

    const result = await AiGateway.structuredOutput({
      system: `You are a sales intent analyst. Given a lead's activity signals, compute an intent score and recommend next action.

Score 0-100:
- 0-20: Cold, no engagement
- 21-40: Warm, some interest
- 41-60: Engaged, actively evaluating
- 61-80: Hot, ready for sales conversation
- 81-100: Very hot, immediate escalation needed

Recommendations:
- ESCALATE_TO_AE: Score 70+, ready for human sales rep
- CONTINUE_SEQUENCE: Score 30-70, keep nurturing
- PAUSE_AND_NURTURE: Score 20-40, slow down outreach
- REACTIVATE: Was engaged but gone cold (no activity 14+ days)
- DISQUALIFY: Negative signals (bounced, unsubscribed, explicit no)`,
      user: `Lead: ${contact?.firstName || "Unknown"} ${contact?.lastName || ""} - ${contact?.jobTitle || "unknown role"}
Current score: ${lead.score}, Temperature: ${lead.temperature}
Status: ${lead.status}
Last contacted: ${lead.lastContactedAt?.toISOString() || "never"}

Intent signals (recent):
${signals.map((s) => `- ${s.signalType}: score ${s.score}, ${s.occurredAt.toISOString()}`).join("\n") || "None"}

Activity timeline:
${recentActivities.map((a) => `- ${a.type}: ${a.title} (${a.occurredAt.toISOString()})`).join("\n") || "None"}`,
      schema: IntentAnalysisSchema,
      workspaceId: params.workspaceId,
    });

    if (result.ok && result.data) {
      if (Math.abs(result.data.score - lead.score) >= 5) {
        const temperature = result.data.score >= 70 ? "HOT" : result.data.score >= 40 ? "WARM" : "COLD";
        await db
          .update(leads)
          .set({ score: result.data.score, temperature, updatedAt: new Date() })
          .where(eq(leads.id, params.leadId));
      }
      return result.data;
    }

    const totalSignalScore = signals.reduce((sum, s) => sum + s.score, 0);
    const computedScore = Math.min(100, Math.max(0, lead.score + totalSignalScore));
    return {
      score: computedScore,
      signals: signals.map((s) => ({ type: s.signalType, weight: s.score, description: s.source || "" })),
      recommendation: computedScore >= 70 ? "ESCALATE_TO_AE" as const : "CONTINUE_SEQUENCE" as const,
      reasoning: `Computed from ${signals.length} intent signals.`,
    };
  }

  // ─── Reactivation Engine ────────────────────────────────────────────

  static async findDormantLeads(workspaceId: string, dormantDays = 14) {
    const cutoff = new Date(Date.now() - dormantDays * 86_400_000);

    return db
      .select({
        lead: leads,
        contact: contacts,
        company: companies,
      })
      .from(leads)
      .leftJoin(contacts, eq(leads.contactId, contacts.id))
      .leftJoin(companies, eq(leads.companyId, companies.id))
      .where(and(
        eq(leads.workspaceId, workspaceId),
        eq(leads.status, "CONTACTED"),
        lte(leads.lastContactedAt, cutoff),
      ))
      .orderBy(desc(leads.score))
      .limit(20);
  }

  static async generateReactivationMessage(params: {
    workspaceId: string;
    leadId: string;
  }) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, params.leadId)).limit(1);
    if (!lead) return null;

    const contact = lead.contactId
      ? (await db.select().from(contacts).where(eq(contacts.id, lead.contactId)).limit(1))[0]
      : null;

    const profile = await IcpService.getActiveProfile(params.workspaceId);

    const ReactivationSchema = z.object({
      subject: z.string(),
      body: z.string(),
      approach: z.enum(["VALUE_ADD", "CHECK_IN", "NEW_ANGLE", "SOCIAL_PROOF", "EVENT_BASED"]),
    });

    const result = await AiGateway.structuredOutput({
      system: `You are a B2B reactivation specialist. Write a re-engagement email for a prospect who went silent.

Rules:
- Never guilt-trip about not responding
- Lead with new value (case study, industry insight, product update)
- Keep it under 100 words
- One clear CTA
- Choose approach: VALUE_ADD (share something useful), CHECK_IN (casual), NEW_ANGLE (different pain point), SOCIAL_PROOF (customer story), EVENT_BASED (industry event)`,
      user: `Prospect: ${contact?.firstName || "there"} ${contact?.lastName || ""}, ${contact?.jobTitle || ""}
Company: ${lead.companyId ? "known" : "unknown"}
Last contact: ${lead.lastContactedAt?.toISOString() || "unknown"}
Lead score: ${lead.score}
${profile ? `Our business: ${profile.businessDescription}` : ""}`,
      schema: ReactivationSchema,
      workspaceId: params.workspaceId,
    });

    if (result.ok && result.data) return result.data;

    return {
      subject: "Quick thought for your team",
      body: `Hi ${contact?.firstName || "there"},\n\nHaven't been in touch for a bit — hope things are going well.\n\nWe just wrapped up a project with a team in a similar space and the results were pretty interesting. Thought you might find it useful.\n\nWorth a quick catch-up?\n\nBest`,
      approach: "VALUE_ADD" as const,
    };
  }

  // ─── BDR Dashboard Stats ────────────────────────────────────────────

  static async getDashboardStats(workspaceId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [[sequenceStats], [enrollmentStats], [signalStats], hotLeads] = await Promise.all([
      db
        .select({
          totalSequences: sql<number>`count(*)::int`,
          activeSequences: sql<number>`count(*) filter (where ${outreachSequences.status} = 'ACTIVE')::int`,
          totalEnrolled: sql<number>`coalesce(sum(${outreachSequences.totalEnrolled}), 0)::int`,
          totalReplied: sql<number>`coalesce(sum(${outreachSequences.totalReplied}), 0)::int`,
          totalMeetings: sql<number>`coalesce(sum(${outreachSequences.totalMeetings}), 0)::int`,
        })
        .from(outreachSequences)
        .where(eq(outreachSequences.workspaceId, workspaceId)),
      db
        .select({
          active: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'ACTIVE')::int`,
          completed: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'COMPLETED')::int`,
          replied: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'REPLIED')::int`,
        })
        .from(sequenceEnrollments)
        .where(eq(sequenceEnrollments.workspaceId, workspaceId)),
      db
        .select({
          totalSignals: sql<number>`count(*)::int`,
          recentSignals: sql<number>`count(*) filter (where ${intentSignals.occurredAt} >= ${thirtyDaysAgo.toISOString()})::int`,
        })
        .from(intentSignals)
        .where(eq(intentSignals.workspaceId, workspaceId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(
          eq(leads.workspaceId, workspaceId),
          eq(leads.temperature, "HOT"),
        )),
    ]);

    return {
      sequences: sequenceStats,
      enrollments: enrollmentStats,
      signals: signalStats,
      hotLeadCount: hotLeads[0]?.count ?? 0,
      replyRate: sequenceStats.totalEnrolled > 0
        ? Math.round((sequenceStats.totalReplied / sequenceStats.totalEnrolled) * 100)
        : 0,
      meetingRate: sequenceStats.totalEnrolled > 0
        ? Math.round((sequenceStats.totalMeetings / sequenceStats.totalEnrolled) * 100)
        : 0,
    };
  }
}
