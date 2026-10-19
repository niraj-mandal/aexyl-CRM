import Link from "next/link";
import { Download, MapPin, Plus } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { placeFromLeadSource } from "@/lib/maps";
import { PageHeader } from "@/components/ui/page-header";
import { LeadsTable, type LeadRow } from "@/components/crm/LeadsTable";

const PAGE_SIZE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ page?: string; city?: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [cityIndex, leadCounts] = await Promise.all([
    CrmService.getLeadCityIndex(workspaceId),
    CrmService.getLeadCounts(workspaceId),
  ]);

  // City chips, biggest first; an unknown ?city= just shows everything.
  const cityCounts = new Map<string, number>();
  for (const l of cityIndex) cityCounts.set(l.city, (cityCounts.get(l.city) ?? 0) + 1);
  const cities = [...cityCounts].sort((a, b) => (a[0] === "Unknown" ? 1 : b[0] === "Unknown" ? -1 : b[1] - a[1]));
  const city = params.city && cityCounts.has(params.city) ? params.city : null;
  const filtered = city ? cityIndex.filter((l) => l.city === city) : cityIndex;

  const totalLeads = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalLeads / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const leads = await CrmService.getLeadsByIds(
    workspaceId,
    filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE).map((l) => l.id),
  );
  const pageHref = (p: number) => `/sales/leads?${new URLSearchParams({ ...(city ? { city } : {}), page: String(p) })}`;
  const chip = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-primary/40 bg-primary/15 text-primary"
        : "border-border-subtle text-text-secondary hover:border-border-strong hover:text-text-primary"
    }`;

  // Metrics come from real SQL counts across the whole table — not the page slice.
  const total = leadCounts.total;
  const newLeads = leadCounts.new;
  const hotLeads = leadCounts.hot;

  const cityOf = new Map(cityIndex.map((l) => [l.id, l.city]));
  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    businessName: l.company?.name || "Unknown",
    phone: l.contact?.phone ?? null,
    email: l.contact?.email ?? null,
    // No street address (most discovery leads): the city still tells you where it is.
    area: l.company?.location ?? (cityOf.get(l.id) !== "Unknown" ? cityOf.get(l.id) ?? null : null),
    websiteStatus: l.company && !l.company.website ? "NO_WEBSITE" : null,
    status: l.status,
    temperature: l.temperature,
    lastContactedAt: l.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    score: l.score,
    place: l.company?.location || placeFromLeadSource(l.source),
    // Auto-created contacts are named "Team <gym>"; they add nothing.
    contactName: l.contact && !/^team\b/i.test(l.contact.firstName) ? `${l.contact.firstName} ${l.contact.lastName ?? ""}`.trim() : null,
    ownerName: l.owner?.firstName ?? null,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description={
          <>
            {total} lead{total === 1 ? "" : "s"} · {newLeads} new · <span className="text-danger">{hotLeads} hot</span>
          </>
        }
        actions={
          <>
            <a
              href="/api/leads/export"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <Link
              href="/sales/leads/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5"
            >
              <Plus className="h-4 w-4" /> Add lead
            </Link>
          </>
        }
      />

      {cities.length > 1 && (
        <nav aria-label="Filter by city" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
          <Link href="/sales/leads" aria-current={city ? undefined : "page"} className={chip(!city)}>
            All <span className="num opacity-70">{cityIndex.length}</span>
          </Link>
          {cities.map(([name, n]) => (
            <Link
              key={name}
              href={`/sales/leads?${new URLSearchParams({ city: name })}`}
              aria-current={city === name ? "page" : undefined}
              className={chip(city === name)}
            >
              <MapPin className="h-3 w-3" /> {name} <span className="num opacity-70">{n}</span>
            </Link>
          ))}
        </nav>
      )}

      <LeadsTable rows={rows} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, totalLeads)} of {totalLeads}
          </span>
          <div className="flex items-center gap-2">
            {safePage > 1 && (
              <Link href={pageHref(safePage - 1)} className="px-3 py-1.5 rounded-md border border-border-subtle hover:border-primary/50 transition">
                ← Prev
              </Link>
            )}
            <span className="font-mono-code">{safePage} / {totalPages}</span>
            {safePage < totalPages && (
              <Link href={pageHref(safePage + 1)} className="px-3 py-1.5 rounded-md border border-border-subtle hover:border-primary/50 transition">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
