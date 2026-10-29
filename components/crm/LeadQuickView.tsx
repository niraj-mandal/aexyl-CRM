"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, MapPin, MessageCircle, Phone, PhoneOff, ScrollText, SkipForward, Sparkles, Timer, X } from "lucide-react";
import { buildCallScript, buildWhatsApp, defaultLang, suggestedWhatsApp, WHATSAPP_KINDS, type ScriptLang } from "@/lib/call-script";
import { DEMO_STYLES, DEMO_TEMPLATES, defaultStyle, defaultTemplate, demoPath, type DemoStyle, type DemoTemplate } from "@/lib/demo";
import type { OutreachLead } from "@/app/actions/outreach.actions";
import { markContactedAction } from "@/app/actions/outreach.actions";
import { OUTCOME_OPTIONS, recordOutcome } from "@/components/crm/LeadQuickActions";
import { announceDialog, queueWithUndo } from "@/components/ui/undo-toast";
import { googleMapsUrl } from "@/lib/maps";
import { waNumber } from "@/lib/phone";
import { GymAvatar } from "@/components/ui/gym-avatar";

const STEPS = ["New", "Contacted", "Interested", "Won"];
const STEP_OF: Record<string, number> = { NEW: 0, CONTACTED: 1, NURTURE: 1, QUALIFIED: 2, CONVERTED: 3 };
const SESSION_MS = 25 * 60_000;

// Apple's projection: where a flick would come to rest (scroll-like deceleration).
const project = (velocity: number, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);
const SHEET_SPRING = { type: "spring" as const, bounce: 0, duration: 0.4 };

