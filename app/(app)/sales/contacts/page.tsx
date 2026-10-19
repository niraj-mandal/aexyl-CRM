import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { deleteContactAction } from "@/app/actions/crm.actions";
import { DeleteRowButton } from "@/components/crm/DeleteRowButton";
import Link from "next/link";
import { format } from "date-fns";
import { Mail, MessageCircle, Phone, Plus, Users, Link as LinkIcon } from "lucide-react";
import { waNumber } from "@/lib/phone";

export default async function ContactsPage() {
  const { workspaceId } = await requireWorkspace();
  const contacts = await CrmService.getContacts(workspaceId);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <PageHeader
        eyebrow="Sales"
        title="Contacts"
        description={`${contacts.length} people in your CRM`}
        actions={
          <Link href="/sales/contacts/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5">
            <Plus className="h-4 w-4" /> Add contact
          </Link>
        }
      />

      <div className="glass-panel overflow-hidden">
        <div className="relative w-full overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Role</th>
                <th className="px-4 py-3 font-medium">Reach</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Added</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {contacts.length > 0 ? contacts.map(contact => (
                <tr key={contact.id} className="hover:bg-surface-high/40 transition-colors group">
                  <td className="px-4 py-3">
                    <Link href={`/sales/contacts/${contact.id}`} className="font-medium text-text-primary hover:text-primary">
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {contact.company ? (
                      <Link href={`/sales/companies/${contact.companyId}`} className="text-text-secondary hover:text-text-primary transition">
                        {contact.company.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-text-secondary md:table-cell">{contact.jobTitle || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-text-muted">
                      {contact.email && <a href={`mailto:${contact.email}`} title={contact.email} aria-label={`Email ${contact.email}`} className="rounded p-1.5 hover:bg-surface-high hover:text-text-primary"><Mail className="w-4 h-4" /></a>}
                      {contact.phone && <a href={`tel:${contact.phone}`} title={contact.phone} aria-label={`Call ${contact.phone}`} className="rounded p-1.5 hover:bg-success/10 hover:text-success"><Phone className="w-4 h-4" /></a>}
                      {waNumber(contact.phone) && <a href={`https://wa.me/${waNumber(contact.phone)}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="rounded p-1.5 hover:bg-success/10 hover:text-success"><MessageCircle className="w-4 h-4" /></a>}
                      {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" aria-label="LinkedIn" className="rounded p-1.5 hover:bg-surface-high hover:text-text-primary"><LinkIcon className="w-4 h-4" /></a>}
                    </div>
                  </td>
                  <td className="num hidden px-4 py-3 text-text-muted md:table-cell">{format(new Date(contact.createdAt), "d MMM yyyy")}</td>
                  <td className="px-4 py-3">
                    <DeleteRowButton action={deleteContactAction} id={contact.id} label={`${contact.firstName} ${contact.lastName}`} />
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Users}
                      title="No contacts yet"
                      body="Add a phone number to a lead and its contact appears here, or add someone by hand."
                      action={{ href: "/sales/leads", label: "Go to Leads" }}
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
