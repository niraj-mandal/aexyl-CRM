import { Display, PageTitle, SectionTitle, Body } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace, SALES_ROLE, isOwnerEmail } from "@/lib/auth/workspace";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditLogs, workspaceMemberships, workspaceInvites, workspaces } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { InviteForm, PendingInviteRow, JoinRequestRow, MemberRoleSelect, RemoveMemberButton, AssignLeads } from "@/components/crm/InviteManager";
import { getLeadPlacesAction } from "@/app/actions/invite.actions";
import { getEmailProvider, isEmailConfigured } from "@/services/email.service";
import { LlmService } from "@/services/ai/llm.service";
import { currentUser } from "@clerk/nextjs/server";
import { WorkspaceNameEditor, AutomationControls } from "@/components/crm/SettingsClient";
import Link from "next/link";
import { Mail, ShieldCheck, Plug, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const TABS = ["Workspace", "Team", "Automations", "Security", "Integrations"] as const;
type SettingsTab = (typeof TABS)[number];

const ACTION_COLORS: Record<string, string> = {
  CREATE: "text-secondary",
  UPDATE: "text-tertiary",
  DELETE: "text-danger",
  CONVERT: "text-primary",
  AGENTIC_SWEEP: "text-primary",
};

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { workspaceId, userId, isSales } = await requireWorkspace();
  // Team, automations, integrations and the audit log are admin-only.
  if (isSales) redirect("/");
  const { tab } = await searchParams;
  const activeTab: SettingsTab = TABS.includes((tab ?? "Workspace") as SettingsTab)
    ? ((tab ?? "Workspace") as SettingsTab)
    : "Workspace";

  const [workspace, memberships, auditRows, pendingInvites, clerkUser, joinRequests] = await Promise.all([
    db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    }),
    db.query.workspaceMemberships.findMany({
      where: eq(workspaceMemberships.workspaceId, workspaceId),
      with: {
        user: { columns: { id: true, firstName: true, lastName: true, email: true, createdAt: true } },
        role: { columns: { name: true } },
      },
    }),
    db.query.auditLogs.findMany({
      where: eq(auditLogs.workspaceId, workspaceId),
      orderBy: [desc(auditLogs.createdAt)],
      limit: 30,
      with: { actor: { columns: { firstName: true, lastName: true } } },
    }),
    db.query.workspaceInvites.findMany({
      where: and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "PENDING")),
      orderBy: [desc(workspaceInvites.createdAt)],
      with: { invitedBy: { columns: { firstName: true, lastName: true } } },
    }),
    currentUser(),
    db.query.workspaceInvites.findMany({
      where: and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.status, "AWAITING_APPROVAL")),
      orderBy: [desc(workspaceInvites.acceptedAt)],
      with: { acceptedBy: { columns: { firstName: true, lastName: true, email: true } } },
    }),
  ]);

  if (!workspace) throw new Error("Workspace not found");

  const leadPlaces = activeTab === "Team" ? await getLeadPlacesAction() : [];
  const teamMembers = memberships.map((m) => ({
    userId: m.user.id,
    name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.email,
    isSales: m.role?.name === SALES_ROLE,
  }));

  const emailOk = isEmailConfigured();
  const emailProvider = getEmailProvider();
  const llm = LlmService.getStatus();
  const fromNote = process.env.EMAIL_FROM
    ? ` from ${process.env.EMAIL_FROM.replace(/<.*>/, "").trim() || process.env.EMAIL_FROM}`
    : "";

  const counts = {
    Team: `${memberships.length}${pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ""}`,
    Security: `${auditRows.length}`,
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-muted">Workspace</p>
          <Display>Settings</Display>
        </div>
        <Badge variant="outline" className="font-mono-code text-xs self-start sm:self-auto">
          {workspace.name.toUpperCase()} · {workspace.slug}
        </Badge>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sidebar Nav — URL-driven tabs, real counts */}
        <nav className="space-y-1">
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/settings?tab=${t}`}
              data-active={activeTab === t}
              className="w-full flex items-center justify-between text-left px-4 py-3 rounded-md text-sm font-medium transition-colors text-text-secondary hover:text-text-primary hover:bg-surface-elevated/50 data-[active=true]:bg-surface-elevated data-[active=true]:text-text-primary"
            >
              <span>{t}</span>
              {counts[t as keyof typeof counts] && (
                <span className="font-mono-code text-xs text-text-muted">{counts[t as keyof typeof counts]}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Content */}
        <div className="md:col-span-2 space-y-8">
          {activeTab === "Workspace" && (
            <GlassPanel>
              <div className="mb-6 border-b border-border-subtle pb-4">
                <PageTitle>Workspace Settings</PageTitle>
                <Body className="mt-1">Your primary Aexyl workspace.</Body>
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <SectionTitle>Workspace Name</SectionTitle>
                  <WorkspaceNameEditor name={workspace.name} />
                </div>
                <div className="space-y-2">
                  <SectionTitle>Workspace URL Slug</SectionTitle>
                  <p className="font-mono-code text-sm text-text-secondary">{workspace.slug}</p>
                </div>
                <div className="space-y-2">
                  <SectionTitle>Created</SectionTitle>
                  <p className="text-sm text-text-secondary flex items-center">
                    <Clock className="mr-2 h-3.5 w-3.5 text-text-muted" />
                    {formatDate(workspace.createdAt)}
                  </p>
                </div>
                <div className="space-y-2">
                  <SectionTitle>Your Account</SectionTitle>
                  <div className="space-y-1 text-sm text-text-secondary">
                    <p className="flex items-center">
                      <Mail className="mr-2 h-3.5 w-3.5 text-text-muted" />
                      {clerkUser?.emailAddresses?.find((e) => e.id === clerkUser?.primaryEmailAddressId)
                        ?.emailAddress ?? "—"}
                    </p>
                    <p className="flex items-center">
                      <ShieldCheck className="mr-2 h-3.5 w-3.5 text-text-muted" />
                      Auth via Clerk · signed in as {clerkUser?.firstName ?? "Operator"}
                    </p>
                  </div>
                </div>
              </div>
            </GlassPanel>
          )}

          {activeTab === "Team" && (
            <GlassPanel>
              <div className="mb-6 border-b border-border-subtle pb-4">
                <PageTitle>Team</PageTitle>
                <Body className="mt-1">
                  {memberships.length} member{memberships.length === 1 ? "" : "s"} in this workspace.
                </Body>
              </div>

              {/* Invite by email */}
              <div className="mb-6">
                <SectionTitle className="mb-2">Invite a teammate</SectionTitle>
                <InviteForm />
              </div>

              {joinRequests.length > 0 && (
                <div className="mb-6 space-y-2">
                  <SectionTitle className="mb-2">Waiting for approval ({joinRequests.length})</SectionTitle>
                  <Body className="text-xs">
                    These people accepted an invite with the invited Google account. Check each one is who you expect before approving.
                  </Body>
                  {joinRequests.map((r) => (
                    <JoinRequestRow
                      key={r.id}
                      request={{
                        id: r.id,
                        email: r.email,
                        name: [r.acceptedBy?.firstName, r.acceptedBy?.lastName].filter(Boolean).join(" ") || null,
                        signedInEmail: r.acceptedBy?.email ?? null,
                        acceptedAt: (r.acceptedAt ?? r.updatedAt).toISOString(),
                      }}
                    />
                  ))}
                </div>
              )}

              {pendingInvites.length > 0 && (
                <div className="mb-6 space-y-2">
                  <SectionTitle className="mb-2">Pending invites ({pendingInvites.length})</SectionTitle>
                  {pendingInvites.map((inv) => (
                    <PendingInviteRow
                      key={inv.id}
                      invite={{
                        id: inv.id,
                        email: inv.email,
                        token: inv.token,
                        createdAt: inv.createdAt.toISOString(),
                        expiresAt: inv.expiresAt.toISOString(),
                        invitedBy: inv.invitedBy ?? null,
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="mb-6 space-y-2">
                <SectionTitle className="mb-2">Assign leads</SectionTitle>
                <AssignLeads places={leadPlaces} members={teamMembers} />
              </div>

              <div className="space-y-3">
                {memberships.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-low px-4 py-3"
                  >
                    <div className="min-w-[40%] flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {[m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || "Unnamed member"}
                        {m.user.id === userId && (
                          <span className="ml-2 text-xs font-mono-code text-primary">YOU</span>
                        )}
                      </p>
                      <p className="text-xs text-text-muted truncate">{m.user.email}</p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <MemberRoleSelect membershipId={m.id} isSales={m.role?.name === SALES_ROLE} disabled={m.user.id === userId || isOwnerEmail(m.user.email)} />
                      <p className="mt-1 text-xs text-text-muted">joined {formatDate(m.user.createdAt)}</p>
                      {m.user.id !== userId && !isOwnerEmail(m.user.email) && (
                        <div className="mt-1.5">
                          <RemoveMemberButton membershipId={m.id} name={[m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.email} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {memberships.length === 0 && (
                  <Body className="text-sm">No members found — this should not happen.</Body>
                )}
              </div>
            </GlassPanel>
          )}

          {activeTab === "Automations" && (
            <GlassPanel>
              <div className="mb-6 border-b border-border-subtle pb-4">
                <PageTitle>Automations</PageTitle>
                <Body className="mt-1">
                  Controls the agentic follow-up sweep. Changes take effect immediately.
                </Body>
              </div>
              <AutomationControls
                settings={{
                  id: workspace.id,
                  name: workspace.name,
                  slug: workspace.slug,
                  createdAt: workspace.createdAt.toISOString(),
                  sweepEnabled: workspace.sweepEnabled,
                  sweepFollowUpDays: workspace.sweepFollowUpDays,
                  staleLeadDays: workspace.staleLeadDays,
                }}
              />
            </GlassPanel>
          )}

          {activeTab === "Security" && (
            <GlassPanel>
              <div className="mb-6 border-b border-border-subtle pb-4">
                <PageTitle>Audit Log</PageTitle>
                <Body className="mt-1">
                  Last {auditRows.length} recorded action{auditRows.length === 1 ? "" : "s"} in this workspace.
                </Body>
              </div>
              <div className="space-y-1">
                {auditRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-4 rounded-md px-3 py-2 hover:bg-surface-elevated/40 transition"
                  >
                    <div className="min-w-0">
                      <p className="text-xs">
                        <span className={`font-mono-code font-semibold ${ACTION_COLORS[row.action] ?? "text-text-secondary"}`}>
                          {row.action}
                        </span>{" "}
                        <span className="text-text-secondary">{row.entity}</span>
                      </p>
                      {row.metadata != null && typeof row.metadata === "object" && Object.keys(row.metadata).length > 0 && (
                        <p className="text-xs font-mono-code text-text-muted truncate">
                          {JSON.stringify(row.metadata)}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-text-secondary">
                        {[row.actor?.firstName, row.actor?.lastName].filter(Boolean).join(" ") || "system"}
                      </p>
                      <p className="text-xs text-text-muted">{formatTime(row.createdAt)}</p>
                    </div>
                  </div>
                ))}
                {auditRows.length === 0 && <Body className="text-sm">No audit events yet.</Body>}
              </div>
            </GlassPanel>
          )}

          {activeTab === "Integrations" && (
            <GlassPanel>
              <div className="mb-6 border-b border-border-subtle pb-4">
                <PageTitle>Integrations</PageTitle>
                <Body className="mt-1">Connected services and their live status.</Body>
              </div>
              <div className="space-y-3">
                {[
                  { name: "PostgreSQL 16 (Docker)", desc: "Primary CRM datastore — aexyl-postgres container", status: "CONNECTED", ok: true },
                  { name: "Clerk", desc: "Authentication & identity", status: "CONNECTED", ok: true },
                  {
                    name: `AI Copilot — ${llm.model ?? "deterministic engine"}`,
                    desc: llm.available
                      ? `Full LLM reasoning online via ${llm.provider}. Ask the copilot anything.`
                      : "Deterministic engine active. Add OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY to .env.local for full conversational reasoning (free keys: openrouter.ai)",
                    status: llm.available ? "CONNECTED" : "HEURISTIC MODE",
                    ok: llm.available,
                  },
                  {
                    name: `Email Delivery — ${emailProvider === "brevo" ? "Brevo" : emailProvider === "resend" ? "Resend" : "not configured"}`,
                    desc: emailOk
                      ? `Configured — invite & outreach emails send automatically${fromNote}`
                      : "Add BREVO_API_KEY (app.brevo.com) or RESEND_API_KEY (resend.com) to .env.local to send invites & outreach automatically",
                    status: emailOk ? "CONNECTED" : "NOT CONFIGURED",
                    ok: emailOk,
                  },
                ].map((i) => (
                  <div
                    key={i.name}
                    className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-low px-4 py-3"
                  >
                    <div className="flex items-center min-w-0">
                      <Plug className={`mr-3 h-4 w-4 shrink-0 ${i.ok ? "text-secondary" : "text-text-muted"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{i.name}</p>
                        <p className="text-xs text-text-muted truncate">{i.desc}</p>
                      </div>
                    </div>
                    <Badge variant={i.ok ? "secondary" : "outline"} className="font-mono-code text-xs shrink-0 ml-4">
                      {i.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
