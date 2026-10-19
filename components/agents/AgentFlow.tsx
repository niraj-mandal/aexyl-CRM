"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle, Brain, Briefcase, CalendarClock, Crown, Database, FolderKanban, History, Inbox, LineChart,
  ListChecks, MessageSquare, MousePointerClick, Newspaper, Play, Radar, RefreshCw, Search, Send, ShieldCheck,
  Square, Target, UserPlus, type LucideIcon,
} from "lucide-react";

export interface FlowAgent {
  key: string;
  name: string;
  enabled: boolean;
  tools: string[];
  runs24h: number;
  description: string;
}

interface Props {
  agents: FlowAgent[];
  rules: { eventType: string; agentKey: string; enabled: boolean }[];
  killSwitch: boolean;
  pendingApprovals: number;
  /** Events fired per type in the last 7 days. */
  events7d: Record<string, number>;
}

type Node = { id: string; title: string; sub: string; icon: LucideIcon; about: string };

const TRIGGERS: Node[] = [
  { id: "t-lead.created", title: "New lead", sub: "lead.created", icon: UserPlus, about: "Recorded the moment a lead is added (Lead Discovery approval, Add lead, import or Copilot). The agent runs at the next daily run." },
  { id: "t-lead.stale", title: "Hot lead goes quiet", sub: "lead.stale", icon: AlertTriangle, about: "Checked at the daily run: a hot lead you've contacted before with no contact for 7+ days. Never-contacted leads don't count; they're in the Today list." },
  { id: "t-lead.followup_due", title: "Follow-up due", sub: "lead.followup_due", icon: CalendarClock, about: "Checked at the daily run: leads whose follow-up date has passed." },
  { id: "t-project.at_risk", title: "Project at risk", sub: "project.at_risk", icon: Briefcase, about: "Checked at the daily run: active projects marked at risk / off track, or past their due date." },
  { id: "t-manual", title: "You press Run", sub: "runs immediately", icon: MousePointerClick, about: "Run any agent by hand from its card below. This is the only trigger that runs straight away." },
];

const AGENT_ICON: Record<string, LucideIcon> = {
  scout: Radar, sales: Target, outreach: Send, followup: RefreshCw, operations: Briefcase, executive: Crown,
};

const BRAIN: Node[] = [
  { id: "planner", title: "Planner", sub: "AI plan from real CRM data", icon: Brain, about: "Writes a 2–5 step plan using only real workspace data. If the AI is unavailable, a safe built-in plan is used instead." },
  { id: "policy", title: "Policy & Safety", sub: "autonomy · budget · kill switch", icon: ShieldCheck, about: "Every step is checked against the agent's autonomy level, daily run and token budget, and the kill switch. Writes are routed to approval." },
];

const TOOLS: (Node & { prefix: string })[] = [
  { id: "tool-crm", prefix: "crm.", title: "CRM", sub: "leads · deals · companies", icon: Database, about: "Search and read leads, deals and companies, and log activity. Changing a lead, moving a deal or creating a company waits for your approval." },
  { id: "tool-research", prefix: "research.", title: "Research", sub: "web · local discovery", icon: Search, about: "Web search and local gym discovery from map data." },
  { id: "tool-comm", prefix: "communication.", title: "Communication", sub: "draft & send email", icon: MessageSquare, about: "Drafts emails (no approval needed for a draft). Sending one always waits for your approval. Agents don't send WhatsApp." },
  { id: "tool-projects", prefix: "projects.", title: "Projects", sub: "projects · tasks", icon: FolderKanban, about: "Reads website projects and creates tasks (tasks are created directly, without approval)." },
  { id: "tool-insights", prefix: "intelligence.", title: "Insights", sub: "metrics · briefing", icon: LineChart, about: "Business metrics, attention items and the daily briefing." },
];

const OUTCOMES: Node[] = [
  { id: "out-approvals", title: "Needs your approval", sub: "", icon: Inbox, about: "Anything that writes or sends waits here until you approve it." },
  { id: "out-activity", title: "Activity logged", sub: "on the lead's history", icon: History, about: "Notes and activity are written to the lead, deal or company timeline (no approval needed)." },
  { id: "out-tasks", title: "Tasks created", sub: "directly, shown on My Day", icon: ListChecks, about: "The Operations agent can add tasks straight to your My Day checklist." },
  { id: "out-report", title: "Run report", sub: "findings on the run page", icon: Newspaper, about: "Every run saves its plan, findings and each step's result on the agent's run page. (The dashboard's Daily brief is a separate AI check, not these agents.)" },
];

const TOOL_TO_OUTCOME: [string, string][] = [
  ["tool-comm", "out-approvals"],
  ["tool-crm", "out-approvals"],
  ["tool-crm", "out-activity"],
  ["tool-projects", "out-tasks"],
  ["tool-research", "out-report"],
  ["tool-insights", "out-report"],
];

