"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

/** Type a city, pick it from the suggestions (or press Enter) to jump to its leads. */
export function CitySearch({ cities, current }: { cities: { name: string; count: number }[]; current: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (name: string) => router.push(`/sales/leads?${new URLSearchParams({ city: name })}`);
  // Exact name first, then a city that starts with the text, then one that contains it.
  const match = (text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    return (
      cities.find((c) => c.name.toLowerCase() === t) ??
      cities.find((c) => c.name.toLowerCase().startsWith(t)) ??
      cities.find((c) => c.name.toLowerCase().includes(t)) ??
      null
    );
  };
  const hit = match(q);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (hit) go(hit.name);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="relative min-w-0 flex-1 sm:max-w-xs">
        <span className="sr-only">Search a city</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          list="lead-cities"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // Picking a suggestion fills in the full name: go straight there.
            const exact = cities.find((c) => c.name === e.target.value);
            if (exact) go(exact.name);
          }}
          // Chrome's open suggestion list swallows Enter before the form sees it, so handle it here.
          onKeyDown={(e) => {
            if (e.key === "Enter" && hit) {
              e.preventDefault();
              go(hit.name);
            }
          }}
          placeholder={`Search ${cities.length} cities…`}
          enterKeyHint="search"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border-subtle bg-surface-lowest pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none"
        />
        <datalist id="lead-cities">
          {cities.map((c) => (
            <option key={c.name} value={c.name} label={`${c.count} lead${c.count === 1 ? "" : "s"}`} />
          ))}
        </datalist>
      </label>
      {q.trim() && (
        <span className="text-xs text-text-muted">{hit ? `Enter → ${hit.name} (${hit.count})` : "No city matches"}</span>
      )}
      {current && (
        <button
          type="button"
          onClick={() => router.push("/sales/leads")}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-border-subtle px-3 text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" /> Clear {current}
        </button>
      )}
    </form>
  );
}
