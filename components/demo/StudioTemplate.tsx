import { Instrument_Serif } from "next/font/google";
import { ArrowRight, ArrowUpRight, MapPin, MessageCircle, Phone } from "lucide-react";
import { DemoBanner, FEATURES, PLANS, PROGRAMS, Stars, mapEmbed, showReviews, type DemoProps } from "@/components/demo/shared";

const serif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"] });

/** Editorial and calm: big serif type, cream on deep green-black, photos in alternating rows. */
export function StudioTemplate({ gym, waLink, join, tel, where }: DemoProps) {
  const year = new Date().getFullYear();
  const s = serif.className;

  return (
    <div className="min-h-screen bg-[#0E120F] text-[#EFE9DD] selection:bg-[var(--a)] selection:text-[var(--ink)]">
      <DemoBanner name={gym.name} className="bg-[#EFE9DD]/[.06] text-[#EFE9DD]/55" />

      <header className="absolute inset-x-0 z-30">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6">
          <a href="#top" className={`${s} truncate text-2xl sm:text-3xl`}>{gym.name}</a>
          <div className="hidden items-center gap-8 text-sm text-[#EFE9DD]/70 md:flex">
            <a href="#programs" className="hover:text-[#EFE9DD]">Programs</a>
            <a href="#plans" className="hover:text-[#EFE9DD]">Membership</a>
            <a href="#visit" className="hover:text-[#EFE9DD]">Visit</a>
          </div>
          <a href={join} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#EFE9DD]/40 px-5 py-2.5 text-sm font-medium backdrop-blur-md transition-colors hover:border-[#EFE9DD]">
            Join <ArrowRight className="h-4 w-4" />
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section id="top" className="relative isolate flex min-h-[88vh] items-end overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/floor-dark.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0E120F] via-[#0E120F]/50 to-[#0E120F]/30" />
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-40 md:pb-24">
          <p className="text-xs uppercase tracking-[.35em] text-[#EFE9DD]/60">{where} · Strength &amp; fitness</p>
          <h1 className={`${s} mt-5 max-w-4xl text-[clamp(3.25rem,9vw,7.5rem)] leading-[.95] tracking-[-0.02em]`}>
            Where effort <em className="text-[var(--a)]">becomes</em> habit.
          </h1>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href={waLink(`Hi! I'd like to book a trial session at ${gym.name}.`)} className="inline-flex items-center gap-2 rounded-full bg-[var(--a)] px-7 py-3.5 font-medium text-[var(--ink)] transition-transform hover:-translate-y-0.5">
              Book a trial session <ArrowRight className="h-4 w-4" />
            </a>
            {tel && (
              <a href={tel} className="inline-flex items-center gap-2 rounded-full border border-[#EFE9DD]/30 px-7 py-3.5 font-medium transition-colors hover:border-[#EFE9DD]">
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-24 md:grid-cols-[1fr_1.4fr]">
        <p className="text-xs uppercase tracking-[.35em] text-[var(--a)]">About {gym.name}</p>
        <p className={`${s} text-3xl leading-snug sm:text-[2.6rem]`}>
          A neighbourhood gym in {where} for people who want to get stronger, feel better and <em>keep showing up</em>.
        </p>
      </section>

      {/* Programs: alternating photo rows */}
      <section id="programs" className="mx-auto max-w-6xl space-y-16 px-5 pb-24 md:space-y-24">
        {PROGRAMS.map((p, i) => (
          <div key={p.title} className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.img} alt="" className={`h-[320px] w-full rounded-[1.75rem] object-cover sm:h-[440px] ${i % 2 ? "md:order-2" : ""}`} />
            <div>
              <p className={`${s} text-2xl italic text-[var(--a)]`}>0{i + 1}</p>
              <h2 className={`${s} mt-2 text-5xl leading-none sm:text-6xl`}>{p.title}</h2>
              <p className="mt-5 max-w-sm leading-relaxed text-[#EFE9DD]/65">{p.body}</p>
              <a href={waLink(`Hi! Tell me about ${p.title} at ${gym.name}.`)} className="mt-7 inline-flex items-center gap-2 border-b border-[#EFE9DD]/30 pb-1 text-sm font-medium transition-colors hover:border-[var(--a)] hover:text-[var(--a)]">
                Ask about it <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        ))}
      </section>

      {/* Features */}
      <section className="border-y border-[#EFE9DD]/10">
        <div className="mx-auto grid max-w-6xl sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-[#EFE9DD]/10 p-8 max-lg:[&:nth-child(-n+2)]:border-b sm:[&:not(:last-child)]:border-r">
              <f.icon className="h-6 w-6 text-[var(--a)]" strokeWidth={1.5} />
              <h3 className={`${s} mt-6 text-3xl`}>{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#EFE9DD]/60">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reviews */}
      {showReviews(gym.reviews) && (
        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <div className="flex justify-center text-[var(--a)]">
            <Stars rating={gym.reviews.rating} className="h-5 w-5" />
          </div>
          <p className={`${s} mt-6 text-[clamp(4rem,12vw,8rem)] leading-none`}>{gym.reviews.rating.toFixed(1)}</p>
          <p className="mt-4 text-[#EFE9DD]/65">
            rated by <b className="font-medium text-[#EFE9DD]">{gym.reviews.reviews} people</b> on Google
          </p>
          <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--a)] hover:underline">
            Read the reviews <ArrowUpRight className="h-4 w-4" />
          </a>
        </section>
      )}

      {/* Plans: editorial list */}
      <section id="plans" className={`mx-auto max-w-6xl px-5 pb-24 ${showReviews(gym.reviews) ? "" : "pt-24"}`}>
        <h2 className={`${s} text-5xl sm:text-6xl`}>Membership</h2>
        <p className="mt-3 text-[#EFE9DD]/60">Message us for current prices and joining offers.</p>
        <div className="mt-10 divide-y divide-[#EFE9DD]/10 border-y border-[#EFE9DD]/10">
          {PLANS.map((p) => (
            <a
              key={p.name}
              href={waLink(`Hi! What's the price of the ${p.name.toLowerCase()} membership at ${gym.name}?`)}
              className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-7"
            >
              <span className={`${s} text-4xl transition-colors group-hover:text-[var(--a)] sm:text-5xl`}>
                {p.name}
                {p.popular && <em className="ml-3 align-middle text-lg text-[var(--a)]">most chosen</em>}
              </span>
              <span className="flex items-center gap-6 text-sm text-[#EFE9DD]/60">
                {p.note}
                <span className="inline-flex items-center gap-1.5 font-medium text-[#EFE9DD]">
                  Ask for price <ArrowUpRight className="h-4 w-4" />
                </span>
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Visit */}
      <section id="visit" className="mx-auto grid max-w-6xl gap-10 px-5 pb-24 md:grid-cols-[1fr_1.3fr]">
        <div>
          <h2 className={`${s} text-5xl sm:text-6xl`}>Find us</h2>
          {gym.address && (
            <p className="mt-8 flex gap-3 text-[#EFE9DD]/70">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[var(--a)]" strokeWidth={1.5} /> {gym.address}
            </p>
          )}
          {gym.phone && (
            <p className="mt-4 flex gap-3 text-[#EFE9DD]/70">
              <Phone className="mt-0.5 h-5 w-5 shrink-0 text-[var(--a)]" strokeWidth={1.5} /> {gym.phone}
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#EFE9DD] px-6 py-3 text-sm font-medium text-[#0E120F]">
              Directions <ArrowUpRight className="h-4 w-4" />
            </a>
            {gym.wa && (
              <a href={join} className="inline-flex items-center gap-2 rounded-full border border-[#EFE9DD]/30 px-6 py-3 text-sm font-medium hover:border-[#EFE9DD]">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
        <iframe
          title={`Map to ${gym.name}`}
          src={mapEmbed(gym)}
          className="h-[380px] w-full rounded-[1.75rem] grayscale sepia-[.25] invert-[.88] md:h-full md:min-h-[400px]"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>

      {/* CTA */}
      <section className="relative isolate overflow-hidden px-5 py-28 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/weights.webp" alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0E120F] via-transparent to-[#0E120F]" />
        <h2 className={`${s} mx-auto max-w-3xl text-[clamp(2.75rem,7vw,5.5rem)] leading-[1]`}>
          Your first session starts with <em className="text-[var(--a)]">a message.</em>
        </h2>
        <a href={join} className="mt-10 inline-flex items-center gap-2 rounded-full bg-[var(--a)] px-8 py-4 font-medium text-[var(--ink)] transition-transform hover:-translate-y-0.5">
          Message {gym.name} <ArrowRight className="h-4 w-4" />
        </a>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-[#EFE9DD]/10 px-5 py-10 text-sm text-[#EFE9DD]/45">
        <p className={`${s} text-2xl text-[#EFE9DD]`}>{gym.name}</p>
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