/** Example run, played node by node. Purely visual: nothing is created or sent. */
const SIMULATION: { node: string; text: string }[] = [
  { node: "t-lead.followup_due", text: "A lead's follow-up date passes; the 7:00 AM daily run picks it up." },
  { node: "a-followup", text: "The Follow-up Agent takes it." },
  { node: "planner", text: "The Planner writes a short plan from the real lead data." },
  { node: "policy", text: "Safety check: autonomy level, budget, kill switch." },
  { node: "tool-crm", text: "It looks the lead up in the CRM." },
  { node: "tool-comm", text: "It drafts a follow-up email." },
  { node: "out-approvals", text: "Sending the email (or changing the lead) waits for your approval." },
];

type Edge = { from: string; to: string; live: boolean };

export function AgentFlow({ agents, rules, killSwitch, pendingApprovals, events7d }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<(Edge & { d: string })[]>([]);
  const [step, setStep] = useState(-1);
  const [selected, setSelected] = useState<string | null>(null);

  const ran = agents.some((a) => a.runs24h > 0);
  const toolGroups = TOOLS.filter((t) => agents.some((a) => a.tools.some((id) => id.startsWith(t.prefix))));

  const edges: Edge[] = [
    ...rules
      .filter((r) => TRIGGERS.some((t) => t.id === `t-${r.eventType}`))
      .map((r) => ({ from: `t-${r.eventType}`, to: `a-${r.agentKey}`, live: r.enabled && (events7d[r.eventType] ?? 0) > 0 })),
    ...agents.map((a) => ({ from: "t-manual", to: `a-${a.key}`, live: false })),
    ...agents.map((a) => ({ from: `a-${a.key}`, to: "planner", live: a.enabled && a.runs24h > 0 })),
    { from: "planner", to: "policy", live: ran },
    ...toolGroups.map((t) => ({ from: "policy", to: t.id, live: ran && !killSwitch })),
    ...TOOL_TO_OUTCOME.filter(([t]) => toolGroups.some((g) => g.id === t)).map(([from, to]) => ({ from, to, live: ran && !killSwitch })),
  ];
  const edgeKey = edges.map((e) => `${e.from}>${e.to}:${e.live}`).join("|");

  // Draw curves between the real node positions; redo on resize.
  const measure = useCallback(() => {
    const root = box.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const at = (id: string) => root.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect();
    const next: (Edge & { d: string })[] = [];
    for (const e of edges) {
      const a = at(e.from);
      const b = at(e.to);
      if (!a || !b) continue;
      const x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top;
      const dx = Math.max(24, (x2 - x1) / 2);
      next.push({ ...e, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
    }
    setPaths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edges are captured by edgeKey
  }, [edgeKey]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);

  // Simulation: advance one node every 1.3 s, then stop on the last step.
  useEffect(() => {
    if (step < 0 || step >= SIMULATION.length - 1) return;
    const id = setTimeout(() => setStep((s) => s + 1), 1300);
    return () => clearTimeout(id);
  }, [step]);

  const playing = step >= 0;
  const litNodes = new Set(SIMULATION.slice(0, step + 1).map((s) => s.node));
  const current = playing ? SIMULATION[step].node : null;
  const hotEdge = (e: Edge) => {
    const i = SIMULATION.findIndex((s) => s.node === e.from);
    return i >= 0 && i < step && SIMULATION[i + 1]?.node === e.to;
  };

  const info: Record<string, string> = {
    "out-approvals": `${pendingApprovals} waiting now`,
    policy: killSwitch ? "Kill switch is ON: every agent is stopped" : "Kill switch off",
  };
  for (const a of agents) info[`a-${a.key}`] = `${a.enabled ? "Active" : "Paused"} · ${a.runs24h} run${a.runs24h === 1 ? "" : "s"} in 24h · ${a.tools.length} tools`;
  for (const t of toolGroups) info[t.id] = `${new Set(agents.flatMap((a) => a.tools.filter((id) => id.startsWith(t.prefix)))).size} tools`;

  const allNodes: Node[] = [
    ...TRIGGERS,
    ...agents.map((a) => ({ id: `a-${a.key}`, title: a.name, sub: "", icon: AGENT_ICON[a.key] ?? Brain, about: a.description })),
    ...BRAIN,
    ...toolGroups,
    ...OUTCOMES,
  ];
  const sel = allNodes.find((n) => n.id === selected);

  const card = (n: Node, extra?: { dot?: "on" | "off" | "stop"; badge?: string }) => {
    const lit = litNodes.has(n.id);
    const isCurrent = current === n.id;
    return (
      <button
        key={n.id}
        type="button"
        data-node={n.id}
        onClick={() => setSelected(selected === n.id ? null : n.id)}
        aria-pressed={selected === n.id}
        className={`glass relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-300 ${
          isCurrent ? "scale-[1.04] ring-2 ring-primary shadow-[0_0_28px_-4px_rgba(255,69,58,0.6)]" : lit ? "ring-1 ring-primary/50" : selected === n.id ? "ring-1 ring-border-strong" : "hover:ring-1 hover:ring-border-strong"
        }`}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${lit ? "bg-primary/20 text-primary" : "bg-[rgba(124,77,255,0.14)] text-[#8B7CF6]"}`}>
          <n.icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-text-primary">{n.title}</span>
          {(extra?.badge ?? n.sub) && <span className="block truncate text-[11px] text-text-muted">{extra?.badge ?? n.sub}</span>}
        </span>
        {extra?.dot && (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${extra.dot === "on" ? "bg-success shadow-[0_0_8px_var(--color-success,#30D158)]" : extra.dot === "stop" ? "bg-danger" : "bg-text-muted/50"}`}
            aria-label={extra.dot === "on" ? "active" : extra.dot === "stop" ? "stopped" : "paused"}
          />
        )}
      </button>
    );
  };

  const col = (label: string, children: React.ReactNode) => (
    <div className="flex min-w-0 flex-col justify-center gap-2.5">
      <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      {children}
    </div>
  );

  return (
    <section aria-label="How the agents work" className="glass-panel overflow-hidden p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">How your agents work</h2>
          <p className="text-xs text-text-muted">
            Automatic triggers are checked once a day at 7:00 AM IST; Run starts an agent immediately. Wires glow only for what actually ran. Click any box for details.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStep(playing && step < SIMULATION.length - 1 ? -1 : 0)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          {playing && step < SIMULATION.length - 1 ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing && step < SIMULATION.length - 1 ? "Stop" : step === SIMULATION.length - 1 ? "Replay" : "Simulate a run"}
        </button>
      </div>

      <div ref={box} className="relative">
        {/* Connectors (desktop only; on phones the columns stack) */}
        <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" aria-hidden>
          {paths.map((p) => {
            const hot = hotEdge(p);
            return (
              <path
                key={`${p.from}>${p.to}`}
                d={p.d}
                fill="none"
                strokeLinecap="round"
                className={hot ? "flow-hot" : p.live ? "flow-live" : "flow-idle"}
              />
            );
          })}
        </svg>

        <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr_1fr_1fr] lg:gap-10">
          {col(
            "Triggers",
            TRIGGERS.map((t) =>
              t.id === "t-manual" ? card(t) : card(t, { badge: `${events7d[t.id.slice(2)] ?? 0} in 7 days · ${t.sub}` }),
            ),
          )}
          {col(
            "Agents",
            agents.map((a) =>
              card(
                { id: `a-${a.key}`, title: a.name, sub: "", icon: AGENT_ICON[a.key] ?? Brain, about: "" },
                { dot: killSwitch ? "stop" : a.enabled ? "on" : "off", badge: `${a.runs24h} run${a.runs24h === 1 ? "" : "s"} in 24h` },
              ),
            ),
          )}
          {col("Brain", BRAIN.map((b) => card(b, b.id === "policy" && killSwitch ? { dot: "stop", badge: "Kill switch ON" } : undefined)))}
          {col("Tools", toolGroups.map((t) => card(t)))}
          {col(
            "Outcomes",
            OUTCOMES.map((o) => card(o, o.id === "out-approvals" ? { badge: `${pendingApprovals} waiting` } : undefined)),
          )}
        </div>
      </div>

      {/* Simulation caption + selected node details */}
      <div className="mt-5 grid gap-3 md:grid-cols-2" aria-live="polite">
        <div className="rounded-xl bg-surface-high/60 px-4 py-3 text-sm">
          {playing ? (
            <>
              <span className="num mr-2 text-xs font-semibold text-primary">
                Step {step + 1}/{SIMULATION.length}
              </span>
              <span className="text-text-primary">{SIMULATION[step].text}</span>
            </>
          ) : (
            <span className="text-text-muted">Press “Simulate a run” to watch an example travel through the system. It&apos;s only a demo: nothing is created or sent.</span>
          )}
        </div>
        <div className="rounded-xl bg-surface-high/60 px-4 py-3 text-sm">
          {sel ? (
            <>
              <span className="font-semibold text-text-primary">{sel.title}</span>
              {info[sel.id] && <span className="ml-2 text-xs text-text-muted">{info[sel.id]}</span>}
              {sel.about && <p className="mt-1 text-text-secondary">{sel.about}</p>}
            </>
          ) : (
            <span className="text-text-muted">Nothing is ever sent without your approval. Every step is checked and logged.</span>
          )}
        </div>
      </div>
    </section>
  );
}
