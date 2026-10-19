import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Phone, Mail, Calendar, ArrowRightLeft, Sparkles, StickyNote, History, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

// Icon + tint per event, so a glance shows calls vs. messages vs. stage moves.
const STYLE: Record<string, { icon: LucideIcon; cls: string }> = {
  NOTE: { icon: StickyNote, cls: "text-text-secondary bg-surface-high" },
  CALL: { icon: Phone, cls: "text-success bg-success/15" },
  EMAIL: { icon: Mail, cls: "text-primary bg-primary/15" },
  MEETING: { icon: Calendar, cls: "text-secondary bg-secondary/15" },
  OUTREACH: { icon: MessageSquare, cls: "text-success bg-success/15" },
  FOLLOW_UP: { icon: Calendar, cls: "text-tertiary bg-tertiary/15" },
  STAGE_CHANGE: { icon: ArrowRightLeft, cls: "text-primary bg-primary/15" },
  STATUS_CHANGE: { icon: Sparkles, cls: "text-tertiary bg-tertiary/15" },
};

interface TimelineActivity {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  occurredAt: string | Date;
  actor?: { firstName: string | null; lastName: string | null } | null;
}

export function ActivityTimeline({ activities }: { activities: TimelineActivity[] }) {
  if (!activities || activities.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No history yet"
        body="Calls, pitches, outcomes and notes for this lead will show up here, newest first."
      />
    );
  }

  return (
    <ol className="stagger relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border-subtle">
      {activities.map((activity) => {
        const { icon: Icon, cls } = STYLE[activity.type] ?? { icon: MessageSquare, cls: "text-text-secondary bg-surface-high" };
        const when = new Date(activity.occurredAt);
        return (
          <li key={activity.id} className="relative flex gap-3">
            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface-low ${cls}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-text-primary">{activity.title}</span>
                <time className="num text-xs text-text-muted" dateTime={when.toISOString()} title={when.toLocaleString()}>
                  {formatDistanceToNow(when, { addSuffix: true })}
                </time>
              </div>
              {activity.description && (
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-text-secondary">{activity.description}</p>
              )}
              {activity.actor && (
                <p className="mt-1 text-xs text-text-muted">
                  by {activity.actor.firstName} {activity.actor.lastName}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
