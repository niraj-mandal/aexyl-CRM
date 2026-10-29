/**
 * Demo websites: a public preview page per lead at /demo/<gym-name>-<first 8 chars of lead id>.
 * The id part makes the link unguessable enough for a preview; the name part makes it readable.
 */
export const DEMO_STYLES = {
  volt: { label: "Volt", accent: "#C6F432" },
  ember: { label: "Ember", accent: "#FF6A1A" },
  crimson: { label: "Crimson", accent: "#E5262E" },
} as const;
export type DemoStyle = keyof typeof DEMO_STYLES;

/** Page layouts. Each gym gets its own one by default, so two gyms in a town don't see the same site. */
export const DEMO_TEMPLATES = {
  bold: "Bold",
  clean: "Clean",
  studio: "Studio",
} as const;
export type DemoTemplate = keyof typeof DEMO_TEMPLATES;

/** Stable per-lead pick: the same gym always opens the same default template and colour. */
function pick<T extends string>(leadId: string, keys: readonly T[], salt: number): T {
  const n = Number.parseInt(leadId.replace(/-/g, "").slice(salt, salt + 6), 16) || 0;
  return keys[n % keys.length];
}
export const defaultTemplate = (leadId: string) => pick(leadId, Object.keys(DEMO_TEMPLATES) as DemoTemplate[], 0);
export const defaultStyle = (leadId: string) => pick(leadId, Object.keys(DEMO_STYLES) as DemoStyle[], 6);

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "gym";

export function demoSlug(name: string, leadId: string): string {
  return `${slugify(name)}-${leadId.replace(/-/g, "").slice(0, 8)}`;
}

export function demoPath(
  name: string,
  leadId: string,
  style: DemoStyle = defaultStyle(leadId),
  color?: string,
  template: DemoTemplate = defaultTemplate(leadId),
): string {
  const q = new URLSearchParams({ t: template, s: style, ...(color ? { c: color.replace("#", "") } : {}) });
  return `/demo/${demoSlug(name, leadId)}?${q}`;
}

/** "tanks-gym-5e114752" → { name: "tanks-gym", idPrefix: "5e114752" } */
export function parseDemoSlug(slug: string): { name: string; idPrefix: string } | null {
  const m = slug.match(/^(.+)-([0-9a-f]{8})$/);
  return m ? { name: m[1], idPrefix: m[2] } : null;
}

/** Black or white text, whichever reads better on the accent colour. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#0A0A0A" : "#FFFFFF";
}
