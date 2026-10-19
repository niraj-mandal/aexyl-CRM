"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, MapPin, Phone, Sparkles, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { OutreachLead } from "@/app/actions/outreach.actions";
import { googleMapsUrl } from "@/lib/maps";
import { LeadOutcomeSelect } from "@/components/crm/LeadQuickActions";
import { TodayProgress } from "@/components/crm/TodayProgress";
import { CallSession, LeadQuickView } from "@/components/crm/LeadQuickView";
import { HotLeads } from "@/components/crm/HotLeads";

const CLOSED = new Set(["CONVERTED", "LOST", "UNQUALIFIED"]);
const NEW_PER_DAY = 5;

/** Splits leads into today's follow-ups and the best never-contacted leads to pitch. */
export function planToday(leads: OutreachLead[], now = new Date()) {
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const open = leads.filter((l) => !CLOSED.has(l.status));

  const followUps = open
    .filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= endOfToday)
    .sort((a, b) => new Date(a.nextFollowUpAt!).getTime() - new Date(b.nextFollowUpAt!).getTime());

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const contactedToday = leads.filter((l) => l.lastContactedAt && new Date(l.lastContactedAt) >= startOfToday).length;

  const neverContacted = open.filter((l) => !l.lastContactedAt && !followUps.includes(l));
  const reachable = neverContacted.filter((l) => l.phone || l.email).sort((a, b) => b.score - a.score);

  return {
    followUps,
    toContact: reachable.slice(0, NEW_PER_DAY),
    moreReachable: Math.max(0, reachable.length - NEW_PER_DAY),
    noContactCount: neverContacted.length - reachable.length,
    contactedToday,
  };
}

export function TodayList() {
  const [leads, setLeads] = useState<OutreachLead[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<OutreachLead | null>(null);
  const [calling, setCalling] = useState(false);

  // GET (not a server action) so it loads in parallel with the dashboard's other panels.
  const load = () =>
    fetch("/api/crm/today", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<OutreachLead[]>) : Promise.reject(r.status)))
      .then(setLeads)
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);

  if (failed) return null;
  if (!leads) {
    return (
      <GlassPanel className="p-5 flex items-center text-xs text-text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Planning your day…
      </GlassPanel>
    );
  }

  const { followUps, toContact, moreReachable, noContactCount, contactedToday } = planToday(leads);
  // Contacted leads leave both lists, so today's target = done + what's still queued.
  const target = contactedToday + followUps.length + toContact.length;
  const next = followUps[0] ?? toContact[0] ?? null;
  const overdue = (l: OutreachLead) => new Date(l.nextFollowUpAt!) < new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <>
    <TodayProgress
      done={contactedToday}
      target={target}
      next={next}
      onOpenNext={() => next && setOpen(next)}
      onStart={followUps.length + toContact.length > 0 ? () => setCalling(true) : undefined}
    />
    {open && <LeadQuickView lead={open} onClose={() => setOpen(null)} onChanged={load} />}
    {calling && <CallSession queue={[...followUps, ...toContact]} onClose={() => setCalling(false)} onChanged={load} />}
    <GlassPanel className="p-5 space-y-5">
      <SectionHeader
        icon={Sparkles}
        title="Today's outreach"
        meta={`${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} · ${toContact.length} new`}
      />

      <section aria-label="Follow-ups due" className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <CalendarClock className="h-3.5 w-3.5 text-tertiary" /> Follow-ups due
        </h3>
        {followUps.length === 0 ? (
          <p className="text-xs text-text-muted">None due. Leads you mark as contacted come back here 3 days later.</p>
        ) : (
          followUps.map((l) => (
            <TodayRow key={l.id} lead={l} note={overdue(l) ? "Overdue" : "Due today"} urgent={overdue(l)} onOutcome={load} onOpen={() => setOpen(l)} />
          ))
        )}
      </section>

      <section aria-label="New leads to contact" className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
          <UserPlus className="h-3.5 w-3.5 text-secondary" /> New leads to contact
        </h3>
        {toContact.length === 0 ? (
          <p className="text-xs text-text-muted">
            No uncontacted leads with a phone or email.
            {noContactCount > 0 && " Look up numbers with the Maps button in Leads, or approve more in Lead Discovery."}
          </p>
        ) : (
          toContact.map((l) => <TodayRow key={l.id} lead={l} note={`Score ${l.score}`} onOpen={() => setOpen(l)} />)
        )}
        {(moreReachable > 0 || noContactCount > 0) && (
          <p className="text-xs text-text-muted">
            {moreReachable > 0 && `${moreReachable} more ready after these. `}
            {noContactCount > 0 && (
              <>
                {noContactCount} uncontacted lead{noContactCount === 1 ? " has" : "s have"} no phone yet —{" "}
                <Link href="/sales/leads" className="text-primary hover:underline">find numbers in Leads</Link>.
              </>
            )}
          </p>
        )}
      </section>
    </GlassPanel>
    <HotLeads leads={leads} onOpen={setOpen} />
    </>
  );
}

function TodayRow({ lead, note, urgent, onOutcome, onOpen }: { lead: OutreachLead; note: string; urgent?: boolean; onOutcome?: () => void; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-lowest/60 px-3 py-2 transition-colors hover:border-border-strong">
      <div className="min-w-0">
        <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-xs font-semibold text-text-primary hover:text-primary">
          {lead.businessName}
        </button>
        <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className={urgent ? "text-danger font-semibold" : ""}>{note}</span>
          {lead.phone && (
            <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="num inline-flex items-center gap-1 text-success hover:underline">
              <Phone className="h-3 w-3" /> {lead.phone}
            </a>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onOutcome && <LeadOutcomeSelect leadId={lead.id} name={lead.businessName} onDone={onOutcome} />}
        <a
          href={googleMapsUrl(lead.businessName, lead.place)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${lead.businessName} on Google Maps`}
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-muted hover:text-primary"
        >
          <MapPin className="h-3 w-3" /> Maps
        </a>
        <Link
          href={`/outreach?lead=${lead.id}`}
          className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/25"
        >
          <Sparkles className="h-3 w-3" /> Write pitch
        </Link>
      </div>
    </div>
  );
}
