"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Brain, Clock3, Plus, Search, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Display, MonoLabel, PageTitle } from "@/components/ui/typography";
import { getAgentMemoryAction, rememberAgentMemoryAction, forgetAgentMemoryAction } from "@/app/actions/ai.actions";

type Memory = Awaited<ReturnType<typeof getAgentMemoryAction>>[number];

const scopes = ["all","workspace","agent","lead","deal","company","contact","project","task"] as const;

export default function AgentMemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [scope, setScope] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(3);
  const [saving, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setMemories(await getAgentMemoryAction({ scope: scope === "all" ? undefined : scope as any, query: query || undefined, limit: 50 })); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [scope]);

  function addMemory() {
    if (!content.trim()) return;
    startTransition(async () => {
      await rememberAgentMemoryAction({ scope: scope === "all" ? "workspace" : scope as any, content: content.trim(), importance });
      setContent("");
      await load();
    });
  }

  function remove(id: string) {
    startTransition(async () => { await forgetAgentMemoryAction(id); await load(); });
  }

  const grouped = useMemo(() => memories, [memories]);

  return <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
    <div className="flex flex-col gap-5 border-b border-border-subtle/50 pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <MonoLabel className="mb-2 block text-primary">AGENTS // MEMORY</MonoLabel>
        <Display>Give AEXYL context that lasts.</Display>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Durable business context for agents. Memory is workspace-scoped, ranked by importance, and never silently promoted from conversation.</p>
      </div>
      <Badge variant="outline"><Brain className="mr-1.5 h-3.5 w-3.5"/> {memories.length} memories</Badge>
    </div>

    <GlassPanel className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4 text-primary"/> Add memory</div>
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Example: For local restaurant clients, Sameer prefers Instagram-first campaigns." className="mt-4 min-h-24 w-full resize-none rounded-xl border border-border-subtle bg-surface-low p-3 text-sm outline-none focus:border-primary/40" />
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <select value={scope === "all" ? "workspace" : scope} onChange={e => setScope(e.target.value)} className="rounded-xl border border-border-subtle bg-surface-low px-3 py-2 text-xs">
            {scopes.filter(s => s !== "all").map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-text-muted">Importance
            <select value={importance} onChange={e => setImportance(Number(e.target.value))} className="rounded-lg border border-border-subtle bg-surface-low px-2 py-1">
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <button disabled={saving || !content.trim()} onClick={addMemory} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4"/> Save memory</button>
      </div>
    </GlassPanel>

    <GlassPanel className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageTitle className="text-base">Memory bank</PageTitle>
        <div className="flex gap-2">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-text-muted"/><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && void load()} placeholder="Search memory..." className="w-64 rounded-xl border border-border-subtle bg-surface-low py-2 pl-9 pr-3 text-xs outline-none"/></div>
          <button onClick={() => void load()} className="rounded-xl border border-border-subtle px-3 py-2 text-xs">Search</button>
        </div>
      </div>
      <div className="mt-5 divide-y divide-border-subtle/60">
        {loading ? <div className="py-10 text-center text-xs text-text-muted">Loading memory…</div> :
        grouped.length === 0 ? <div className="py-10 text-center text-xs text-text-muted">No memory stored yet.</div> :
        grouped.map(memory => <div key={memory.id} className="flex items-start gap-4 py-4">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2"><Brain className="h-4 w-4 text-primary"/></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6 text-text-primary">{memory.content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="outline">{memory.scope}</Badge><Badge variant="secondary">importance {memory.importance}</Badge>{memory.expiresAt && <span className="inline-flex items-center gap-1 text-[10px] text-text-muted"><Clock3 className="h-3 w-3"/> expires {new Date(memory.expiresAt).toLocaleDateString()}</span>}</div>
          </div>
          <button onClick={() => remove(memory.id)} disabled={saving} className="rounded-lg p-2 text-text-muted hover:text-destructive disabled:opacity-50"><Trash2 className="h-4 w-4"/></button>
        </div>)}
      </div>
    </GlassPanel>
  </div>;
}
