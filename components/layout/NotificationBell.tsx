"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { listNotificationsAction, markNotificationsReadAction } from "@/app/actions/production.actions";

interface NotificationItem {
  id: string;
  type: string;
  content: { title?: string; body?: string | null; link?: string | null };
  readAt: string | null;
  createdAt: string;
}

/**
 * In-app notification center (spec §23): "2 things require your attention",
 * not raw event spam. Items are real DB rows created by agents/policies.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = async () => {
    try {
      const res = await listNotificationsAction();
      setItems(
        (res.items ?? []).map((n: { id: string; type: string; content: unknown; readAt: Date | null; createdAt: Date }) => ({
          id: n.id,
          type: n.type,
          content: (n.content ?? {}) as NotificationItem["content"],
          readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
          createdAt: new Date(n.createdAt).toISOString(),
        }))
      );
      setUnread(res.unread ?? 0);
    } catch {
      // bell is non-critical chrome
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

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
        className="relative rounded-lg border border-border-subtle bg-surface-low/80 p-2 text-text-muted transition-colors hover:border-primary/40 hover:text-text-secondary"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tertiary px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-border-subtle bg-surface-low/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-border-subtle/60 px-4 py-2.5">
              <span className="font-mono-code text-[10px] tracking-wider text-text-muted">
                {unread > 0 ? `${unread} NEED YOUR ATTENTION` : "ALL CLEAR"}
              </span>
              {unread > 0 && (
                <button onClick={markAll} className="text-[10px] text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto scrollbar-thin">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] text-text-muted">No notifications yet.</p>
              ) : (
                items.map((n) => {
                  const inner = (
                    <div className={`border-b border-border-subtle/40 px-4 py-3 ${!n.readAt ? "bg-primary/5" : ""}`}>
                      <p className="text-[11px] font-semibold text-text-primary">{n.content.title ?? n.type}</p>
                      {n.content.body && <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">{n.content.body}</p>}
                      <p className="mt-1 font-mono-code text-[9px] text-text-muted/60">
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
          </div>
        </>
      )}
    </div>
  );
}
