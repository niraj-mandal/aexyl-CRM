export default function AppLoading() {
  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Title bar */}
      <div className="flex justify-between items-end">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-md bg-surface-elevated/70 animate-pulse" />
          <div className="h-4 w-72 rounded bg-surface-elevated/50 animate-pulse" />
        </div>
        <div className="h-10 w-28 rounded-md bg-surface-elevated/70 animate-pulse" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-panel p-5">
            <div className="h-4 w-20 rounded bg-surface-elevated/60 animate-pulse" />
            <div className="h-7 w-16 rounded bg-surface-elevated/70 animate-pulse mt-3" />
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="glass-panel p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-4 rounded bg-surface-elevated/50 animate-pulse shrink-0" />
            <div
              className="h-4 rounded bg-surface-elevated/50 animate-pulse"
              style={{ width: `${40 + ((i * 17) % 50)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
