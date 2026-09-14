import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { deals } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { format } from "date-fns";

export default async function DealsPage() {
  const { workspaceId } = await requireWorkspace();
  
  const allDeals = await db.query.deals.findMany({
    where: eq(deals.workspaceId, workspaceId),
    orderBy: [desc(deals.updatedAt)],
    with: {
      company: { columns: { name: true } },
      owner: { columns: { firstName: true, lastName: true } }
    }
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-end">
        <section className="space-y-2">
          <Display>Deals</Display>
          <Body>All opportunities across stages.</Body>
        </section>
        
        <Link 
          href="/sales/pipeline" 
          className="bg-surface-elevated text-text-primary border border-border-strong px-4 py-2 rounded-md font-medium text-sm hover:bg-surface-elevated/80 transition"
        >
          View Pipeline
        </Link>
      </div>

      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Deal Name</th>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium">Value</th>
                <th className="px-6 py-4 font-medium">Stage</th>
                <th className="px-6 py-4 font-medium">Prob.</th>
                <th className="px-6 py-4 font-medium">Expected Close</th>
                <th className="px-6 py-4 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {allDeals.length > 0 ? allDeals.map(deal => (
                <tr key={deal.id} className="hover:bg-surface-elevated/30 transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/sales/deals/${deal.id}`} className="font-medium text-text-primary hover:underline">
                      {deal.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4">{deal.company?.name || "—"}</td>
                  <td className="px-6 py-4 font-semibold">${Number(deal.value || 0).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-surface-elevated text-xs rounded-md border border-border-subtle">
                      {deal.stage}
                    </span>
                  </td>
                  <td className="px-6 py-4">{deal.probability}%</td>
                  <td className="px-6 py-4">{deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), "MMM d, yyyy") : "—"}</td>
                  <td className="px-6 py-4">{deal.owner?.firstName || "—"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-text-muted">
                    No deals yet. Move a qualified lead to a deal to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
