"use client";

import { useState, useRef } from "react";
import { Sparkles, Bot, Send, X, ArrowRight, Cpu, Download, CheckCircle2, Globe, Mail, Phone, Loader2, Zap, Ban, PenLine, ListTodo } from "lucide-react";
import {
  sendCopilotPromptAction,
  discoverLeadsAction,
  importDiscoveredLeadAction,
  executeCopilotWriteAction,
  type ImportLeadCandidate,
  type CopilotWriteResult,
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

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  actions?: { label: string; actionType: string; payload: Record<string, unknown> }[];
  leads?: DiscoveryLead[];
  notes?: string[];
  /** Excluded from copilot memory (UI-only scaffolding). */
  ephemeral?: boolean;
}

type ImportState = "idle" | "importing" | "imported" | "error";

const WRITE_KINDS = new Set(["UPDATE_DEAL_STAGE", "LOG_ACTIVITY", "CREATE_TASK"]);
const isWriteKind = (t: string) => WRITE_KINDS.has(t);

export function AiCopilotDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [engine, setEngine] = useState<"llm" | "deterministic" | null>(null);
  const [importStates, setImportStates] = useState<Record<string, { state: ImportState; message?: string }>>({});
  const [writeStates, setWriteStates] = useState<Record<string, { state: "pending" | "armed" | "executing" | "done" | "declined" | "error"; message?: string }>>({});
  // Arm→confirm timers: an armed proposal decays back to pending.
  const armTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hello, Operator. I am Aexyl Copilot — your autonomous revenue agent. I answer anything about your pipeline, and I can hunt new leads across the open web: ask me to \"find 6 dental clinics in Austin\" or \"scrape SaaS agencies needing automation\".",
      ephemeral: true,
    },
  ]);

  const router = useRouter();

  const setImport = (key: string, state: ImportState, message?: string) =>
    setImportStates((prev) => ({ ...prev, [key]: { state, message } }));

  const handleSend = async (userPrompt?: string) => {
    const queryText = userPrompt || prompt;
    if (!queryText.trim() || loading || discovering) return;

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
      const res = await sendCopilotPromptAction(queryText, history);
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

  return (
    <>
      {/* Floating Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center space-x-2 rounded-full bg-gradient-to-r from-primary via-indigo-600 to-tertiary px-4 py-3 text-xs font-bold text-white shadow-[0_0_25px_rgba(43,102,255,0.4)] hover:scale-105 hover:shadow-[0_0_35px_rgba(43,102,255,0.6)] transition-all duration-300 group"
      >
        <Sparkles className="h-4 w-4 animate-pulse group-hover:rotate-12 transition-transform" />
        <span>AI COPILOT</span>
      </button>

      {/* Drawer Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-surface-lowest border-l border-border-subtle shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">

            {/* Header */}
            <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-surface-elevated/40">
              <div className="flex items-center space-x-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary border border-primary/30">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-text-primary tracking-wide">AEXYL AI COPILOT</h3>
                  <span className="text-[10px] font-mono-code text-secondary flex items-center space-x-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary animate-ping mr-1"></span>
                    {engine === "llm" ? "LLM REASONING ONLINE" : engine === "deterministic" ? "DETERMINISTIC ENGINE" : "AUTONOMOUS AGENT ACTIVE"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Preset Prompt Chips */}
            <div className="p-3 bg-surface-low/50 border-b border-border-subtle flex items-center gap-2 overflow-x-auto text-[10px]">
              <button
                onClick={() => handleSend("Audit pipeline risk")}
                className="px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/30 whitespace-nowrap hover:bg-primary/20 transition-colors"
              >
                ⚡ Audit Risk
              </button>
              <button
                onClick={() => handleSend("Summarize hot leads")}
                className="px-2.5 py-1 rounded-full bg-secondary/10 text-secondary border border-secondary/30 whitespace-nowrap hover:bg-secondary/20 transition-colors"
              >
                🎯 Hot Leads
              </button>
              <button
                onClick={() => handleSend("Client account stats")}
                className="px-2.5 py-1 rounded-full bg-tertiary/10 text-tertiary border border-tertiary/30 whitespace-nowrap hover:bg-tertiary/20 transition-colors"
              >
                🏢 Clients
              </button>
              <button
                onClick={() => handleDiscover("B2B agencies that need automation services")}
                className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap hover:bg-emerald-500/20 transition-colors"
              >
                🔎 Scrape Leads
              </button>
            </div>

            {/* Chat History Container */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
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
                                        : "border-amber-500/40 bg-amber-500/5"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {act.actionType === "CREATE_TASK" ? (
                                    <ListTodo className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
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
                </div>
              ))}

              {(loading || discovering) && (
                <div className="flex items-center space-x-2 text-xs text-text-muted">
                  <Cpu className="h-4 w-4 animate-spin text-primary" />
                  <span>{discovering ? "Scanning the web for prospects…" : "Synthesizing CRM telemetry context..."}</span>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-border-subtle bg-surface-elevated/30">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center space-x-2"
              >
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask anything, or: find dermatology clinics in Miami…"
                  className="flex-1 bg-surface-lowest border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-primary/60"
                />
                <button
                  type="submit"
                  disabled={loading || discovering || !prompt.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
