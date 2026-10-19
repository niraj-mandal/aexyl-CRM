"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { format } from "date-fns";
import { Search, Command, ShieldAlert, Menu } from "lucide-react";
import { TOGGLE_SIDEBAR_EVENT } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ActionNeededBadge, useActionNeededCount } from "@/components/layout/ActionNeededBadge";

export function Header({ userFirstName }: { userFirstName?: string | null }) {
  const today = new Date();
  const { pending, failedRuns } = useActionNeededCount();
  const actionNeeded = pending > 0 || failedRuns > 0;

  return (
    <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center justify-between gap-2 px-4 md:px-8 bg-[var(--chrome-bg)] backdrop-blur-2xl backdrop-saturate-150 border-b border-border-subtle">
      <div className="flex items-center space-x-3 md:space-x-6">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT))}
          aria-label="Open menu"
          aria-controls="app-sidebar"
          className="md:hidden -ml-1 rounded-lg p-2 text-text-secondary hover:bg-surface-high hover:text-text-primary"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="hidden md:block text-xs text-text-muted">
          {format(today, "EEEE, MMMM do, yyyy")}
        </p>
      </div>

      <div className="flex items-center space-x-2 md:space-x-4">
        <ThemeToggle />
        {/* Pinned approvals shortcut — review inbox always one click away */}
        <Link
          href="/agents/approvals"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
            actionNeeded
              ? "border-tertiary/50 bg-tertiary/10 text-text-primary hover:border-tertiary/70"
              : "border-border-subtle bg-surface-low/80 text-text-muted hover:border-primary/40 hover:text-text-secondary"
          }`}
          title={`${pending} agent action${pending === 1 ? "" : "s"} awaiting approval${failedRuns ? ` · ${failedRuns} failed run${failedRuns === 1 ? "" : "s"} (24h)` : ""}`}
        >
          <ShieldAlert className={`h-3.5 w-3.5 ${actionNeeded ? "text-tertiary" : ""}`} />
          <span className="hidden lg:inline">Action needed</span>
          <ActionNeededBadge count={pending} />
        </Link>
        <NotificationBell />
        {/* Search Command Palette Trigger */}
        <button
          onClick={() => {
            const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
            document.dispatchEvent(event);
          }}
          aria-label="Search or jump to"
          className="md:hidden flex items-center space-x-3 rounded-lg border border-border-subtle bg-surface-low/80 px-3 py-1.5 text-xs text-text-muted hover:border-primary/40 hover:text-text-secondary transition-all"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search or jump to...</span>
          <kbd className="hidden sm:flex items-center gap-0.5 rounded border border-border-subtle bg-surface-high px-1.5 py-0.5 font-mono-code text-xs text-text-muted">
            <Command className="h-2.5 w-2.5" /> K
          </kbd>
        </button>

        <UserButton
          appearance={{
            elements: {
              avatarBox: "w-8 h-8 rounded-lg border border-border-subtle hover:border-primary/50 transition-colors",
            }
          }}
        />
      </div>
    </header>
  );
}
