/**
 * Aexyl client observability (Next.js instrumentation-client hook).
 *
 * Until NEXT_PUBLIC_SENTRY_DSN is configured this file initializes nothing —
 * zero network calls, zero behavior change. With a DSN, client-side React
 * errors and unhandled rejections are captured with release/environment tags.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Modest sampling: errors are always captured; traces are diagnostic only.
    tracesSampleRate: 0.1,
  });
}
