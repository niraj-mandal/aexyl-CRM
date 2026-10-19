"use client";

import { Flame, Phone } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import type { OutreachLead } from "@/app/actions/outreach.actions";

const RANK: Record<string, number> = { QUALIFIED: 3, CONTACTED: 2, NURTURE: 1, NEW: 0 };

const TILE: Record<string, { label: string; cls: string }> = {
  OVERDUE: { label: "Overdue", cls: "bg-[#E5322D] text-white" },
  QUALIFIED: { label: "Interested", cls: "bg-[#1F7A4D] text-white" },
  CONTACTED: { label: "Contacted", cls: "bg-[#F5C84C] text-[#1A1A1A]" },
  NURTURE: { label: "Nurture", cls: "bg-surface-highest text-text-primary" },
  NEW: { label: "New", cls: "bg-[#0B0B0D] text-white ring-1 ring-inset ring-white/10" },
};

const isOverdue = (l: OutreachLead, startOfToday: Date) =>
  Boolean(l.nextFollowUpAt && new Date(l.nextFollowUpAt) < startOfToday);

/** Open leads closest to signing: furthest stage first, then score. */
export function pickHotLeads(leads: OutreachLead[], limit = 6) {
  return leads
    .filter((l) => l.status in RANK)
    .sort((a, b) => RANK[b.status] - RANK[a.status] || b.score - a.score)
    .slice(0, limit);
}

/** Bold tiles, one color per stage, so the warmest gyms stand out at a glance. */
export function HotLeads({ leads, onOpen }: { leads: OutreachLead[]; onOpen: (l: OutreachLead) => void }) {
  const hot = pickHotLeads(leads);
  if (hot.length === 0) return null;
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <GlassPanel className="p-5">
      <SectionHeader icon={Flame} title="Hot leads" meta="closest to signing" />
      <div className="stagger mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {hot.map((l) => {
          const tile = TILE[isOverdue(l, startOfToday) ? "OVERDUE" : l.status];
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onOpen(l)}
              className={`flex min-h-[124px] flex-col justify-between rounded-xl p-3.5 text-left shadow-lg transition-transform duration-200 hover:-translate-y-1 ${tile.cls}`}
            >
              <span className="flex items-center justify-between gap-2 text-xs opacity-80">
                <span className="truncate">{tile.label}</span>
                <span className="num shrink-0">{l.score}</span>
              </span>
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{l.businessName}</span>
              <span className="flex items-center gap-1.5 text-xs opacity-75">
                {l.phone && <Phone className="h-3 w-3 shrink-0" />}
                <span className="truncate">{l.area ?? "No address"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </GlassPanel>
  );
}
