import { CrmService } from "@/services/crm.service";

export const EVENT_TYPES = [
  "HIRING", "FUNDING", "EXPANSION", "LAUNCH", "LEADERSHIP_CHANGE",
  "WEBSITE_CHANGE", "LOCATION_CHANGE", "ANNOUNCEMENT", "OTHER",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export type ExternalEvent = {
  companyName: string;
  type: EventType;
  title: string;
  summary?: string;
  source: string;
  sourceUrl?: string;
  occurredAt?: string;
};

const weights: Record<EventType, number> = {
  HIRING: 72, FUNDING: 88, EXPANSION: 84, LAUNCH: 78, LEADERSHIP_CHANGE: 70,
  WEBSITE_CHANGE: 62, LOCATION_CHANGE: 76, ANNOUNCEMENT: 60, OTHER: 40,
};

export function scoreEvent(event: ExternalEvent, targetProfile?: string | null) {
  const target = (targetProfile || "").toLowerCase();
  const text = [event.companyName, event.title, event.summary].filter(Boolean).join(" ").toLowerCase();
  const targetHits = target.split(/[^a-z0-9]+/).filter(Boolean).filter(t => t.length >= 3 && text.includes(t));
  const relevance = Math.min(100, weights[event.type] + Math.min(18, targetHits.length * 6));
  return {
    relevanceScore: relevance,
    confidence: event.sourceUrl ? 85 : 60,
    reasons: targetHits.length ? [`ICP context matched: ${targetHits.slice(0, 4).join(", ")}`] : ["Event type is relevant to outbound timing."],
  };
}

export function normalizeEvent(input: Partial<ExternalEvent>, source: string): ExternalEvent | null {
  if (!input.companyName?.trim() || !input.title?.trim() || !input.type) return null;
  return {
    companyName: input.companyName.trim(), type: input.type, title: input.title.trim(),
    summary: input.summary?.trim() || undefined, source, sourceUrl: input.sourceUrl?.trim() || undefined,
    occurredAt: input.occurredAt,
  };
}
