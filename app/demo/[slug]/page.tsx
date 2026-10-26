import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Anton } from "next/font/google";
import { and, eq, sql } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, Clock, Dumbbell, MapPin, MessageCircle, Phone, ShieldCheck, Star, Users } from "lucide-react";
import { db } from "@/db";
import { companies, contacts, discoveryCandidates, leads } from "@/db/schema";
import { DEMO_STYLES, type DemoStyle, demoSlug, inkOn, parseDemoSlug } from "@/lib/demo";
import { parseReviews } from "@/lib/call-script";
import { googleMapsUrl, leadCity } from "@/lib/maps";
import { waNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

const display = Anton({ weight: "400", subsets: ["latin"] });

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string; c?: string }> };

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

function theme(s?: string, c?: string) {
  const style: DemoStyle = s && Object.hasOwn(DEMO_STYLES, s) ? (s as DemoStyle) : "volt";
  const accent = c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : DEMO_STYLES[style].accent;
  return { style, accent, ink: inkOn(accent) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gym = await loadGym((await params).slug);
  return {
    title: gym ? `${gym.name}${gym.city ? ` · ${gym.city}` : ""}` : "Preview",
    robots: { index: false, follow: false },
  };
}

const PROGRAMS = [
  { img: "/demo/strength.webp", title: "Strength Training", body: "Free weights, racks and machines with guidance on form." },
  { img: "/demo/women.webp", title: "Women's Fitness", body: "Comfortable sessions built around your own goals." },
  { img: "/demo/classes.webp", title: "Group Workouts", body: "Train alongside people who push you to show up." },
];
const FEATURES = [
  { icon: Dumbbell, title: "Full equipment", body: "Everything you need, from cardio to heavy lifts." },
  { icon: Users, title: "Trainers on the floor", body: "Ask for help any time, beginners welcome." },
  { icon: Clock, title: "Morning & evening", body: "Timings that fit around work and college." },
  { icon: ShieldCheck, title: "Clean & safe", body: "A space you'll actually want to come back to." },
];
const PLANS = [
  { name: "Monthly", note: "Start without a long commitment" },
  { name: "Quarterly", note: "Most members pick this one", popular: true },
  { name: "Yearly", note: "Best value for the committed" },
];
const TICKER = ["Strength", "Cardio", "Personal Training", "Fat Loss", "Muscle Gain", "Group Workouts"];

export default async function DemoSite({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const gym = await loadGym(slug);
  if (!gym) notFound();
  if (gym.slug !== slug) {
    const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
    redirect(`/demo/${gym.slug}${q.size ? `?${q}` : ""}`);
  }
  const { style, accent, ink } = theme(sp.s, sp.c);

  const waLink = (text: string) => (gym.wa ? `https://wa.me/${gym.wa}?text=${encodeURIComponent(text)}` : gym.mapsUrl);
  const join = waLink(`Hi! I'd like to know about joining ${gym.name}.`);
  const tel = gym.phone ? `tel:${gym.phone.replace(/[^\d+]/g, "")}` : null;
  const where = gym.city ?? "your city";
  const [first, ...rest] = gym.name.split(" ");
  const year = new Date().getFullYear();

  return (
    <div
      className="demo-site min-h-screen bg-[#070707] text-white selection:bg-[var(--a)] selection:text-[var(--ink)]"
      style={{ "--a": accent, "--ink": ink } as React.CSSProperties}
    >
      <style>{`
        .demo-site .d{font-family:${display.style.fontFamily};letter-spacing:.01em;text-transform:uppercase;line-height:.92}
        @keyframes demo-tick{to{transform:translateX(-50%)}}
        .demo-site .tick{animation:demo-tick 28s linear infinite}
        @media (prefers-reduced-motion:reduce){.demo-site .tick{animation:none}}
      `}</style>

      <p className="bg-white/[.06] px-4 py-2 text-center text-[11px] text-white/60">
        Demo preview designed for {gym.name} by AEXYL · not the official website yet
      </p>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070707]/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <a href="#top" className="d truncate text-2xl">
            {first} <span className="text-[var(--a)]">{rest.join(" ")}</span>
          </a>
          <div className="hidden items-center gap-8 text-sm text-white/70 md:flex">
            <a href="#programs" className="hover:text-white">Programs</a>
            <a href="#plans" className="hover:text-white">Membership</a>
            <a href="#visit" className="hover:text-white">Visit</a>
          </div>
          <a href={join} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--a)] px-5 py-2.5 text-sm font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5">
            Join now <ArrowRight className="h-4 w-4" />
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section id="top" className="relative isolate overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/hero.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[45%_center] opacity-60 md:object-[70%_center] md:opacity-70" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#070707] via-[#070707]/80 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-[#070707]" />
        {style === "ember" && (
          <div className="absolute -left-40 top-10 -z-10 h-[520px] w-[520px] rounded-full bg-[var(--a)] opacity-40 blur-[120px]" />
        )}
        <div className="mx-auto grid max-w-6xl items-end gap-10 px-5 pb-20 pt-24 md:grid-cols-[1.4fr_1fr] md:pb-28 md:pt-36">
          <div>
            <p className="mb-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[.3em] text-[var(--a)]">
              <span className="h-px w-10 bg-[var(--a)]" /> {where} · Fitness club
            </p>
            <h1 className="d text-[clamp(3.4rem,10vw,7.5rem)]">
              Stronger
              <br />
              <span className="text-[var(--a)]">every day</span>
              <br />
              in {where}
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70">
              {gym.name}: real equipment, real guidance and a crowd that keeps you coming back.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href={waLink(`Hi! I'd like to book a trial session at ${gym.name}.`)} className="inline-flex items-center gap-2 rounded-full bg-[var(--a)] px-7 py-3.5 font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5">
                Book a trial <ArrowRight className="h-4 w-4" />
              </a>
              {tel && (
                <a href={tel} className="inline-flex items-center gap-2 rounded-full border border-white/25 px-7 py-3.5 font-semibold transition-colors hover:border-white">
                  <Phone className="h-4 w-4" /> Call us
                </a>
              )}
            </div>
          </div>
          {gym.reviews && gym.reviews.reviews >= 5 && (
            <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="justify-self-start rounded-3xl border border-white/15 bg-white/[.07] p-6 backdrop-blur-2xl transition-colors hover:border-[var(--a)] md:justify-self-end">
              <div className="flex items-center gap-1 text-[var(--a)]">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className="h-4 w-4" fill={i < Math.round(gym.reviews!.rating) ? "currentColor" : "none"} />
                ))}
              </div>
              <p className="d mt-3 text-6xl">{gym.reviews.rating.toFixed(1)}</p>
              <p className="mt-2 text-sm text-white/70">
                from <b className="text-white">{gym.reviews.reviews}</b> Google reviews
              </p>
            </a>
          )}
        </div>
      </section>

      {/* Ticker */}
      <div className="overflow-hidden bg-[var(--a)] py-4 text-[var(--ink)]" aria-hidden>
        <div className="tick flex w-max gap-10">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="d flex items-center gap-10 text-2xl">
              {t} <span className="text-base">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* Photo fan */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <div className="relative mx-auto flex h-[300px] max-w-3xl items-center justify-center sm:h-[380px]">
          {[
            { src: "/demo/fan-1.webp", r: "-12deg", x: "-150%", y: "18px" },
            { src: "/demo/fan-2.webp", r: "-4deg", x: "-52%", y: "-10px" },
            { src: "/demo/fan-3.webp", r: "5deg", x: "48%", y: "6px" },
            { src: "/demo/fan-4.webp", r: "11deg", x: "146%", y: "-14px" },
          ].map((c) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={c.src}
              src={c.src}
              alt=""
              className="absolute h-[200px] w-[130px] rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 transition-transform duration-500 hover:z-10 hover:scale-105 sm:h-[300px] sm:w-[200px]"
              style={{ transform: `translateX(${c.x}) translateY(${c.y}) rotate(${c.r})` }}
            />
          ))}
        </div>
        <h2 className="d mt-8 text-4xl sm:text-5xl">
          Built for every kind of <span className="text-[var(--a)]">strong</span>
        </h2>
        <p className="mx-auto mt-4 max-w-md text-white/60">First day or fifth year, there&apos;s a place for you at {gym.name}.</p>
      </section>

      {/* Programs */}
      <section id="programs" className="mx-auto max-w-6xl px-5 pb-24">
        <p className="text-xs font-semibold uppercase tracking-[.3em] text-[var(--a)]">Programs</p>
        <h2 className="d mt-3 text-5xl sm:text-6xl">Train. Improve. Belong.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PROGRAMS.map((p, i) => (
            <a key={p.title} href={waLink(`Hi! Tell me about ${p.title} at ${gym.name}.`)} className="group relative isolate flex h-[420px] flex-col justify-end overflow-hidden rounded-3xl p-6 ring-1 ring-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.img} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/40 to-transparent" />
              <span className="num absolute left-6 top-6 text-sm text-white/60">0{i + 1}</span>
              <h3 className="d text-3xl">{p.title}</h3>
              <p className="mt-2 pr-14 text-sm text-white/70">{p.body}</p>
              <span className="absolute bottom-6 right-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/30 transition-colors group-hover:border-[var(--a)] group-hover:bg-[var(--a)] group-hover:text-[var(--ink)]">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-white/10 bg-white/[.02]">
        <div className="mx-auto grid max-w-6xl gap-px px-5 py-16 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-5">
              <f.icon className="h-7 w-7 text-[var(--a)]" />
              <h3 className="mt-5 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="mx-auto max-w-6xl px-5 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.3em] text-[var(--a)]">Membership</p>
            <h2 className="d mt-3 text-5xl sm:text-6xl">Find your plan</h2>
          </div>
          <p className="max-w-xs text-sm text-white/60">Message us for current prices and any joining offers running this month.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-3xl border p-7 ${p.popular ? "border-[var(--a)] bg-[var(--a)]/[.08]" : "border-white/10 bg-white/[.03]"}`}
            >
              {p.popular && (
                <span className="absolute -top-3 left-7 rounded-full bg-[var(--a)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ink)]">
                  Most popular
                </span>
              )}
              <h3 className="d text-4xl">{p.name}</h3>
              <p className="mt-2 text-sm text-white/60">{p.note}</p>
              <a
                href={waLink(`Hi! What's the price of the ${p.name.toLowerCase()} membership at ${gym.name}?`)}
                className={`mt-10 inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
                  p.popular ? "bg-[var(--a)] text-[var(--ink)]" : "border border-white/20 hover:border-white"
                }`}
              >
                <MessageCircle className="h-4 w-4" /> Ask for price
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Reviews */}
      {gym.reviews && gym.reviews.reviews >= 5 && (
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="grid items-center gap-8 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[.06] to-transparent p-8 sm:p-12 md:grid-cols-[auto_1fr]">
            <p className="d text-[clamp(5rem,14vw,9rem)] text-[var(--a)]">{gym.reviews.rating.toFixed(1)}</p>
            <div>
              <div className="flex gap-1 text-[var(--a)]">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className="h-5 w-5" fill={i < Math.round(gym.reviews!.rating) ? "currentColor" : "none"} />
                ))}
              </div>
              <h2 className="d mt-4 text-4xl sm:text-5xl">{gym.reviews.reviews} people rated us on Google</h2>
              <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--a)] hover:underline">
                Read the reviews on Google <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      )}

      {/* Visit */}
      <section id="visit" className="mx-auto grid max-w-6xl gap-4 px-5 pb-24 md:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/[.03] p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.3em] text-[var(--a)]">Visit us</p>
            <h2 className="d mt-3 text-5xl">Come say hi</h2>
            {gym.address && (
              <p className="mt-6 flex gap-3 text-white/70">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[var(--a)]" /> {gym.address}
              </p>
            )}
            {gym.phone && (
              <p className="mt-4 flex gap-3 text-white/70">
                <Phone className="mt-0.5 h-5 w-5 shrink-0 text-[var(--a)]" /> {gym.phone}
              </p>
            )}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[var(--a)] px-6 py-3 text-sm font-semibold text-[var(--ink)]">
              Directions <ArrowUpRight className="h-4 w-4" />
            </a>
            {gym.wa && (
              <a href={join} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold hover:border-white">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
        <iframe
          title={`Map to ${gym.name}`}
          src={`https://www.google.com/maps?q=${encodeURIComponent([gym.name, gym.address ?? gym.city].filter(Boolean).join(", "))}&output=embed`}
          className="h-[380px] w-full rounded-3xl border border-white/10 grayscale invert-[.9] md:h-full md:min-h-[420px]"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>

      {/* CTA */}
      <section className="relative isolate mx-5 mb-5 overflow-hidden rounded-[2rem] bg-[var(--a)] px-6 py-16 text-center text-[var(--ink)] sm:py-24">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/weights.webp" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-15 mix-blend-multiply" />
        <h2 className="d text-[clamp(3rem,9vw,6.5rem)]">Ready to start?</h2>
        <p className="mx-auto mt-4 max-w-md font-medium opacity-80">Send us a message and we&apos;ll help you pick the right plan.</p>
        <a href={join} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#070707] px-8 py-4 font-semibold text-white transition-transform hover:-translate-y-0.5">
          Message {gym.name} <ArrowRight className="h-4 w-4" />
        </a>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-white/50">
        <p className="d text-xl text-white">
          {first} <span className="text-[var(--a)]">{rest.join(" ")}</span>
        </p>
        <p>© {year} {gym.name}</p>
        <p>Website by AEXYL</p>
      </footer>

      {gym.wa && (
        <a
          href={join}
          aria-label={`WhatsApp ${gym.name}`}
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl transition-transform hover:scale-105"
        >
          <MessageCircle className="h-6 w-6" />
        </a>
      )}
    </div>
  );
}
