"use client";

import { useState } from "react";
import { Phone, LoaderCircle, Copy, Check } from "lucide-react";
import { generateCallScriptAction, type CallScript } from "@/app/actions/call-script.actions";

/**
 * Built-in call script for a lead (pitch: "Built-In Call Scripts").
 * Generated on demand from the lead's real CRM data; clearly labeled when the
 * deterministic fallback produced it. One click, audited server-side.
 */
export function CallScriptCard({ leadId }: { leadId: string }) {
  const [script, setScript] = useState<CallScript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await generateCallScriptAction(leadId);
      if (res.ok) setScript(res.script);
      else setError(res.error);
    } catch {
      setError("Couldn't generate the script — try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!script) return;
    const text = [
      `CALL SCRIPT — generated for this lead (${script.source === "llm" ? "AI" : "standard template"})`,
      "",
      `OPENER: ${script.opener}`,
      "",
      "DISCOVERY QUESTIONS:",
      ...script.discoveryQuestions.map((q, i) => `  ${i + 1}. ${q}`),
      "",
      `PITCH: ${script.pitch}`,
      "",
      "OBJECTION HANDLING:",
      ...script.objectionHandling.map((o) => `  ${o.objection} → ${o.response}`),
      "",
      `CLOSE: ${script.close}`,
    ].join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="glass-panel rounded-xl border border-border-subtle p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="flex items-center gap-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
          <Phone className="h-3.5 w-3.5" /> Call Script
        </h4>
        {script && (
          <button
            onClick={copyAll}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition"
            aria-label="Copy call script"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-secondary" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {!script && !loading && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Generate a phone script tailored to this lead — opener, discovery questions,
            pitch, and objection handling, grounded in what we actually know.
          </p>
          <button
            onClick={generate}
            className="bg-text-primary text-background px-3 py-1.5 rounded-md text-sm font-medium hover:bg-text-secondary transition"
          >
            Generate script
          </button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Writing the script…
        </div>
      )}

      {script && !loading && (
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-[11px] font-mono-code uppercase text-text-muted mb-1">Opener</div>
            <p className="text-text-primary leading-relaxed">{script.opener}</p>
          </div>
          <div>
            <div className="text-[11px] font-mono-code uppercase text-text-muted mb-1">Discovery</div>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary">
              {script.discoveryQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="text-[11px] font-mono-code uppercase text-text-muted mb-1">Pitch</div>
            <p className="text-text-secondary leading-relaxed">{script.pitch}</p>
          </div>
          {script.objectionHandling.length > 0 && (
            <div>
              <div className="text-[11px] font-mono-code uppercase text-text-muted mb-1">Objections</div>
              <div className="space-y-2">
                {script.objectionHandling.map((o, i) => (
                  <div key={i} className="rounded-lg border border-border-subtle bg-surface-low p-3">
                    <div className="text-text-primary">{o.objection}</div>
                    <div className="text-text-secondary mt-1">→ {o.response}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] font-mono-code uppercase text-text-muted mb-1">Close</div>
            <p className="text-text-primary leading-relaxed">{script.close}</p>
          </div>
          <p className="text-[11px] text-text-muted border-t border-border-subtle pt-3">
            {script.source === "llm"
              ? "AI-generated from this lead's CRM data — a conversation aid, not verified facts. Verify before you promise anything."
              : "Standard template (LLM unavailable) built from this lead's CRM fields."}
          </p>
        </div>
      )}
    </div>
  );
}
