import { HeaderSkeleton, Skeleton, TableSkeleton } from "@/components/ui/skeleton";

/** Sales tabs (Leads, Companies, Contacts, Deals): header, filter chips and a table. */
export default function SalesLoading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6 animate-in fade-in duration-150">
      <HeaderSkeleton />
      <div className="flex gap-2">
        {[48, 96, 88, 72].map((w, i) => (
          <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <TableSkeleton />
    </div>
  );
}
