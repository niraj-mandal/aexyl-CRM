"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, UsersRound } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { GymAvatar } from "@/components/ui/gym-avatar";
import type { ScoreboardService } from "@/services/scoreboard.service";

type Team = Awaited<ReturnType<typeof ScoreboardService.team>>;

/** Admin dashboard: the whole team's calls today, combined, then each person's numbers and lead status. */
export function TeamToday() {
  const [team, setTeam] = useState<Team | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/crm/team", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Team>) : Promise.reject(r.status)))
      .then(setTeam)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!team) return <Skeleton className="h-[260px] rounded-2xl" />;

  const { total, people } = team;
  const totals = [
    { label: "Calls", value: total.calls },
    { label: "Picked up", value: total.connected },
    { label: "Interested", value: total.interested },
    { label: "WhatsApps", value: total.whatsapp },
  ];

  return (
    <GlassPanel className="space-y-4 p-5">
      <SectionHeader
        icon={UsersRound}
        title="Team today"
        meta={`${people.length} ${people.length === 1 ? "person" : "people"}`}
        action={
          <Link href="/sales/scoreboard" className="flex items-center text-xs font-medium text-primary hover:underline">
            Scoreboard <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        }
      />

      <dl className="grid grid-cols-4 gap-2 rounded-xl bg-surface-high/60 p-3">
        {totals.map((t) => (
          <div key={t.label} className="min-w-0 text-center">
            <dd className="num text-2xl font-semibold text-text-primary">{t.value}</dd>
            <dt className="truncate text-[11px] text-text-muted">{t.label}</dt>
          </div>
        ))}
      </dl>

      {people.length === 0 ? (
        <p className="text-xs text-text-muted">Nobody owns leads yet. Assign leads in Settings → Team.</p>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl bg-surface-high/60">
          {people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3">
              <div className="flex min-w-0 flex-1 basis-48 items-center gap-2.5">
                <GymAvatar name={p.name} size={34} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-text-primary">
                    {p.name}
                    <span className="rounded-full bg-surface-highest px-1.5 py-px text-[10px] font-medium text-text-muted">{p.role}</span>
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {p.lastContactAt ? `Last contact ${formatDistanceToNow(new Date(p.lastContactAt), { addSuffix: true })}` : "No contacts yet"}
                  </p>
                </div>
              </div>
              {/* Today's activity */}
              <div className="num flex gap-4 text-center">
                <Stat value={p.calls} label="calls" strong />
                <Stat value={p.connected} label="picked up" />
                <Stat value={p.interested} label="interested" />
              </div>
              {/* Where their leads stand */}
              <p className="num w-full text-xs text-text-muted sm:w-auto sm:text-right">
                <span className="text-text-secondary">{p.leads}</span> leads · <span className="text-text-secondary">{p.toContact}</span> not called ·{" "}
                <span className={p.followUpsDue ? "font-semibold text-tertiary" : "text-text-secondary"}>{p.followUpsDue}</span> follow-up{p.followUpsDue === 1 ? "" : "s"} due
              </p>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function Stat({ value, label, strong }: { value: number; label: string; strong?: boolean }) {
  return (
    <div className="w-14">
      <p className={`text-lg font-semibold ${strong && value > 0 ? "text-success" : "text-text-primary"}`}>{value}</p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  );
}
