import type { ComponentType, ReactNode } from "react";

/** Card header: icon tile + title, with optional monospace meta and an action on the right. */
export function SectionHeader({
  icon: Icon,
  title,
  meta,
  action,
  tone = "primary",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  tone?: "primary" | "secondary" | "tertiary";
}) {
  const toneClass = {
    primary: "text-primary bg-primary/10 ring-primary/20",
    secondary: "text-secondary bg-secondary/10 ring-secondary/20",
    tertiary: "text-tertiary bg-tertiary/10 ring-tertiary/20",
  }[tone];

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h2 className="truncate text-sm font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {meta && <span className="num text-[11px] uppercase tracking-wider text-text-muted">{meta}</span>}
        {action}
      </div>
    </div>
  );
}
