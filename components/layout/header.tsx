"use client";

import Link from "next/link";
import { useIsSales } from "@/components/providers/role-provider";
import { UserButton } from "@clerk/nextjs";
import { format } from "date-fns";
import { Search, ShieldAlert, Menu } from "lucide-react";
import { TOGGLE_SIDEBAR_EVENT } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ActionNeededBadge, useActionNeededCount } from "@/components/layout/ActionNeededBadge";

export function Header({ userFirstName }: { userFirstName?: string | null }) {
  const today = new Date();
  const { pending, failedRuns } = useActionNeededCount();
  const actionNeeded = pending > 0 || failedRuns > 0;
  const isSales = useIsSales();

  return (
    <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center justify-between gap-2 px-4 md:px-8 bg-[var(--chrome-bg)] backdrop-blur-2xl backdrop-saturate-150 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-gradient-to-b after:from-[var(--chrome-bg)] after:to-transparent">
      <div className="flex items-center space-x-3 md:space-x-6">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT))}
          aria-label="Open menu"
          aria-controls="app-sidebar"
          className="md:hidden -ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-high hover:text-text-primary"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="hidden md:block text-xs text-text-muted">
          {format(today, "EEEE, MMMM do, yyyy")}
        </p>
      </div>

      <div className="flex items-center gap-1 md:gap-4">
        <ThemeToggle />
        {/* Pinned approvals shortcut — review inbox always one click away (admins only).
            Hidden on phones to keep the bar calm; it's in the menu under Aexyl Agents. */}
        {!isSales && <Link
          href="/agents/approvals"
          className={`hidden md:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
            actionNeeded
              ? "border-tertiary/50 bg-tertiary/10 text-text-primary hover:border-tertiary/70"
              : "border-border-subtle bg-surface-low/80 text-text-muted hover:border-primary/40 hover:text-text-secondary"
          }`}
          title={`${pending} agent action${pending === 1 ? "" : "s"} awaiting approval${failedRuns ? ` · ${failedRuns} failed run${failedRuns === 1 ? "" : "s"} (24h)` : ""}`}
        >
          <ShieldAlert className={`h-3.5 w-3.5 ${actionNeeded ? "text-tertiary" : ""}`} />
          <span className="hidden lg:inline">Action needed</span>
          <ActionNeededBadge count={pending} />
        </Link>}
        <NotificationBell />
        {/* Search Command Palette Trigger */}
        <button
          onClick={() => {
            const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
            document.dispatchEvent(event);
          }}
          aria-label="Search or jump to"
          className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-high hover:text-text-primary transition-colors"
        >
          <Search className="h-[18px] w-[18px]" />
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
