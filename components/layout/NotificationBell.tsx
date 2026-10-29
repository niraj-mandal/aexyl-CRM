"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/production.actions";
import { refreshAlerts, useAlerts } from "@/lib/hooks/use-alerts";

/**
 * In-app notification center (spec §23): "2 things require your attention",
 * not raw event spam. Items are real DB rows created by agents/policies.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { items, unread } = useAlerts();
  const refresh = refreshAlerts;

  const markAll = async () => {
    await markNotificationsReadAction();
    refresh();
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) refresh();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-[var(--fill-hover)] hover:text-text-primary md:h-auto md:w-auto md:border md:border-border-subtle md:bg-surface-low/80 md:p-2 md:text-text-muted"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tertiary px-1 text-[11px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* The header's backdrop-blur makes it the containing block for fixed children, so size the overlay to the viewport explicitly. */}
          <div className="fixed left-0 top-0 z-30 h-dvh w-screen max-md:bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-border-subtle bg-surface-low/95 shadow-2xl backdrop-blur-xl max-md:fixed max-md:inset-x-3 max-md:top-16 max-md:mt-0 max-md:w-auto max-md:bg-surface-low">
            <div className="flex items-center justify-between border-b border-border-subtle/60 px-4 py-2.5">
              <span className="font-mono-code text-xs tracking-wider text-text-muted">
                {unread > 0 ? `${unread} NEED YOUR ATTENTION` : "ALL CLEAR"}
              </span>
              {unread > 0 && (
                <button onClick={markAll} className="py-1 text-xs text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto overscroll-contain scrollbar-thin max-md:max-h-[60dvh]">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-text-muted">No notifications yet.</p>
              ) : (
                items.map((n) => {
                  const inner = (
                    <div className={`border-b border-border-subtle/40 px-4 py-3 ${!n.readAt ? "bg-primary/5" : ""}`}>
                      <p className="text-xs font-semibold text-text-primary">{n.content.title ?? n.type}</p>
                      {n.content.body && <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{n.content.body}</p>}
                      <p className="mt-1 font-mono-code text-[11px] text-text-muted/60">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  );
                  return n.content.link ? (
                    <Link key={n.id} href={n.content.link} onClick={() => setOpen(false)}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={n.id}>{inner}</div>
                  );
                })
              )}
            </div>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-border-subtle/60 px-4 py-2 text-center text-xs font-medium text-primary hover:bg-surface-high/40"
            >
              View all notifications
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
