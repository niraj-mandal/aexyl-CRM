"use client";

import { useEffect, useState } from "react";

export interface StageCount {
  count: number;
  value: number;
}

export interface RealtimeStats {
  pipelineRevenue: number;
  totalPipelineValue: number;
  activeLeads: number;
  hotLeads: number;
  activeDeals: number;
  activeCompanies: number;
  winRate: string;
  pipelineHealth: string;
  stageCounts: Record<string, StageCount>;
  latencyMs: number;
  updatedAt: string;
  user: { firstName: string | null; lastName: string | null };
}

export interface TelemetryState {
  connected: boolean;
  stats: RealtimeStats | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Shared poller singleton.
// One tab-wide interval fetches /api/crm/telemetry and fans the result out to
// every subscriber component. Polling (unlike long-lived SSE connections) never
// pins server workers — a stream held open for minutes is what exhausted the
// Turbopack worker pool and crashed dev with "Jest worker encountered N child
// process exceptions".
// ---------------------------------------------------------------------------
type StatsListener = (stats: RealtimeStats) => void;
type ConnListener = (connected: boolean) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let lastStats: RealtimeStats | null = null;
let isConnected = false;
let lastError: string | null = null;
const statsListeners = new Set<StatsListener>();
const connListeners = new Set<ConnListener>();

function parseStats(data: Record<string, unknown>): RealtimeStats {
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  return {
    pipelineRevenue: num(data.pipelineRevenue),
    totalPipelineValue: num(data.totalPipelineValue),
    activeLeads: num(data.activeLeads),
    hotLeads: num(data.hotLeads),
    activeDeals: num(data.activeDeals),
    activeCompanies: num(data.activeCompanies),
    winRate: str(data.winRate, "—"),
    pipelineHealth: str(data.pipelineHealth, "—"),
    stageCounts:
      data.stageCounts && typeof data.stageCounts === "object"
        ? (data.stageCounts as Record<string, StageCount>)
        : {},
    latencyMs: num(data.latencyMs),
    updatedAt: str(data.updatedAt, new Date().toISOString()),
    user:
      data.user && typeof data.user === "object"
        ? (data.user as RealtimeStats["user"])
        : { firstName: null, lastName: null },
  };
}

function notifyStats(stats: RealtimeStats) {
  lastStats = stats;
  lastError = null;
  statsListeners.forEach((fn) => fn(stats));
}

function notifyConn(connected: boolean) {
  if (isConnected === connected) return;
  isConnected = connected;
  connListeners.forEach((fn) => fn(connected));
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch("/api/crm/telemetry", { cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      lastError = body?.error || `Telemetry request failed (${res.status})`;
      notifyConn(false);
      return;
    }
    const body = (await res.json()) as { success: boolean; data?: Record<string, unknown> };
    if (body.success && body.data) {
      notifyConn(true);
      notifyStats(parseStats(body.data));
    }
  } catch {
    lastError = "Telemetry stream unreachable";
    notifyConn(false);
  } finally {
    inFlight = false;
  }
}

function ensurePolling() {
  if (timer || typeof window === "undefined") return;
  void poll(); // immediate first fetch
  timer = setInterval(() => {
    // Pause while the tab is hidden — no point burning requests in background
    if (document.visibilityState === "visible") void poll();
  }, POLL_INTERVAL_MS);
}

function releaseIfIdle() {
  if (statsListeners.size === 0 && connListeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Live CRM telemetry, polled every 5 seconds from real workspace data.
 * One shared poller per tab; components subscribe to the same snapshot.
 */
export function useRealtimeTelemetry() {
  const [state, setState] = useState<TelemetryState>(() => ({
    connected: isConnected,
    stats: lastStats,
    error: lastError,
  }));

  useEffect(() => {
    const onStats: StatsListener = (stats) => {
      setState({ connected: true, stats, error: null });
    };
    const onConn: ConnListener = (connected) => {
      setState((prev) => ({ ...prev, connected, error: connected ? null : prev.error }));
    };

    statsListeners.add(onStats);
    connListeners.add(onConn);
    ensurePolling();

    // Hydrate lazily from the shared cache when a poller already ran
    if (lastStats) {
      const cached = lastStats;
      queueMicrotask(() => setState({ connected: isConnected, stats: cached, error: null }));
    }

    return () => {
      statsListeners.delete(onStats);
      connListeners.delete(onConn);
      releaseIfIdle();
    };
  }, []);

  return {
    stats: state.stats,
    connected: state.connected,
    error: state.error,
    latencyMs: state.stats?.latencyMs ?? 0,
  };
}
