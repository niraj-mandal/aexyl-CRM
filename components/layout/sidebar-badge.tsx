/**
 * Count pill for sidebar nav rows — mirrors the header badges' styling
 * language (amber for attention-type alerts, blue for informational counts).
 * Hidden at zero so the nav stays quiet when there's nothing to do.
 */
export function SidebarBadge({
  count,
  tone = "alert",
  title,
}: {
  count: number;
  /** "alert" = amber attention pill, "info" = primary-blue count pill. */
  tone?: "alert" | "info";
  title?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      title={title}
      className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 font-mono-code text-[9px] font-bold text-white ${
        tone === "alert"
          ? "bg-tertiary shadow-[0_0_10px_rgba(255,185,95,0.45)]"
          : "bg-primary/80"
      }`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
