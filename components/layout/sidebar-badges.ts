"use client";

import { useEffect, useState } from "react";
import {
  actionNeededSummaryAction,
  attentionCountAction,
} from "@/app/actions/agents.actions";
import { listNotificationsAction } from "@/app/actions/production.actions";

export interface SidebarBadgeCounts {
  /** Agent actions awaiting approval (badge on "Aexyl Agents"). */
  approvals: number;
  /** HIGH/WARNING pipeline risks (badge on "Attention Required"). */
  attention: number;
  /** Unread in-app notifications (badge on "Notifications"). */
  notifications: number;
}

/**
 * One poller feeding every sidebar badge so the nav doubles as an alert
 * surface. Counts come from the same server actions the destination pages
 * render, so badges never disagree with the pages. Non-critical chrome:
 * individual failures degrade that count to 0 instead of breaking the poll.
 */
export function useSidebarBadges(pollMs = 30_000): SidebarBadgeCounts {
  const [badges, setBadges] = useState<SidebarBadgeCounts>({
    approvals: 0,
    attention: 0,
    notifications: 0,
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [summary, attention, notifications] = await Promise.allSettled([
        actionNeededSummaryAction(),
        attentionCountAction(),
        listNotificationsAction(),
      ]);
      if (!alive) return;
      setBadges({
        approvals: summary.status === "fulfilled" ? summary.value.pending : 0,
        attention: attention.status === "fulfilled" ? attention.value.count : 0,
        notifications:
          notifications.status === "fulfilled" ? notifications.value.unread : 0,
      });
    };
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pollMs]);

  return badges;
}
