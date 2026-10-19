import { HeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Shown instantly on navigation while a page's data loads; mirrors the shared page layout. */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6 animate-in fade-in duration-150">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-panel space-y-3 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="glass-panel space-y-4 p-5">
        <Skeleton className="h-4 w-36" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" style={{ width: `${70 + ((i * 17) % 30)}%` }} />
        ))}
      </div>
    </div>
  );
}
