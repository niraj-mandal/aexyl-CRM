import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { deleteCompanyAction } from "@/app/actions/crm.actions";
import { DeleteRowButton } from "@/components/crm/DeleteRowButton";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { format } from "date-fns";

export default async function CompaniesPage() {
  const { workspaceId } = await requireWorkspace();
  const companies = await CrmService.getCompanies(workspaceId);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <PageHeader
        eyebrow="Sales"
        title="Companies"
        description={`${companies.length} gyms and businesses in your CRM`}
        actions={
          <Link href="/sales/companies/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-black transition-transform hover:-translate-y-0.5">
            <Plus className="h-4 w-4" /> Add company
          </Link>
        }
      />

      <div className="glass-panel overflow-hidden">
        <div className="relative w-full overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Industry</th>
                <th className="px-4 py-3 font-medium">Contacts</th>
                <th className="px-4 py-3 font-medium">Deals</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Owner</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Updated</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {companies.length > 0 ? companies.map(company => (
                <tr key={company.id} className="hover:bg-surface-high/40 transition-colors group">
                  <td className="px-4 py-3">
                    <Link href={`/sales/companies/${company.id}`} className="font-medium text-text-primary hover:text-primary">
                      {company.name}
                    </Link>
                    {company.website && (
                      <div className="mt-0.5 max-w-[240px] truncate text-xs text-text-muted">{company.website}</div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-text-secondary sm:table-cell">{company.industry || "—"}</td>
                  <td className="num px-4 py-3 text-text-secondary">{company.contacts.length}</td>
                  <td className="num px-4 py-3 text-text-secondary">{company.deals.length}</td>
                  <td className="hidden px-4 py-3 text-text-secondary md:table-cell">{company.owner?.firstName || "Unassigned"}</td>
                  <td className="num hidden px-4 py-3 text-text-muted md:table-cell">{format(new Date(company.updatedAt), "d MMM yyyy")}</td>
                  <td className="px-4 py-3">
                    <DeleteRowButton action={deleteCompanyAction} id={company.id} label={company.name} />
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={Building2}
                      title="No companies yet"
                      body="Every lead you approve from Lead Discovery adds its gym here. You can also add one by hand."
                      action={{ href: "/bdr?tab=discovery", label: "Open Lead Discovery" }}
                    />
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
