import { db } from "@/db";
import { featureFlags } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Workspace feature flags (spec §24). Flags gate Phase 6 capabilities so
 * dangerous/external behavior ships dark and can be enabled per workspace.
 *
 * Registration happens opportunistically (on first read) so no migration
 * seeding step is required and new workspaces pick flags up automatically.
 * Cache is per-process and short-TTL to keep page loads cheap while staying
 * fresh enough for rollout control.
 */
export const FLAG_DEFINITIONS = [
  { key: "integrations.email", description: "Outbound email via Resend connector" },
  { key: "integrations.calendar", description: "Google Calendar integration (placeholder until OAuth app exists)" },
  { key: "agents.outreach.send", description: "Allow the Outreach Agent to send approved emails (requires approval still)" },
  { key: "agents.progressive_autonomy", description: "Enable per-tool policy overrides toward L4 behavior" },
  { key: "intelligence.forecasting", description: "Revenue forecast + predictive intelligence surfaces" },
  { key: "notifications.inapp", description: "In-app notification center" },
] as const;

export type FlagKey = (typeof FLAG_DEFINITIONS)[number]["key"];

const DEFAULT_ENABLED: FlagKey[] = ["integrations.email", "agents.outreach.send", "notifications.inapp", "intelligence.forecasting"];

type CacheEntry = { at: number; flags: Map<string, boolean> };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15_000;

export async function ensureFlags(workspaceId: string) {
  const existing = await db.select().from(featureFlags).where(eq(featureFlags.workspaceId, workspaceId));
  const known = new Set(existing.map((f) => f.flagKey));
  const missing = FLAG_DEFINITIONS.filter((d) => !known.has(d.key));
  if (missing.length > 0) {
    await db
      .insert(featureFlags)
      .values(
        missing.map((d) => ({
          workspaceId,
          flagKey: d.key,
          enabled: (DEFAULT_ENABLED as readonly string[]).includes(d.key),
          description: d.description,
        }))
      )
      .onConflictDoNothing();
    cache.delete(workspaceId);
  }
}

export async function getFlags(workspaceId: string): Promise<Map<string, boolean>> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flags;
  await ensureFlags(workspaceId);
  const rows = await db.select().from(featureFlags).where(eq(featureFlags.workspaceId, workspaceId));
  const flags = new Map(rows.map((r) => [r.flagKey, r.enabled]));
  cache.set(workspaceId, { at: Date.now(), flags });
  return flags;
}

export async function isFlagEnabled(workspaceId: string, key: FlagKey): Promise<boolean> {
  const flags = await getFlags(workspaceId);
  return flags.get(key) ?? false;
}

export async function setFlag(workspaceId: string, key: string, enabled: boolean) {
  await db
    .update(featureFlags)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(featureFlags.workspaceId, workspaceId), eq(featureFlags.flagKey, key)));
  cache.delete(workspaceId);
}

export async function listFlags(workspaceId: string) {
  await ensureFlags(workspaceId);
  return db.select().from(featureFlags).where(eq(featureFlags.workspaceId, workspaceId)).orderBy(featureFlags.flagKey);
}
