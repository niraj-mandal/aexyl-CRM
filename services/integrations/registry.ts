/**
 * Integration connector registry (Phase 6 spec §2-3).
 *
 * Architecture: Integration → Connector → Permission → Tool → Agent.
 * Agents never talk to providers; they call tools, tools call connectors,
 * connectors own credentials. Credentials are stored server-side only and are
 * stripped from every client-facing payload.
 *
 * Honesty rule: a connector that has no real implementation reports
 * requiresExternalSetup: true and never fabricates a connected state.
 */
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getEmailProvider, sendRawEmail } from "@/services/email.service";

export interface ConnectorDefinition {
  key: string;
  name: string;
  category: "communication" | "productivity" | "lead_generation" | "analytics";
  description: string;
  /** Capability list shown in the UI. */
  scopes: string[];
  /** True when the connector can actually work in this deployment right now. */
  isConfigurable: (env: NodeJS.ProcessEnv) => boolean;
  /** What's missing, when isConfigurable is false. */
  setupHint: string;
  /** External setup the workspace admin must do (create OAuth app, etc.). */
  requiresExternalSetup?: boolean;
  /** Live health probe — returns error string or null. */
  check?: () => Promise<string | null>;
}

export const CONNECTORS: ConnectorDefinition[] = [
  {
    key: "brevo",
    name: "Email (Brevo)",
    category: "communication",
    description: "Transactional email: workspace invites, agent-approved outreach, follow-ups.",
    scopes: ["email:send"],
    isConfigurable: (env) => Boolean(env.BREVO_API_KEY),
    setupHint:
      "Add BREVO_API_KEY to environment (.env.local) — SMTP & API keys live in the Brevo dashboard (app.brevo.com). Sender must be verified there.",
    check: async () =>
      getEmailProvider() === "brevo" ? null : "BREVO_API_KEY missing (Resend fallback active)",
  },
  {
    key: "resend",
    name: "Email (Resend)",
    category: "communication",
    description: "Transactional email fallback: invites, outreach and follow-ups when Brevo is not configured.",
    scopes: ["email:send"],
    isConfigurable: (env) => Boolean(env.RESEND_API_KEY),
    setupHint: "Add RESEND_API_KEY to environment (.env.local) — free tier at resend.com.",
    check: async () =>
      getEmailProvider() === "resend" ? null : "RESEND_API_KEY missing or Brevo is primary",
  },
  {
    key: "gmail",
    name: "Gmail",
    category: "communication",
    description: "Two-way email sync, thread-aware follow-up intelligence.",
    scopes: ["gmail.readonly", "gmail.send"],
    isConfigurable: () => false,
    setupHint: "Requires a Google OAuth app (client id/secret) — not yet created.",
    requiresExternalSetup: true,
  },
  {
    key: "google_calendar",
    name: "Google Calendar",
    category: "productivity",
    description: "Meeting scheduling, call bookings synced to pipeline activity.",
    scopes: ["calendar.events"],
    isConfigurable: () => false,
    setupHint: "Requires a Google OAuth app (client id/secret) — not yet created.",
    requiresExternalSetup: true,
  },
  {
    key: "google_drive",
    name: "Google Drive",
    category: "productivity",
    description: "Document intelligence source: briefs, contracts, client assets.",
    scopes: ["drive.file"],
    isConfigurable: () => false,
    setupHint: "Requires a Google OAuth app (client id/secret) — not yet created.",
    requiresExternalSetup: true,
  },
  {
    key: "slack",
    name: "Slack",
    category: "communication",
    description: "Agent notifications and approvals delivered to your team channel.",
    scopes: ["chat:write", "incoming-webhook"],
    isConfigurable: (env) => Boolean(env.SLACK_WEBHOOK_URL),
    setupHint: "Add SLACK_WEBHOOK_URL to environment (Incoming Webhook app).",
  },
];

export function getConnector(key: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.key === key);
}

/** Client-safe view of a connection: credentials are stripped here. */
export async function getConnectionView(workspaceId: string, connectorKey: string) {
  const connector = getConnector(connectorKey);
  if (!connector) return null;
  const row = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.workspaceId, workspaceId),
      eq(integrationConnections.connectorKey, connectorKey)
    ),
  });
  const envConfigured = connector.isConfigurable(process.env);
  return {
    key: connector.key,
    name: connector.name,
    category: connector.category,
    description: connector.description,
    scopes: connector.scopes,
    setupHint: connector.setupHint,
    requiresExternalSetup: connector.requiresExternalSetup ?? false,
    envConfigured,
    // No connection row: env-ready connectors are AVAILABLE (one click to
    // connect); the rest are UNAVAILABLE pending external setup.
    status: row?.status ?? (envConfigured ? "AVAILABLE" : "UNAVAILABLE"),
    accountLabel: row?.accountLabel ?? null,
    lastError: row?.lastError ?? null,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    // NOTE: credentials deliberately never leave the server.
  };
}

export async function listConnectionViews(workspaceId: string) {
  return Promise.all(CONNECTORS.map((c) => getConnectionView(workspaceId, c.key)));
}

/**
 * Persist a "connected" state for env-driven connectors. For OAuth connectors
 * this is where token exchange would land (none are live yet — honesty rule).
 */
export async function markConnected(params: {
  workspaceId: string;
  connectorKey: string;
  accountLabel?: string;
  credentials?: Record<string, string>;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  await db
    .insert(integrationConnections)
    .values({
      workspaceId: params.workspaceId,
      connectorKey: params.connectorKey,
      status: "CONNECTED",
      accountLabel: params.accountLabel ?? null,
      credentials: params.credentials ?? {},
      metadata: params.metadata ?? {},
      connectedAt: now,
      lastCheckedAt: now,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [integrationConnections.workspaceId, integrationConnections.connectorKey],
      set: {
        status: "CONNECTED",
        accountLabel: params.accountLabel ?? null,
        ...(params.credentials ? { credentials: params.credentials } : {}),
        connectedAt: now,
        lastCheckedAt: now,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function markDisconnected(workspaceId: string, connectorKey: string) {
  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.workspaceId, workspaceId),
        eq(integrationConnections.connectorKey, connectorKey)
      )
    );
}

/** Runs the connector's live check and records the outcome. */
export async function verifyConnection(workspaceId: string, connectorKey: string): Promise<{ ok: boolean; error?: string }> {
  const connector = getConnector(connectorKey);
  if (!connector) return { ok: false, error: "Unknown connector" };
  if (!connector.check) return { ok: true };

  const error = await connector.check();
  const now = new Date();
  await db
    .insert(integrationConnections)
    .values({
      workspaceId,
      connectorKey,
      status: error ? "ERROR" : "CONNECTED",
      lastError: error,
      lastCheckedAt: now,
      credentials: {},
    })
    .onConflictDoUpdate({
      target: [integrationConnections.workspaceId, integrationConnections.connectorKey],
      set: {
        status: error ? "ERROR" : "CONNECTED",
        lastError: error,
        lastCheckedAt: now,
        updatedAt: now,
      },
    });
  return error ? { ok: false, error } : { ok: true };
}

/** Real send path used by tools — goes through the connector, not direct provider calls. */
export async function sendViaEmailConnector(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  return sendRawEmail(input);
}
