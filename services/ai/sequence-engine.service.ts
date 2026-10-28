import { z } from "zod";
import { AiGateway } from "@/lib/ai/gateway";
import { db } from "@/db";
import {
  outreachSequences,
  sequenceSteps,
  sequenceEnrollments,
  sequenceEvents,
  leads,
  contacts,
  activities,
  intentSignals,
} from "@/db/schema";
import { and, eq, lte, sql, desc } from "drizzle-orm";
import { sendRawEmail } from "@/services/email.service";

const SequenceGenerationSchema = z.object({
  name: z.string(),
  description: z.string(),
  steps: z.array(z.object({
    stepNumber: z.number(),
    channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN", "CALL"]),
    subject: z.string().optional(),
    body: z.string(),
    delayDays: z.number().min(0).max(30),
  })).min(2).max(7),
});

export class SequenceEngineService {
  static async generateSequence(params: {
    workspaceId: string;
    userId: string;
    icpProfileId?: string;
    targetProfile: string;
    valueProp: string;
    channels?: string[];
  }) {
    const result = await AiGateway.structuredOutput({
      system: `You are a B2B outreach sequence designer. Create a multi-step outreach sequence for cold prospects.

Rules:
- 3-5 steps total, mixing channels (EMAIL primary, with LINKEDIN or CALL follow-ups)
- Step 1 is always EMAIL with a personalized opener
- Include appropriate delays (2-4 days between emails, 1-2 days for follow-ups)
- Each email needs a subject line and body
- Keep emails short (under 150 words), conversational, no corporate jargon
- Focus on the prospect's pain points, not your features
- Last step should be a breakup email (soft close)
- LinkedIn steps should be connection request or message (short)
- Name the sequence based on the target profile`,
      user: `Target: ${params.targetProfile}\nValue Prop: ${params.valueProp}${params.channels?.length ? `\nPreferred Channels: ${params.channels.join(", ")}` : ""}`,
      schema: SequenceGenerationSchema,
      workspaceId: params.workspaceId,
    });

    if (!result.ok || !result.data) {
      return SequenceEngineService.fallbackSequence(params);
    }

    const [sequence] = await db.insert(outreachSequences).values({
      workspaceId: params.workspaceId,
      icpProfileId: params.icpProfileId ?? null,
      name: result.data.name,
      description: result.data.description,
      channel: "MULTI",
      status: "DRAFT",
      createdBy: params.userId,
    }).returning();

    await db.insert(sequenceSteps).values(
      result.data.steps.map((step) => ({
        sequenceId: sequence.id,
        stepNumber: step.stepNumber,
        channel: step.channel,
        subject: step.subject ?? null,
        body: step.body,
        delayDays: step.delayDays,
      }))
    );

    return { sequence, steps: result.data.steps };
  }

  private static async fallbackSequence(params: {
    workspaceId: string;
    userId: string;
    icpProfileId?: string;
    targetProfile: string;
    valueProp: string;
  }) {
    const steps = [
      {
        stepNumber: 1, channel: "EMAIL" as const, delayDays: 0,
        subject: `Quick question about ${params.targetProfile.split(" ")[0]}'s outreach`,
        body: `Hi {{firstName}},\n\n${params.valueProp}\n\nWorth a quick 15-min chat this week?\n\nBest,\n{{senderName}}`,
      },
      {
        stepNumber: 2, channel: "EMAIL" as const, delayDays: 3,
        subject: "Re: Quick question",
        body: `Hi {{firstName}},\n\nJust floating this back up — I know inboxes get busy.\n\nWe've been helping similar companies and thought there might be a fit. Happy to share a few examples.\n\nWould Thursday or Friday work for a quick call?\n\n{{senderName}}`,
      },
      {
        stepNumber: 3, channel: "LINKEDIN" as const, delayDays: 2,
        body: `Hi {{firstName}} — sent you an email earlier this week about {{valueProp}}. Would love to connect here too.`,
      },
      {
        stepNumber: 4, channel: "EMAIL" as const, delayDays: 4,
        subject: "Last note from me",
        body: `Hi {{firstName}},\n\nDon't want to be that person who won't take a hint 😊\n\nIf the timing isn't right, no worries at all. If it ever makes sense to chat, my calendar is always open: {{meetingLink}}\n\nAll the best,\n{{senderName}}`,
      },
    ];

    const [sequence] = await db.insert(outreachSequences).values({
      workspaceId: params.workspaceId,
      icpProfileId: params.icpProfileId ?? null,
      name: `Outreach: ${params.targetProfile.slice(0, 50)}`,
      description: `Auto-generated sequence for ${params.targetProfile}`,
      channel: "MULTI",
      status: "DRAFT",
      createdBy: params.userId,
    }).returning();

    await db.insert(sequenceSteps).values(
      steps.map((s) => ({ sequenceId: sequence.id, ...s, subject: s.subject ?? null }))
    );

    return { sequence, steps };
  }

