import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import Link from "next/link";
import { format } from "date-fns";

export default async function CompaniesPage() {
  const { workspaceId } = await requireWorkspace();
  const companies = await CrmService.getCompanies(workspaceId);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-end">
        <section className="space-y-2">
          <Display>Companies</Display>
          <Body>Organizations in your ecosystem.</Body>
        </section>
        
        <Link 
          href="/sales/companies/new" 
          className="bg-text-primary text-background px-4 py-2 rounded-md font-medium text-sm hover:bg-text-secondary transition"
        >
          + Add Company
        </Link>
      </div>

      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Company Name</th>
                <th className="px-6 py-4 font-medium">Industry</th>
                <th className="px-6 py-4 font-medium">Contacts</th>
                <th className="px-6 py-4 font-medium">Deals</th>
                <th className="px-6 py-4 font-medium">Owner</th>
                <th className="px-6 py-4 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {companies.length > 0 ? companies.map(company => (
                <tr key={company.id} className="hover:bg-surface-elevated/30 transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/sales/companies/${company.id}`} className="font-medium text-text-primary hover:underline">
                      {company.name}
                    </Link>
                    {company.website && (
                      <div className="text-xs text-text-muted mt-1">{company.website}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">{company.industry || "—"}</td>
                  <td className="px-6 py-4">{company.contacts.length}</td>
                  <td className="px-6 py-4">{company.deals.length}</td>
                  <td className="px-6 py-4">{company.owner?.firstName || "Unassigned"}</td>
                  <td className="px-6 py-4">{format(new Date(company.updatedAt), "MMM d, yyyy")}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-text-muted">
                    No companies yet. Add your first prospect to start building the Aexyl pipeline.
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
