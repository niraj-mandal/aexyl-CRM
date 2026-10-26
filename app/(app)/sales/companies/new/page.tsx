import { Display, Body } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { CompanyForm } from "@/components/crm/NewRecordForms";

export default function NewCompanyPage() {
  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <section className="space-y-2">
        <Display className="text-3xl">Add Company</Display>
        <Body>Add a business you&apos;re working with or want to pitch.</Body>
      </section>

      <GlassPanel>
        <CompanyForm />
      </GlassPanel>
    </div>
  );
}
