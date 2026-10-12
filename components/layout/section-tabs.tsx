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
    { name: "Clients", href: "/clients" },
    { name: "Projects", href: "/projects" },
  ],
  [
    { name: "Executive Matrix", href: "/intelligence" },
    { name: "Attention Required", href: "/attention" },
  ],
];

export function SectionTabs() {
  const pathname = usePathname();
  const group = SECTION_GROUPS.find((g) => g.some((t) => t.href === pathname));
  if (!group) return null;

  return (
    <nav aria-label="Section" className="mb-6 flex flex-wrap items-center gap-1 rounded-lg border border-border-subtle bg-surface-lowest p-1 w-fit">
      {group.map((tab) => {
        const active = tab.href === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              active
                ? "bg-primary/15 text-primary border border-primary/30 shadow-sm"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-high/50 border border-transparent",
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
