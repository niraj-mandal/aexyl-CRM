import { Inter_Tight } from "next/font/google";
import { ArrowRight, ArrowUpRight, MapPin, MessageCircle, Phone } from "lucide-react";
import { DemoBanner, FEATURES, PLANS, PROGRAMS, Stars, mapEmbed, showReviews, type DemoProps } from "@/components/demo/shared";

const sans = Inter_Tight({ weight: ["500", "700", "800"], subsets: ["latin"] });

/**
 * Light, airy and friendly. The accent is used only as a fill (buttons, highlights, icon discs),
 * never as text on the light background, so bright accents like Volt stay readable.
 */
export function CleanTemplate({ gym, waLink, join, tel, where }: DemoProps) {
  const year = new Date().getFullYear();
  const accentBtn = "inline-flex items-center gap-2 rounded-full bg-[var(--a)] font-semibold text-[var(--ink)] transition-transform hover:-translate-y-0.5";
  const darkBtn = "inline-flex items-center gap-2 rounded-full bg-[#111] font-semibold text-white transition-transform hover:-translate-y-0.5";

  return (
    <div className={`${sans.className} min-h-screen bg-[#F5F4F0] text-[#111] selection:bg-[var(--a)] selection:text-[var(--ink)]`}>
      <DemoBanner name={gym.name} className="bg-black/[.05] text-black/50" />

      <header className="sticky top-0 z-30 border-b border-black/5 bg-[#F5F4F0]/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <a href="#top" className="flex min-w-0 items-center gap-2.5 text-lg font-extrabold tracking-tight">
            <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] bg-[var(--a)] ring-1 ring-black/10" />
            <span className="truncate">{gym.name}</span>
          </a>
          <div className="hidden items-center gap-8 text-sm font-medium text-black/60 md:flex">
            <a href="#programs" className="hover:text-black">Programs</a>
            <a href="#plans" className="hover:text-black">Membership</a>
            <a href="#visit" className="hover:text-black">Visit</a>
          </div>
          <a href={join} className={`${darkBtn} shrink-0 px-5 py-2.5 text-sm`}>
            Join now <ArrowRight className="h-4 w-4" />
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section id="top" className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 md:grid-cols-[1.1fr_1fr] md:pb-24 md:pt-20">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black/70 shadow-sm ring-1 ring-black/5">
            <span className="h-2 w-2 rounded-full bg-[var(--a)] ring-1 ring-black/10" /> Fitness club in {where}
          </p>
          <h1 className="mt-6 text-[clamp(2.75rem,7vw,4.75rem)] font-extrabold leading-[1.02] tracking-[-0.035em]">
            Your fitness,{" "}
            <span className="whitespace-nowrap rounded-2xl bg-[var(--a)] px-3 text-[var(--ink)]">made simple.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-black/60">
            {gym.name} is a friendly place to get fit in {where}, whether it&apos;s your first workout or your hundredth.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={waLink(`Hi! I'd like to book a trial session at ${gym.name}.`)} className={`${accentBtn} px-7 py-3.5`}>
              Book a free trial <ArrowRight className="h-4 w-4" />
            </a>
            {tel && (
              <a href={tel} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-semibold shadow-sm ring-1 ring-black/10 hover:ring-black/30">
                <Phone className="h-4 w-4" /> Call us
              </a>
            )}
          </div>
          {showReviews(gym.reviews) && (
            <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-3 text-sm text-black/60 hover:text-black">
              <span className="text-[#F5A623]"><Stars rating={gym.reviews.rating} className="h-4 w-4" /></span>
              <b className="text-black">{gym.reviews.rating.toFixed(1)}</b> from {gym.reviews.reviews} Google reviews
            </a>
          )}
        </div>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/hero-alt.webp" alt="" className="h-[360px] w-full rounded-[2rem] object-cover shadow-xl sm:h-[480px]" />
          <a
            href={waLink(`Hi! I'd like to book a trial session at ${gym.name}.`)}
            className="absolute -bottom-5 left-5 right-5 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/5 sm:left-auto sm:w-72"
          >
            <span>
              <span className="block text-sm font-bold">Try a session first</span>
              <span className="block text-xs text-black/55">Message us to book your visit</span>
            </span>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--a)] text-[var(--ink)]">
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 pt-8">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-3xl bg-white p-6 ring-1 ring-black/5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--a)] text-[var(--ink)]">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-black/55">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Programs */}
      <section id="programs" className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">What you can do here</h2>
        <div className="mt-10 divide-y divide-black/10 border-y border-black/10">
          {PROGRAMS.map((p) => (
            <a key={p.title} href={waLink(`Hi! Tell me about ${p.title} at ${gym.name}.`)} className="group flex items-center gap-5 py-5 sm:gap-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.img} alt="" className="h-20 w-24 shrink-0 rounded-2xl object-cover sm:h-28 sm:w-44" />
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold tracking-tight sm:text-2xl">{p.title}</h3>
                <p className="mt-1 text-sm text-black/55 sm:text-base">{p.body}</p>
              </div>
              <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1 ring-black/15 transition-colors group-hover:bg-[var(--a)] group-hover:text-[var(--ink)] group-hover:ring-transparent sm:flex">
                <ArrowUpRight className="h-5 w-5" />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Gallery */}
      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-3 px-5 md:grid-cols-4">
        {["/demo/fan-1.webp", "/demo/floor.webp", "/demo/fan-3.webp", "/demo/fan-4.webp"].map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" className={`h-56 w-full rounded-3xl object-cover sm:h-72 ${i % 2 ? "md:mt-10" : ""}`} />
        ))}
      </section>

      {/* Plans */}
      <section id="plans" className="mx-auto max-w-6xl px-5 py-24">
        <div className="text-center">
          <h2 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Simple memberships</h2>
          <p className="mx-auto mt-3 max-w-md text-black/55">Message us for current prices and any joining offer this month.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={`relative flex flex-col rounded-3xl bg-white p-7 ${p.popular ? "shadow-xl ring-2 ring-[#111]" : "ring-1 ring-black/5"}`}>
              {p.popular && (
                <span className="absolute -top-3 left-7 rounded-full bg-[var(--a)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ink)] ring-1 ring-black/10">
                  Most popular
                </span>
              )}
              <h3 className="text-2xl font-extrabold tracking-tight">{p.name}</h3>
              <p className="mt-1.5 text-sm text-black/55">{p.note}</p>
              <a
                href={waLink(`Hi! What's the price of the ${p.name.toLowerCase()} membership at ${gym.name}?`)}
                className={`mt-10 justify-center py-3 text-sm ${p.popular ? `${darkBtn} flex` : "flex items-center gap-2 rounded-full font-semibold ring-1 ring-black/15 hover:ring-black/40"}`}
              >
                <MessageCircle className="h-4 w-4" /> Ask for price
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Visit */}
      <section id="visit" className="mx-auto grid max-w-6xl gap-4 px-5 pb-24 md:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col justify-between rounded-3xl bg-white p-8 ring-1 ring-black/5">
          <div>
            <h2 className="text-4xl font-extrabold tracking-[-0.03em]">Come visit</h2>
            {gym.address && (
              <p className="mt-6 flex gap-3 text-black/65">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0" /> {gym.address}
              </p>
            )}
            {gym.phone && (
              <p className="mt-4 flex gap-3 text-black/65">
                <Phone className="mt-0.5 h-5 w-5 shrink-0" /> {gym.phone}
              </p>
            )}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={gym.mapsUrl} target="_blank" rel="noopener noreferrer" className={`${darkBtn} px-6 py-3 text-sm`}>
              Directions <ArrowUpRight className="h-4 w-4" />
            </a>
            {gym.wa && (
              <a href={join} className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-black/15 hover:ring-black/40">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
        <iframe
          title={`Map to ${gym.name}`}
          src={mapEmbed(gym)}
          className="h-[380px] w-full rounded-3xl ring-1 ring-black/5 md:h-full md:min-h-[420px]"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>

      {/* CTA */}
      <section className="mx-5 mb-5 rounded-[2rem] bg-[#111] px-6 py-16 text-center text-white sm:py-24">
        <h2 className="text-[clamp(2.5rem,7vw,4.5rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">Start this week.</h2>
        <p className="mx-auto mt-4 max-w-md text-white/60">Send a message and we&apos;ll help you pick the right plan.</p>
        <a href={join} className={`${accentBtn} mt-8 px-8 py-4`}>
          Message {gym.name} <ArrowRight className="h-4 w-4" />
        </a>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-black/45">
        <p className="font-extrabold text-black">{gym.name}</p>
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
