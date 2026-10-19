const COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#BF5AF2"];

/** A short confetti burst from the middle of the screen. Skipped when the viewer prefers reduced motion. */
export function celebrate() {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.createElement("div");
  root.className = "confetti";
  root.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 32; i++) {
    const p = document.createElement("i");
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 560}px`);
    p.style.setProperty("--y", `${-140 - Math.random() * 260}px`);
    p.style.setProperty("--r", `${Math.random() * 900 - 450}deg`);
    p.style.background = COLORS[i % COLORS.length];
    p.style.animationDelay = `${Math.random() * 90}ms`;
    root.appendChild(p);
  }
  document.body.appendChild(root);
  setTimeout(() => root.remove(), 1700);
}
