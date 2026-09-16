"use client";

import Link from "next/link";
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
  FolderKanban, 
  Sparkles, 
  Bot,
  BellRing, 
  Settings
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: string;
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
    ]
  },
  {
    title: "SALES & OUTREACH",
    items: [
      { name: "Leads", href: "/sales/leads", icon: Users },
      { name: "Pipeline", href: "/sales/pipeline", icon: Kanban },
      { name: "Companies", href: "/sales/companies", icon: Briefcase },
      { name: "Contacts", href: "/sales/contacts", icon: Users },
      { name: "Deals", href: "/sales/deals", icon: Kanban },
      { name: "Outreach Engine", href: "/outreach", icon: Send },
    ]
  },
  {
    title: "OPERATIONS",
    items: [
      { name: "Clients Directory", href: "/sales/companies", icon: Briefcase },
      { name: "Projects Directory", href: "/projects", icon: FolderKanban },
    ]
  },
  {
    title: "INTELLIGENCE",
    items: [
      { name: "Executive Matrix", href: "/intelligence", icon: Sparkles, badge: "AI" },
      { name: "Attention Required", href: "/attention", icon: BellRing },
      { name: "Aexyl Agents", href: "/agents", icon: Bot },
    ]
  }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[260px] flex-col bg-surface-lowest border-r border-border-subtle overflow-y-auto select-none">
      {/* Brand Header */}
      <div className="flex h-16 items-center px-6 border-b border-border-subtle/50">
        <Link href="/" className="flex items-center space-x-3 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-[0_0_15px_rgba(43,102,255,0.4)] transition-transform group-hover:scale-105">
            <span className="font-bold text-sm tracking-wider">A</span>
          </div>
          <div>
            <span className="font-semibold text-sm tracking-tight text-text-primary block">AEXYL</span>
            <span className="font-mono-code text-[10px] text-text-muted tracking-widest block uppercase">OS v2.4</span>
          </div>
        </Link>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 space-y-6 px-3 py-4">
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
      <div className="p-3 border-t border-border-subtle/50">
        <Link
          href="/settings"
          className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-text-secondary hover:bg-surface-high/50 hover:text-text-primary transition-colors"
        >
          <div className="flex items-center space-x-2.5">
            <Settings className="h-4 w-4 text-text-muted" />
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
