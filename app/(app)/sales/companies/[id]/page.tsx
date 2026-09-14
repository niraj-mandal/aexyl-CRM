import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import Link from "next/link";
import { Building2, Globe, MapPin, Users } from "lucide-react";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: companyId } = await params;

  const company = await db.query.companies.findFirst({
    where: and(eq(companies.id, companyId), eq(companies.workspaceId, workspaceId)),
    with: {
      owner: true,
      contacts: true,
      leads: true,
      deals: true,
    }
  });

  if (!company) notFound();

  return (
    <div className="space-y-8 max-w-6xl animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-start">
        <section className="space-y-2">
          <Display>{company.name}</Display>
          <div className="flex items-center space-x-4 text-sm text-text-secondary">
            {company.website && (
              <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" className="flex items-center hover:text-text-primary transition">
                <Globe className="w-4 h-4 mr-1.5" />
                {company.website}
              </a>
            )}
            {company.industry && (
              <span className="flex items-center">
                <Building2 className="w-4 h-4 mr-1.5" />
                {company.industry}
              </span>
            )}
            {company.location && (
              <span className="flex items-center">
                <MapPin className="w-4 h-4 mr-1.5" />
                {company.location}
              </span>
            )}
          </div>
        </section>

        <div className="flex space-x-3">
          <button className="bg-text-primary text-background px-4 py-2 rounded-md font-medium text-sm hover:bg-text-secondary transition">
            Edit Company
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Column - Metadata */}
        <div className="space-y-6">
          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Details</h4>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-text-secondary mb-1">Owner</div>
                <div className="font-medium text-text-primary">{company.owner?.firstName || "Unassigned"}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Status</div>
                <div className="font-medium text-text-primary px-2 py-1 bg-surface-elevated border border-border-subtle rounded-md inline-block">
                  {company.status}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Size</div>
                <div className="font-medium text-text-primary">{company.size || "Unknown"}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary mb-1">Source</div>
                <div className="font-medium text-text-primary">{company.source || "Unknown"}</div>
              </div>
            </div>
          </GlassCard>

          {company.notes && (
            <GlassCard className="p-5">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Notes</h4>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{company.notes}</p>
            </GlassCard>
          )}
        </div>

        {/* Right Column - Related Entities */}
        <div className="md:col-span-2 space-y-6">
          
          <GlassPanel className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-text-primary">Deals</h3>
              <span className="text-sm text-text-muted bg-surface-elevated px-2 py-0.5 rounded-full border border-border-subtle">
                {company.deals.length}
              </span>
            </div>
            
            {company.deals.length > 0 ? (
              <div className="space-y-3">
                {company.deals.map(deal => (
                  <Link key={deal.id} href={`/sales/deals/${deal.id}`} className="block p-4 border border-border-subtle rounded-lg hover:border-border-strong transition group bg-surface/50">
                    <div className="flex justify-between items-center">
                      <div className="font-medium text-text-primary group-hover:underline">{deal.name}</div>
                      <div className="font-semibold">${Number(deal.value || 0).toLocaleString()}</div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-xs text-text-secondary">
                      <span>Stage: {deal.stage}</span>
                      <span>Prob: {deal.probability}%</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-muted py-4">No active deals.</div>
            )}
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-text-primary">Contacts</h3>
              <span className="text-sm text-text-muted bg-surface-elevated px-2 py-0.5 rounded-full border border-border-subtle">
                {company.contacts.length}
              </span>
            </div>
            
            {company.contacts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {company.contacts.map(contact => (
                  <Link key={contact.id} href={`/sales/contacts/${contact.id}`} className="flex items-center p-3 border border-border-subtle rounded-lg hover:border-border-strong transition bg-surface/50">
                    <div className="bg-surface-elevated p-2 rounded-full mr-3 text-text-secondary border border-border-subtle">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-text-primary">{contact.firstName} {contact.lastName}</div>
                      <div className="text-xs text-text-secondary">{contact.jobTitle || "No title"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-muted py-4">No contacts found.</div>
            )}
          </GlassPanel>

        </div>
      </div>
    </div>
  );
}
