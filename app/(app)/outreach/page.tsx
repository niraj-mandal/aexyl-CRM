"use client";

import { useEffect, useMemo, useState } from "react";
import { Display, PageTitle, MonoLabel } from "@/components/ui/typography";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
} from "lucide-react";
import {
  generatePitchAction,
  getOutreachLeadsAction,
  markContactedAction,
  type OutreachLead,
} from "@/app/actions/outreach.actions";

type Pitch = Extract<Awaited<ReturnType<typeof generatePitchAction>>, { ok: true }>["pitch"];
type Channel = "WHATSAPP" | "CALL" | "EMAIL";

const WEBSITE_LABEL: Record<string, { text: string; variant: "danger" | "secondary" | "outline" }> = {
  NO_WEBSITE: { text: "No website", variant: "danger" },
  BROKEN_WEBSITE: { text: "Broken website", variant: "danger" },
  POOR_WEBSITE: { text: "Poor website", variant: "secondary" },
  BASIC_WEBSITE: { text: "Basic website", variant: "outline" },
  GOOD_WEBSITE: { text: "Good website", variant: "outline" },
};

const PREFS_KEY = "aexyl.pitchWriter.prefs";
const DEFAULT_OFFER = "We design simple, mobile-friendly websites for local businesses so new customers can find you on Google.";

function loadPrefs(): { senderName?: string; offer?: string; tone?: string; language?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePrefs(prefs: Record<string, string>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable (private mode); preferences just won't persist.
  }
}

/** wa.me needs the full international number without "+" or spaces. */
function waNumber(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 ? digits : null;
}

