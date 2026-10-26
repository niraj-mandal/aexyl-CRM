"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, LayoutGrid, Menu, PhoneCall, Users } from "lucide-react";
import { TOGGLE_SIDEBAR_EVENT } from "@/components/layout/sidebar";

const TABS = [
  { href: "/", label: "Today", icon: LayoutGrid, match: (p: string) => p === "/" },
  { href: "/sales/leads", label: "Leads", icon: Users, match: (p: string) => p.startsWith("/sales/leads") },
  // Opens the call session on the dashboard (TodayList reads ?call=1).
  { href: "/?call=1", label: "Call", icon: PhoneCall, match: () => false },
  { href: "/my-day", label: "My Day", icon: CalendarCheck, match: (p: string) => p.startsWith("/my-day") },
];

/** iOS-style tab bar on phones: the daily essentials one tap away; "More" opens the full menu. */
export function MobileTabBar() {
  const pathname = usePathname();
  const item = "flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1 text-[10px] font-medium transition-colors";

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex bg-[var(--chrome-bg)] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-5 before:bg-gradient-to-t before:from-[var(--chrome-bg)] before:to-transparent pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl backdrop-saturate-150 md:hidden"
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        const isCall = t.label === "Call";
        return (
          <Link key={t.label} href={t.href} aria-current={active ? "page" : undefined} className={`${item} ${active ? "text-primary" : "text-text-muted"}`}>
            {isCall ? (
              <span className="-mt-4 flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-[var(--background)]">
                <t.icon className="h-5 w-5" />
              </span>
            ) : (
              <t.icon className="h-6 w-6" />
            )}
            {t.label}
          </Link>
        );
      })}
      <button type="button" onClick={() => window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT))} className={`${item} text-text-muted`}>
        <Menu className="h-6 w-6" />
        More
      </button>
    </nav>
  );
}
