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
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-base font-semibold text-text-primary">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-text-muted">{body}</p>
      {action && (
        <div className="mt-5">
          {typeof action === "object" && action !== null && "href" in action ? (
            <Link
              href={action.href}
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5"
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
