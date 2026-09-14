import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

export const GlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass rounded-xl p-6", className)}
      {...props}
    />
  )
);
GlassCard.displayName = "GlassCard";

export const GlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("glass-panel p-6", className)}
      {...props}
    />
  )
);
GlassPanel.displayName = "GlassPanel";
