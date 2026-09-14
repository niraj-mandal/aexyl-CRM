import { cn } from "@/lib/utils";
import { HTMLAttributes, forwardRef } from "react";

export const Display = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h1 ref={ref} className={cn("text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-[-0.03em] text-text-primary", className)} {...props} />
  )
);
Display.displayName = "Display";

export const PageTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-xl sm:text-2xl font-semibold tracking-[-0.025em] text-text-primary", className)} {...props} />
  )
);
PageTitle.displayName = "PageTitle";

export const SectionTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-base font-medium tracking-[-0.015em] text-text-primary", className)} {...props} />
  )
);
SectionTitle.displayName = "SectionTitle";

export const Body = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm leading-relaxed text-text-secondary", className)} {...props} />
  )
);
Body.displayName = "Body";

export const Metadata = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("text-xs text-text-muted", className)} {...props} />
  )
);
Metadata.displayName = "Metadata";

export const MonoLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("font-mono-code text-[11px] tracking-[0.04em] uppercase text-text-muted", className)} {...props} />
  )
);
MonoLabel.displayName = "MonoLabel";
