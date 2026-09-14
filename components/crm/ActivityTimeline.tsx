import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Phone, Mail, Calendar, ArrowRightLeft, Sparkles, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, any> = {
  NOTE: StickyNote,
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Calendar,
  OUTREACH: MessageSquare,
  FOLLOW_UP: Calendar,
  STAGE_CHANGE: ArrowRightLeft,
  STATUS_CHANGE: Sparkles,
};

export function ActivityTimeline({ activities }: { activities: any[] }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-text-muted">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="relative border-l border-border-strong ml-4 space-y-8 pb-4">
      {activities.map((activity, index) => {
        const Icon = iconMap[activity.type] || MessageSquare;
        
        return (
          <div key={activity.id} className="relative pl-8 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 50}ms` }}>
            <div className="absolute -left-3.5 top-1 bg-surface border border-border-strong rounded-full p-1.5 shadow-sm">
              <Icon className="w-4 h-4 text-text-secondary" />
            </div>
            
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  {activity.title}
                </span>
                <span className="text-xs text-text-muted" title={new Date(activity.occurredAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(activity.occurredAt), { addSuffix: true })}
                </span>
              </div>
              
              {activity.description && (
                <p className="text-sm text-text-secondary leading-relaxed">
                  {activity.description}
                </p>
              )}

              {activity.actor && (
                <div className="text-xs text-text-muted mt-2">
                  by {activity.actor.firstName} {activity.actor.lastName}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
