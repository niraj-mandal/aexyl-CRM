"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink, RefreshCw, Sparkles, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import {
  dismissOutboundEventAction,
  getOutboundEventsAction,
  promoteOutboundEventAction,
} from "@/app/actions/ai.actions";

type Events = Awaited<ReturnType<typeof getOutboundEventsAction>>;
type EventItem = Events[number];

const labels: Record<string, string> = {
  HIRING: "Hiring",
  FUNDING: "Funding",
  EXPANSION: "Expansion",
  LAUNCH: "Launch",
  LEADERSHIP_CHANGE: "Leadership change",
  WEBSITE_CHANGE: "Website change",
  LOCATION_CHANGE: "Location change",
  ANNOUNCEMENT: "Announcement",
  OTHER: "Signal",
};

function scoreTone(score: number) {
  if (score >= 80) return "primary";
  if (score >= 65) return "secondary";
  return "outline";
}

export default function EventsPage() {
  const [events, setEvents] = useState<Events>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("NEW");
  const [query, setQuery] = useState("");\n  const [prepared, setPrepared] = useState<{ eventId: string; message: string; angle: string; reason: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setEvents(await getOutboundEventsAction(filter)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [filter]);

  const filtered = useMemo(() => events.filter((event) => {
    const text = [
      event.title,
      event.summary,
      event.company?.name,
      event.type,
    ].filter(Boolean).join(" ").toLowerCase();
    return text.includes(query.toLowerCase());
  }), [events, query]);

  const act = async (id: string, action: "promote" | "dismiss") => {
    setBusy(id);
    try {
      if (action === "promote") await promoteOutboundEventAction(id);
      else await dismissOutboundEventAction(id);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <MonoLabel className="mb-2 block text-primary">OUTBOUND OS // SIGNAL FEED</MonoLabel>
          <Display>Know when to reach out.</Display>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            External business events become timing signals. Review the evidence first; promoting a signal never sends a message.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-low px-4 py-2.5 text-xs font-semibold">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
        </button>
      </div>

      <GlassPanel className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["NEW", "New signals"],
              ["OUTREACH_READY", "Outreach ready"],
              ["DISMISSED", "Dismissed"],
            ].map(([value, label]) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${filter === value ? "border-primary/40 bg-primary/5 text-primary" : "border-border-subtle text-text-secondary"}`}>
                {label}
              </button>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search signals..." className="rounded-xl border border-border-subtle bg-surface-low px-3 py-2 text-sm outline-none md:w-72" />
        </div>
      </GlassPanel>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl bg-surface-low" />)}</div>
      ) : filtered.length === 0 ? (
        <GlassPanel className="p-14 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-text-muted" />
          <p className="mt-3 text-sm text-text-secondary">No signals in this view.</p>
          <p className="mt-1 text-xs text-text-muted">Signals appear here once the approved event research provider is connected.</p>
        </GlassPanel>
      ) : (
        <div className="space-y-3">
          {filtered.map((event: EventItem) => (
            <GlassPanel key={event.id} className="p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={scoreTone(event.relevanceScore) as any}>{event.relevanceScore}/100 signal</Badge>
                    <Badge variant="outline">{labels[event.type] ?? event.type}</Badge>
                    <Badge variant="outline">{event.confidence}% confidence</Badge>
                  </div>
                  <PageTitle className="mt-3 text-base">{event.title}</PageTitle>
                  <p className="mt-1 text-sm font-medium text-text-secondary">{event.company?.name ?? "Company signal"}</p>
                  {event.summary && <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">{event.summary}</p>}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    <span>Source: {event.source}</span>
                    {event.occurredAt && <span>· {new Date(event.occurredAt).toLocaleDateString()}</span>}
                    {event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="h-3 w-3" /> Evidence</a>}
                  </div>
                  {event.lead?.contact && (
                    <p className="mt-3 text-xs text-text-muted">
                      Existing lead: {[event.lead.contact.firstName, event.lead.contact.lastName].filter(Boolean).join(" ")}
                      {event.lead.contact.jobTitle ? ` · ${event.lead.contact.jobTitle}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2 lg:flex-col">
                  {filter === "NEW" && <>
                    <button disabled={busy === event.id} onClick={() => void act(event.id, "promote")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
                      <ArrowUpRight className="h-4 w-4" /> {busy === event.id ? "Updating..." : "Make outreach ready"}
                    </button>
                    <button disabled={busy === event.id} onClick={() => void act(event.id, "dismiss")} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-subtle px-4 py-2.5 text-xs font-semibold disabled:opacity-50">
                      <X className="h-4 w-4" /> Dismiss
                    </button>
                  </>}
                  {filter === "OUTREACH_READY" && (
                    <button disabled={busy === event.id} onClick={async () => {
                      setBusy(event.id);
                      try {
                        const result = await prepareEventOutreachAction(event.id, "EMAIL");
                        setPrepared({ eventId: event.id, message: result.message, angle: result.angle, reason: result.reason });
                      } finally { setBusy(null); }
                    }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
                      <Sparkles className="h-4 w-4" /> Prepare email
                    </button>
                  )}
                  {filter === "DISMISSED" && <Badge variant="outline">DISMISSED</Badge>}
                </div>
              </div>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  );
}
