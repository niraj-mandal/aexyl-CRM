import { CrmService } from "@/services/crm.service";
import { ActivityService } from "@/services/activity.service";

export type OutboundChannel = "EMAIL" | "LINKEDIN" | "WHATSAPP";

export type OutboundIntent = "HIGH" | "MEDIUM" | "LOW" | "TIMING" | "NOT_INTERESTED" | "UNKNOWN";
export type NurtureAction = "HANDOFF" | "CONTINUE" | "HANDLE_OBJECTION" | "REACTIVATE" | "NURTURE" | "STOP" | "REVIEW";

export async function classifyOutboundReplyForEnrollment(
  workspaceId: string,
  enrollmentId: string,
  input: {
    leadId: string;
    channel: OutboundChannel;
    body: string;
    providerMessageId?: string;
    sender?: string;
  }
) {
  const body = input.body.trim().slice(0, 8000);
  if (!body) throw new Error("Reply body is required.");

  const lower = body.toLowerCase();
  let intent: OutboundIntent = "UNKNOWN";
  let recommendedAction = "REVIEW";
  let confidence = 45;

  if (/(unsubscribe|remove me|stop emailing|don't contact|do not contact|take me off)/i.test(lower)) {
    intent = "NOT_INTERESTED"; recommendedAction = "STOP"; confidence = 98;
  } else if (/(book|schedule|demo|meeting|call|available|calendar|let's talk|lets talk)/i.test(lower)) {
    intent = "HIGH"; recommendedAction = "HANDOFF"; confidence = 92;
  } else if (/(later|next month|next quarter|next year|in \d+ (day|week|month)|not now|timing|circle back|follow up later)/i.test(lower)) {
    intent = "TIMING"; recommendedAction = "REACTIVATE"; confidence = 88;
  } else if (/(price|pricing|cost|budget|expensive|how much|rate|quote)/i.test(lower)) {
    intent = "MEDIUM"; recommendedAction = "HANDLE_OBJECTION"; confidence = 86;
  } else if (/(interested|tell me more|sounds good|send|learn more|curious|what do you do)/i.test(lower)) {
    intent = "MEDIUM"; recommendedAction = "CONTINUE"; confidence = 82;
  } else if (/(no thanks|not interested|pass|not a fit|no interest)/i.test(lower)) {
    intent = "NOT_INTERESTED"; recommendedAction = "STOP"; confidence = 94;
  } else if (/(thanks|thank you|got it|received)/i.test(lower)) {
    intent = "LOW"; recommendedAction = "NURTURE"; confidence = 68;
  }

  const reply = await CrmService.createOutboundReply(workspaceId, {
    enrollmentId,
    leadId: input.leadId,
    channel: input.channel,
    body,
    intent,
    confidence,
    recommendedAction,
  });

  const enrollmentStatus =
    recommendedAction === "STOP" ? "UNSUBSCRIBED" :
    recommendedAction === "HANDOFF" ? "REPLIED" :
    recommendedAction === "REACTIVATE" ? "PAUSED" :
    "REPLIED";

  await CrmService.updateOutboundEnrollmentState(workspaceId, enrollmentId, {
    status: enrollmentStatus,
    intent,
    lastActionAt: new Date(),
    nextActionAt: recommendedAction === "REACTIVATE" ? new Date(Date.now() + 30 * 86400000) : null,
    metadata: {
      lastInbound: {
        providerMessageId: input.providerMessageId ?? null,
        sender: input.sender ?? null,
        receivedAt: new Date().toISOString(),
      },
    },
  });

  await ActivityService.logAudit(workspaceId, null, "CLASSIFY_REPLY", "OUTBOUND_REPLY", reply.id, {
    enrollmentId,
    intent,
    confidence,
    recommendedAction,
  });

  return reply;
}
