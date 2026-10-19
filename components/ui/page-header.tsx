import type { ReactNode } from "react";
import { Display } from "@/components/ui/typography";

/** Page title block matching the Command Center: mono eyebrow, big title, short description, actions right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-semibold text-text-muted">{eyebrow}</p>}
        <Display className={eyebrow ? "mt-0.5" : undefined}>{title}</Display>
        {description && <p className="mt-1.5 text-[15px] text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
