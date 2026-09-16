"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { format } from "date-fns";
import { Search, Command, ShieldAlert } from "lucide-react";
import { AexylPulse } from "@/components/ui/aexyl-pulse";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ActionNeededBadge, useActionNeededCount } from "@/components/layout/ActionNeededBadge";

export function Header({ userFirstName }: { userFirstName?: string | null }) {
  const today = new Date();
  const { pending, failedRuns } = useActionNeededCount();
  const actionNeeded = pending > 0 || failedRuns > 0;
  
  return (
    <header className="sticky top-0 z-20 flex h-16 flex-shrink-0 items-center justify-between px-8 bg-surface-lowest/80 backdrop-blur-xl border-b border-border-subtle">
      <div className="flex items-center space-x-6">
        <AexylPulse state="idle" />
        <span className="hidden md:inline-block h-4 w-px bg-border-subtle" />
        <p className="hidden md:block font-mono-code text-xs text-text-muted">
          {format(today, "EEEE, MMMM do, yyyy")}
        </p>
      </div>

      <div className="flex items-center space-x-4">
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
          className="flex items-center space-x-3 rounded-lg border border-border-subtle bg-surface-low/80 px-3 py-1.5 text-xs text-text-muted hover:border-primary/40 hover:text-text-secondary transition-all"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search or jump to...</span>
          <kbd className="flex items-center gap-0.5 rounded border border-border-subtle bg-surface-high px-1.5 py-0.5 font-mono-code text-[10px] text-text-muted">
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
