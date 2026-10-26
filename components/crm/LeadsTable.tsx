"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Flame, MapPin, MessageCircle, PhoneCall, Users } from "lucide-react";
import type { OutreachLead } from "@/app/actions/outreach.actions";
import { LeadOutcomeSelect, LeadPhoneEditor } from "@/components/crm/LeadQuickActions";
import { DeleteLeadButton } from "@/components/crm/DeleteLeadButton";
import { CallSession, LeadQuickView } from "@/components/crm/LeadQuickView";
import { ReachedOutToggle } from "@/components/crm/ReachedOutToggle";
import { EmptyState } from "@/components/ui/empty-state";
import { GymAvatar } from "@/components/ui/gym-avatar";
import { googleMapsUrl } from "@/lib/maps";
import { waNumber } from "@/lib/phone";
import { LEAD_STAGE } from "@/lib/stages";

export type LeadRow = OutreachLead & { contactName: string | null; ownerName: string | null };

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LeadRow | null>(null);
  const [calling, setCalling] = useState(false);
  // Gyms on this page (best first) you haven't reached yet and can actually call.
  const toCall = rows.filter((l) => l.phone && !l.lastContactedAt && !["CONVERTED", "LOST", "UNQUALIFIED"].includes(l.status));

  if (rows.length === 0) {
    return (
      <div className="glass-panel">
        <EmptyState
          icon={Users}
          title="No leads yet"
          body="Find gyms without websites in Lead Discovery, approve the ones you like, and they'll land here ready to call."
          action={{ href: "/bdr?tab=discovery", label: "Open Lead Discovery" }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {toCall.length > 0 && (
      <button
        type="button"
        onClick={() => setCalling(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
      >
        <PhoneCall className="h-4 w-4" /> Call this list <span className="num opacity-80">{toCall.length}</span>
      </button>
    )}
    {calling && <CallSession queue={toCall} onClose={() => setCalling(false)} onChanged={() => router.refresh()} />}
    <div className="glass-panel overflow-hidden">
      {open && <LeadQuickView lead={open} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
      <div className="relative w-full overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-subtle text-xs text-text-muted">
            <tr>
              <th className="w-10 py-3 pl-3 pr-0 sm:pl-4 font-medium"><span className="sr-only">Reached out</span></th>
              <th className="px-2 py-3 font-medium sm:px-4">Gym</th>
              <th className="px-2 py-3 font-medium sm:px-4">Phone</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Stage</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Score</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Owner</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="stagger divide-y divide-border-subtle">
            {rows.map((lead) => {
              const stage = LEAD_STAGE[lead.status] ?? { label: lead.status, color: "#9B9BA4" };
              const wa = waNumber(lead.phone);
              return (
                <tr key={lead.id} className="group transition-colors hover:bg-surface-high/40">
                  <td className="py-3 pl-3 pr-0 sm:pl-4">
                    <ReachedOutToggle leadId={lead.id} name={lead.businessName} done={Boolean(lead.lastContactedAt)} />
                  </td>
                  <td className="max-w-[150px] px-2 py-3 sm:max-w-[260px] sm:px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="relative shrink-0">
                        <GymAvatar name={lead.businessName} size={34} />
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-glass)]"
                          style={{ background: stage.color }}
                          aria-hidden
                        />
                      </span>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setOpen(lead)}
                          className="block max-w-full truncate text-left font-medium text-text-primary hover:text-primary"
                        >
                          {lead.businessName}
                        </button>
                        <p className="truncate text-xs text-text-muted">
                          {[lead.contactName, lead.area].filter(Boolean).join(" · ") || "No address"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 sm:px-4">
                    <div className="flex items-center gap-1.5">
                      <LeadPhoneEditor leadId={lead.id} phone={lead.phone} />
                      {wa && (
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${lead.businessName}`}
                          className="rounded p-1 text-text-muted hover:bg-success/10 hover:text-success"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: `${stage.color}22`, color: stage.color }}
                    >
                      {stage.label}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="num inline-flex items-center gap-1 text-text-secondary">
                      {lead.score}
                      {lead.temperature === "HOT" && <Flame className="h-3 w-3 text-danger" aria-label="Hot" />}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-text-secondary md:table-cell">{lead.ownerName}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* On phones the popup (tap the name) has the outcome buttons. */}
                      <span className="hidden sm:inline-flex">
                        <LeadOutcomeSelect leadId={lead.id} name={lead.businessName} />
                      </span>
                      <a
                        href={googleMapsUrl(lead.businessName, lead.place)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${lead.businessName} on Google Maps`}
                        className="rounded p-1.5 text-text-muted hover:bg-surface-high hover:text-primary"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                      </a>
                      <Link
                        href={`/sales/leads/${lead.id}`}
                        aria-label={`Full details for ${lead.businessName}`}
                        className="rounded p-1.5 text-text-muted hover:bg-surface-high hover:text-primary"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      <DeleteLeadButton leadId={lead.id} leadName={lead.businessName} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