export default function OutreachPage() {
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [query, setQuery] = useState("");
  const [contactableOnly, setContactableOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [senderName, setSenderName] = useState("");
  const [offer, setOffer] = useState("");
  const [tone, setTone] = useState("friendly");
  const [language, setLanguage] = useState("english");

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [whatsapp, setWhatsapp] = useState("");
  const [callScript, setCallScript] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [marking, setMarking] = useState<Channel | null>(null);
  const [marked, setMarked] = useState<Channel | null>(null);

  useEffect(() => {
    const prefs = loadPrefs();
    getOutreachLeadsAction()
      .then((list) => {
        setLeads(list);
        setSenderName(prefs.senderName ?? "");
        setOffer(prefs.offer || DEFAULT_OFFER);
        if (prefs.tone) setTone(prefs.tone);
        if (prefs.language) setLanguage(prefs.language);
      })
      .finally(() => setLoadingLeads(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter(
      (l) =>
        (!contactableOnly || l.phone || l.email) &&
        (!q || l.businessName.toLowerCase().includes(q) || (l.area ?? "").toLowerCase().includes(q)),
    );
  }, [leads, query, contactableOnly]);

  const selected = leads.find((l) => l.id === selectedId) ?? null;
  const contactableCount = leads.filter((l) => l.phone || l.email).length;

  const selectLead = (id: string) => {
    setSelectedId(id);
    setPitch(null);
    setError(null);
    setMarked(null);
  };

  const generate = async () => {
    if (!selected) return;
    setGenerating(true);
    setError(null);
    setMarked(null);
    savePrefs({ senderName, offer, tone, language });
    try {
      const res = await generatePitchAction(selected.id, { offer, senderName, tone, language });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPitch(res.pitch);
      setWhatsapp(res.pitch.whatsapp);
      setCallScript(res.pitch.callScript);
      setEmailSubject(res.pitch.emailSubject);
      setEmailBody(res.pitch.emailBody);
    } catch {
      setError("Couldn't write the pitch right now. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      setError("Clipboard is blocked in this browser — select the text and copy it manually.");
    }
  };

  const markContacted = async (channel: Channel, message: string) => {
    if (!selected) return;
    setMarking(channel);
    try {
      const res = await markContactedAction(selected.id, channel, message);
      if (res.ok) {
        setMarked(channel);
        setLeads((prev) =>
          prev.map((l) =>
            l.id === selected.id
              ? { ...l, lastContactedAt: res.contactedAt, status: l.status === "NEW" ? "CONTACTED" : l.status }
              : l,
          ),
        );
      } else {
        setError(res.error);
      }
    } finally {
      setMarking(null);
    }
  };

  const wa = waNumber(selected?.phone ?? null);
  const telHref = selected?.phone ? `tel:${selected.phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-primary block mb-1">OUTREACH // AI PITCH WRITER</MonoLabel>
          <Display>Outreach Engine</Display>
          <p className="mt-1 text-xs text-text-muted">
            Pick a lead and get a WhatsApp message, call script and email written from its real details. You review and send — nothing goes out automatically.
          </p>
        </div>
        <Badge variant="secondary" className="font-mono-code text-[11px] self-start sm:self-auto">
          CONTACTABLE LEADS: {contactableCount}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead picker */}
        <GlassPanel className="p-4 space-y-3 lg:max-h-[calc(100vh-14rem)] flex flex-col">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads by name or area…"
              aria-label="Search leads"
              className="w-full rounded-lg bg-surface-low border border-border-subtle pl-8 pr-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={contactableOnly}
              onChange={(e) => setContactableOnly(e.target.checked)}
              className="accent-primary"
            />
            Only leads with a phone or email
          </label>

          <div className="flex-1 overflow-y-auto scrollbar-thin -mx-1 px-1 space-y-1.5" role="listbox" aria-label="Leads">
            {loadingLeads ? (
              <div className="flex items-center justify-center py-10 text-xs text-text-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading leads…
              </div>
            ) : visible.length === 0 ? (
              <p className="py-10 text-center text-xs text-text-muted">No leads match.</p>
            ) : (
              visible.map((l) => {
                const ws = l.websiteStatus ? WEBSITE_LABEL[l.websiteStatus] : null;
                const active = l.id === selectedId;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => selectLead(l.id)}
                    className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border-subtle bg-surface-low hover:bg-surface-high/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-text-primary truncate">{l.businessName}</span>
                      {l.lastContactedAt && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Contacted" />}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                      {l.phone ? (
                        <span className="inline-flex items-center gap-1 text-success"><Phone className="h-3 w-3" />{l.phone}</span>
                      ) : l.email ? (
                        <span className="inline-flex items-center gap-1 text-success"><Mail className="h-3 w-3" />{l.email}</span>
                      ) : (
                        <span>No contact listed</span>
                      )}
                      {ws && <Badge variant={ws.variant} className="text-[9px]">{ws.text}</Badge>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </GlassPanel>

        {/* Composer */}
        <div className="lg:col-span-2 space-y-6">
          <GlassPanel className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-subtle">
              <div className="min-w-0">
                <PageTitle className="text-base truncate">{selected ? selected.businessName : "Select a lead"}</PageTitle>
                {selected && (
                  <p className="text-[11px] text-text-muted truncate">
                    {[selected.area, selected.phone ?? selected.email ?? "no contact details"].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              {pitch && (
                <Badge variant={pitch.engine === "llm" ? "primary" : "outline"} className="font-mono-code text-[9px] shrink-0">
                  {pitch.engine === "llm" ? "AI DRAFT" : "TEMPLATE (AI UNAVAILABLE)"}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <MonoLabel className="block mb-1.5 text-[10px]">YOUR NAME / BUSINESS</MonoLabel>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="e.g. Niraj from AEXYL"
                  className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <MonoLabel className="block mb-1.5 text-[10px]">TONE</MonoLabel>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full rounded-lg bg-surface-low border border-border-subtle px-2 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
                  >
                    <option value="friendly">Friendly</option>
                    <option value="professional">Professional</option>
                  </select>
                </div>
                <div>
                  <MonoLabel className="block mb-1.5 text-[10px]">LANGUAGE</MonoLabel>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full rounded-lg bg-surface-low border border-border-subtle px-2 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
                  >
                    <option value="english">English</option>
                    <option value="hinglish">Hinglish</option>
                    <option value="hindi">Hindi</option>
                  </select>
                </div>
              </div>
            </div>
            <div>
              <MonoLabel className="block mb-1.5 text-[10px]">WHAT YOU OFFER</MonoLabel>
              <textarea
                rows={2}
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                className="w-full rounded-lg bg-surface-low border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary focus:outline-none"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-lg bg-danger/10 border border-danger/30 p-3 text-xs text-danger">
                {error}
              </div>
            )}

            <button
              onClick={generate}
              disabled={!selected || generating}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "Writing pitch… (can take ~20s)" : pitch ? "Rewrite pitch" : "Write pitch"}
            </button>
          </GlassPanel>

          {!pitch && !generating && (
            <div className="rounded-lg bg-surface-low/50 border border-dashed border-border-subtle p-6 text-center">
              <p className="text-xs text-text-muted">
                {selected
                  ? "Hit Write pitch to draft a WhatsApp message, call script and email for this lead."
                  : "Pick a lead on the left to get started. Leads with a phone number are listed first."}
              </p>
            </div>
          )}

          {pitch && selected && (
            <div className="space-y-4">
              {/* WhatsApp */}
              <GlassCard className="p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-success" />
                  <MonoLabel className="text-success">WHATSAPP MESSAGE</MonoLabel>
                  <span className="ml-auto text-[10px] text-text-muted">{whatsapp.length} chars</span>
                </div>
                <textarea
                  rows={5}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  aria-label="WhatsApp message"
                  className="w-full rounded-lg bg-surface-lowest border border-border-subtle px-3 py-2 text-xs leading-relaxed text-text-primary focus:border-primary focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => copy("wa", whatsapp)} icon={copied === "wa" ? Check : Copy} label={copied === "wa" ? "Copied" : "Copy"} />
                  {wa ? (
                    <a
                      href={`https://wa.me/${wa}?text=${encodeURIComponent(whatsapp)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1.5 text-[11px] font-semibold text-success hover:bg-success/25 transition-colors"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> Open in WhatsApp
                    </a>
                  ) : (
                    <span className="self-center text-[10px] text-text-muted">No phone number — copy and send manually.</span>
                  )}
                  <MarkButton channel="WHATSAPP" marking={marking} marked={marked} onClick={() => markContacted("WHATSAPP", whatsapp)} />
                </div>
              </GlassCard>

              {/* Call script */}
              <GlassCard className="p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <MonoLabel className="text-primary">CALL SCRIPT</MonoLabel>
                </div>
                <textarea
                  rows={9}
                  value={callScript}
                  onChange={(e) => setCallScript(e.target.value)}
                  aria-label="Call script"
                  className="w-full rounded-lg bg-surface-lowest border border-border-subtle px-3 py-2 text-xs leading-relaxed text-text-primary focus:border-primary focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => copy("call", callScript)} icon={copied === "call" ? Check : Copy} label={copied === "call" ? "Copied" : "Copy"} />
                  {telHref && (
                    <a
                      href={telHref}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/25 transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5" /> Call {selected.phone}
                    </a>
                  )}
                  <MarkButton channel="CALL" marking={marking} marked={marked} onClick={() => markContacted("CALL", callScript)} />
                </div>
              </GlassCard>

              {/* Email */}
              <GlassCard className="p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-tertiary" />
                  <MonoLabel className="text-tertiary">EMAIL</MonoLabel>
                </div>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  aria-label="Email subject"
                  className="w-full rounded-lg bg-surface-lowest border border-border-subtle px-3 py-2 text-xs font-semibold text-text-primary focus:border-primary focus:outline-none"
                />
                <textarea
                  rows={7}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  aria-label="Email body"
                  className="w-full rounded-lg bg-surface-lowest border border-border-subtle px-3 py-2 text-xs leading-relaxed text-text-primary focus:border-primary focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    onClick={() => copy("email", `Subject: ${emailSubject}\n\n${emailBody}`)}
                    icon={copied === "email" ? Check : Copy}
                    label={copied === "email" ? "Copied" : "Copy"}
                  />
                  {selected.email ? (
                    <a
                      href={`mailto:${selected.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-tertiary/15 px-2.5 py-1.5 text-[11px] font-semibold text-tertiary hover:bg-tertiary/25 transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" /> Open in email app
                    </a>
                  ) : (
                    <span className="self-center text-[10px] text-text-muted">No email on file for this lead.</span>
                  )}
                  <MarkButton channel="EMAIL" marking={marking} marked={marked} onClick={() => markContacted("EMAIL", `${emailSubject}\n\n${emailBody}`)} />
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon: Icon, label }: { onClick: () => void; icon: typeof Copy; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-low px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-high/50 transition-colors"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function MarkButton({
  channel,
  marking,
  marked,
  onClick,
}: {
  channel: Channel;
  marking: Channel | null;
  marked: Channel | null;
  onClick: () => void;
}) {
  const done = marked === channel;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={marking !== null || done}
      title="Logs this outreach on the lead and moves it from NEW to CONTACTED"
      className={`ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-default ${
        done ? "bg-success/15 text-success" : "border border-border-subtle bg-surface-low text-text-muted hover:text-text-primary disabled:opacity-50"
      }`}
    >
      {marking === channel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {done ? "Logged as contacted" : "Mark as contacted"}
    </button>
  );
}
