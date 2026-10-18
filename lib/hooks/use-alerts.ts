"use client";

import { useEffect, useState } from "react";

export interface AlertItem {
  id: string;
  type: string;
  content: { title?: string; body?: string | null; link?: string | null };
  readAt: string | null;
  createdAt: string;
}

export interface Alerts {
  pending: number;
  failedRuns: number;
  attention: number;
  unread: number;
  items: AlertItem[];
}

const EMPTY: Alerts = { pending: 0, failedRuns: 0, attention: 0, unread: 0, items: [] };
const POLL_MS = 60_000;

// One tab-wide poller shared by the sidebar, header badge and notification bell.
let snapshot: Alerts = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<(a: Alerts) => void>();

/** Fetches a fresh snapshot now (e.g. after marking notifications read). */
export async function refreshAlerts() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch("/api/crm/alerts", { cache: "no-store" });
    if (res.ok) {
      snapshot = { ...EMPTY, ...((await res.json()) as Partial<Alerts>) };
      listeners.forEach((l) => l(snapshot));
    }
  } catch {
    // Non-critical chrome: keep the last snapshot.
  } finally {
    inFlight = false;
  }
}

function onVisible() {
  if (document.visibilityState === "visible") void refreshAlerts();
}

export function useAlerts(): Alerts {
  const [alerts, setAlerts] = useState<Alerts>(snapshot);

  useEffect(() => {
    listeners.add(setAlerts);
    if (!timer) {
      void refreshAlerts();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refreshAlerts();
      }, POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      listeners.delete(setAlerts);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  return alerts;
}
