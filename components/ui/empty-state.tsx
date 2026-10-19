import type { ComponentType, ReactNode } from "react";
import Link from "next/link";

/** What a blank screen should say: why it's empty and the one thing to do next. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: ReactNode;
  action?: { href: string; label: string } | ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {/* Small illustration: the icon inside soft concentric rings. */}
      <span className="relative flex h-24 w-24 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full border border-border-subtle" />
        <span className="absolute inset-3 rounded-full border border-border-subtle bg-primary/[0.04]" />
        <span className="absolute right-3 top-4 h-1.5 w-1.5 rounded-full bg-primary/60" />
        <span className="absolute bottom-5 left-2.5 h-1 w-1 rounded-full bg-text-muted/50" />
        <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <Icon className="h-5 w-5" />
        </span>
      </span>
      <p className="mt-4 text-base font-semibold text-text-primary">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-text-muted">{body}</p>
      {action && (
        <div className="mt-5">
          {typeof action === "object" && action !== null && "href" in action ? (
            <Link
              href={action.href}
              className="inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
            >
              {action.label}
            </Link>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}
