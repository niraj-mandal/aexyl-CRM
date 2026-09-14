import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "secondary" | "tertiary" | "outline" | "danger";
}

export function Badge({ variant = "primary", className, children, ...props }: BadgeProps) {
  const variantStyles = {
    primary: "bg-primary/10 text-primary border-primary/20",
    secondary: "bg-secondary/10 text-secondary border-secondary/20",
    tertiary: "bg-tertiary/10 text-tertiary border-tertiary/20",
    danger: "bg-danger/10 text-danger border-danger/20",
    outline: "bg-white/[0.03] text-text-secondary border-white/10",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide transition-colors",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
