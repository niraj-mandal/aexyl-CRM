"use client";

import { useEffect, useState } from "react";
import { ArrowRight, PhoneCall, Target } from "lucide-react";

/** Animates 0 → value once (respects reduced motion). */
function useCountUp(value: number, durationMs = 900) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return shown;
}

/** Brand-red hero: how much of today's outreach is done, and who's next. */
export function TodayProgress({
  done,
  target,
  next,
  onOpenNext,
  onStart,
}: {
  done: number;
  target: number;
  next: { businessName: string } | null;
  onOpenNext: () => void;
  onStart?: () => void;
}) {
  const shown = useCountUp(done);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const [barPct, setBarPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarPct(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  const remaining = Math.max(0, target - done);
  const message =
    target === 0
      ? "Nothing scheduled. Approve leads in Lead Discovery or add phone numbers to fill your day."
      : remaining === 0
        ? "Today's outreach is done. Great work."
        : `${remaining} more to go today.`;

  return (
    <section
      aria-label="Today's progress"
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-[0_20px_50px_-20px_rgba(229,50,45,0.6)] transition-transform duration-200 hover:-translate-y-1 sm:p-6"
      style={{ background: "linear-gradient(120deg, #c81f1f 0%, #e5322d 45%, #f26b3a 100%)" }}
    >
      {/* soft highlight + texture */}
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
      <div className="bg-stripes pointer-events-none absolute inset-0 opacity-60" />

      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-white/80">
            <Target className="h-3.5 w-3.5" /> Today&apos;s progress
          </p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="num text-5xl font-semibold leading-none sm:text-6xl">{shown}</span>
            <span className="num text-lg text-white/70">/ {target}</span>
            <span className="ml-1 text-sm text-white/80">contacted</span>
          </p>
          <p className="mt-2 text-sm text-white/85">{message}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onStart && (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <PhoneCall className="h-4 w-4" /> Start calling
            </button>
          )}
          {next && (
            <button
              type="button"
              onClick={onOpenNext}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#c81f1f] shadow-lg transition-transform hover:scale-[1.03]"
            >
              Next: <span className="max-w-[160px] truncate">{next.businessName}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-5">
        <div
          className="h-2 overflow-hidden rounded-full bg-black/20"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={done}
          aria-label="Leads contacted today"
        >
          <div
            className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)] transition-[width] duration-1000 ease-out"
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className="num mt-1.5 text-right text-[11px] text-white/75">{pct}%</p>
      </div>
    </section>
  );
}
