import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { ArrowLeft, Clock, Handshake, History, Info, MapPin, MessageCircle, Phone, Sparkles } from "lucide-react";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { LogActivityForm } from "@/components/crm/LogActivityForm";
import { ConvertLeadButton } from "@/components/crm/ConvertLeadButton";
import { ConfirmLeadButton } from "@/components/crm/ConfirmLeadButton";
import { CallScriptCard } from "@/components/crm/CallScriptCard";
import { LeadOutcomeSelect } from "@/components/crm/LeadQuickActions";
import { LeadStageStepper } from "@/components/crm/LeadQuickView";
import { ActivityService } from "@/services/activity.service";
import { GlassPanel } from "@/components/ui/glass-card";
import { Display } from "@/components/ui/typography";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { googleMapsUrl, placeFromLeadSource } from "@/lib/maps";
import { waNumber } from "@/lib/phone";
import { DEAL_STAGES, LEAD_STAGE, rupees } from "@/lib/stages";

function Field({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-text-primary">
        {empty ? (
          <span className="text-text-muted">—</span>
        ) : href ? (
          <a href={href} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

const day = (d: Date | null | undefined) => (d ? format(d, "d MMM yyyy") : null);

const actionBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: leadId } = await params;

  const [lead, activities] = await Promise.all([
    db.query.leads.findFirst({
      where: and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)),
      with: { company: true, contact: true, owner: true, deals: true },
    }),
    ActivityService.getActivitiesForEntity(workspaceId, "leadId", leadId),
  ]);
  if (!lead) notFound();

  const { company, contact } = lead;
  const name = company?.name || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "Untitled lead";
  const stage = LEAD_STAGE[lead.status] ?? { label: lead.status, color: "#9B9BA4" };
  const place = company?.location || placeFromLeadSource(lead.source);
  const tel = contact?.phone?.replace(/[^\d+]/g, "");
  const wa = waNumber(contact?.phone ?? null);
  const realContact = contact && !/^team\b/i.test(contact.firstName);
  const overdue = lead.nextFollowUpAt && lead.nextFollowUpAt < new Date(new Date().setHours(0, 0, 0, 0));
  const open = lead.status !== "CONVERTED" && lead.status !== "LOST";

  return (
    <div className="max-w-6xl space-y-6 animate-in fade-in duration-150">
      <Link href="/sales/leads" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary">
        <ArrowLeft className="h-3.5 w-3.5" /> Leads
      </Link>

      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: `${stage.color}22`, color: stage.color }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.color }} />
              {stage.label}
            </span>
            <Display className="mt-2 break-words">{name}</Display>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
              {place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-text-muted" /> {place}
                </span>
              )}
              <span className="text-text-muted">· added {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tel && (
              <a href={`tel:${tel}`} className={`${actionBtn} border-success/40 text-success hover:text-success`}>
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
            {wa && (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={actionBtn}>
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
            <a href={googleMapsUrl(name, place)} target="_blank" rel="noopener noreferrer" className={actionBtn}>
              <MapPin className="h-4 w-4" /> Maps
            </a>
            <Link
              href={`/outreach?lead=${lead.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5"
            >
              <Sparkles className="h-4 w-4" /> Write pitch
            </Link>
          </div>
        </div>

        <GlassPanel className="space-y-4 p-5">
          <LeadStageStepper status={lead.status} />
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
            {open && <LeadOutcomeSelect leadId={lead.id} name={name} />}
            <LogActivityForm entityType="lead" entityId={leadId} />
            {open && (
              <ConfirmLeadButton
                leadId={leadId}
                companyName={company?.name || "this prospect"}
                contactName={realContact ? `${contact.firstName} ${contact.lastName ?? ""}`.trim() : undefined}
              />
            )}
            {lead.status !== "CONVERTED" && <ConvertLeadButton leadId={leadId} companyName={company?.name || "Prospect"} />}
          </div>
        </GlassPanel>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column: history first — it's what you read before a follow-up call */}
        <div className="space-y-6 lg:col-span-2">
          <GlassPanel className="p-5">
            <SectionHeader icon={History} title="Activity" meta={`${activities.length} events`} />
            <div className="mt-5">
              <ActivityTimeline activities={activities} />
            </div>
          </GlassPanel>

          <GlassPanel className="p-5">
            <SectionHeader icon={Handshake} title="Deals" meta={String(lead.deals.length)} />
            {lead.deals.length === 0 ? (
              <p className="mt-4 text-sm text-text-muted">No deal yet. Mark this gym Interested and one is created automatically.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {lead.deals.map((deal) => {
                  const ds = DEAL_STAGES.find((s) => s.key === deal.stage);
                  return (
                    <Link
                      key={deal.id}
                      href={`/sales/deals/${deal.id}`}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-lowest/40 px-3 py-2.5 transition-colors hover:border-border-strong"
                    >
                      <span className="truncate text-sm text-text-primary group-hover:text-primary">{deal.name}</span>
                      <span className="flex shrink-0 items-center gap-3 text-xs">
                        {deal.value && <span className="num text-text-secondary">{rupees(Number(deal.value))}</span>}
                        <span className="inline-flex items-center gap-1.5 text-text-secondary">
                          <span className="h-2 w-2 rounded-full" style={{ background: ds?.color ?? "#9B9BA4" }} />
                          {ds?.label ?? deal.stage}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-5">
            <SectionHeader icon={Info} title="Details" />
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Phone" value={contact?.phone} href={tel ? `tel:${tel}` : undefined} />
              <Field label="Email" value={contact?.email} href={contact?.email ? `mailto:${contact.email}` : undefined} />
              <Field label="Contact person" value={realContact ? `${contact.firstName} ${contact.lastName ?? ""}`.trim() : null} />
              <Field label="Role" value={contact?.jobTitle} />
              <Field
                label="Website"
                value={company?.website ?? "No website"}
                href={company?.website ? (company.website.startsWith("http") ? company.website : `https://${company.website}`) : undefined}
              />
              <Field label="Industry" value={company?.industry} />
              <Field label="Address" value={company?.location} />
              <Field label="Source" value={lead.source} />
              {(lead.notes || company?.notes) && (
                <div className="sm:col-span-2">
                  <Field label="Notes" value={[lead.notes, company?.notes].filter(Boolean).join("\n\n")} />
                </div>
              )}
            </dl>
          </GlassPanel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <GlassPanel className="p-5">
            <SectionHeader icon={Clock} title="At a glance" />
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-text-muted">Score</dt>
                <dd className="num mt-0.5 text-2xl font-medium text-text-primary">{lead.score}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Temperature</dt>
                <dd className={`mt-1 text-sm font-medium ${lead.temperature === "HOT" ? "text-danger" : lead.temperature === "WARM" ? "text-tertiary" : "text-text-primary"}`}>
                  {lead.temperature ? lead.temperature.charAt(0) + lead.temperature.slice(1).toLowerCase() : "—"}
                </dd>
              </div>
              <Field label="Last contacted" value={day(lead.lastContactedAt) ?? "Never"} />
              <div>
                <dt className="text-xs text-text-muted">Next follow-up</dt>
                <dd className={`mt-0.5 text-sm ${overdue ? "font-medium text-danger" : "text-text-primary"}`}>
                  {day(lead.nextFollowUpAt) ?? "Not set"}
                  {overdue && " · overdue"}
                </dd>
              </div>
              <Field label="Owner" value={lead.owner ? lead.owner.firstName || lead.owner.email : "Unassigned"} />
              <Field label="Updated" value={day(new Date(lead.updatedAt))} />
            </dl>
          </GlassPanel>

          <CallScriptCard leadId={leadId} />

          {!contact?.phone && (
            <GlassPanel>
              <EmptyState
                icon={Phone}
                title="No phone yet"
                body="Open this gym on Google Maps, copy its number, and add it from the Leads list."
              />
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
