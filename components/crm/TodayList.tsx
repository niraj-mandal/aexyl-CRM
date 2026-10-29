"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, MapPin, Phone, PhoneCall, Sparkles, UserPlus } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { OutreachLead } from "@/app/actions/outreach.actions";
import { googleMapsUrl } from "@/lib/maps";
import { LeadOutcomeSelect } from "@/components/crm/LeadQuickActions";
import { TodayProgress } from "@/components/crm/TodayProgress";
import { Skeleton } from "@/components/ui/skeleton";
import { CallSession, LeadQuickView } from "@/components/crm/LeadQuickView";
import { HotLeads } from "@/components/crm/HotLeads";
import { GymAvatar } from "@/components/ui/gym-avatar";
import type { TodayPlan } from "@/lib/today";

/** Apple inset-grouped list: one rounded block, hairlines between rows. */
const GROUP = "stagger divide-y divide-border-subtle overflow-hidden rounded-xl bg-surface-high/60";

export function TodayList() {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<OutreachLead | null>(null);
  const [calling, setCalling] = useState(false);

  // GET (not a server action) so it loads in parallel with the dashboard's other panels.
  // The server picks today's gyms; we send our local midnight so "today" is the user's day.
  const load = () =>
    fetch(`/api/crm/today?start=${encodeURIComponent(new Date(new Date().setHours(0, 0, 0, 0)).toISOString())}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TodayPlan>) : Promise.reject(r.status)))
      .then(setPlan)
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);

  // The phone tab bar's "Call" button links to /?call=1: open the session once leads are in.
  useEffect(() => {
    if (!plan || new URLSearchParams(window.location.search).get("call") !== "1") return;
    window.history.replaceState(null, "", window.location.pathname);
    const id = requestAnimationFrame(() => setCalling(true));
    return () => cancelAnimationFrame(id);
  }, [plan]);

  if (failed) return null;
  if (!plan) {
    return (
      <div role="status" aria-label="Planning your day" className="space-y-6">
        <Skeleton className="h-[164px] rounded-2xl" />
        <GlassPanel className="space-y-3 p-5">
          <Skeleton className="h-4 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </GlassPanel>
      </div>
    );
  }

  const { followUps, toContact, hot, moreReachable, noContactCount, contactedToday } = plan;
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
        icon={PhoneCall}
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
          <div className={GROUP}>
            {followUps.map((l) => (
              <TodayRow key={l.id} lead={l} note={overdue(l) ? "Overdue" : "Due today"} urgent={overdue(l)} onOutcome={load} onOpen={() => setOpen(l)} />
            ))}
          </div>
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
          <div className={GROUP}>
            {toContact.map((l) => <TodayRow key={l.id} lead={l} note={`Score ${l.score}`} onOpen={() => setOpen(l)} />)}
          </div>
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
    <HotLeads leads={hot} onOpen={setOpen} />
    </>
  );
}

function TodayRow({ lead, note, urgent, onOutcome, onOpen }: { lead: OutreachLead; note: string; urgent?: boolean; onOutcome?: () => void; onOpen: () => void }) {
  const tel = lead.phone?.replace(/[^\d+]/g, "");
  return (
    // The name button stretches over the whole row (after:inset-0), so on a phone the entire row opens the
    // gym's sheet; the Call button and desktop actions sit above it (relative z-10) and stay tappable.
    <div className="relative flex items-center justify-between gap-2 px-3.5 py-3 transition-colors hover:bg-[var(--fill-hover)] sm:flex-wrap sm:py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <GymAvatar name={lead.businessName} size={34} />
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-sm font-semibold text-text-primary after:absolute after:inset-0 hover:text-primary sm:text-xs"
          >
            {lead.businessName}
          </button>
          <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className={urgent ? "text-danger font-semibold" : ""}>{note}</span>
            {lead.phone && (
              <a href={`tel:${tel}`} className="num relative z-10 hidden items-center gap-1 text-success hover:underline sm:inline-flex">
                <Phone className="h-3 w-3" /> {lead.phone}
              </a>
            )}
          </p>
        </div>
      </div>
      {/* Phone: one big Call button; everything else lives in the sheet the row opens. */}
      {tel && (
        <a
          href={`tel:${tel}`}
          aria-label={`Call ${lead.businessName}`}
          className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success sm:hidden"
        >
          <Phone className="h-5 w-5" />
        </a>
      )}
      <div className="relative z-10 hidden flex-wrap items-center gap-1.5 sm:flex">
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
