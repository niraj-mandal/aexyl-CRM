"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useIsSales } from "@/components/providers/role-provider";
import {
  LayoutDashboard,
  CalendarRange,
  Users,
  Kanban,
  Send,
  Briefcase,
  Sparkles,
  Bot,
  Settings,
  Zap,
  Search,
  Trophy,
} from "lucide-react";
import { useSidebarBadges } from "./sidebar-badges";
import { SidebarBadge } from "./sidebar-badge";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Other routes that belong to this entry (its section tabs) and keep it highlighted. */
  also?: string[];
  exact?: boolean;
  badge?: string;
  /** Live count badge source from useSidebarBadges. */
  badgeKey?: "approvals" | "attention" | "notifications";
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Related pages are merged under one entry and reached via SectionTabs; notifications live in the header bell.
const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { name: "Command Center", href: "/", icon: LayoutDashboard, exact: true, also: ["/my-day"] },
      { name: "Calendar", href: "/calendar", icon: CalendarRange },
    ]
  },
  {
    title: "Sales",
    items: [
      { name: "Leads", href: "/sales/leads", icon: Users, also: ["/sales/companies", "/sales/contacts"] },
      { name: "Pipeline", href: "/sales/pipeline", icon: Kanban, also: ["/sales/deals"] },
      { name: "Outreach", href: "/outreach", icon: Send },
      { name: "Scoreboard", href: "/sales/scoreboard", icon: Trophy },
      { name: "AI BDR", href: "/bdr", icon: Zap, badge: "AI" },
    ]
  },
  {
    title: "Delivery",
    items: [
      // Clients are companies (Leads → Companies); /clients only redirects there.
      { name: "Projects", href: "/projects", icon: Briefcase },
    ]
  },
  {
    title: "Intelligence",
    items: [
      { name: "Insights", href: "/intelligence", icon: Sparkles, also: ["/attention"], badgeKey: "attention" },
      { name: "Aexyl Agents", href: "/agents", icon: Bot, badgeKey: "approvals" },
    ]
  }
];

// Pages a Sales member can't open (the server redirects them anyway).
const ADMIN_ONLY = new Set(["/projects", "/intelligence", "/agents"]);

function isItemActive(item: NavItem, pathname: string): boolean {
  const matches = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return matches(item.href, item.exact) || (item.also ?? []).some((h) => matches(h));
}

/** Opened from the header's menu button on small screens. */
export const TOGGLE_SIDEBAR_EVENT = "aexyl:toggle-sidebar";

export function Sidebar() {
  const pathname = usePathname();
  const badges = useSidebarBadges();
  const isSales = useIsSales();
  const sections = isSales
    ? navSections.map((s) => ({ ...s, items: s.items.filter((i) => !ADMIN_ONLY.has(i.href)) })).filter((s) => s.items.length > 0)
    : navSections;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);

  // Navigating closes the mobile drawer (derived from the path, no effect needed).
  const open = mobileOpen && openedAt === pathname;

  useEffect(() => {
    const toggle = () => {
      setOpenedAt(window.location.pathname);
      setMobileOpen((o) => !o);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
    {open && (
      <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
    )}
    <aside
      id="app-sidebar"
      className={cn(
        "h-full w-[260px] flex-col bg-[var(--chrome-bg)] backdrop-blur-2xl backdrop-saturate-150 border-r border-border-subtle overflow-hidden select-none",
        open ? "fixed inset-y-0 left-0 z-[60] flex shadow-2xl" : "hidden",
        "md:static md:z-auto md:flex md:shadow-none",
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center px-6 border-b border-border-subtle/50">
        <Link href="/" aria-label="AEXYL home" className="flex items-center gap-2.5 group">
          <Image
            src="/aexyl-symbol.png"
            alt=""
            width={259}
            height={248}
            priority
            className="h-7 w-auto shrink-0 transition-transform group-hover:scale-105 group-hover:-rotate-3"
          />
          <Image
            src="/aexyl-mark-white.png"
            alt="AEXYL"
            width={874}
            height={150}
            priority
            className="logo-wordmark h-3 w-auto"
          />
        </Link>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
          className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface-low px-3 py-2 text-xs text-text-muted hover:border-border-strong hover:text-text-secondary transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-border-subtle bg-surface-high px-1.5 py-0.5 font-mono-code text-[11px]">⌘K</kbd>
        </button>
      </div>

      {/* Navigation Groups (scrollable; brand + footer stay pinned) */}
      <div className="flex-1 space-y-6 px-3 py-4 overflow-y-auto scrollbar-thin">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 pb-1.5 text-xs font-medium text-text-muted">
              {section.title}
            </div>
            {section.items.map((item) => {
              const isActive = isItemActive(item, pathname);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                    isActive
                      ? "bg-[var(--fill-active)] text-text-primary border border-transparent"
                      : "text-text-secondary hover:bg-surface-high/50 hover:text-text-primary border border-transparent"
                  )}
                >
                  <div className="flex items-center space-x-2.5">
                    <item.icon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive ? "text-brand" : "text-text-muted group-hover:text-text-secondary"
                      )}
                    />
                    <span>{item.name}</span>
                  </div>

                  {item.badge && (
                    <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono-code text-[11px] text-primary">
                      {item.badge}
                    </span>
                  )}

                  {item.badgeKey && (
                    <SidebarBadge
                      count={badges[item.badgeKey]}
                      tone={item.badgeKey === "notifications" ? "info" : "alert"}
                      title={
                        item.badgeKey === "approvals"
                          ? `${badges.approvals} agent action${badges.approvals === 1 ? "" : "s"} awaiting approval`
                          : item.badgeKey === "attention"
                            ? (badges.attention === 1 ? "1 pipeline risk needs attention" : `${badges.attention} pipeline risks need attention`)
                            : `${badges.notifications} unread notification${badges.notifications === 1 ? "" : "s"}`
                      }
                    />
                  )}

                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer System Quick Action */}
      {!isSales && (
      <div className="shrink-0 p-3 border-t border-border-subtle/50">
        <Link
          href="/settings"
          className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors",
            pathname.startsWith("/settings")
              ? "bg-brand/15 text-text-primary border border-brand/30"
              : "text-text-secondary hover:bg-surface-high/50 hover:text-text-primary border border-transparent"
          )}
        >
          <div className="flex items-center space-x-2.5">
            <Settings className={cn("h-4 w-4", pathname.startsWith("/settings") ? "text-brand" : "text-text-muted")} />
            <span>Settings & Rules</span>
          </div>
          <kbd className="font-mono-code text-xs text-text-muted bg-surface-high px-1.5 py-0.5 rounded border border-border-subtle">
            ⌘S
          </kbd>
        </Link>
      </div>
      )}
    </aside>
    </>
  );
}
