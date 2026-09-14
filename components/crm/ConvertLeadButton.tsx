"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { convertLeadToDealAction } from "@/app/actions/crm.actions";

/**
 * Agentic conversion: turns a lead into a real pipeline deal (server-side),
 * then navigates to the new deal record.
 */
export function ConvertLeadButton({
  leadId,
  companyName,
  defaultValue,
}: {
  leadId: string;
  companyName: string;
  defaultValue?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dealName, setDealName] = useState(`${companyName} — New Opportunity`);
  const [value, setValue] = useState(String(defaultValue ?? 50000));
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center space-x-2 rounded-md bg-text-primary text-background px-4 py-2 text-sm font-medium hover:bg-text-secondary transition"
      >
        <ArrowRightLeft className="h-4 w-4" />
        <span>Convert to Deal</span>
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConverting(true);
    setError(null);
    try {
      const deal = await convertLeadToDealAction(leadId, {
        name: dealName.trim() || `${companyName} — New Opportunity`,
        value: parseFloat(value) > 0 ? String(parseFloat(value)) : "50000.00",
        stage: "QUALIFIED",
        probability: 30,
      });
      router.push(`/sales/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
      setConverting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-low p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center text-xs font-semibold text-text-primary">
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5 text-primary" />
          Convert Lead to Deal
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-text-muted hover:text-text-primary"
          disabled={converting}
        >
          Cancel
        </button>
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">Deal name</label>
        <input
          value={dealName}
          onChange={(e) => setDealName(e.target.value)}
          className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-[11px] text-text-muted mb-1">Value (USD)</label>
        <input
          type="number"
          min="0"
          step="1000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-md bg-surface-lowest border border-border-subtle px-3 py-2 text-xs text-text-primary focus:border-primary/60 focus:outline-none"
        />
      </div>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <button
        type="submit"
        disabled={converting}         className="w-full inline-flex items-center justify-center space-x-2 rounded-md bg-text-primary text-background px-4 py-2 text-xs font-semibold hover:bg-text-secondary transition disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
      >
        {converting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{converting ? "Converting..." : "Create Deal & Convert"}</span>
      </button>
    </form>
  );
}
