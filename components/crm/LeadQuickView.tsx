"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, MapPin, MessageCircle, Phone, PhoneOff, SkipForward, Sparkles, Timer, X } from "lucide-react";
import type { OutreachLead } from "@/app/actions/outreach.actions";
import { markContactedAction } from "@/app/actions/outreach.actions";
import { OUTCOME_OPTIONS, recordOutcome } from "@/components/crm/LeadQuickActions";
import { queueWithUndo } from "@/components/ui/undo-toast";
import { googleMapsUrl } from "@/lib/maps";
import { waNumber } from "@/lib/phone";

const STEPS = ["New", "Contacted", "Interested", "Won"];
const STEP_OF: Record<string, number> = { NEW: 0, CONTACTED: 1, NURTURE: 1, QUALIFIED: 2, CONVERTED: 3 };
const SESSION_MS = 25 * 60_000;

/** Native <dialog>: focus trap, Escape and backdrop come from the platform. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-2xl border border-border-strong bg-surface-low p-0 text-text-primary shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150"
    >
      {children}
    </dialog>
  );
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

/** New → Contacted → Interested → Won, or a "lost" note. */
export function LeadStageStepper({ status }: { status: string }) {
  const step = STEP_OF[status] ?? 0;
  if (status === "LOST" || status === "UNQUALIFIED") {
    return <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">Marked as lost.</p>;
  }
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Lead stage">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? "step" : undefined}>
          <span className={`block h-1.5 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-surface-high"}`} />
          <span className={`mt-1.5 block text-xs ${i === step ? "font-semibold text-text-primary" : "text-text-muted"}`}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Lead details plus the actions that move it along. `onAct` fires once an action is queued. */
function LeadPanel({ lead, onAct, onChanged, onUndo }: { lead: OutreachLead; onAct: () => void; onChanged: () => void; onUndo?: () => void }) {
  const step = STEP_OF[lead.status] ?? 0;
  const lost = lead.status === "LOST" || lead.status === "UNQUALIFIED";
  const tel = lead.phone?.replace(/[^\d+]/g, "");
  const wa = waNumber(lead.phone);
  const opts = { onDone: onChanged, onUndo };

  const outcome = (value: string) => {
    recordOutcome(lead.id, value, lead.businessName, opts);
    onAct();
  };
  const noAnswer = () => {
    queueWithUndo(
      `No answer · ${lead.businessName}`,
      async () => {
        const res = await markContactedAction(lead.id, "CALL", "No answer");
        return res.ok ? { ok: true, message: "Logged. It'll come back in 3 days." } : res;
      },
      opts,
    );
    onAct();
  };

  // The video's "Move to Negotiation": one primary button for the next stage.
  const primary =
    step >= 2 ? OUTCOME_OPTIONS.find((o) => o.value === "WON")! : OUTCOME_OPTIONS.find((o) => o.value === "INTERESTED")!;
  const secondary = OUTCOME_OPTIONS.filter((o) => o.value !== primary.value);
  const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary";

  return (
    <div className="space-y-5 p-5">
      <div className="min-w-0 pr-8">
        <h2 className="truncate text-lg font-semibold">{lead.businessName}</h2>
        <p className="mt-0.5 truncate text-xs text-text-muted">{lead.area ?? "No address"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {lead.websiteStatus && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">
              {lead.websiteStatus === "NO_WEBSITE" ? "No website" : lead.websiteStatus.replace("_", " ").toLowerCase()}
            </span>
          )}
          <span className="num rounded-full bg-surface-high px-2 py-0.5 text-text-secondary">Score {lead.score}</span>
        </div>
      </div>

      <LeadStageStepper status={lead.status} />

      <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface-lowest/60 p-3 text-xs">
        <div>
          <dt className="text-text-muted">Last contacted</dt>
          <dd className="num mt-0.5 text-text-primary">{fmtDay(lead.lastContactedAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Next follow-up</dt>
          <dd className="num mt-0.5 text-text-primary">{fmtDay(lead.nextFollowUpAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-text-muted">Phone</dt>
          <dd className="num mt-0.5 text-text-primary">{lead.phone ?? "Not found yet"}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-4 gap-1.5">
        {tel ? (
          <a href={`tel:${tel}`} className={`${btn} border-success/40 text-success hover:text-success`}>
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        ) : (
          <span className={`${btn} opacity-40`} aria-disabled="true"><Phone className="h-3.5 w-3.5" /> Call</span>
        )}
        {wa ? (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={btn}>
            <MessageCircle className="h-3.5 w-3.5" /> Chat
          </a>
        ) : (
          <span className={`${btn} opacity-40`} aria-disabled="true"><MessageCircle className="h-3.5 w-3.5" /> Chat</span>
        )}
        <a href={googleMapsUrl(lead.businessName, lead.place)} target="_blank" rel="noopener noreferrer" className={btn}>
          <MapPin className="h-3.5 w-3.5" /> Maps
        </a>
        <Link href={`/outreach?lead=${lead.id}`} className={btn}>
          <Sparkles className="h-3.5 w-3.5" /> Pitch
        </Link>
      </div>

      {!lost && lead.status !== "CONVERTED" && (
        <div className="space-y-2 border-t border-border-subtle pt-4">
          <p className="text-xs font-medium text-text-muted">How did it go?</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={noAnswer} className={btn}>
              <PhoneOff className="h-3.5 w-3.5" /> No answer
            </button>
            {secondary.map((o) => (
              <button key={o.value} type="button" onClick={() => outcome(o.value)} className={btn}>
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => outcome(primary.value)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            {primary.label} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const closeBtn = "absolute right-3 top-3 z-10 rounded-full p-1.5 text-text-muted hover:bg-surface-high hover:text-text-primary";

/** Popup for one lead: stage, contact buttons and outcomes without leaving the dashboard. */
export function LeadQuickView({ lead, onClose, onChanged }: { lead: OutreachLead; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal label={lead.businessName} onClose={onClose}>
      <button type="button" onClick={onClose} aria-label="Close" className={closeBtn}>
        <X className="h-4 w-4" />
      </button>
      <LeadPanel lead={lead} onAct={onClose} onChanged={onChanged} />
    </Modal>
  );
}

/** 25-minute power hour: one lead at a time from today's list, next appears after each outcome. */
export function CallSession({ queue, onClose, onChanged }: { queue: OutreachLead[]; onClose: () => void; onChanged: () => void }) {
  const [leads] = useState(queue); // freeze the order; the list reloads under us as outcomes save
  const [idx, setIdx] = useState(0);
  const [logged, setLogged] = useState(0);
  const [endAt] = useState(() => Date.now() + SESSION_MS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, endAt - now);
  const finished = idx >= leads.length || left === 0;
  const lead = leads[idx];
  const mmss = `${String(Math.floor(left / 60_000)).padStart(2, "0")}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;

  return (
    <Modal label="Call session" onClose={onClose}>
      <button type="button" onClick={onClose} aria-label="End session" className={closeBtn}>
        <X className="h-4 w-4" />
      </button>
      <div className="border-b border-border-subtle px-5 pb-3 pt-4">
        <div className="flex items-center gap-3 pr-8 text-xs">
          <span className="font-semibold text-text-primary">Call session</span>
          <span className="num text-text-muted">{Math.min(idx + 1, leads.length)} / {leads.length}</span>
          <span className={`num ml-auto inline-flex items-center gap-1 ${left < 5 * 60_000 ? "text-danger" : "text-text-secondary"}`}>
            <Timer className="h-3.5 w-3.5" /> {mmss}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-high">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(Math.min(idx, leads.length) / Math.max(1, leads.length)) * 100}%` }} />
        </div>
      </div>

      {finished ? (
        <div className="space-y-4 p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">{left === 0 ? "Time's up" : "List done"}</p>
            <p className="num mt-1 text-sm text-text-muted">{logged} call{logged === 1 ? "" : "s"} logged this session.</p>
          </div>
          <button type="button" onClick={onClose} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-black">
            Close
          </button>
        </div>
      ) : (
        <>
          <LeadPanel
            key={lead.id}
            lead={lead}
            onChanged={onChanged}
            onAct={() => {
              setLogged((n) => n + 1);
              setIdx((i) => i + 1);
            }}
            onUndo={() => {
              // Undo brings the lead back on screen so it can be redone.
              const back = leads.indexOf(lead);
              setLogged((n) => Math.max(0, n - 1));
              setIdx(back);
            }}
          />
          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={() => setIdx((i) => i + 1)}
              className="flex w-full items-center justify-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
            >
              <SkipForward className="h-3.5 w-3.5" /> Skip for now
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
