import { Display, MonoLabel, PageTitle, Body, Metadata } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { LogActivityForm } from "@/components/crm/LogActivityForm";
import { ConvertLeadButton } from "@/components/crm/ConvertLeadButton";
import { ConfirmLeadButton } from "@/components/crm/ConfirmLeadButton";
import { CallScriptCard } from "@/components/crm/CallScriptCard";
import { ActivityService } from "@/services/activity.service";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { formatDistanceToNow, format } from "date-fns";

const STATUS_VARIANT: Record<string, "primary" | "secondary" | "tertiary" | "outline" | "danger"> = {
  NEW: "outline",
  CONTACTED: "secondary",
  QUALIFIED: "primary",
  UNQUALIFIED: "danger",
  NURTURE: "tertiary",
  CONVERTED: "primary",
  LOST: "danger",
};

function Field({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  return (
    <div>
      <MonoLabel className="block mb-1">{label}</MonoLabel>
      {value === null || value === undefined || value === "" ? (
        <span className="text-sm text-text-muted">—</span>
      ) : href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-sm text-text-primary hover:text-primary hover:underline break-words">
          {value}
        </a>
      ) : (
        <span className="text-sm text-text-primary break-words">{value}</span>
      )}
    </div>
  );
}

function formatDate(d: Date | null | undefined) {
  if (!d) return null;
  return format(d, "d MMM yyyy, HH:mm");
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: leadId } = await params;

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)),
    with: {
      company: true,
      contact: true,
      owner: true,
      deals: true,
    },
  });

  if (!lead) notFound();

  const activities = await ActivityService.getActivitiesForEntity(workspaceId, "leadId", leadId);

  const company = lead.company;
  const contact = lead.contact;
  const displayName = company?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "Untitled lead";

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      {/* Header */}
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <section className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Display>{displayName}</Display>
            <Badge variant={STATUS_VARIANT[lead.status] ?? "outline"} className="font-mono-code">
              {lead.status}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span className="text-text-secondary">Owner: {lead.owner ? `${lead.owner.firstName ?? ""} ${lead.owner.lastName ?? ""}`.trim() || lead.owner.email : "Unassigned"}</span>
            <span className="text-border-strong">•</span>
            <span className="text-text-secondary">Source: {lead.source || "Unknown"}</span>
            <span className="text-border-strong">•</span>
            <span className="text-text-secondary">Created {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}</span>
          </div>
        </section>

        <div className="flex flex-col items-end space-y-3">
          <div className="flex flex-wrap gap-3 justify-end">
            <LogActivityForm entityType="lead" entityId={leadId} />
            {lead.status !== "CONVERTED" && lead.status !== "LOST" && (
              <ConfirmLeadButton
                leadId={leadId}
                companyName={company?.name || "this prospect"}
                contactName={contact ? `${contact.firstName} ${contact.lastName ?? ""}`.trim() : undefined}
              />
            )}
            {lead.status !== "CONVERTED" && (
              <ConvertLeadButton leadId={leadId} companyName={company?.name || "Prospect"} />
            )}
          </div>
          {lead.status === "CONVERTED" && (
            <span className="text-[11px] font-mono-code text-secondary">LEAD CONVERTED — see pipeline</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="md:col-span-2 space-y-6">
          {/* Lead record — every field in the leads table */}
          <GlassPanel className="p-6">
            <div className="flex items-center justify-between mb-6">
              <PageTitle>Lead record</PageTitle>
              <MonoLabel>LEAD // {lead.id.slice(0, 8)}</MonoLabel>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
              <Field label="Status" value={lead.status} />
              <Field label="Stage" value={lead.stage} />
              <Field label="Temperature" value={lead.temperature} />
              <Field label="Score" value={lead.score} />
              <Field label="Source" value={lead.source} />
              <Field
                label="Owner"
                value={lead.owner ? (lead.owner.firstName || lead.owner.email) : null}
              />
              <Field label="Last contacted" value={formatDate(lead.lastContactedAt)} />
              <Field label="Next follow-up" value={formatDate(lead.nextFollowUpAt)} />
              <Field label="Created" value={formatDate(new Date(lead.createdAt))} />
              <Field label="Last updated" value={formatDate(new Date(lead.updatedAt))} />
              <div className="sm:col-span-2">
                <Field label="Notes" value={lead.notes} />
              </div>
            </div>
          </GlassPanel>

          {/* Company */}
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-5">
              <PageTitle>Company</PageTitle>
              {company?.status && <Badge variant="outline" className="font-mono-code">{company.status}</Badge>}
            </div>
            {company ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <Field label="Name" value={company.name} />
                <Field label="Website" value={company.website} href={company.website ? (company.website.startsWith("http") ? company.website : `https://${company.website}`) : undefined} />
                <Field label="Industry" value={company.industry} />
                <Field label="Location" value={company.location} />
                <Field label="Size" value={company.size} />
                <Field label="Source" value={company.source} />
                <div className="sm:col-span-2">
                  <Field label="Notes" value={company.notes} />
                </div>
              </div>
            ) : (
              <Body>No company linked to this lead.</Body>
            )}
          </GlassCard>

          {/* Contact */}
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-5">
              <PageTitle>Contact</PageTitle>
              {contact?.status && <Badge variant="outline" className="font-mono-code">{contact.status}</Badge>}
            </div>
            {contact ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                <Field label="Name" value={`${contact.firstName} ${contact.lastName ?? ""}`.trim()} />
                <Field label="Job title" value={contact.jobTitle} />
                <Field label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
                <Field label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
                <Field label="LinkedIn" value={contact.linkedinUrl} href={contact.linkedinUrl ?? undefined} />
                <Field label="Company" value={contact.companyId ? (company?.name ?? null) : null} />
                <div className="sm:col-span-2">
                  <Field label="Notes" value={contact.notes} />
                </div>
              </div>
            ) : (
              <Body>No contact assigned.</Body>
            )}
          </GlassCard>

          {/* Linked deals */}
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-5">
              <PageTitle>Deals</PageTitle>
              <Badge variant="secondary" className="font-mono-code">{lead.deals.length}</Badge>
            </div>
            {lead.deals.length === 0 ? (
              <Body>No deals yet — convert this lead to open a pipeline deal.</Body>
            ) : (
              <div className="space-y-2">
                {lead.deals.map((deal) => (
                  <Link
                    key={deal.id}
                    href={`/sales/pipeline`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle/60 bg-surface-lowest/40 px-3 py-2.5 hover:bg-surface-elevated/60 transition group"
                  >
                    <span className="text-sm text-text-primary group-hover:text-primary transition truncate">
                      {deal.name}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {deal.value && (
                        <span className="font-mono-code text-[11px] text-text-secondary">
                          ${Number(deal.value).toLocaleString("en-US")}
                        </span>
                      )}
                      <Badge variant="outline" className="font-mono-code text-[10px]">{deal.stage}</Badge>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Activity timeline */}
          <GlassPanel className="p-6">
            <h3 className="text-lg font-medium text-text-primary mb-6">Activity Timeline</h3>
            <ActivityTimeline activities={activities} />
          </GlassPanel>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Lead Status</h4>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-text-secondary mb-1">Stage</div>
                <div className="font-medium text-text-primary">{lead.stage || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Temperature</div>
                <div className={`font-medium ${
                  lead.temperature === "HOT" ? "text-danger" :
                  lead.temperature === "WARM" ? "text-warning" : "text-text-primary"
                }`}>
                  {lead.temperature}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Score</div>
                <div className="text-2xl font-light text-text-primary">{lead.score}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Next follow-up</div>
                <div className="text-sm text-text-primary">
                  {lead.nextFollowUpAt ? format(new Date(lead.nextFollowUpAt), "d MMM yyyy") : "Not scheduled"}
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Contact Info</h4>
            {contact ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-text-secondary mb-0.5">Name</div>
                  <div className="text-sm text-text-primary">{contact.firstName} {contact.lastName}</div>
                </div>
                {contact.jobTitle && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">Role</div>
                    <div className="text-sm text-text-primary">{contact.jobTitle}</div>
                  </div>
                )}
                {contact.email && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">Email</div>
                    <a href={`mailto:${contact.email}`} className="text-sm text-text-primary hover:underline">{contact.email}</a>
                  </div>
                )}
                {contact.phone && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">Phone</div>
                    <a href={`tel:${contact.phone}`} className="text-sm text-text-primary hover:underline">{contact.phone}</a>
                  </div>
                )}
                {contact.linkedinUrl && (
                  <div>
                    <div className="text-xs text-text-secondary mb-0.5">LinkedIn</div>
                    <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Open profile</a>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-text-muted">No contact assigned.</div>
            )}
          </GlassCard>

          <CallScriptCard leadId={leadId} />

          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Record</h4>
            <div className="space-y-2">
              <Metadata className="block">Lead ID: {lead.id}</Metadata>
              <Metadata className="block">Created: {format(new Date(lead.createdAt), "d MMM yyyy, HH:mm")}</Metadata>
              <Metadata className="block">Updated: {format(new Date(lead.updatedAt), "d MMM yyyy, HH:mm")}</Metadata>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
