import { cn } from "@/lib/utils";
import { Building2, User } from "lucide-react";

export function DealCard({ deal, isOverlay }: { deal: any; isOverlay?: boolean }) {
  return (
    <div
      className={cn(
        "glass-panel p-4 cursor-grab active:cursor-grabbing hover:border-border-strong transition-colors bg-surface",
        isOverlay && "rotate-2 scale-105 shadow-2xl cursor-grabbing ring-1 ring-border-strong"
      )}
    >
      <div className="flex justify-between items-start mb-3">
        <h4 className="font-medium text-text-primary text-sm line-clamp-2 leading-tight">
          {deal.name}
        </h4>
      </div>
      
      <div className="flex items-center text-xs text-text-secondary mb-3">
        <Building2 className="w-3 h-3 mr-1" />
        <span className="truncate">{deal.company?.name || "No Company"}</span>
      </div>

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-subtle">
        <div className="font-semibold text-sm text-text-primary">
          ${Number(deal.value || 0).toLocaleString()}
        </div>
        {deal.owner && (
          <div className="flex items-center text-xs text-text-muted" title={`${deal.owner.firstName} ${deal.owner.lastName}`}>
            <User className="w-3 h-3 mr-1" />
            <span className="truncate w-16">{deal.owner.firstName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