  static async enrollLead(params: {
    workspaceId: string;
    sequenceId: string;
    leadId: string;
    contactId?: string;
  }) {
    const [existing] = await db
      .select()
      .from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.sequenceId, params.sequenceId),
        eq(sequenceEnrollments.leadId, params.leadId),
        eq(sequenceEnrollments.status, "ACTIVE"),
      ))
      .limit(1);

    if (existing) return { enrolled: false, reason: "Lead already enrolled in this sequence" };

    const [firstStep] = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, params.sequenceId))
      .orderBy(sequenceSteps.stepNumber)
      .limit(1);

    if (!firstStep) return { enrolled: false, reason: "Sequence has no steps" };

    const nextStepAt = new Date(Date.now() + firstStep.delayDays * 86_400_000);

    const [enrollment] = await db.insert(sequenceEnrollments).values({
      workspaceId: params.workspaceId,
      sequenceId: params.sequenceId,
      leadId: params.leadId,
      contactId: params.contactId ?? null,
      currentStep: 0,
      nextStepAt,
    }).returning();

    await db
      .update(outreachSequences)
      .set({ totalEnrolled: sql`${outreachSequences.totalEnrolled} + 1` })
      .where(eq(outreachSequences.id, params.sequenceId));

    return { enrolled: true, enrollmentId: enrollment.id };
  }

  static async processDueSteps(workspaceId: string, userId: string, limit = 10) {
    const dueEnrollments = await db
      .select()
      .from(sequenceEnrollments)
      .where(and(
        eq(sequenceEnrollments.workspaceId, workspaceId),
        eq(sequenceEnrollments.status, "ACTIVE"),
        lte(sequenceEnrollments.nextStepAt, new Date()),
      ))
      .limit(limit);

    const results: { enrollmentId: string; stepExecuted: number; channel: string }[] = [];

    for (const enrollment of dueEnrollments) {
      const nextStepNumber = enrollment.currentStep + 1;
      const [step] = await db
        .select()
        .from(sequenceSteps)
        .where(and(
          eq(sequenceSteps.sequenceId, enrollment.sequenceId),
          eq(sequenceSteps.stepNumber, nextStepNumber),
        ))
        .limit(1);

      if (!step) {
        await db
          .update(sequenceEnrollments)
          .set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(sequenceEnrollments.id, enrollment.id));
        continue;
      }

      const contact = enrollment.contactId
        ? (await db.select().from(contacts).where(eq(contacts.id, enrollment.contactId)).limit(1))[0]
        : null;

      if (step.channel === "EMAIL" && contact?.email) {
        const personalizedBody = step.body
          .replace(/\{\{firstName\}\}/g, contact.firstName || "there")
          .replace(/\{\{senderName\}\}/g, "Aexyl");

        await sendRawEmail({
          to: contact.email,
          subject: step.subject || "Following up",
          html: personalizedBody.replace(/\n/g, "<br>"),
          text: personalizedBody,
        }).catch(() => undefined);

        await db.insert(activities).values({
          workspaceId,
          leadId: enrollment.leadId,
          contactId: enrollment.contactId,
          actorId: userId,
          type: "OUTREACH",
          title: `Sequence step ${nextStepNumber}: ${step.channel}`,
          description: personalizedBody.slice(0, 300),
          metadata: { sequenceId: enrollment.sequenceId, stepId: step.id, channel: step.channel },
        });
      }

      await db.insert(sequenceEvents).values({
        enrollmentId: enrollment.id,
        stepId: step.id,
        type: "SENT",
        metadata: { channel: step.channel },
      });

      const nextStep = await db
        .select()
        .from(sequenceSteps)
        .where(and(
          eq(sequenceSteps.sequenceId, enrollment.sequenceId),
          eq(sequenceSteps.stepNumber, nextStepNumber + 1),
        ))
        .limit(1);

      const nextStepAt = nextStep[0]
        ? new Date(Date.now() + nextStep[0].delayDays * 86_400_000)
        : null;

      await db
        .update(sequenceEnrollments)
        .set({
          currentStep: nextStepNumber,
          nextStepAt,
          status: nextStepAt ? "ACTIVE" : "COMPLETED",
          completedAt: nextStepAt ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sequenceEnrollments.id, enrollment.id));

      results.push({ enrollmentId: enrollment.id, stepExecuted: nextStepNumber, channel: step.channel });
    }

    return results;
  }

  static async recordSignal(params: {
    workspaceId: string;
    enrollmentId: string;
    stepId: string;
    type: "OPENED" | "CLICKED" | "REPLIED" | "BOUNCED" | "MEETING_BOOKED";
  }) {
    await db.insert(sequenceEvents).values({
      enrollmentId: params.enrollmentId,
      stepId: params.stepId,
      type: params.type,
    });

    const [enrollment] = await db
      .select()
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.id, params.enrollmentId))
      .limit(1);

    if (!enrollment) return;

    const scoreMap: Record<string, number> = {
      OPENED: 5, CLICKED: 15, REPLIED: 30, MEETING_BOOKED: 50, BOUNCED: -20,
    };

    await db.insert(intentSignals).values({
      workspaceId: params.workspaceId,
      leadId: enrollment.leadId,
      contactId: enrollment.contactId,
      signalType: params.type,
      score: scoreMap[params.type] ?? 0,
      source: `sequence:${enrollment.sequenceId}`,
    });

    if (params.type === "REPLIED") {
      await db
        .update(sequenceEnrollments)
        .set({ status: "REPLIED", updatedAt: new Date() })
        .where(eq(sequenceEnrollments.id, params.enrollmentId));
      await db
        .update(outreachSequences)
        .set({ totalReplied: sql`${outreachSequences.totalReplied} + 1` })
        .where(eq(outreachSequences.id, enrollment.sequenceId));
    }

    if (params.type === "MEETING_BOOKED") {
      await db
        .update(outreachSequences)
        .set({ totalMeetings: sql`${outreachSequences.totalMeetings} + 1` })
        .where(eq(outreachSequences.id, enrollment.sequenceId));
    }

    if (enrollment.leadId && scoreMap[params.type]) {
      await db
        .update(leads)
        .set({ score: sql`LEAST(100, ${leads.score} + ${scoreMap[params.type]})`, updatedAt: new Date() })
        .where(eq(leads.id, enrollment.leadId));
    }
  }

  static async getSequences(workspaceId: string) {
    return db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.workspaceId, workspaceId))
      .orderBy(desc(outreachSequences.createdAt));
  }

  static async getSequenceWithSteps(sequenceId: string) {
    const [sequence] = await db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.id, sequenceId))
      .limit(1);

    if (!sequence) return null;

    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, sequenceId))
      .orderBy(sequenceSteps.stepNumber);

    const enrollmentStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'ACTIVE')::int`,
        replied: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'REPLIED')::int`,
        completed: sql<number>`count(*) filter (where ${sequenceEnrollments.status} = 'COMPLETED')::int`,
      })
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.sequenceId, sequenceId));

    return { sequence, steps, stats: enrollmentStats[0] };
  }

  static async activateSequence(sequenceId: string, workspaceId: string) {
    await db
      .update(outreachSequences)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(and(eq(outreachSequences.id, sequenceId), eq(outreachSequences.workspaceId, workspaceId)));
  }

  static async pauseSequence(sequenceId: string, workspaceId: string) {
    await db
      .update(outreachSequences)
      .set({ status: "PAUSED", updatedAt: new Date() })
      .where(and(eq(outreachSequences.id, sequenceId), eq(outreachSequences.workspaceId, workspaceId)));
  }
}
