"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import { Sparkles, Bot, Send, X, Keyboard, Copy, Check, ArrowRight, Cpu, Download, CheckCircle2, Globe, Mail, Phone, Loader2, Zap, Ban, PenLine, ListTodo, CalendarClock, MapPin, SquareCheck, Square, Flame, Paperclip, FileSpreadsheet as SheetIcon, UserPlus, Building2, Handshake, Trash2, Brain, Target, MailPlus, Play, Search, BarChart3 } from "lucide-react";
import {
  sendCopilotPromptAction,
  ingestSheetAction,
  discoverLeadsAction,
  discoverLocalLeadsAction,
  discoverGooglePlacesAction,
  enrichLeadAction,
  getCampaignAnalyticsAction,
  importDiscoveredLeadAction,
  importDiscoveredLeadsAction,
  executeCopilotWriteAction,
  type ImportLeadCandidate,
  type CopilotWriteResult,
  type IngestSheetResult,
} from "@/app/actions/ai.actions";
import { queueStaleFollowUpsAction } from "@/app/actions/crm.actions";
import { useRouter } from "next/navigation";

interface DiscoveryLead {
  companyName: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  description: string | null;
  emails: string[];
  phones: string[];
  socials: { linkedin?: string; twitter?: string };
  sourceQuery: string;
  sourceUrl: string | null;
  fitScore: number;
  fitReason: string;
}

/** Google Places discovery result — richer than OSM with ratings and reviews. */
interface GooglePlacesLead {
  companyName: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  openingHours: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string;
  googleMapsUrl: string | null;
  priceLevel: string | null;
  priority: "Hot" | "Warm" | "Cold";
  priorityReason: string;
  suggestedHook: string | null;
  sourceQuery: string;
  sourceUrl: string | null;
  fitScore: number;
  businessStatus: string | null;
  types: string[];
}

/** Local (OpenStreetMap) discovery result — distinct shape from web-search leads. */
interface LocalDiscoveryLead {
  companyName: string | null;
  website: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  phone: string | null;
  openingHours: string | null;
  lat: number | null;
  lng: number | null;
  osmId: string;
  priority: "Hot" | "Warm" | "Cold";
  priorityReason: string;
  suggestedHook: string | null;
  sourceQuery: string;
  sourceUrl: string | null;
  fitScore: number;
  contactHint: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  actions?: { label: string; actionType: string; payload: Record<string, unknown> }[];
  leads?: DiscoveryLead[];
  localLeads?: LocalDiscoveryLead[];
  googlePlacesLeads?: GooglePlacesLead[];
  notes?: string[];
  /** Excluded from copilot memory (UI-only scaffolding). */
  ephemeral?: boolean;
}

/** Server-held spreadsheet attachment — rows live server-side; the client keeps only ids and counts. */
interface AttachedSheet {
  sheetId: string;
  fileName: string;
  headers: string[];
  rowCount: number;
}

/** A whole-message Google Sheets share link is ingested as an attachment, not sent to the LLM. */
const SHEET_URL_RE = /^https?:\/\/(?:www\.)?docs\.google\.com\/spreadsheets\/\S+$/i;

type ImportState = "idle" | "importing" | "imported" | "error";

const WRITE_KINDS = new Set([
  "UPDATE_DEAL_STAGE", "LOG_ACTIVITY", "CREATE_TASK", "CREATE_FOLLOW_UP", "IMPORT_SHEET_LEADS",
  "CREATE_LEAD", "CREATE_DEAL", "CREATE_COMPANY", "CREATE_CONTACT",
  "UPDATE_LEAD", "UPDATE_DEAL", "UPDATE_CONTACT", "UPDATE_COMPANY",
  "DELETE_LEAD", "DELETE_DEAL", "SEND_EMAIL",
  "ENROLL_SEQUENCE", "CREATE_SEQUENCE", "HANDLE_OBJECTION", "ANALYZE_INTENT",
]);
const isWriteKind = (t: string) => WRITE_KINDS.has(t);

const noopSubscribe = () => () => {};
const SHEET_FILE_RE = /\.(csv|xlsx|xls|tsv|txt)$/i;

