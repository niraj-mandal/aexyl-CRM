/**
 * Route-level loading skeleton for every Sales & Outreach tab (leads,
 * pipeline, companies, contacts, deals + their detail/new pages).
 *
 * With this file present the (app) shell streams instantly on navigation and
 * this skeleton renders while the tab's data loads — no more blank stalls.
 * Mirrors the pages' real layout (title bar + stat cards + table) using the
 * same glass tokens so the swap feels seamless.
 */
export default function SalesLoading() {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Title bar */}
      <div className="flex justify-between items-end">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-surface-elevated/70 animate-pulse" />
          <div className="h-4 w-64 rounded bg-surface-elevated/50 animate-pulse" />
        </div>
        <div className="h-10 w-28 rounded-md bg-surface-elevated/70 animate-pulse" />
      </div>

      {/* Stat cards (leads layout) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-panel p-4">
            <div className="h-4 w-20 rounded bg-surface-elevated/60 animate-pulse" />
            <div className="h-8 w-14 rounded bg-surface-elevated/70 animate-pulse mt-2" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                {["Company", "Contact", "Stage", "Temp", "Score", "Owner", ""].map((h, i) => (
                  <th key={i} className="px-6 py-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-6 py-4">
                      <div
                        className="h-4 rounded bg-surface-elevated/50 animate-pulse"
                        style={{ width: `${45 + ((i * 13 + j * 29) % 45)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