/**
 * Native <dialog> (focus trap, Escape, backdrop) that behaves like an iOS sheet on phones:
 * slides up, can be dragged down by its grabber (1:1, interruptible, with momentum), and
 * leaves the way it came. On larger screens it fades and scales from 96%.
 * `children` gets `close`, which animates out before unmounting.
 */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: (close: () => void) => React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const y = useRef(0);
  const anim = useRef<ReturnType<typeof animate> | null>(null);
  const done = useRef(false);
  const drag = useRef<{ start: number; samples: { y: number; t: number }[] } | null>(null);

  const sheet = () => window.matchMedia("(max-width: 639px)").matches;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const setY = (v: number) => {
    y.current = v;
    // At rest, no transform: a transformed dialog would trap the fixed undo toast inside its box.
    if (ref.current) ref.current.style.transform = v === 0 ? "" : `translateY(${v}px)`;
  };
  // Always start from the live value, so grabbing mid-animation never jumps.
  const springY = (to: number, velocity = 0, onComplete?: () => void) => {
    anim.current?.stop();
    anim.current = animate(y.current, to, { ...SHEET_SPRING, velocity, onUpdate: setY, onComplete });
  };

  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    announceDialog();
    if (reduced()) {
      anim.current = animate(0, 1, { duration: 0.2, onUpdate: (o) => (el.style.opacity = String(o)) });
    } else if (sheet()) {
      setY(el.offsetHeight);
      springY(0);
    } else {
      anim.current = animate(0, 1, {
        ...SHEET_SPRING,
        duration: 0.3,
        onUpdate: (p) => {
          el.style.opacity = String(Math.min(1, p));
          el.style.transform = `scale(${0.96 + 0.04 * p})`;
        },
        onComplete: () => (el.style.transform = ""),
      });
    }
    return () => {
      anim.current?.stop();
      requestAnimationFrame(announceDialog); // after React removes the dialog
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    ref.current?.close();
    announceDialog();
    onClose();
  };
  const close = (velocity = 0) => {
    const el = ref.current;
    if (!el || done.current) return;
    if (reduced()) {
      anim.current?.stop();
      anim.current = animate(1, 0, { duration: 0.15, onUpdate: (o) => (el.style.opacity = String(o)), onComplete: finish });
    } else if (sheet()) springY(el.offsetHeight, velocity, finish);
    else {
      anim.current?.stop();
      anim.current = animate(1, 0, {
        duration: 0.15,
        onUpdate: (p) => {
          el.style.opacity = String(p);
          el.style.transform = `scale(${0.96 + 0.04 * p})`;
        },
        onComplete: finish,
      });
    }
  };

  const onGrab = (e: React.PointerEvent) => {
    anim.current?.stop(); // interruptible: catch it mid-flight
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture (e.g. the pointer is already gone): the drag still tracks while over the grabber.
    }
    drag.current = { start: e.clientY - y.current, samples: [{ y: e.clientY, t: e.timeStamp }] };
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.start;
    // Rubber-band when pulled up past the resting position.
    setY(raw >= 0 ? raw : (raw * 0.55 * 100) / (100 + 0.55 * Math.abs(raw)));
    d.samples = [...d.samples.slice(-4), { y: e.clientY, t: e.timeStamp }];
  };
  const onRelease = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !ref.current) return;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const velocity = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
    // Decide from where the gesture is going, not where it let go.
    if (y.current + project(velocity) > ref.current.offsetHeight * 0.35) close(velocity);
    else springY(0, velocity);
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault(); // Escape: animate out instead of vanishing
        close();
      }}
      onClose={finish}
      onClick={(e) => e.target === ref.current && close()}
      className="m-auto max-h-[92dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl max-sm:mb-0 max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none border border-border-subtle bg-[var(--surface-glass-floating)] p-0 backdrop-blur-2xl text-text-primary shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {/* iOS grabber: drag down to dismiss. touch-none so the browser doesn't scroll instead. */}
      <div
        onPointerDown={onGrab}
        onPointerMove={onDrag}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        className="sticky top-0 z-20 flex h-6 cursor-grab touch-none items-center justify-center sm:hidden"
        aria-hidden
      >
        <span className="h-1.5 w-10 rounded-full bg-text-muted/50" />
      </div>
      {/* `close` reads refs only when a button is tapped, never during render. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {children(() => close())}
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
function LeadPanel({
  lead,
  onAct,
  onChanged,
  onUndo,
  scriptOpen = false,
  doneLabel = "Done",
}: {
  lead: OutreachLead;
  onAct: () => void;
  onChanged: () => void;
  onUndo?: () => void;
  scriptOpen?: boolean;
  doneLabel?: string;
}) {
  // After "Interested" the panel stays for one step: send the demo while they're still warm.
  const [interested, setInterested] = useState(false);
  const advanced = useRef(false);
  const next = () => {
    advanced.current = true;
    onAct();
  };
  const step = STEP_OF[lead.status] ?? 0;
  const lost = lead.status === "LOST" || lead.status === "UNQUALIFIED";
  const tel = lead.phone?.replace(/[^\d+]/g, "");
  const wa = waNumber(lead.phone);
  const suggested = suggestedWhatsApp(lead.status);
  // Assam gyms get Assamese scripts; a teammate who doesn't speak it can switch to Hinglish.
  const localLang = defaultLang(lead);
  const [lang, setLang] = useState<ScriptLang>(localLang);
  // Defaults differ per gym, so neighbouring gyms don't get the same-looking demo.
  const [demoTemplate, setDemoTemplate] = useState<DemoTemplate>(() => defaultTemplate(lead.id));
  const [demoStyle, setDemoStyle] = useState<DemoStyle>(() => defaultStyle(lead.id));
  const [demoColor, setDemoColor] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const demoUrl = `${origin}${demoPath(lead.businessName, lead.id, demoStyle, demoColor ?? undefined, demoTemplate)}`;
  // "Copied" belongs to the exact link that was copied, not to whatever style is picked next.
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const copiedDemo = copiedUrl === demoUrl;
  const demoPicker = (
    <DemoPicker
      url={demoUrl}
      template={demoTemplate}
      onTemplate={setDemoTemplate}
      style={demoStyle}
      color={demoColor}
      copied={copiedDemo}
      onStyle={(s) => {
        setDemoStyle(s);
        setDemoColor(null);
      }}
      onColor={setDemoColor}
      onCopy={() => navigator.clipboard.writeText(demoUrl).then(() => setCopiedUrl(demoUrl), () => {})}
    />
  );
  const opts = { onDone: onChanged, onUndo };

  // A short tap on phones for the moments that matter, fired with the visual (same frame).
  const buzz = () => navigator.vibrate?.(15);
  const outcome = (value: string) => {
    if (value === "INTERESTED") {
      buzz();
      setInterested(true);
      recordOutcome(lead.id, value, lead.businessName, {
        onDone: onChanged,
        // Undo before moving on just reopens the buttons; after moving on, the session brings this gym back.
        onUndo: () => {
          setInterested(false);
          if (advanced.current) {
            advanced.current = false;
            onUndo?.();
          }
        },
      });
      return;
    }
    if (value === "WON") buzz();
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
        <GymAvatar name={lead.businessName} size={44} className="mb-3" />
        <h2 className="truncate text-lg font-semibold">{lead.businessName}</h2>
        <p className="mt-0.5 truncate text-xs text-text-muted">{lead.area ?? "No address"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {lead.websiteStatus && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">
              {lead.websiteStatus === "NO_WEBSITE" ? "No website" : lead.websiteStatus.replace("_", " ").toLowerCase()}
            </span>
          )}
          {/* Temperature is the potential signal; the numeric score only measures contact details. */}
          {lead.temperature && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                lead.temperature === "HOT" ? "bg-hot/15 text-hot" : lead.temperature === "WARM" ? "bg-warning/15 text-warning" : "bg-surface-high text-text-secondary"
              }`}
            >
              {lead.temperature.charAt(0) + lead.temperature.slice(1).toLowerCase()}
            </span>
          )}
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

      {interested && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          className="space-y-3 rounded-xl border border-success/30 bg-success/10 p-4"
        >
          <div className="flex items-center gap-3">
            <motion.span
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-white"
            >
              <Check className="h-5 w-5" />
            </motion.span>
            <div>
              <p className="text-sm font-semibold text-text-primary">Interested</p>
              <p className="text-xs text-text-secondary">Send the demo now, while it&apos;s fresh.</p>
            </div>
          </div>
          {demoPicker}
          {wa ? (
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent(buildWhatsApp("demo", lead, undefined, demoUrl, lang))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-success py-2.5 text-sm font-semibold text-white"
            >
              <MessageCircle className="h-4 w-4" /> Send demo on WhatsApp
            </a>
          ) : (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(demoUrl).then(() => setCopiedUrl(demoUrl), () => {})}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-success py-2.5 text-sm font-semibold text-white"
            >
              {copiedDemo ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copiedDemo ? "Copied" : "Copy demo link"}
            </button>
          )}
          <button type="button" onClick={next} className={`${btn} w-full`}>
            {doneLabel} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}

      {/* Right under Call: logging the result is the one thing done on every call. */}
      {!interested && !lost && lead.status !== "CONVERTED" && (
        <div className="space-y-2 rounded-xl border border-border-subtle p-3">
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
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            {primary.label} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <details open={scriptOpen} className="group rounded-xl border border-border-subtle bg-surface-lowest/60">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-text-secondary hover:text-text-primary">
          <ScrollText className="h-3.5 w-3.5" /> Call script for {lead.businessName}
          <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="max-h-64 space-y-3 overflow-y-auto border-t border-border-subtle px-3 py-3 text-xs leading-relaxed">
          {localLang !== "hinglish" && (
            <div role="group" aria-label="Script language" className="flex gap-1">
              {(["assamese", "hinglish"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium max-sm:min-h-8 ${
                    lang === l ? "border-border-strong bg-surface-high text-text-primary" : "border-border-subtle text-text-muted hover:text-text-primary"
                  }`}
                >
                  {l === "assamese" ? "Assamese" : "Hinglish"}
                </button>
              ))}
            </div>
          )}
          {buildCallScript(lead, undefined, lang).map((s) => (
            <section key={s.title}>
              <h3 className="mb-1 font-semibold text-text-primary">{s.title}</h3>
              <ul className="space-y-1 text-text-secondary">
                {s.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </details>

      {/* Before the call these wait one tap away; the Interested step above brings the demo forward. */}
      {!interested && (
        <details className="group/more rounded-xl border border-border-subtle">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-text-secondary hover:text-text-primary">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp & demo website
            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open/more:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-border-subtle px-3 py-3">
            {wa && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-text-muted">WhatsApp message</p>
                <div className="flex flex-wrap gap-1.5">
                  {WHATSAPP_KINDS.map(({ kind, label }) => (
                    <a
                      key={kind}
                      href={`https://wa.me/${wa}?text=${encodeURIComponent(buildWhatsApp(kind, lead, undefined, demoUrl, lang))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs max-sm:min-h-9 font-medium transition-colors ${
                        kind === suggested
                          ? "border-success/40 bg-success/15 text-success"
                          : "border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary"
                      }`}
                    >
                      <MessageCircle className="h-3 w-3" /> {label}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-text-muted">Demo website</p>
              {demoPicker}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

/** Style chips, custom colour, open and copy for the lead's demo website. */
function DemoPicker({
  url,
  style,
  color,
  copied,
  template,
  onTemplate,
  onStyle,
  onColor,
  onCopy,
}: {
  url: string;
  template: DemoTemplate;
  onTemplate: (t: DemoTemplate) => void;
  style: DemoStyle;
  color: string | null;
  copied: boolean;
  onStyle: (s: DemoStyle) => void;
  onColor: (c: string) => void;
  onCopy: () => void;
}) {
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs max-sm:min-h-9 font-medium transition-colors ${
      active ? "border-border-strong bg-surface-high text-text-primary" : "border-border-subtle text-text-secondary hover:text-text-primary"
    }`;
  return (
    <div className="space-y-2">
    <div role="group" aria-label="Demo layout" className="flex flex-wrap items-center gap-1.5">
      <span className="w-12 text-[11px] text-text-muted">Layout</span>
      {(Object.keys(DEMO_TEMPLATES) as DemoTemplate[]).map((t) => (
        <button key={t} type="button" onClick={() => onTemplate(t)} aria-pressed={template === t} className={chip(template === t)}>
          {DEMO_TEMPLATES[t]}
        </button>
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-12 text-[11px] text-text-muted">Colour</span>
      {(Object.keys(DEMO_STYLES) as DemoStyle[]).map((s) => (
        <button key={s} type="button" onClick={() => onStyle(s)} aria-pressed={style === s && !color} className={chip(style === s && !color)}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: DEMO_STYLES[s].accent }} /> {DEMO_STYLES[s].label}
        </button>
      ))}
      {/* The gym's own brand colour, e.g. from their logo or signboard. */}
      <label className={`relative cursor-pointer ${chip(Boolean(color))}`}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color ?? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
        Custom
        <input
          type="color"
          value={color ?? DEMO_STYLES[style].accent}
          onChange={(e) => onColor(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Custom brand colour"
        />
      </label>
      <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        Open <ArrowUpRight className="h-3 w-3" />
      </a>
      <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy link"}
      </button>
    </div>
    </div>
  );
}

const closeBtn = "absolute right-3 top-3 z-10 rounded-full p-1.5 text-text-muted hover:bg-surface-high hover:text-text-primary";

/** Popup for one lead: stage, contact buttons and outcomes without leaving the dashboard. */
export function LeadQuickView({ lead, onClose, onChanged }: { lead: OutreachLead; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal label={lead.businessName} onClose={onClose}>
      {(close) => (
        <>
          <button type="button" onClick={close} aria-label="Close" className={closeBtn}>
            <X className="h-4 w-4" />
          </button>
          <LeadPanel lead={lead} onAct={close} onChanged={onChanged} />
        </>
      )}
    </Modal>
  );
}

/** 25-minute power hour: one lead at a time from today's list, next appears after each outcome. */
export function CallSession({ queue, onClose, onChanged }: { queue: OutreachLead[]; onClose: () => void; onChanged: () => void }) {
  const [leads] = useState(queue); // freeze the order; the list reloads under us as outcomes save
  const [idx, setIdx] = useState(0);
  // +1 = forward through the stack (slides left), -1 = back via Undo (slides right).
  const [dir, setDir] = useState(1);
  const [logged, setLogged] = useState(0);
  const [endAt] = useState(() => Date.now() + SESSION_MS);
  const [now, setNow] = useState(() => Date.now());
  const still = useReducedMotion();
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, endAt - now);
  const finished = idx >= leads.length || left === 0;
  const lead = leads[idx];
  const mmss = `${String(Math.floor(left / 60_000)).padStart(2, "0")}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`;
  const go = (to: number) => {
    setDir(to >= idx ? 1 : -1);
    setIdx(to);
  };
  // Same path out and back: the finished card leaves the way the next one is coming from.
  const slide = {
    enter: (d: number) => (still ? { opacity: 0 } : { opacity: 0, x: d * 48 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => (still ? { opacity: 0 } : { opacity: 0, x: d * -48 }),
  };

  return (
    <Modal label="Call session" onClose={onClose}>
      {(close) => (
        <>
          <button type="button" onClick={close} aria-label="End session" className={closeBtn}>
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

          <div className="overflow-x-hidden">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={finished ? "done" : lead.id}
                custom={dir}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", bounce: 0, duration: 0.35 }}
              >
                {finished ? (
                  <div className="space-y-4 p-6 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
                      <Check className="h-6 w-6" />
                    </span>
                    <div>
                      <p className="text-lg font-semibold">{left === 0 ? "Time's up" : "List done"}</p>
                      <p className="num mt-1 text-sm text-text-muted">{logged} call{logged === 1 ? "" : "s"} logged this session.</p>
                    </div>
                    <button type="button" onClick={close} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white">
                      Close
                    </button>
                  </div>
                ) : (
                  <>
                    <LeadPanel
                      lead={lead}
                      scriptOpen
                      doneLabel="Next gym"
                      onChanged={onChanged}
                      onAct={() => {
                        setLogged((n) => n + 1);
                        go(idx + 1);
                      }}
                      onUndo={() => {
                        // Undo brings the lead back on screen so it can be redone.
                        setLogged((n) => Math.max(0, n - 1));
                        go(leads.indexOf(lead));
                      }}
                    />
                    <div className="px-5 pb-5">
                      <button
                        type="button"
                        onClick={() => go(idx + 1)}
                        className="flex w-full items-center justify-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
                      >
                        <SkipForward className="h-3.5 w-3.5" /> Skip for now
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      )}
    </Modal>
  );
}
