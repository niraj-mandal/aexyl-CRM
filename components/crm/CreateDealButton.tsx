"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";
import { createDealAction } from "@/app/actions/crm.actions";

const STAGES = ["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION"] as const;

const STAGE_PROBABILITY: Record<string, number> = {
  QUALIFIED: 30,
  CALL_BOOKED: 45,
  PROPOSAL: 60,
  NEGOTIATION: 80,
};

/**
 * Inline deal creation for the pipeline board. Persists a real deal row and
 * refreshes the kanban. Stage pre-selects when opened from a column.
 */
export function CreateDealButton({
  companies,
  defaultStage,
  compact = false,
}: {
  companies: { id: string; name: string }[];
  defaultStage?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const initialStage =
    defaultStage && STAGES.includes(defaultStage as (typeof STAGES)[number]) ? defaultStage : "QUALIFIED";
  const [stage, setStage] = useState<string>(initialStage);
  const [value, setValue] = useState("25000");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (companies.length === 0) {
    return null;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Create deal"
        className={
          compact
            ? "p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            : "inline-flex items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 transition-all"
        }
      >
        <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {!compact && <span>Create Deal</span>}
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !companyId) return;
    setSaving(true);
    setError(null);
    try {
      await createDealAction({
        name: name.trim(),
        companyId,
        stage,
        probability: STAGE_PROBABILITY[stage] ?? 30,
        value: parseFloat(value) > 0 ? String(parseFloat(value)) : "0",
        currency: "USD",
      });
      setOpen(false);
      setName("");
      setValue("25000");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full rounded-lg border border-primary/30 bg-surface-low p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-primary">New Deal</span>
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Deal name"
        required
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
      />

      <select
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        className="w-full rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="flex space-x-2">
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="flex-1 rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="1000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 rounded-md bg-surface-lowest border border-border-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
          title="Value (USD)"
        />
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="w-full inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create Deal"}
      </button>
    </form>
  );
}
