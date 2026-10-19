/** Coloured initials for a business, e.g. "Fitness Factor Gym" → FF. Same name, same colour every time. */
const HUES = ["#FF453A", "#FF9F0A", "#30D158", "#64D2FF", "#BF5AF2", "#FF375F", "#FFD60A", "#5E5CE6"];

export function initials(name: string): string {
  const words = name
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^the$/i.test(w));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

function hueFor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function GymAvatar({ name, size = 32, className = "" }: { name: string; size?: number; className?: string }) {
  const c = hueFor(name);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        color: c,
        background: `linear-gradient(145deg, ${c}38, ${c}14)`,
        boxShadow: `inset 0 0 0 1px ${c}40`,
      }}
    >
      {initials(name)}
    </span>
  );
}
