import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, outboundEnrollments } from "@/db/schema";
import { CrmService } from "@/services/crm.service";
import { classifyOutboundReplyForEnrollment } from "@/services/outbound/reply-classifier";

export async function POST(request: Request) {
  try {
    const secret = process.env.OUTBOUND_INBOUND_WEBHOOK_SECRET;
    if (secret && request.headers.get("x-aexyl-webhook-secret") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await request.json() as {
      to?: string;
      recipient?: string;
      from?: string;
      sender?: string;
      text?: string;
      body?: string;
      messageId?: string;
      channel?: string;
      workspaceId?: string;
    };

    const recipient = String(payload.to ?? payload.recipient ?? "").trim();
    const body = String(payload.text ?? payload.body ?? "").trim();
    const workspaceId = String(payload.workspaceId ?? "").trim();

    if (!recipient || !body) return NextResponse.json({ error: "recipient and body are required" }, { status: 400 });
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    const enrollment = await CrmService.findOutboundEnrollmentByRecipient(workspaceId, recipient);
    if (!enrollment) return NextResponse.json({ received: false, reason: "No active outbound enrollment matched recipient." }, { status: 202 });

    const result = await classifyOutboundReplyForEnrollment(workspaceId, enrollment.id, {
      leadId: enrollment.leadId,
      channel: String(payload.channel ?? "EMAIL").toUpperCase() as "EMAIL" | "LINKEDIN" | "WHATSAPP",
      body,
      providerMessageId: payload.messageId,
      sender: payload.from ?? payload.sender,
    });

    return NextResponse.json({ received: true, enrollmentId: enrollment.id, intent: result.intent, recommendedAction: result.recommendedAction });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inbound processing failed." }, { status: 500 });
  }
}
