"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCompanyAction, createContactAction } from "@/app/actions/crm.actions";

// Same look as LeadForm.
const input = "w-full bg-surface border border-border-strong rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary";
const label = "block text-sm font-medium text-text-secondary mb-1";
const submit = "bg-text-primary text-background hover:bg-text-secondary px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:bg-surface-high disabled:text-text-muted disabled:cursor-not-allowed";
const blank = (v?: string) => (v?.trim() ? v.trim() : null);

function Field({ title, error, children }: { title: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={label}>
        {title}
        {children}
      </label>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}

const companySchema = z.object({
  name: z.string().trim().min(2, "Company name is required"),
  website: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});
type CompanyValues = z.infer<typeof companySchema>;

export function CompanyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CompanyValues>({ resolver: zodResolver(companySchema) });

  const onSubmit = async (d: CompanyValues) => {
    setError(null);
    try {
      const company = await createCompanyAction({
        name: d.name,
        website: blank(d.website),
        industry: blank(d.industry),
        location: blank(d.location),
        notes: blank(d.notes),
      });
      router.push(`/sales/companies/${company.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the company. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-sm text-danger">{error}</div>}
      <div className="space-y-4">
        <Field title="Company name *" error={errors.name?.message}>
          <input {...register("name")} className={`${input} mt-1`} placeholder="Iron Wings Gym" autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field title="Industry">
            <input {...register("industry")} className={`${input} mt-1`} placeholder="Gym / Fitness" />
          </Field>
          <Field title="Website">
            <input {...register("website")} className={`${input} mt-1`} placeholder="Leave empty if they have none" inputMode="url" />
          </Field>
        </div>
        <Field title="Address">
          <input {...register("location")} className={`${input} mt-1`} placeholder="Street, area, city" />
        </Field>
        <Field title="Notes">
          <textarea {...register("notes")} rows={3} className={`${input} mt-1`} placeholder="Anything worth remembering" />
        </Field>
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" disabled={isSubmitting} className={submit}>
          {isSubmitting ? "Creating..." : "Create company"}
        </button>
      </div>
    </form>
  );
}

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().optional(),
  companyId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  jobTitle: z.string().optional(),
});
type ContactValues = z.infer<typeof contactSchema>;

export function ContactForm({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ContactValues>({ resolver: zodResolver(contactSchema) });

  const onSubmit = async (d: ContactValues) => {
    setError(null);
    try {
      const contact = await createContactAction({
        firstName: d.firstName,
        lastName: blank(d.lastName),
        companyId: blank(d.companyId),
        phone: blank(d.phone),
        email: blank(d.email),
        jobTitle: blank(d.jobTitle),
      });
      router.push(`/sales/contacts/${contact.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the contact. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && <div className="p-3 bg-danger/10 border border-danger/20 rounded-md text-sm text-danger">{error}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field title="First name *" error={errors.firstName?.message}>
            <input {...register("firstName")} className={`${input} mt-1`} placeholder="Gurpreet" autoFocus />
          </Field>
          <Field title="Last name">
            <input {...register("lastName")} className={`${input} mt-1`} placeholder="Singh" />
          </Field>
        </div>
        <Field title="Company">
          <select {...register("companyId")} className={`${input} mt-1`} defaultValue="">
            <option value="">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field title="Phone">
            <input {...register("phone")} className={`${input} mt-1`} placeholder="+91 98765 43210" inputMode="tel" />
          </Field>
          <Field title="Email" error={errors.email?.message}>
            <input {...register("email")} className={`${input} mt-1`} placeholder="owner@gym.com" inputMode="email" />
          </Field>
        </div>
        <Field title="Role">
          <input {...register("jobTitle")} className={`${input} mt-1`} placeholder="Owner, Manager…" />
        </Field>
      </div>
      <div className="flex justify-end pt-2">
        <button type="submit" disabled={isSubmitting} className={submit}>
          {isSubmitting ? "Creating..." : "Create contact"}
        </button>
      </div>
    </form>
  );
}
