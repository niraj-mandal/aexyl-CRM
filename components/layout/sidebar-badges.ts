"use client";

import { useAlerts } from "@/lib/hooks/use-alerts";

export interface SidebarBadgeCounts {
  /** Agent actions awaiting approval (badge on "Aexyl Agents"). */
  approvals: number;
  /** HIGH/WARNING pipeline risks (badge on "Insights"). */
  attention: number;
  /** Unread in-app notifications. */
  notifications: number;
}

/** Sidebar badge counts, read from the shared alerts poller (one request per minute for all chrome). */
export function useSidebarBadges(): SidebarBadgeCounts {
  const a = useAlerts();
  return { approvals: a.pending, attention: a.attention, notifications: a.unread };
}
