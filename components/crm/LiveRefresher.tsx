"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps server-rendered pages live: revalidates the current route on an
 * interval (and when the tab regains focus) so lists reflect database state
 * in near real-time, complementing the SSE telemetry on the dashboard.
 */
export function LiveRefresher({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        router.refresh();
      }, intervalMs);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
