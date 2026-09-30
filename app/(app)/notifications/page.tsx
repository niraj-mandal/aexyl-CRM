import { notificationsPageAction } from "@/app/actions/production.actions";
import { Display, MonoLabel, Body } from "@/components/ui/typography";
import { GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * Full notification inbox — the destination for the sidebar "Notifications"
 * badge. Same data the header bell shows, but with history (read items kept)
 * and a larger window.
 */
export default async function NotificationsPage() {
  const { items, unread } = await notificationsPageAction();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <section className="space-y-2">
          <MonoLabel className="text-primary block mb-1">SYSTEM // INBOX</MonoLabel>
          <Display>Notifications</Display>
          <Body>
            {unread > 0
              ? `${unread} item${unread === 1 ? "" : "s"} need${unread === 1 ? "s" : ""} your attention.`
              : "You're all caught up."}{" "}
            Approvals, failed runs, incidents, and workspace events land here.
          </Body>
        </section>
        <Badge variant="outline" className="font-mono-code text-[11px]">
          {unread} unread · {items.length} recent
        </Badge>
      </div>

      {items.length === 0 ? (
        <GlassPanel className="p-10 text-center">
          <Body className="text-text-muted">
            No notifications yet. When agents need approvals, runs fail, or
            incidents open, they&apos;ll appear here and on the sidebar badge.
          </Body>
        </GlassPanel>
      ) : (
        <GlassPanel className="p-2">
          <div className="divide-y divide-border-subtle/40">
            {items.map((n) => {
              const content = (n.content ?? {}) as {
                title?: string;
                body?: string | null;
                link?: string | null;
              };
              const inner = (
                <div
                  className={`flex items-start gap-3 rounded-lg px-3 py-3 ${
                    !n.readAt ? "bg-primary/5" : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      !n.readAt ? "bg-primary shadow-[0_0_8px_rgba(43,102,255,0.6)]" : "bg-border-subtle"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      {content.title ?? n.type}
                    </p>
                    {content.body && (
                      <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                        {content.body}
                      </p>
                    )}
                    <p className="mt-1 font-mono-code text-[10px] text-text-muted/60">
                      {format(new Date(n.createdAt), "EEE d MMM · HH:mm")}
                    </p>
                  </div>
                  {!n.readAt && (
                    <Badge variant="secondary" className="font-mono-code text-[9px] shrink-0">
                      NEW
                    </Badge>
                  )}
                </div>
              );
              return content.link ? (
                <Link key={n.id} href={content.link} className="block">
                  {inner}
                </Link>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
