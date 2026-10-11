"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { IcpService } from "@/services/ai/icp.service";
import { SequenceEngineService } from "@/services/ai/sequence-engine.service";
import { BdrEngineService } from "@/services/ai/bdr-engine.service";
import { revalidatePath } from "next/cache";

// ─── ICP ──────────────────────────────────────────────────────────────

export async function generateIcpProfileAction(params: {
  businessDescription: string;
  website?: string;
  targetLocation?: string;
}) {
  const { workspaceId } = await requireWorkspace();
  const trimmed = params.businessDescription.trim();
  if (trimmed.length < 10) {
    return { error: "Describe your business in at least 10 characters." };
  }

  const result = await IcpService.generateProfile({
    workspaceId,
    businessDescription: trimmed.slice(0, 500),
    website: params.website?.trim().slice(0, 200) || undefined,
    targetLocation: params.targetLocation?.trim().slice(0, 100) || undefined,
  });

  revalidatePath("/bdr");
  return result;
}

export async function getIcpProfileAction() {
  const { workspaceId } = await requireWorkspace();
  return IcpService.getProfile(workspaceId);
}

// ─── Lead Discovery ───────────────────────────────────────────────────

export async function discoverIcpLeadsAction(maxResults?: number) {
  const { workspaceId } = await requireWorkspace();
  return BdrEngineService.discoverIcpLeads({ workspaceId, maxResults });
}

// ─── Sequences ────────────────────────────────────────────────────────

export async function generateSequenceAction(params: {
  targetProfile: string;
  valueProp: string;
  channels?: string[];
}) {
  const { workspaceId, userId } = await requireWorkspace();
  const profile = await IcpService.getActiveProfile(workspaceId);

  const result = await SequenceEngineService.generateSequence({
    workspaceId,
    userId,
    icpProfileId: profile?.id,
    targetProfile: params.targetProfile.trim().slice(0, 300),
    valueProp: params.valueProp.trim().slice(0, 500),
    channels: params.channels,
  });

  revalidatePath("/bdr");
  return result;
}

export async function getSequencesAction() {
  const { workspaceId } = await requireWorkspace();
  return SequenceEngineService.getSequences(workspaceId);
}

export async function getSequenceDetailAction(sequenceId: string) {
  return SequenceEngineService.getSequenceWithSteps(sequenceId);
}

export async function enrollLeadAction(sequenceId: string, leadId: string, contactId?: string) {
  const { workspaceId } = await requireWorkspace();
  const result = await SequenceEngineService.enrollLead({
    workspaceId,
    sequenceId,
    leadId,
    contactId,
  });
  revalidatePath("/bdr");
  return result;
}

export async function activateSequenceAction(sequenceId: string) {
  await SequenceEngineService.activateSequence(sequenceId);
  revalidatePath("/bdr");
  return { success: true };
}

export async function pauseSequenceAction(sequenceId: string) {
  await SequenceEngineService.pauseSequence(sequenceId);
  revalidatePath("/bdr");
  return { success: true };
}

export async function processDueStepsAction() {
  const { workspaceId, userId } = await requireWorkspace();
  const results = await SequenceEngineService.processDueSteps(workspaceId, userId);
  revalidatePath("/bdr");
  return { processed: results.length, results };
}

// ─── Objection Handling ───────────────────────────────────────────────

export async function handleObjectionAction(leadId: string, objectionText: string, context?: string) {
  const { workspaceId } = await requireWorkspace();
  return BdrEngineService.handleObjection({
    workspaceId,
    leadId,
    objectionText: objectionText.trim().slice(0, 1000),
    context,
  });
}

// ─── Intent Analysis ──────────────────────────────────────────────────

export async function analyzeLeadIntentAction(leadId: string) {
  const { workspaceId } = await requireWorkspace();
  return BdrEngineService.analyzeLeadIntent({ workspaceId, leadId });
}

// ─── Reactivation ─────────────────────────────────────────────────────

export async function findDormantLeadsAction(dormantDays?: number) {
  const { workspaceId } = await requireWorkspace();
  return BdrEngineService.findDormantLeads(workspaceId, dormantDays);
}

export async function generateReactivationAction(leadId: string) {
  const { workspaceId } = await requireWorkspace();
  return BdrEngineService.generateReactivationMessage({ workspaceId, leadId });
}

// ─── Dashboard ────────────────────────────────────────────────────────

export async function getBdrDashboardAction() {
  const { workspaceId } = await requireWorkspace();
  const [stats, profile, sequences] = await Promise.all([
    BdrEngineService.getDashboardStats(workspaceId),
    IcpService.getProfile(workspaceId),
    SequenceEngineService.getSequences(workspaceId),
  ]);
  return { stats, profile, sequences };
}
