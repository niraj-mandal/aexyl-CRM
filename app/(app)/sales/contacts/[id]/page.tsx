import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { ActivityTimeline } from "@/components/crm/ActivityTimeline";
import { LogActivityForm } from "@/components/crm/LogActivityForm";
import { ActivityService } from "@/services/activity.service";
import Link from "next/link";
import { Mail, Phone, Link as LinkIcon, Building2 } from "lucide-react";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireWorkspace();
  const { id: contactId } = await params;

  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)),
    with: {
      company: true,
      leads: true,
    }
  });

  if (!contact) notFound();

  const activities = await ActivityService.getActivitiesForEntity(workspaceId, 'contactId', contactId);

  return (
    <div className="space-y-8 max-w-5xl animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-start">
        <section className="space-y-2">
          <Display>{contact.firstName} {contact.lastName}</Display>
          <div className="flex items-center space-x-3 text-sm text-text-secondary">
            {contact.jobTitle && <span>{contact.jobTitle}</span>}
            {contact.company && (
              <>
                <span className="text-border-strong">•</span>
                <Link href={`/sales/companies/${contact.companyId}`} className="flex items-center hover:text-text-primary transition">
                  <Building2 className="w-4 h-4 mr-1.5" />
                  {contact.company.name}
                </Link>
              </>
            )}
          </div>
        </section>

        <LogActivityForm entityType="contact" entityId={contactId} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <div className="space-y-6">
          <GlassCard className="p-5">
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Contact Info</h4>
            <div className="space-y-4">
              {contact.email && (
                <div className="flex items-center text-sm">
                  <Mail className="w-4 h-4 text-text-secondary mr-3 flex-shrink-0" />
                  <a href={`mailto:${contact.email}`} className="text-text-primary hover:underline break-all">{contact.email}</a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center text-sm">
                  <Phone className="w-4 h-4 text-text-secondary mr-3 flex-shrink-0" />
                  <a href={`tel:${contact.phone}`} className="text-text-primary hover:underline">{contact.phone}</a>
                </div>
              )}
              {contact.linkedinUrl && (
                <div className="flex items-center text-sm">
                  <LinkIcon className="w-4 h-4 text-text-secondary mr-3 flex-shrink-0" />
                  <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="text-text-primary hover:underline truncate">{contact.linkedinUrl}</a>
                </div>
              )}
            </div>
            {(!contact.email && !contact.phone && !contact.linkedinUrl) && (
              <div className="text-sm text-text-muted">No contact info provided.</div>
            )}
          </GlassCard>

          {contact.notes && (
            <GlassCard className="p-5">
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Notes</h4>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{contact.notes}</p>
            </GlassCard>
          )}
        </div>

        <div className="md:col-span-2 space-y-6">
          <GlassPanel className="p-6">
            <h3 className="text-lg font-medium text-text-primary mb-6">Activity Timeline</h3>
            <ActivityTimeline activities={activities} />
          </GlassPanel>
        </div>

      </div>
    </div>
  );
}
