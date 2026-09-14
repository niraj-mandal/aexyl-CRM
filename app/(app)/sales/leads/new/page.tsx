import { Display, Body } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { LeadForm } from "@/components/crm/LeadForm";

export default function NewLeadPage() {
  return (
    <div className="space-y-8 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <section className="space-y-2">
        <Display className="text-3xl">Add Lead</Display>
        <Body>Create a new prospect. A company and contact will be automatically created if they don't exist.</Body>
      </section>

      <GlassPanel>
        <LeadForm />
      </GlassPanel>
    </div>
  );
}
