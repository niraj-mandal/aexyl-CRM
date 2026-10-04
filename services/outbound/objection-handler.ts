export type ObjectionType = "PRICE" | "TIMING" | "INFO_REQUEST" | "EXISTING_PROVIDER" | "NO_PRIORITY" | "OTHER";

export function classifyObjection(body: string) {
  const text = body.toLowerCase();
  if (/(price|pricing|cost|budget|expensive|quote)/i.test(text)) return { type: "PRICE" as const, confidence: 92 };
  if (/(later|next month|next quarter|not now|timing|circle back)/i.test(text)) return { type: "TIMING" as const, confidence: 90 };
  if (/(send me|more info|details|case study|examples|tell me more)/i.test(text)) return { type: "INFO_REQUEST" as const, confidence: 88 };
  if (/(already use|current provider|another agency|another vendor|working with)/i.test(text)) return { type: "EXISTING_PROVIDER" as const, confidence: 88 };
  if (/(not a priority|no need|do not need|don't need)/i.test(text)) return { type: "NO_PRIORITY" as const, confidence: 86 };
  return { type: "OTHER" as const, confidence: 50 };
}

export function buildObjectionDraft(firstName: string, type: ObjectionType, companyName?: string | null, valueProp?: string | null) {
  const name = firstName || "there";
  if (type === "PRICE") return `Hi ${name},\n\nTotally fair — budget is worth validating first. Rather than assume this makes sense for ${companyName || "your team"}, would it be useful to look at the outcome you want and see whether there is a sensible scope?\n\nIf useful, we can keep it to 15 minutes.`;
  if (type === "TIMING") return `Hi ${name},\n\nUnderstood — no point forcing the timing. When would be a better point to revisit this? I can follow up around then and keep it lightweight.`;
  if (type === "INFO_REQUEST") return `Hi ${name},\n\nAbsolutely. The short version is that we help with ${valueProp || "the problem this campaign is targeting"}. I can send a concise overview tailored to ${companyName || "your team"}.`;
  if (type === "EXISTING_PROVIDER") return `Hi ${name},\n\nThat makes sense. If the current setup is working, changing it only makes sense when there is a clear gap. What would you most want to improve about the current setup, if anything?`;
  if (type === "NO_PRIORITY") return `Hi ${name},\n\nFair enough. I do not want to push if this is not a priority. What would need to change for this to become worth considering?`;
  return `Hi ${name},\n\nThat is fair. I do not want to push past the actual concern. What would need to be true for this to become worth considering?`;
}
