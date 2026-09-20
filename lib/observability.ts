/**
 * Aexyl observability — error capture that is honest about being optional.
 *
 * Sentry is wired in only when a DSN exists. Without one these helpers are
 * no-ops, so local dev and self-hosted deploys never gain a hard dependency
 * on an external SaaS. Never import Sentry statically here: a broken or
 * missing SDK must not take the app down.
 */

let clientInitialized = false;

export function isObservabilityEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Fire-and-forget server-side error capture. Never throws. */
export async function captureError(error: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    if (!process.env.SENTRY_DSN) return;
    const Sentry = await import("@sentry/nextjs");
    if (!clientInitialized) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
        tracesSampleRate: 0.1,
      });
      clientInitialized = true;
    }
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Observability must never break the operation it observes.
  }
}
