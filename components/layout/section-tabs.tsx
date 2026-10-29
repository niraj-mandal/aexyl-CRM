"use client";

import Link from "next/link";
import { useIsSales } from "@/components/providers/role-provider";
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

// Tabs a Sales member can't open (the server redirects them anyway).
const ADMIN_ONLY_TABS = new Set(["/sales/deals", "/intelligence", "/attention"]);

export function SectionTabs() {
  const pathname = usePathname();
  const isSales = useIsSales();
  const found = SECTION_GROUPS.find((g) => g.some((t) => t.href === pathname));
  const group = isSales ? found?.filter((t) => !ADMIN_ONLY_TABS.has(t.href)) : found;
  if (!group || group.length < 2) return null;
  // On phones the bottom tab bar already has Today and My Day, so these two tabs would be a duplicate.
  const onTabBar = group.some((t) => t.href === "/");

  return (
    <nav aria-label="Section" className={cn("mb-6 inline-flex w-fit flex-wrap items-center gap-0.5 rounded-[10px] bg-surface-high p-0.5", onTabBar && "max-md:hidden")}>
      {group.map((tab) => {
        const active = tab.href === pathname;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center gap-2 rounded-[8px] px-3.5 py-1 text-[13px] font-medium transition-all duration-200 md:min-h-0",
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
