"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { createLeadAction, createCompanyAction, createContactAction } from "@/app/actions/crm.actions";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/glass-card";

const leadSchema = z.object({
  companyName: z.string().min(2, "Company name is required"),
  contactFirstName: z.string().min(2, "First name is required"),
  contactLastName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  source: z.string().optional(),
  temperature: z.enum(["COLD", "WARM", "HOT"]).default("COLD"),
  notes: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

export function LeadForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(leadSchema),
    defaultValues: { temperature: "COLD" }
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    setError(null);
    try {
      // 1. Create Company
      const company = await createCompanyAction({ name: data.companyName, source: data.source });
      
      // 2. Create Contact
      const contact = await createContactAction({ 
        companyId: company.id, 
        firstName: data.contactFirstName, 
        lastName: data.contactLastName,
        email: data.contactEmail,
      });

      // 3. Create Lead
      const lead = await createLeadAction({
        companyId: company.id,
        contactId: contact.id,
        source: data.source,
        temperature: data.temperature,
        notes: data.notes,
        stage: "QUALIFIED", // initial stage
        status: "NEW"
      });

      if (onSuccess) onSuccess();
      router.push(`/sales/leads/${lead.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create lead. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Company Name *</label>
          <input 
            {...register("companyName")}
            className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
            placeholder="Acme Corp"
          />
          {errors.companyName && <p className="text-xs text-danger mt-1">{errors.companyName.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Contact First Name *</label>
            <input 
              {...register("contactFirstName")}
              className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
              placeholder="Jane"
            />
            {errors.contactFirstName && <p className="text-xs text-danger mt-1">{errors.contactFirstName.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Contact Last Name</label>
            <input 
              {...register("contactLastName")}
              className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
              placeholder="Doe"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Contact Email</label>
          <input 
            {...register("contactEmail")}
            className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
            placeholder="jane@acme.com"
          />
          {errors.contactEmail && <p className="text-xs text-danger mt-1">{errors.contactEmail.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Source</label>
            <input 
              {...register("source")}
              className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
              placeholder="e.g. Website, LinkedIn"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Temperature</label>
            <select 
              {...register("temperature")}
              className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
            >
              <option value="COLD">Cold</option>
              <option value="WARM">Warm</option>
              <option value="HOT">Hot</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Initial Notes</label>
          <textarea 
            {...register("notes")}
            rows={3}
            className="w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary"
            placeholder="Any background information..."
          />
        </div>
      </div>

      <div className="pt-4 flex justify-end space-x-3">
        <button 
          type="submit" 
          disabled={isSubmitting}           className="bg-text-primary text-background hover:bg-text-secondary px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating..." : "Create Lead"}
        </button>
      </div>
    </form>
  );
}
