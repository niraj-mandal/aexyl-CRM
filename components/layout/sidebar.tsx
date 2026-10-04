"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  CalendarDays, 
  CalendarRange,
  Users, 
  Kanban, 
  Send, 
  Briefcase, 
  Building2,
  Contact,
  TrendingUp,
  FolderKanban, 
  Sparkles, 
  Bot,
  BellRing, 
  Bell,
  Settings,
  Megaphone,
  Clock3,
  Flame,
  TimerReset,
  Radar
} from "lucide-react";
import { useSidebarBadges } from "./sidebar-badges";
import { SidebarBadge } from "./sidebar-badge";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: string;
  /** Live count badge source from useSidebarBadges. */
  badgeKey?: "approvals" | "attention" | "notifications";
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [
      { name: "Command Center", href: "/", icon: LayoutDashboard, exact: true },
      { name: "My Day", href: "/my-day", icon: CalendarDays },
      { name: "Calendar", href: "/calendar", icon: CalendarRange },
      { name: "Notifications", href: "/notifications", icon: Bell, badgeKey: "notifications" },
    ]
  },
  {
    title: "SALES & OUTREACH",
    items: [
      { name: "Leads", href: "/sales/leads", icon: Users },
      { name: "Pipeline", href: "/sales/pipeline", icon: Kanban },
      { name: "Companies", href: "/sales/companies", icon: Building2 },
      { name: "Contacts", href: "/sales/contacts", icon: Contact },
      { name: "Deals", href: "/sales/deals", icon: TrendingUp },
      { name: "Outreach Engine", href: "/outreach", icon: Send },
      { name: "Campaigns", href: "/outreach/campaigns", icon: Megaphone },
      { name: "Discovery", href: "/outreach/discovery", icon: Radar },
      { name: "Outbound Queue", href: "/outreach/queue", icon: Clock3 },
      { name: "Human Handoffs", href: "/outreach/handoffs", icon: Flame, badgeKey: "attention" },
      { name: "Nurture", href: "/outreach/nurture", icon: TimerReset },
    ]
  },
  {
    title: "OPERATIONS",
    items: [
      { name: "Clients Directory", href: "/clients", icon: Briefcase },
      { name: "Projects Directory", href: "/projects", icon: FolderKanban },
    ]
  },
  {
    title: "INTELLIGENCE",
    items: [
      { name: "Executive Matrix", href: "/intelligence", icon: Sparkles, badge: "AI" },
      { name: "Attention Required", href: "/attention", icon: BellRing, badgeKey: "attention" },
      { name: "Aexyl Agents", href: "/agents", icon: Bot, badgeKey: "approvals" },
    ]
  }
];

export function Sidebar() {
  const pathname = usePathname();
  const badges = useSidebarBadges();

  return (
    <aside className="flex h-full w-[260px] flex-col bg-surface-lowest border-r border-border-subtle overflow-hidden select-none">
      {/* Brand Header */}
      <div className="flex h-16 items-center px-6 border-b border-border-subtle/50">
        <Link href="/" className="flex items-center space-x-3 group">
          <Image
            src="/aexyl-mark-white.png"
            alt="AEXYL"
            width={874}
            height={150}
            priority
            className="h-3 w-auto transition-transform group-hover:scale-105"
          />
          <span className="font-mono-code text-[10px] text-text-muted tracking-widest uppercase">OS v2.4</span>
        </Link>
      </div>

      {/* Navigation Groups (scrollable; brand + footer stay pinned) */}
      <div className="flex-1 space-y-6 px-3 py-4 overflow-y-auto scrollbar-thin">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 pb-1.5 text-[10px] font-mono-code tracking-[0.08em] text-text-muted/70 uppercase">
              {section.title}
            </div>
            {section.items.map((item) => {
              const isActive = item.exact 
                ? pathname === item.href 
                : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150",
                    isActive
                      ? "bg-primary/15 text-text-primary border border-primary/30 shadow-[0_0_20px_rgba(43,102,255,0.15)]"
                      : "text-text-secondary hover:bg-surface-high/50 hover:text-text-primary border border-transparent"
                  )}
                >
                  <div className="flex items-center space-x-2.5">
                    <item.icon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive ? "text-primary" : "text-text-muted group-hover:text-text-secondary"
                      )}
                    />
                    <span>{item.name}</span>
                  </div>

                  {item.badge && (
                    <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono-code text-[9px] text-primary">
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

                  {isActive && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 rounded-l-full bg-primary" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer System Quick Action */}
      <div className="shrink-0 p-3 border-t border-border-subtle/50">
        <Link
          href="/settings"
          className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary/15 text-text-primary border border-primary/30"
              : "text-text-secondary hover:bg-surface-high/50 hover:text-text-primary border border-transparent"
          )}
        >
          <div className="flex items-center space-x-2.5">
            <Settings className={cn("h-4 w-4", pathname.startsWith("/settings") ? "text-primary" : "text-text-muted")} />
            <span>Settings & Rules</span>
          </div>
          <kbd className="font-mono-code text-[10px] text-text-muted bg-surface-high px-1.5 py-0.5 rounded border border-border-subtle">
            ⌘S
          </kbd>
        </Link>
      </div>
    </aside>
  );
}
