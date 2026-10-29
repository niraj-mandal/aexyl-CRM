import Link from "next/link";
import { Trophy } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ScoreboardService } from "@/services/scoreboard.service";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const RANGES = [7, 14, 30];
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default async function ScoreboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { workspaceId, userId, isSales } = await requireWorkspace();
  const requested = Number((await searchParams).days);
  const days = RANGES.includes(requested) ? requested : 7;
  // Sales members see their own numbers; admins see everyone, with a per-person breakdown.
  const { totals: t, today, daily, cities, people } = await ScoreboardService.get(workspaceId, days, undefined, isSales ? userId : undefined);
  const max = Math.max(1, ...daily.map((d) => d.calls));

  const chip = (active: boolean) =>
    `inline-flex items-center rounded-full border px-3 py-1 text-xs max-sm:min-h-9 font-medium transition-colors ${
      active ? "border-primary/40 bg-primary/15 text-primary" : "border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary"
    }`;

  const tiles = [
    { label: "Calls", value: t.calls, sub: `${today.calls} today` },
    { label: "Picked up", value: t.connected, sub: `${pct(t.connected, t.calls)} of calls` },
    { label: "Interested", value: t.interested, sub: `${pct(t.interested, t.connected)} of pickups` },
    { label: "Won", value: t.won, sub: `${pct(t.won, t.interested)} of interested` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Scoreboard"
        description={`Calls and results for the last ${days} days. WhatsApps sent: ${t.whatsapp}.`}
      />

      <nav aria-label="Time range" className="flex gap-2">
        {RANGES.map((r) => (
          <Link key={r} href={`/sales/scoreboard?days=${r}`} aria-current={r === days ? "page" : undefined} className={chip(r === days)}>
            {r} days
          </Link>
        ))}
      </nav>

      {t.calls + t.whatsapp + t.interested + t.notNow + t.notInterested + t.won === 0 ? (
        <div className="glass-panel">
          <EmptyState
            icon={Trophy}
            title="No calls logged yet"
            body="Tick Reached out, log No answer, or record an outcome on a lead, and your numbers show up here."
            action={{ href: "/sales/leads", label: "Go to Leads" }}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((s) => (
              <div key={s.label} className="glass-panel p-4">
                <p className="text-xs text-text-muted">{s.label}</p>
                <p className="num mt-1 text-3xl font-semibold text-text-primary">{s.value}</p>
                <p className="num mt-1 text-xs text-text-secondary">{s.sub}</p>
              </div>
            ))}
          </div>

          <section className="glass-panel p-5">
            <h2 className="text-sm font-semibold text-text-primary">Calls per day</h2>
            <div className="mt-4 flex h-44 items-end gap-[2px]" role="list" aria-label="Calls per day">
              {daily.map((d) => {
                const label = `${dayLabel(d.day)}: ${d.calls} call${d.calls === 1 ? "" : "s"}, ${d.connected} picked up, ${d.interested} interested`;
                return (
                  <div key={d.day} role="listitem" tabIndex={0} aria-label={label} className="group relative flex h-full flex-1 items-end focus:outline-none">
                    <div
                      className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary group-focus:bg-primary"
                      style={{ height: d.calls ? `${(d.calls / max) * 100}%` : "2px", opacity: d.calls ? 1 : 0.25 }}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-lg border border-border-subtle bg-[var(--surface-glass-floating)] px-2.5 py-1.5 text-xs text-text-primary shadow-xl backdrop-blur-xl group-hover:block group-focus:block">
                      <p className="font-medium">{dayLabel(d.day)}</p>
                      <p className="num text-text-secondary">{d.calls} calls · {d.connected} picked up · {d.interested} interested</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="num mt-2 flex justify-between text-[11px] text-text-muted">
              <span>{dayLabel(daily[0].day)}</span>
              <span>Today</span>
            </div>
          </section>

          {!isSales && people.length > 0 && (
            <section className="glass-panel overflow-hidden">
              <h2 className="px-5 pt-5 text-sm font-semibold text-text-primary">By person</h2>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="border-b border-border-subtle text-xs text-text-muted">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Person</th>
                      <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                      <th className="px-3 py-2.5 text-right font-medium">Picked up</th>
                      <th className="px-3 py-2.5 text-right font-medium">WhatsApps</th>
                      <th className="px-3 py-2.5 text-right font-medium">Interested</th>
                      <th className="px-3 py-2.5 text-right font-medium">Won</th>
                      <th className="px-5 py-2.5 text-right font-medium">Interest rate</th>
                    </tr>
                  </thead>
                  <tbody className="num divide-y divide-border-subtle text-text-secondary">
                    {people.map((p) => (
                      <tr key={p.userId}>
                        <td className="px-5 py-2.5 font-medium text-text-primary">{p.person}</td>
                        <td className="px-3 py-2.5 text-right">{p.calls}</td>
                        <td className="px-3 py-2.5 text-right">{p.connected}</td>
                        <td className="px-3 py-2.5 text-right">{p.whatsapp}</td>
                        <td className="px-3 py-2.5 text-right">{p.interested}</td>
                        <td className="px-3 py-2.5 text-right">{p.won}</td>
                        <td className="px-5 py-2.5 text-right text-text-primary">{pct(p.interested, p.connected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="glass-panel overflow-hidden">
            <h2 className="px-5 pt-5 text-sm font-semibold text-text-primary">By city</h2>
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-left text-sm">
                <thead className="border-b border-border-subtle text-xs text-text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">City</th>
                    <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-3 py-2.5 text-right font-medium">Picked up</th>
                    <th className="px-3 py-2.5 text-right font-medium">WhatsApps</th>
                    <th className="px-3 py-2.5 text-right font-medium">Interested</th>
                    <th className="px-3 py-2.5 text-right font-medium">Won</th>
                    <th className="px-5 py-2.5 text-right font-medium">Interest rate</th>
                  </tr>
                </thead>
                <tbody className="num divide-y divide-border-subtle text-text-secondary">
                  {cities.map((c) => (
                    <tr key={c.city}>
                      <td className="px-5 py-2.5 font-medium text-text-primary">
                        <Link href={`/sales/leads?${new URLSearchParams({ city: c.city })}`} className="hover:text-primary">{c.city}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right">{c.calls}</td>
                      <td className="px-3 py-2.5 text-right">{c.connected}</td>
                      <td className="px-3 py-2.5 text-right">{c.whatsapp}</td>
                      <td className="px-3 py-2.5 text-right">{c.interested}</td>
                      <td className="px-3 py-2.5 text-right">{c.won}</td>
                      <td className="px-5 py-2.5 text-right text-text-primary">{pct(c.interested, c.connected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
