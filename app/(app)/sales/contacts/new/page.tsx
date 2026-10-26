import { Display, Body } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { ContactForm } from "@/components/crm/NewRecordForms";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";

export default async function NewContactPage() {
  const { workspaceId } = await requireWorkspace();
  const companies = await CrmService.getCompanies(workspaceId, 1000);

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <section className="space-y-2">
        <Display className="text-3xl">Add Contact</Display>
        <Body>Add a person, like a gym owner or manager, and link them to their business.</Body>
      </section>

      <GlassPanel>
        <ContactForm companies={companies.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))} />
      </GlassPanel>
    </div>
  );
}
