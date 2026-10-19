import { cn } from "@/lib/utils";

/** Shimmering placeholder block; size it with className. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} style={style} />;
}

/** Placeholder for the shared PageHeader: eyebrow, title, description, action. */
export function HeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  );
}

/** Table placeholder: a header strip and rows with varied widths so it reads as content. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex gap-6 border-b border-border-subtle px-4 py-3">
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} className="h-3 w-14" />
        ))}
      </div>
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3.5">
            <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
            <div className="w-40 space-y-1.5">
              <Skeleton className="h-3.5" style={{ width: `${60 + ((i * 23) % 40)}%` }} />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            {Array.from({ length: cols - 1 }).map((_, j) => (
              <Skeleton key={j} className="hidden h-3.5 sm:block" style={{ width: `${40 + ((i * 13 + j * 29) % 50)}px` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
