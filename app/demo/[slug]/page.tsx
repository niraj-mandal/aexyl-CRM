import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, contacts, discoveryCandidates, leads } from "@/db/schema";
import { DEMO_STYLES, DEMO_TEMPLATES, type DemoStyle, type DemoTemplate, defaultStyle, defaultTemplate, demoSlug, inkOn, parseDemoSlug } from "@/lib/demo";
import { BoldTemplate } from "@/components/demo/BoldTemplate";
import { CleanTemplate } from "@/components/demo/CleanTemplate";
import { StudioTemplate } from "@/components/demo/StudioTemplate";
import { parseReviews } from "@/lib/call-script";
import { googleMapsUrl, leadCity } from "@/lib/maps";
import { waNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string; s?: string; c?: string }> };

/** Public preview: only facts already on the lead (name, address, phone, Google rating) are shown. */
async function loadGym(slug: string) {
  const parsed = parseDemoSlug(slug);
  if (!parsed) return null;
  const [row] = await db
    .select({
      id: leads.id,
      name: companies.name,
      location: companies.location,
      source: leads.source,
      notes: leads.notes,
      phone: contacts.phone,
      candidateCity: discoveryCandidates.city,
    })
    .from(leads)
    .innerJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(discoveryCandidates, and(eq(discoveryCandidates.leadId, leads.id), eq(discoveryCandidates.workspaceId, leads.workspaceId)))
    .where(sql`${leads.id}::text like ${parsed.idPrefix + "%"}`)
    .limit(1);
  if (!row) return null;
  const city = leadCity(row);
  return {
    id: row.id,
    // Renamed since the link was sent: the page redirects to the current name instead of 404ing.
    slug: demoSlug(row.name, row.id),
    name: row.name,
    city: city === "Unknown" ? null : city,
    address: row.location,
    phone: row.phone,
    wa: waNumber(row.phone),
    reviews: parseReviews(row.notes),
    mapsUrl: googleMapsUrl(row.name, row.location ?? city),
  };
}

function theme(leadId: string, t?: string, s?: string, c?: string) {
  // Links sent before templates existed carry ?s= but no ?t=: they keep the original Bold layout.
  const template: DemoTemplate = t && Object.hasOwn(DEMO_TEMPLATES, t) ? (t as DemoTemplate) : s ? "bold" : defaultTemplate(leadId);
  const style: DemoStyle = s && Object.hasOwn(DEMO_STYLES, s) ? (s as DemoStyle) : defaultStyle(leadId);
  const accent = c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : DEMO_STYLES[style].accent;
  return { template, style, accent, ink: inkOn(accent) };
}

const TEMPLATES = { bold: BoldTemplate, clean: CleanTemplate, studio: StudioTemplate };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gym = await loadGym((await params).slug);
  return {
    title: gym ? `${gym.name}${gym.city ? ` · ${gym.city}` : ""}` : "Preview",
    robots: { index: false, follow: false },
  };
}

export default async function DemoSite({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const gym = await loadGym(slug);
  if (!gym) notFound();
  if (gym.slug !== slug) {
    const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/demo/${gym.slug}${q.size ? `?${q}` : ""}`);
  }
  const { template, style, accent, ink } = theme(gym.id, sp.t, sp.s, sp.c);

  const waLink = (text: string) => (gym.wa ? `https://wa.me/${gym.wa}?text=${encodeURIComponent(text)}` : gym.mapsUrl);
  const Template = TEMPLATES[template];
  return (
    <div style={{ "--a": accent, "--ink": ink } as React.CSSProperties}>
      <Template
        gym={gym}
        style={style}
        waLink={waLink}
        join={waLink(`Hi! I'd like to know about joining ${gym.name}.`)}
        tel={gym.phone ? `tel:${gym.phone.replace(/[^\d+]/g, "")}` : null}
        where={gym.city ?? "your city"}
      />
    </div>
  );
}
