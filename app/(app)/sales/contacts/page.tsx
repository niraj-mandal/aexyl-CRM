import { Display, Body } from "@/components/ui/typography";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import Link from "next/link";
import { format } from "date-fns";
import { Mail, Phone, Link as LinkIcon } from "lucide-react";

export default async function ContactsPage() {
  const { workspaceId } = await requireWorkspace();
  const contacts = await CrmService.getContacts(workspaceId);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex justify-between items-end">
        <section className="space-y-2">
          <Display>Contacts</Display>
          <Body>People in your CRM.</Body>
        </section>
        
        <Link 
          href="/sales/contacts/new" 
          className="bg-text-primary text-background px-4 py-2 rounded-md font-medium text-sm hover:bg-text-secondary transition"
        >
          + Add Contact
        </Link>
      </div>

      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium">Contact Info</th>
                <th className="px-6 py-4 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {contacts.length > 0 ? contacts.map(contact => (
                <tr key={contact.id} className="hover:bg-surface-elevated/30 transition-colors group">
                  <td className="px-6 py-4">
                    <Link href={`/sales/contacts/${contact.id}`} className="font-medium text-text-primary hover:underline">
                      {contact.firstName} {contact.lastName}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    {contact.company ? (
                      <Link href={`/sales/companies/${contact.companyId}`} className="text-text-secondary hover:text-text-primary transition">
                        {contact.company.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-6 py-4">{contact.jobTitle || "—"}</td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-3 text-text-muted">
                      {contact.email && <a href={`mailto:${contact.email}`} title={contact.email} className="hover:text-text-primary transition"><Mail className="w-4 h-4" /></a>}
                      {contact.phone && <a href={`tel:${contact.phone}`} title={contact.phone} className="hover:text-text-primary transition"><Phone className="w-4 h-4" /></a>}
                      {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="hover:text-text-primary transition"><LinkIcon className="w-4 h-4" /></a>}
                    </div>
                  </td>
                  <td className="px-6 py-4">{format(new Date(contact.createdAt), "MMM d, yyyy")}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                    No contacts yet.
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