export function AiCopilotDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [engine, setEngine] = useState<"llm" | "deterministic" | null>(null);
  const [importStates, setImportStates] = useState<Record<string, { state: ImportState; message?: string }>>({});
  const [writeStates, setWriteStates] = useState<Record<string, { state: "pending" | "armed" | "executing" | "done" | "declined" | "error"; message?: string }>>({});
  const [sheet, setSheet] = useState<AttachedSheet | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isMac = useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  // Sent-prompt history for ↑/↓ recall; index -1 means "not browsing".
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Arm→confirm timers: an armed proposal decays back to pending.
  const armTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hello, Operator. I am AEXYL — your AI CRM Copilot with full CRM control. I can create leads, deals, companies & contacts, update any record, send emails, manage outreach sequences, handle objections, analyze intent, and discover new prospects — all through natural language. Try: \"create a lead for Acme Corp\", \"move the Tesla deal to negotiation\", \"email john@acme.com a follow-up\", or \"find gyms in Austin\".",
      ephemeral: true,
    },
  ]);

  const router = useRouter();

  const setImport = (key: string, state: ImportState, message?: string) =>
    setImportStates((prev) => ({ ...prev, [key]: { state, message } }));

  const applySheetResult = (res: IngestSheetResult) => {
    if (!res.success || !res.sheetId) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Couldn't attach the sheet: ${res.error ?? "unknown error."}`, ephemeral: true },
      ]);
      return;
    }
    setSheet({ sheetId: res.sheetId, fileName: res.fileName ?? "sheet", headers: res.headers ?? [], rowCount: res.rowCount ?? 0 });
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: `📊 Attached ${res.fileName} — ${res.rowCount} row${res.rowCount === 1 ? "" : "s"} × ${res.headers?.length ?? 0} columns.${res.truncated ? " (parsed up to the size cap)" : ""} Ask what's in it, or say "add all the data from the sheet to the leads" to import every row.`,
        ephemeral: true,
      },
    ]);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (file) await attachSheetFile(file);
  };

  const attachSheetFile = async (file: File) => {
    if (sheetBusy) return;
    setMessages((prev) => [...prev, { role: "user", text: `📎 ${file.name}`, ephemeral: true }]);
    setSheetBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      applySheetResult(await ingestSheetAction(fd));
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Couldn't read that file — export it again from Google Sheets as .csv or .xlsx.", ephemeral: true },
      ]);
    } finally {
      setSheetBusy(false);
    }
  };

  const handleSheetUrl = async (url: string) => {
    setMessages((prev) => [...prev, { role: "user", text: `📎 ${url}`, ephemeral: true }]);
    setSheetBusy(true);
    try {
      const fd = new FormData();
      fd.append("url", url);
      applySheetResult(await ingestSheetAction(fd));
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Couldn't fetch that sheet — make sure it's shared as 'Anyone with the link'.", ephemeral: true },
      ]);
    } finally {
      setSheetBusy(false);
    }
  };

  const handleSend = async (userPrompt?: string) => {
    const queryText = userPrompt || prompt;
    if (!queryText.trim() || loading || discovering || sheetBusy) return;

    // A pasted Google Sheets share link attaches the sheet instead of chatting.
    const trimmed = queryText.trim();
    if (!userPrompt) {
      setSentHistory((h) => (h[h.length - 1] === trimmed ? h : [...h, trimmed].slice(-50)));
    }
    setHistoryIndex(-1);
    if (SHEET_URL_RE.test(trimmed)) {
      if (!userPrompt) setPrompt("");
      await handleSheetUrl(trimmed);
      return;
    }

    // Conversation memory: the last 10 real turns (excluding UI-only messages)
    // so follow-ups like "why that one?" resolve against prior context.
    const history = messages
      .filter((m) => !m.ephemeral && !m.leads && m.text.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, { role: "user", text: queryText }]);
    if (!userPrompt) setPrompt("");
    setLoading(true);

    try {
      const res = await sendCopilotPromptAction(queryText, history, sheet?.sheetId);
      const dc = (res.dataContext ?? {}) as { engine?: string };
      if (dc.engine === "llm") setEngine("llm");
      else if (dc.engine === "deterministic") setEngine("deterministic");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          actions: res.suggestedActions,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I hit an issue reaching my services. Telemetry remains operational — try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (query: string) => {
    if (!query.trim() || discovering) return;
    setMessages((prev) => [...prev, { role: "user", text: `🔎 Find leads: ${query.trim()}` }]);
    setPrompt("");
    setDiscovering(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "Discovery run started — planning searches, scanning the web, and scraping candidate sites. This takes 15–45 seconds…", ephemeral: true },
    ]);

    try {
      const res = await discoverLeadsAction(query);
      if (!res.success || res.leads.length === 0) {
        const failNote = "notes" in res && res.notes ? res.notes.join(" ") : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `No usable companies came back for that query. ${failNote} Try naming an industry plus a location, e.g. "dermatology clinics in Miami".`,
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Discovery complete — ${res.leads.length} ranked candidate${res.leads.length === 1 ? "" : "s"}. Review and import what you want; duplicates are blocked automatically.`,
          leads: res.leads,
          notes: res.notes,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "The discovery run failed (web scrape blocked or timed out). Try a more specific query." },
      ]);
    } finally {
      setDiscovering(false);
    }
  };

  const handleDiscoverLocal = async (category: string, city: string) => {
    if (!category.trim() || !city.trim() || discovering) return;
    setMessages((prev) => [...prev, { role: "user", text: `📍 Find local ${category.trim()} in ${city.trim()}` }]);
    setPrompt("");
    setDiscovering(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "Geocoding the city and querying OpenStreetMap (free, keyless). This takes 5–20 seconds…", ephemeral: true },
    ]);

    try {
      const res = await discoverLocalLeadsAction(category, city, 10);
      if (!res.success || res.leads.length === 0) {
        const failNote = "notes" in res && res.notes ? res.notes.join(" ") : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `No local businesses came back. ${failNote} Try a concrete category plus city, e.g. "find gyms in Jorhat, Assam".`,
          },
        ]);
        return;
      }
      const hot = res.leads.filter((l) => l.priority === "Hot").length;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Found ${res.leads.length} local business${res.leads.length === 1 ? "" : "es"} from OpenStreetMap — ${hot} Hot (no website, no phone). Select all or pick individual leads to import; duplicates are blocked automatically.`,
          localLeads: res.leads,
          notes: res.notes,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "The local discovery run failed (Places API unreachable). Try again in a moment." },
      ]);
    } finally {
      setDiscovering(false);
    }
  };

  const handleDiscoverGoogle = async (category: string, city: string) => {
    if (!category.trim() || !city.trim() || discovering) return;
    setMessages((prev) => [...prev, { role: "user", text: `🗺️ Google Maps: ${category.trim()} in ${city.trim()}` }]);
    setPrompt("");
    setDiscovering(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "Searching for businesses — this may take up to 2 minutes if the Google Maps scraper is running…", ephemeral: true },
    ]);

    try {
      const res = await discoverGooglePlacesAction(category, city, 10);
      if (!res.success || res.leads.length === 0) {
        const hint = `No businesses found for "${category}" in "${city}". Try a broader category (e.g. "restaurant" instead of "vegan cafe"), check the city name, or try a larger nearby city. For richer data (ratings, reviews), add GOOGLE_PLACES_API_KEY to .env.local.`;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: hint },
        ]);
        return;
      }
      // Check if the response has Google-specific fields (rating with a value) vs free scraper/OSM
      const hasRealRatings = res.leads[0] && "rating" in res.leads[0] && (res.leads[0] as GooglePlacesLead).rating != null;
      if ("rating" in (res.leads[0] ?? {})) {
        const hot = (res.leads as GooglePlacesLead[]).filter((l) => l.priority === "Hot").length;
        const source = hasRealRatings ? "Google Maps" : "OpenStreetMap";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Found ${res.leads.length} business${res.leads.length === 1 ? "" : "es"} via ${source} — ${hot} Hot (no website). Select and import to your CRM.`,
            googlePlacesLeads: res.leads as GooglePlacesLead[],
            notes: res.notes,
          },
        ]);
      } else {
        const hot = (res.leads as LocalDiscoveryLead[]).filter((l) => l.priority === "Hot").length;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Found ${res.leads.length} local business${res.leads.length === 1 ? "" : "es"} — ${hot} Hot.`,
            localLeads: res.leads as LocalDiscoveryLead[],
            notes: res.notes,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Business discovery failed. Try again or check your internet connection." },
      ]);
    } finally {
      setDiscovering(false);
    }
  };

  const googleToCandidate = (l: GooglePlacesLead): ImportLeadCandidate => ({
    companyName: l.companyName,
    website: l.website,
    industry: l.industry,
    location: l.location,
    size: null,
    description: l.priorityReason,
    emails: [],
    phones: l.phone ? [l.phone] : [],
    linkedin: null,
    fitScore: l.fitScore,
    sourceQuery: l.sourceQuery,
    sourceUrl: l.sourceUrl,
    placeId: l.placeId,
    rating: l.rating,
    reviewCount: l.reviewCount,
    priority: l.priority,
    priorityReason: l.priorityReason,
    hook: l.suggestedHook,
  });

  const handleImportGoogle = async (lead: GooglePlacesLead) => {
    const key = lead.placeId;
    if (importStates[key]?.state === "importing" || importStates[key]?.state === "imported") return;
    setImport(key, "importing");
    try {
      const res = await importDiscoveredLeadAction(googleToCandidate(lead));
      if (res.success) {
        setImport(key, "imported", `Score ${res.score} · in CRM`);
        router.refresh();
      } else {
        setImport(key, "error", res.error ?? "Import failed");
      }
    } catch {
      setImport(key, "error", "Import failed");
    }
  };

  const handleImportAllGoogle = async (leads: GooglePlacesLead[]) => {
    const fresh = leads.filter((l) => {
      const st = importStates[l.placeId]?.state;
      return st !== "imported" && st !== "importing" && st !== "error";
    });
    if (fresh.length === 0) return;
    for (const l of fresh) setImport(l.placeId, "importing");
    try {
      const res = await importDiscoveredLeadsAction(fresh.map(googleToCandidate));
      res.results.forEach((r, i) => {
        const key = fresh[i]?.placeId ?? r.companyName;
        if (r.ok) setImport(key, "imported", "In CRM");
        else setImport(key, "error", r.error ?? "Import failed");
      });
      if (res.imported > 0) router.refresh();
    } catch {
      for (const l of fresh) setImport(l.placeId, "error", "Import failed");
    }
  };

  const handleEnrichLead = async (companyName: string, website: string | null, location: string | null, industry: string | null) => {
    setMessages((prev) => [...prev, { role: "user", text: `🔍 Enrich: ${companyName}` }]);
    setLoading(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: `Scraping ${website ?? companyName} for emails, decision makers, and social links…`, ephemeral: true },
    ]);
    try {
      const res = await enrichLeadAction({ companyName, website, location, industry });
      const parts: string[] = [];
      if (res.companyDescription) parts.push(`**About:** ${res.companyDescription}`);
      if (res.emails.length > 0) {
        const personal = res.emails.filter((e) => e.isPersonal);
        const generic = res.emails.filter((e) => !e.isPersonal);
        if (personal.length > 0) parts.push(`**Personal emails:** ${personal.map((e) => e.address).join(", ")}`);
        if (generic.length > 0) parts.push(`**Generic emails:** ${generic.map((e) => e.address).join(", ")}`);
      }
      if (res.people.length > 0) {
        parts.push("**Decision makers:**");
        for (const p of res.people) {
          let line = `• ${p.name}`;
          if (p.role) line += ` — ${p.role}`;
          if (p.email) line += ` (${p.email})`;
          if (p.linkedinUrl) line += ` [LinkedIn](${p.linkedinUrl})`;
          line += ` [${p.confidence}]`;
          parts.push(line);
        }
      }
      if (Object.keys(res.socials).length > 0) {
        parts.push(`**Social:** ${Object.entries(res.socials).map(([k, v]) => `[${k}](${v})`).join(" · ")}`);
      }
      if (res.techSignals.length > 0) parts.push(`**Tech stack:** ${res.techSignals.join(", ")}`);
      if (res.employeeEstimate) parts.push(`**Team size:** ~${res.employeeEstimate} employees`);
      if (parts.length === 0 && res.notes.length > 0) parts.push(res.notes.join(" "));
      if (parts.length === 0) parts.push("No additional data found — the website may block scraping or have limited public info.");
      setMessages((prev) => [...prev, { role: "assistant", text: parts.join("\n"), notes: res.notes }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Enrichment failed — the website may be unreachable." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleCampaignAnalytics = async () => {
    setMessages((prev) => [...prev, { role: "user", text: "📊 Campaign Analytics" }]);
    setLoading(true);
    try {
      const data = await getCampaignAnalyticsAction();
      const parts: string[] = [];
      parts.push(`**Sequences:** ${data.totalSequences} total (${data.activeSequences} active)`);
      parts.push(`**Enrolled:** ${data.totalEnrolled} · **Replied:** ${data.totalReplied} (${data.overallReplyRate}%) · **Meetings:** ${data.totalMeetings} (${data.overallMeetingRate}%)`);
      if (data.topSequences.length > 0) {
        parts.push("\n**Top sequences:**");
        for (const s of data.topSequences) {
          parts.push(`• ${s.name} — ${s.enrolled} enrolled, ${s.replyRate}% reply, ${s.meetingRate}% meeting`);
        }
      }
      if (data.conversionFunnel.length > 0) {
        parts.push("\n**Lead funnel:**");
        for (const step of data.conversionFunnel) {
          parts.push(`• ${step.stage}: ${step.count} (${step.percentage}%)`);
        }
      }
      if (data.insights.length > 0) {
        parts.push("\n**Insights:**");
        for (const insight of data.insights) parts.push(`• ${insight}`);
      }
      setMessages((prev) => [...prev, { role: "assistant", text: parts.join("\n") }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Could not load campaign analytics." }]);
    } finally {
      setLoading(false);
    }
  };

  const localToCandidate = (l: LocalDiscoveryLead): ImportLeadCandidate => ({
    companyName: l.companyName ?? "Unnamed business",
    website: l.website,
    industry: l.industry,
    location: l.location,
    size: l.size,
    description: null,
    emails: [],
    phones: l.phone ? [l.phone] : [],
    linkedin: null,
    fitScore: l.fitScore,
    sourceQuery: `${l.industry ?? "local business"} ${l.location ?? ""}`.trim(),
    sourceUrl: l.sourceUrl,
    placeId: l.osmId,
    rating: null,
    reviewCount: null,
    priority: l.priority,
    priorityReason: l.priorityReason,
    hook: l.suggestedHook,
  });

  const handleImportLocal = async (lead: LocalDiscoveryLead) => {
    const key = lead.osmId || lead.companyName || "unknown";
    if (importStates[key]?.state === "importing" || importStates[key]?.state === "imported") return;
    setImport(key, "importing");
    try {
      const res = await importDiscoveredLeadAction(localToCandidate(lead));
      if (res.success) {
        setImport(key, "imported", `Score ${res.score} · in CRM`);
        router.refresh();
      } else {
        setImport(key, "error", res.error ?? "Import failed");
      }
    } catch {
      setImport(key, "error", "Import failed");
    }
  };

  const handleImportAllLocal = async (leads: LocalDiscoveryLead[]) => {
    const fresh = leads.filter((l) => {
      const st = importStates[l.osmId || l.companyName || "unknown"]?.state;
      return st !== "imported" && st !== "importing" && st !== "error";
    });
    if (fresh.length === 0) return;
    for (const l of fresh) setImport(l.osmId || l.companyName || "unknown", "importing");
    try {
      const res = await importDiscoveredLeadsAction(fresh.map(localToCandidate));
      res.results.forEach((r, i) => {
        const key = fresh[i]?.osmId || fresh[i]?.companyName || r.companyName;
        if (r.ok) setImport(key, "imported", "In CRM");
        else setImport(key, "error", r.error ?? "Import failed");
      });
      if (res.imported > 0) router.refresh();
    } catch {
      for (const l of fresh) setImport(l.osmId || l.companyName || "unknown", "error", "Import failed");
    }
  };

  const handleImport = async (lead: DiscoveryLead) => {
    const key = lead.website ?? lead.companyName;
    if (importStates[key]?.state === "importing") return;
    setImport(key, "importing");

    const candidate: ImportLeadCandidate = {
      companyName: lead.companyName,
      website: lead.website,
      industry: lead.industry,
      location: lead.location,
      size: lead.size,
      description: lead.description,
      emails: lead.emails,
      phones: lead.phones,
      linkedin: lead.socials?.linkedin ?? null,
      fitScore: lead.fitScore,
      sourceQuery: lead.sourceQuery,
      sourceUrl: lead.sourceUrl,
    };

    try {
      const res = await importDiscoveredLeadAction(candidate);
      if (res.success) {
        setImport(key, "imported", `Score ${res.score} · in CRM`);
        router.refresh();
      } else {
        setImport(key, "error", res.error ?? "Import failed");
      }
    } catch {
      setImport(key, "error", "Import failed");
    }
  };

  const executeAction = async (action: { label: string; actionType: string; payload: Record<string, unknown> }) => {
    // Agentic actions actually mutate CRM state; NAVIGATE just moves the user.
    if (action.actionType === "RUN_SWEEP") {
      setMessages((prev) => [...prev, { role: "user", text: "⚡ Execute follow-up sweep" }]);
      setLoading(true);
    try {
      const report = await queueStaleFollowUpsAction();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text:
              report.scheduled > 0
                ? `Sweep complete. Scheduled ${report.scheduled} follow-up${report.scheduled === 1 ? "" : "s"} (${report.skipped} leads already current). Each lead now has a next-follow-up date and an activity-trail entry.`
                : `All ${report.totalActive} active leads are already current — no follow-ups needed.`,
          },
        ]);
        router.refresh();
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "The sweep failed. Check the server logs and try again." },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (action.actionType === "DISCOVER_LEADS") {
      const q = typeof action.payload?.query === "string" ? action.payload.query : "";
      if (q) await handleDiscover(q);
      return;
    }

    if (action.actionType === "DISCOVER_LOCAL_LEADS") {
      const category = typeof action.payload?.category === "string" ? action.payload.category : "";
      const city = typeof action.payload?.city === "string" ? action.payload.city : "";
      if (category && city) await handleDiscoverLocal(category, city);
      return;
    }

    if (action.actionType === "DISCOVER_GOOGLE_LEADS") {
      const category = typeof action.payload?.category === "string" ? action.payload.category : "";
      const city = typeof action.payload?.city === "string" ? action.payload.city : "";
      if (category && city) await handleDiscoverGoogle(category, city);
      return;
    }

    if (action.actionType === "ENRICH_LEAD") {
      const companyName = typeof action.payload?.companyName === "string" ? action.payload.companyName : "";
      const website = typeof action.payload?.website === "string" ? action.payload.website : null;
      const location = typeof action.payload?.location === "string" ? action.payload.location : null;
      const industry = typeof action.payload?.industry === "string" ? action.payload.industry : null;
      if (companyName) await handleEnrichLead(companyName, website, location, industry);
      return;
    }

    if (action.actionType === "CAMPAIGN_ANALYTICS") {
      await handleCampaignAnalytics();
      return;
    }

    if (action.actionType === "NAVIGATE" && typeof action.payload?.url === "string") {
      router.push(action.payload.url);
      setIsOpen(false);
    }
  };

  const setWrite = (key: string, state: "pending" | "armed" | "executing" | "done" | "declined" | "error", message?: string) =>
    setWriteStates((prev) => ({ ...prev, [key]: { state, message } }));

  /**
   * Two-stage confirmation on REAL user clicks only:
   *  - untrusted (programmatic) events are rejected outright — stray scripts
   *    or synthetic replays can never fire a write;
   *  - the first genuine click ARMS ("click again to confirm", 6s window);
   *  - only a second genuine click inside the window executes.
   *  A stray/replayed single click can therefore only arm harmlessly.
   */
  const handleWriteClick = (e: React.MouseEvent<HTMLButtonElement>, key: string, payload: Record<string, unknown>) => {
    if (!e.nativeEvent.isTrusted) return; // programmatic click — ignore
    const current = writeStates[key]?.state ?? "pending";
    if (current !== "armed") {
      setWrite(key, "armed");
      const prev = armTimers.current.get(key);
      if (prev) clearTimeout(prev);
      armTimers.current.set(
        key,
        setTimeout(() => setWrite(key, "pending"), 6000)
      );
      return;
    }
    const timer = armTimers.current.get(key);
    if (timer) clearTimeout(timer);
    void handleWriteConfirm(key, payload);
  };

  const handleWriteConfirm = async (key: string, payload: Record<string, unknown>) => {
    const token = typeof payload.writeToken === "string" ? payload.writeToken : null;
    if (!token) {
      setWrite(key, "error", "Proposal missing — ask the Copilot again.");
      return;
    }
    setWrite(key, "executing");
    try {
      const res: CopilotWriteResult = await executeCopilotWriteAction(token);
      if (res.success) {
        setWrite(key, "done", res.message);
        setMessages((prev) => [...prev, { role: "assistant", text: `✅ ${res.message}` }]);
        router.refresh();
      } else {
        setWrite(key, "error", res.message);
      }
    } catch {
      setWrite(key, "error", "Execution failed — try again.");
    }
  };

  const busy = loading || discovering || sheetBusy;
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === "assistant" && m.text.trim());
  const mod = isMac ?"⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";

  const quickPrompts: { label: string; className: string; run: () => void }[] = [
    { label: "☀️ Today", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20", run: () => handleSend("What should I do today?") },
    { label: "⚡ Audit Risk", className: "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20", run: () => handleSend("Audit pipeline risk") },
    { label: "🎯 Hot Leads", className: "bg-secondary/10 text-secondary border-secondary/30 hover:bg-secondary/20", run: () => handleSend("Summarize hot leads") },
    { label: "🏢 Clients", className: "bg-tertiary/10 text-tertiary border-tertiary/30 hover:bg-tertiary/20", run: () => handleSend("Client account stats") },
    { label: "🔎 Scrape Leads", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20", run: () => handleDiscover("B2B agencies that need automation services") },
    { label: "➕ New Lead", className: "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20", run: () => handleSend("Create a new lead") },
    { label: "📨 Sequences", className: "bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/20", run: () => handleSend("Show my outreach sequences and BDR stats") },
  ];

  const shortcutList: { keys: string; action: string }[] = [
    { keys: `${mod} J`, action: "Open / close the copilot (anywhere)" },
    { keys: "Enter", action: "Send message" },
    { keys: "Shift Enter", action: "New line" },
    { keys: "↑ / ↓", action: "Previous / next sent message" },
    { keys: `${alt} 1–${quickPrompts.length}`, action: "Run a quick prompt" },
    { keys: `${alt} A`, action: "Attach a spreadsheet" },
    { keys: `${mod} C`, action: "Copy selection (or the latest AI reply if nothing is selected)" },
    { keys: `${mod} V`, action: "Paste into the message box (sheet files attach)" },
    { keys: "Esc", action: "Close this panel / the copilot" },
    { keys: `? or ${mod} /`, action: "Show these shortcuts" },
    { keys: "Tab / Shift Tab", action: "Move between buttons" },
  ];

  const openCopilot = () => {
    setShowShortcuts(false);
    setIsOpen(true);
  };
  const closeCopilot = () => {
    setShowShortcuts(false);
    setIsOpen(false);
  };

  // Focus the input on open; return focus to the trigger on close.
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  // Grow the textarea with its content, up to ~6 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [prompt, isOpen]);

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyMessage = async (idx: number) => {
    const text = messages[idx]?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      // Clipboard can be blocked (permissions/insecure context); selection-copy still works.
    }
  };

  // Paste anywhere in the open panel lands in the message box; pasted sheet files attach.
  useEffect(() => {
    if (!isOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || !e.clipboardData) return;
      const target = e.target as HTMLElement | null;
      if (target && !dialog.contains(target) && target !== document.body) return;

      const file = Array.from(e.clipboardData.files).find((f) => SHEET_FILE_RE.test(f.name));
      if (file) {
        e.preventDefault();
        void attachSheetFile(file);
        return;
      }

      if (target === inputRef.current) return;
      const text = e.clipboardData.getData("text");
      if (!text) return;
      e.preventDefault();
      setHistoryIndex(-1);
      setPrompt((p) => p + text);
      inputRef.current?.focus();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // Re-subscribed every render so the handler always sees current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;

      if (modKey && !e.shiftKey && !e.altKey && e.code === "KeyJ") {
        e.preventDefault();
        if (isOpen) closeCopilot();
        else openCopilot();
        return;
      }
      if (!isOpen) return;

      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape") {
        e.preventDefault();
        if (showShortcuts) setShowShortcuts(false);
        else closeCopilot();
        return;
      }
      // Ctrl/⌘+C with nothing selected copies the latest AI reply; a real selection copies normally.
      if (modKey && !e.shiftKey && !e.altKey && e.code === "KeyC") {
        const selected = window.getSelection()?.toString() ?? "";
        const inputHasSelection =
          typing && target instanceof HTMLTextAreaElement && target.selectionStart !== target.selectionEnd;
        if (!selected && !inputHasSelection) {
          const lastReply = messages.map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === "assistant" && m.text.trim());
          if (lastReply) {
            e.preventDefault();
            void copyMessage(lastReply.i);
          }
        }
        return;
      }
      if ((modKey && e.key === "/") || (!typing && e.key === "?")) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (e.altKey && !modKey && /^Digit[1-9]$/.test(e.code)) {
        const chip = quickPrompts[Number(e.code.slice(5)) - 1];
        if (chip) {
          e.preventDefault();
          if (!busy) chip.run();
        }
        return;
      }
      if (e.altKey && !modKey && e.code === "KeyA") {
        e.preventDefault();
        if (!sheetBusy) fileInputRef.current?.click();
        return;
      }

      // Keep Tab focus inside the open dialog.
      const dialog = dialogRef.current;
      if (e.key === "Tab" && dialog) {
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]):not([type="file"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialog.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
      return;
    }
    const el = e.currentTarget;
    if (e.key === "ArrowUp" && sentHistory.length > 0 && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (historyIndex === -1 && prompt.trim() !== "") return;
      e.preventDefault();
      const prev = historyIndex === -1 ? sentHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(prev);
      setPrompt(sentHistory[prev]);
      return;
    }
    if (e.key === "ArrowDown" && historyIndex !== -1 && el.selectionStart === el.value.length) {
      e.preventDefault();
      const next = historyIndex + 1;
      if (next >= sentHistory.length) {
        setHistoryIndex(-1);
        setPrompt("");
      } else {
        setHistoryIndex(next);
        setPrompt(sentHistory[next]);
      }
    }
  };


  return (
    <>
      {/* Floating Trigger Button */}
      <button
        ref={triggerRef}
        onClick={openCopilot}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-keyshortcuts="Control+J Meta+J"
        title={`Open AI Copilot (${mod}+J)`}
        className="fixed bottom-6 right-6 z-50 flex items-center space-x-2 rounded-full bg-gradient-to-r from-primary via-indigo-600 to-tertiary px-4 py-3 text-xs font-bold text-white shadow-[0_0_25px_rgba(43,102,255,0.4)] hover:scale-105 hover:shadow-[0_0_35px_rgba(43,102,255,0.6)] transition-all duration-300 group"
      >
        <Sparkles className="h-4 w-4 animate-pulse group-hover:rotate-12 transition-transform" />
        <span>AI COPILOT</span>
      </button>

      {/* Drawer Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCopilot();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="copilot-title"
            className="relative w-full max-w-md bg-surface-lowest border-l border-border-subtle shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300"
          >

            {/* Header */}
            <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-surface-elevated/40">
              <div className="flex items-center space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary border border-primary/30">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h3 id="copilot-title" className="text-xs font-semibold text-text-primary tracking-wide">AEXYL AI COPILOT</h3>
                  <span className="text-[10px] font-mono-code text-secondary flex items-center space-x-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary animate-ping mr-1"></span>
                    {engine === "llm" ? "LLM REASONING ONLINE" : engine === "deterministic" ? "DETERMINISTIC ENGINE" : "AUTONOMOUS AGENT ACTIVE"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowShortcuts((s) => !s)}
                  aria-label="Keyboard shortcuts"
                  aria-expanded={showShortcuts}
                  aria-keyshortcuts="Control+/ Meta+/ Shift+?"
                  title={`Keyboard shortcuts (? or ${mod}+/)`}
                  className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Keyboard className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={closeCopilot}
                  aria-label="Close copilot"
                  aria-keyshortcuts="Escape"
                  title="Close (Esc)"
                  className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {showShortcuts && (
              <div
                role="region"
                aria-label="Keyboard shortcuts"
                className="absolute inset-x-3 top-16 z-10 rounded-xl border border-border-subtle bg-surface-elevated p-4 shadow-2xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-primary tracking-wide">KEYBOARD SHORTCUTS</span>
                  <button
                    type="button"
                    onClick={() => setShowShortcuts(false)}
                    aria-label="Close keyboard shortcuts"
                    className="p-0.5 rounded text-text-muted hover:text-text-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <dl className="space-y-1.5">
                  {shortcutList.map((s) => (
                    <div key={s.keys} className="flex items-center justify-between gap-3 text-[11px]">
                      <dt className="text-text-muted">{s.action}</dt>
                      <dd className="flex shrink-0 gap-1">
                        {s.keys.split(" ").map((k, i) => (
                          <kbd
                            key={i}
                            className="rounded border border-border-subtle bg-surface-lowest px-1.5 py-0.5 font-mono-code text-[10px] text-text-primary"
                          >
                            {k}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Quick Preset Prompt Chips */}
            <div role="toolbar" aria-label="Quick prompts" className="p-3 bg-surface-low/50 border-b border-border-subtle flex items-center gap-2 overflow-x-auto text-[10px]">
              {quickPrompts.map((chip, i) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={chip.run}
                  disabled={busy}
                  aria-keyshortcuts={`Alt+${i + 1}`}
                  title={`${alt}+${i + 1}`}
                  className={`px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${chip.className}`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Chat History Container */}
            <div
              role="log"
              aria-live="polite"
              aria-label="Conversation"
              aria-busy={busy}
              className="flex-1 p-4 overflow-y-auto space-y-4"
            >
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${
                    m.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[92%] rounded-xl p-3 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-white font-medium rounded-br-none"
                        : "bg-surface-elevated border border-border-subtle text-text-primary rounded-bl-none shadow-sm"
                    }`}
                  >
                    {m.text}

                    {/* Discovery result cards */}
                    {m.leads && m.leads.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {m.leads.map((lead) => {
                          const key = lead.website ?? lead.companyName;
                          const st = importStates[key]?.state ?? "idle";
                          return (
                            <div key={key} className="rounded-lg border border-border-subtle bg-surface-lowest p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold text-text-primary truncate">
                                    {lead.website ? (
                                      <a href={lead.website} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                                        {lead.companyName}
                                      </a>
                                    ) : (
                                      lead.companyName
                                    )}
                                  </p>
                                  <p className="text-[10px] text-text-muted truncate">
                                    {[lead.industry, lead.location, lead.size].filter(Boolean).join(" · ") || "—"}
                                  </p>
                                </div>
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold font-mono-code ${
                                    lead.fitScore >= 70
                                      ? "bg-emerald-500/15 text-emerald-400"
                                      : lead.fitScore >= 50
                                        ? "bg-amber-500/15 text-amber-400"
                                        : "bg-surface-high text-text-muted"
                                  }`}
                                >
                                  {lead.fitScore}
                                </span>
                              </div>

                              {lead.description && (
                                <p className="mt-1.5 text-[10px] text-text-muted line-clamp-2">{lead.description}</p>
                              )}

                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
                                {lead.emails[0] && (
                                  <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{lead.emails[0]}</span>
                                )}
                                {lead.phones[0] && (
                                  <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phones[0]}</span>
                                )}
                                {lead.website && (
                                  <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{new URL(lead.website).hostname}</span>
                                )}
                              </div>

                              <p className="mt-1 text-[10px] text-text-muted italic">Fit: {lead.fitReason}</p>

                              <button
                                onClick={() => handleImport(lead)}
                                disabled={st === "importing" || st === "imported"}
                                className={`mt-2 w-full flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                                  st === "imported"
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : st === "error"
                                      ? "bg-red-500/15 text-red-400"
                                      : "bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                                }`}
                              >
                                {st === "importing" ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" /> Importing…</>
                                ) : st === "imported" ? (
                                  <><CheckCircle2 className="h-3 w-3" /> {importStates[key]?.message ?? "In CRM"}</>
                                ) : st === "error" ? (
                                  <>{importStates[key]?.message ?? "Failed — retry?"}</>
                                ) : (
                                  <><Download className="h-3 w-3" /> Import to CRM</>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Local (OpenStreetMap) discovery cards — tiered, with batch import */}
                    {m.localLeads && m.localLeads.length > 0 && (
                      <LocalLeadsBlock
                        leads={m.localLeads}
                        importStates={importStates}
                        onImport={handleImportLocal}
                        onImportAll={handleImportAllLocal}
                      />
                    )}

                    {m.googlePlacesLeads && m.googlePlacesLeads.length > 0 && (
                      <GooglePlacesBlock
                        leads={m.googlePlacesLeads}
                        importStates={importStates}
                        onImport={handleImportGoogle}
                        onImportAll={handleImportAllGoogle}
                      />
                    )}

                    {m.notes && m.notes.length > 0 && (
                      <p className="mt-2 text-[10px] text-text-muted italic">{m.notes.join(" ")}</p>
                    )}

                    {/* Render AI Action Trigger Buttons */}
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-border-subtle/40 space-y-1.5">
                        {m.actions.map((act, aIdx) => {
                          const isWrite = isWriteKind(act.actionType);
                          const wKey = `${idx}-${aIdx}`;
                          const wState = writeStates[wKey]?.state;
                          if (isWrite) {
                            return (
                              <div
                                key={aIdx}
                                className={`rounded-lg border p-2.5 ${
                                  wState === "done"
                                    ? "border-emerald-500/40 bg-emerald-500/10"
                                    : wState === "error"
                                      ? "border-red-500/40 bg-red-500/10"
                                      : wState === "declined"
                                        ? "border-border-subtle bg-surface-lowest opacity-60"
                                        : act.actionType.startsWith("DELETE_")
                                          ? "border-red-500/40 bg-red-500/5"
                                          : act.actionType === "SEND_EMAIL"
                                            ? "border-sky-500/40 bg-sky-500/5"
                                            : act.actionType.startsWith("CREATE_") && act.actionType !== "CREATE_TASK" && act.actionType !== "CREATE_FOLLOW_UP"
                                              ? "border-emerald-500/40 bg-emerald-500/5"
                                              : "border-amber-500/40 bg-amber-500/5"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {act.actionType === "CREATE_TASK" ? (
                                    <ListTodo className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                                  ) : act.actionType === "CREATE_FOLLOW_UP" ? (
                                    <CalendarClock className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                                  ) : act.actionType === "IMPORT_SHEET_LEADS" ? (
                                    <SheetIcon className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                                  ) : act.actionType === "CREATE_LEAD" || act.actionType === "CREATE_CONTACT" ? (
                                    <UserPlus className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                                  ) : act.actionType === "CREATE_COMPANY" ? (
                                    <Building2 className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                                  ) : act.actionType === "CREATE_DEAL" ? (
                                    <Handshake className="h-3.5 w-3.5 mt-0.5 text-emerald-400 shrink-0" />
                                  ) : act.actionType === "DELETE_LEAD" || act.actionType === "DELETE_DEAL" ? (
                                    <Trash2 className="h-3.5 w-3.5 mt-0.5 text-red-400 shrink-0" />
                                  ) : act.actionType === "SEND_EMAIL" ? (
                                    <MailPlus className="h-3.5 w-3.5 mt-0.5 text-sky-400 shrink-0" />
                                  ) : act.actionType === "ANALYZE_INTENT" || act.actionType === "HANDLE_OBJECTION" ? (
                                    <Brain className="h-3.5 w-3.5 mt-0.5 text-purple-400 shrink-0" />
                                  ) : act.actionType === "ENROLL_SEQUENCE" || act.actionType === "CREATE_SEQUENCE" ? (
                                    <Play className="h-3.5 w-3.5 mt-0.5 text-sky-400 shrink-0" />
                                  ) : act.actionType.startsWith("UPDATE_") ? (
                                    <Target className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                                  ) : (
                                    <PenLine className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold text-text-primary">
                                      {typeof act.payload.summary === "string" ? act.payload.summary : "Proposed write action"}
                                    </p>
                                    <p className="text-[10px] text-text-muted mt-0.5">
                                      {wState === "done"
                                        ? writeStates[wKey]?.message
                                        : wState === "armed"
                                          ? "Click Confirm again to execute."
                                          : "Write action — nothing changes until you confirm."}
                                    </p>
                                  </div>
                                </div>

                                {/* Spreadsheet import: server-provided preview of the first rows */}
                                {act.actionType === "IMPORT_SHEET_LEADS" && Array.isArray(act.payload.preview) && (
                                  <div className="mt-2 rounded border border-border-subtle bg-surface-lowest overflow-x-auto">
                                    <table className="w-full text-[9px] font-mono-code">
                                      <thead>
                                        <tr className="text-text-muted">
                                          {(Array.isArray(act.payload.headers) ? act.payload.headers : []).slice(0, 3).map((h, hi) => (
                                            <th key={hi} className="px-1.5 py-1 text-left font-semibold border-b border-border-subtle max-w-[90px] truncate">
                                              {String(h)}
                                            </th>
                                          ))}
                                          {Array.isArray(act.payload.headers) && act.payload.headers.length > 3 && (
                                            <th className="px-1 py-1 text-left font-normal text-text-muted/70">+{act.payload.headers.length - 3}</th>
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(act.payload.preview as string[][]).slice(0, 5).map((row, ri) => (
                                          <tr key={ri} className="border-b border-border-subtle/40 last:border-0">
                                            {row.slice(0, 3).map((cell, ci) => (
                                              <td key={ci} className="px-1.5 py-1 text-text-primary max-w-[90px] truncate">
                                                {cell || <span className="text-text-muted/50">—</span>}
                                              </td>
                                            ))}
                                            {row.length > 3 && <td className="px-1 py-1 text-text-muted/70">+{row.length - 3}</td>}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {typeof act.payload.rowCount === "number" && act.payload.rowCount > 5 && (
                                      <p className="px-1.5 py-1 text-[9px] text-text-muted">
                                        … {act.payload.rowCount - 5} more rows — every row imports on confirm.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {wState !== "done" && wState !== "declined" && (
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                      onClick={(e) => handleWriteClick(e, wKey, act.payload)}
                                      disabled={wState === "executing"}
                                      className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 transition-colors ${
                                        wState === "armed" ? "bg-emerald-500 animate-pulse" : "bg-emerald-600/90 hover:bg-emerald-600"
                                      }`}
                                    >
                                      {wState === "executing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                                      {wState === "armed" ? "Click again" : "Confirm"}
                                    </button>
                                    <button
                                      onClick={() => setWrite(wKey, "declined")}
                                      disabled={wState === "executing"}
                                      className="flex items-center justify-center gap-1 rounded border border-border-subtle bg-surface-low px-2 py-1.5 text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-elevated disabled:opacity-50 transition-colors"
                                    >
                                      <Ban className="h-3 w-3" /> Dismiss
                                    </button>
                                  </div>
                                )}
                                {wState === "error" && (
                                  <p className="mt-1.5 text-[10px] text-red-400">{writeStates[wKey]?.message}</p>
                                )}
                              </div>
                            );
                          }
                          return (
                            <button
                              key={aIdx}
                              onClick={() => executeAction(act)}
                              className="w-full flex items-center justify-between px-3 py-1.5 rounded bg-primary/20 border border-primary/40 text-[11px] font-semibold text-primary hover:bg-primary/30 transition-colors"
                            >
                              <span>{act.label}</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {m.role === "assistant" && m.text.trim() && (
                    <button
                      type="button"
                      onClick={() => copyMessage(idx)}
                      aria-label={copiedIdx === idx ? "Copied" : "Copy reply"}
                      title={idx === lastAssistantIdx ? `Copy reply (${mod}+C with nothing selected)` : "Copy reply"}
                      className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {copiedIdx === idx ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copiedIdx === idx ? "Copied" : "Copy"}
                    </button>
                  )}
                </div>
              ))}

              {busy && (
                <div role="status" className="flex items-center space-x-2 text-xs text-text-muted">
                  <Cpu className="h-4 w-4 animate-spin text-primary" />
                  <span>
                    {sheetBusy
                      ? "Reading spreadsheet…"
                      : discovering
                        ? "Scanning the web for prospects…"
                        : "Synthesizing CRM telemetry context..."}
                  </span>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-border-subtle bg-surface-elevated/30">
              {sheet && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px]">
                  <SheetIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-text-primary truncate">{sheet.fileName}</span>
                  <span className="font-mono-code text-text-muted shrink-0">
                    {sheet.rowCount} rows · {sheet.headers.length} cols
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheet(null)}
                    title="Detach sheet"
                    aria-label={`Detach ${sheet.fileName}`}
                    className="ml-auto p-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-end space-x-2"
              >
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sheetBusy}
                  aria-label="Attach a spreadsheet"
                  aria-keyshortcuts="Alt+A"
                  title={`Attach a Google Sheet (.csv/.xlsx) or paste its share link (${alt}+A)`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-lowest text-text-muted hover:text-primary hover:border-primary/40 disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {sheetBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={prompt}
                  onChange={(e) => {
                    setHistoryIndex(-1);
                    setPrompt(e.target.value);
                  }}
                  onKeyDown={onInputKeyDown}
                  aria-label="Message the AI copilot"
                  aria-describedby="copilot-input-hint"
                  placeholder="Create a lead, send an email, analyze intent…"
                  className="flex-1 resize-none bg-surface-lowest border border-border-subtle rounded-lg px-3 py-2 text-xs leading-4 text-text-primary focus:outline-none focus:border-primary/60"
                />
                <button
                  type="submit"
                  disabled={busy || !prompt.trim()}
                  aria-label="Send message"
                  aria-keyshortcuts="Enter"
                  title="Send (Enter)"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-50 hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
              <p id="copilot-input-hint" className="mt-1.5 text-[9px] text-text-muted">
                <kbd className="font-mono-code">Enter</kbd> send · <kbd className="font-mono-code">Shift+Enter</kbd> new line ·{" "}
                <kbd className="font-mono-code">↑</kbd> last message · <kbd className="font-mono-code">?</kbd> all shortcuts
              </p>
              <input
                ref={fileInputRef}
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                accept=".csv,.xlsx,.xls,.tsv,.txt"
                className="hidden"
                onChange={handleFilePick}
              />
            </div>

          </div>
        </div>
      )}
    </>
  );
}

const TIER_STYLE: Record<string, string> = {
  Hot: "bg-tertiary/15 text-tertiary border-tertiary/40",
  Warm: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  Cold: "bg-surface-high text-text-muted border-border-subtle",
};

/**
 * Batch-import block for OpenStreetMap local leads: select-all + per-card
 * import, showing the Hot/Warm/Cold tier, factual OSM fields (phone, opening
 * hours, no-website signal), and the labeled LLM suggestedHook — a clearly
 * marked suggestion reviewers verify, never merged with the factual data.
 */
function LocalLeadsBlock({
  leads,
  importStates,
  onImport,
  onImportAll,
}: {
  leads: LocalDiscoveryLead[];
  importStates: Record<string, { state: ImportState; message?: string }>;
  onImport: (lead: LocalDiscoveryLead) => void;
  onImportAll: (leads: LocalDiscoveryLead[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(leads.map((l) => l.osmId)));
  const [bulkState, setBulkState] = useState<"idle" | "importing" | "done">("idle");

  const importable = leads.filter((l) => {
    const st = importStates[l.osmId]?.state;
    return st !== "imported" && st !== "importing";
  });
  const selectedFresh = leads.filter((l) => selected.has(l.osmId) && importStates[l.osmId]?.state !== "imported");
  const importedCount = leads.filter((l) => importStates[l.osmId]?.state === "imported").length;
  const allDone = importedCount === leads.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = async () => {
    if (selectedFresh.length === 0 || bulkState === "importing") return;
    setBulkState("importing");
    await onImportAll(selectedFresh);
    setBulkState("done");
  };

  return (
    <div className="mt-3 rounded-lg border border-tertiary/30 bg-tertiary/5 p-2">
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          onClick={() => setSelected(allDone ? new Set() : new Set(importable.map((l) => l.osmId)))}
          disabled={allDone || importable.length === 0}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
        >
          {selected.size > 0 && !allDone ? <SquareCheck className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
          Select all ({selected.size}/{leads.length})
        </button>
        <button
          onClick={importSelected}
          disabled={selectedFresh.length === 0 || bulkState === "importing"}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-bold text-white hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {bulkState === "importing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {allDone ? "All in CRM" : `Import ${selectedFresh.length}`}
        </button>
      </div>

      <div className="space-y-1.5">
        {leads.map((lead) => {
          const key = lead.osmId;
          const st = importStates[key]?.state ?? "idle";
          const isSelected = selected.has(key) && st !== "imported" && st !== "importing";
          return (
            <div
              key={key}
              className={`rounded-lg border p-2 transition-colors ${
                st === "imported" ? "border-emerald-500/40 bg-emerald-500/10" : isSelected ? "border-primary/40 bg-surface-lowest" : "border-border-subtle bg-surface-lowest"
              }`}
            >
              <div className="flex items-start gap-2">
                {st !== "imported" && (
                  <button onClick={() => toggle(key)} className="mt-0.5 shrink-0" aria-label={`Select ${lead.companyName}`}>
                    {isSelected ? <SquareCheck className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-text-muted" />}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-text-primary truncate">{lead.companyName ?? "Unnamed business"}</p>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold font-mono-code ${TIER_STYLE[lead.priority]}`}>
                      {lead.priority === "Hot" ? <Flame className="mr-0.5 inline h-2.5 w-2.5" /> : null}{lead.priority.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted truncate">{lead.location ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                    {lead.phone && <span className="inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{lead.phone}</span>}
                    {lead.openingHours && <span title={lead.openingHours}>🕒 {lead.openingHours.slice(0, 24)}</span>}
                    {lead.website ? (
                      <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                        <Globe className="h-2.5 w-2.5" />site
                      </a>
                    ) : (
                      <span className="text-tertiary">no website</span>
                    )}
                    {lead.sourceUrl && (
                      <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                        <MapPin className="h-2.5 w-2.5" />osm
                      </a>
                    )}
                  </div>
                  <p className="mt-1 text-[9px] text-text-muted/80">{lead.priorityReason}</p>
                  {lead.suggestedHook && (
                    <p className="mt-0.5 text-[10px] text-secondary italic" title="AI-suggested outreach angle — a guess, not a fact. Verify before use.">
                      Suggested angle (AI): {lead.suggestedHook}
                    </p>
                  )}
                  {st === "error" && <p className="mt-0.5 text-[10px] text-red-400">{importStates[key]?.message}</p>}
                </div>
                <button
                  onClick={() => onImport(lead)}
                  disabled={st === "importing" || st === "imported"}
                  className={`shrink-0 self-center rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                    st === "imported"
                      ? "text-emerald-400"
                      : st === "importing"
                        ? "text-text-muted"
                        : "bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                  }`}
                >
                  {st === "importing" ? <Loader2 className="h-3 w-3 animate-spin" /> : st === "imported" ? <CheckCircle2 className="h-3 w-3" /> : "Import"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GooglePlacesBlock({
  leads,
  importStates,
  onImport,
  onImportAll,
}: {
  leads: GooglePlacesLead[];
  importStates: Record<string, { state: ImportState; message?: string }>;
  onImport: (lead: GooglePlacesLead) => void;
  onImportAll: (leads: GooglePlacesLead[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(leads.map((l) => l.placeId)));
  const [bulkState, setBulkState] = useState<"idle" | "importing" | "done">("idle");

  const importable = leads.filter((l) => {
    const st = importStates[l.placeId]?.state;
    return st !== "imported" && st !== "importing";
  });
  const selectedFresh = leads.filter((l) => selected.has(l.placeId) && importStates[l.placeId]?.state !== "imported");
  const importedCount = leads.filter((l) => importStates[l.placeId]?.state === "imported").length;
  const allDone = importedCount === leads.length;

  const toggle = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const importSelected = async () => {
    if (selectedFresh.length === 0 || bulkState === "importing") return;
    setBulkState("importing");
    await onImportAll(selectedFresh);
    setBulkState("done");
  };

  return (
    <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-2">
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          onClick={() => setSelected(allDone ? new Set() : new Set(importable.map((l) => l.placeId)))}
          disabled={allDone || importable.length === 0}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors"
        >
          {selected.size > 0 && !allDone ? <SquareCheck className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
          Select all ({selected.size}/{leads.length})
        </button>
        <button
          onClick={importSelected}
          disabled={selectedFresh.length === 0 || bulkState === "importing"}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-bold text-white hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {bulkState === "importing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {allDone ? "All in CRM" : `Import ${selectedFresh.length}`}
        </button>
      </div>

      <div className="space-y-1.5">
        {leads.map((lead) => {
          const key = lead.placeId;
          const st = importStates[key]?.state ?? "idle";
          const isSelected = selected.has(key) && st !== "imported" && st !== "importing";
          return (
            <div
              key={key}
              className={`rounded-lg border p-2 transition-colors ${
                st === "imported" ? "border-emerald-500/40 bg-emerald-500/10" : isSelected ? "border-primary/40 bg-surface-lowest" : "border-border-subtle bg-surface-lowest"
              }`}
            >
              <div className="flex items-start gap-2">
                {st !== "imported" && (
                  <button onClick={() => toggle(key)} className="mt-0.5 shrink-0" aria-label={`Select ${lead.companyName}`}>
                    {isSelected ? <SquareCheck className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-text-muted" />}
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-text-primary truncate">{lead.companyName}</p>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold font-mono-code ${TIER_STYLE[lead.priority]}`}>
                      {lead.priority === "Hot" ? <Flame className="mr-0.5 inline h-2.5 w-2.5" /> : null}{lead.priority.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted truncate">{lead.location ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                    {lead.rating != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <span className="text-amber-400">★</span> {lead.rating.toFixed(1)}
                        {lead.reviewCount != null && <span className="text-text-muted/70">({lead.reviewCount})</span>}
                      </span>
                    )}
                    {lead.phone && <span className="inline-flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{lead.phone}</span>}
                    {lead.openingHours && <span title={lead.openingHours}>🕒 {lead.openingHours.slice(0, 24)}</span>}
                    {lead.website ? (
                      <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                        <Globe className="h-2.5 w-2.5" />site
                      </a>
                    ) : (
                      <span className="text-tertiary">no website</span>
                    )}
                    {lead.googleMapsUrl && (
                      <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                        <MapPin className="h-2.5 w-2.5" />maps
                      </a>
                    )}
                  </div>
                  <p className="mt-1 text-[9px] text-text-muted/80">{lead.priorityReason}</p>
                  {lead.suggestedHook && (
                    <p className="mt-0.5 text-[10px] text-secondary italic" title="AI-suggested outreach angle — verify before use.">
                      Suggested angle (AI): {lead.suggestedHook}
                    </p>
                  )}
                  {st === "error" && <p className="mt-0.5 text-[10px] text-red-400">{importStates[key]?.message}</p>}
                </div>
                <button
                  onClick={() => onImport(lead)}
                  disabled={st === "importing" || st === "imported"}
                  className={`shrink-0 self-center rounded px-2 py-1 text-[10px] font-semibold transition-colors ${
                    st === "imported"
                      ? "text-emerald-400"
                      : st === "importing"
                        ? "text-text-muted"
                        : "bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                  }`}
                >
                  {st === "importing" ? <Loader2 className="h-3 w-3 animate-spin" /> : st === "imported" ? <CheckCircle2 className="h-3 w-3" /> : "Import"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
