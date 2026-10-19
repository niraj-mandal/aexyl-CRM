"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SectionTab {
  name: string;
  href: string;
}

/**
 * Pages merged under one sidebar entry. Each group's tabs render at the top of
 * that group's main pages (not detail pages), so related views stay one click apart.
 */
export const SECTION_GROUPS: SectionTab[][] = [
  [
    { name: "Overview", href: "/" },
    { name: "My Day", href: "/my-day" },
  ],
  [
    { name: "Leads", href: "/sales/leads" },
    { name: "Companies", href: "/sales/companies" },
    { name: "Contacts", href: "/sales/contacts" },
  ],
  [
    { name: "Board", href: "/sales/pipeline" },
    { name: "All Deals", href: "/sales/deals" },
  ],
  [
    { name: "Insights", href: "/intelligence" },
    { name: "Attention", href: "/attention" },
  ],
];

export function SectionTabs() {
  const pathname = usePathname();
  const group = SECTION_GROUPS.find((g) => g.some((t) => t.href === pathname));
  if (!group) return null;

  return (
    <nav aria-label="Section" className="mb-6 inline-flex w-fit flex-wrap items-center gap-0.5 rounded-[10px] bg-surface-high p-0.5">
      {group.map((tab) => {
        const active = tab.href === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-[8px] px-3.5 py-1 text-[13px] font-medium transition-all duration-200",
              active
                ? "bg-surface-highest text-text-primary shadow-[0_1px_4px_rgba(0,0,0,0.45)]"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
