# Deploying Aexyl CRM to Vercel + Neon

Target stack (total ₹0/month, free tiers):

| Piece | Service | Plan |
|---|---|---|
| Web app | [Vercel](https://vercel.com) | Hobby (free) |
| Postgres (+ pgvector) | [Neon](https://neon.com) | Free |
| Automation heartbeat | [cron-job.org](https://cron-job.org) | Free |
| Rate limiting | [Upstash Redis](https://upstash.com) (optional but recommended) | Free |

> **Honest caveats:** Vercel Hobby is non-commercial per its ToS — fine for
> evaluation, move to Pro ($20/mo) or Railway ($5/mo) when Aexyl becomes your
> daily business driver. Serverless cold starts add a few seconds after
> inactivity. Neon's free DB auto-pauses after ~5 idle minutes (first request
> wakes it).

---

## Phase 0 — Repo prep (done)

- All commits pushed to `main` (GitHub Actions CI runs tsc, eslint, migrations
  and the 52-check agent scenario suite on every push).
- `vercel.json` intentionally has **no `crons`** — Vercel Hobby allows at most
  daily schedules, but `/api/cron/tick` must run every 15 minutes, so it is
  triggered externally (Phase 5).

## Phase 1 — Neon Postgres

1. Sign in at **https://neon.com** with GitHub → **Create project**.
2. Region: `aws ap-south-1` (Mumbai) — closest to India.
3. **Dashboard → Connection Details** → select **Pooled connection** → copy.
4. The string looks like
   `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
   — the `-pooler` host is **mandatory** for serverless (direct endpoints
   exhaust connections under serverless load).
5. pgvector is included on Neon free — nothing to enable.

This string is `DATABASE_URL`.

## Phase 2 — Vercel project

1. **https://vercel.com/new** → sign in with GitHub → **Import**
   `niraj-mandal/aexyl-CRM`.
2. Framework preset auto-detects **Next.js** — leave build defaults. Don't
   deploy yet.
3. **Environment Variables** — add every variable below (values from local
   `.env.local` unless noted):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** string (Phase 1) |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from `.env.local` (production keys in Phase 3) |
   | `CLERK_SECRET_KEY` | from `.env.local` |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | from `.env.local` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | from `.env.local` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | from `.env.local` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | from `.env.local` |
   | `OPENROUTER_API_KEY` | from `.env.local` |
   | `AEXYL_LLM_MODEL` | from `.env.local` |
   | `BREVO_API_KEY` | from `.env.local` |
   | `EMAIL_FROM` | from `.env.local` (sender must be verified in Brevo) |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-app>.vercel.app` (set after first deploy) |
   | `CRON_SECRET` | `openssl rand -hex 32` — generate fresh |
   | `BREVO_WEBHOOK_TOKEN` | from `.env.local` (or generate fresh) |
   | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | optional — leave empty initially |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | recommended — from Upstash REST Redis |

   With Upstash set, the rate limiter automatically switches from in-memory
   (per-instance) to Redis (cross-instance) — required for serverless.
4. Click **Deploy** (~2–3 min first build).

## Phase 3 — Clerk production keys

Local dev uses Clerk **dev-instance** keys (`pk_test_…`). For production:

1. **https://dashboard.clerk.com** → your app → **API Keys** → copy the
   `pk_live_…` / `sk_live_…` pair → replace the two Clerk vars in Vercel.
2. **Configure → Domains** → add `https://<your-app>.vercel.app`
   (or connect the Clerk integration from Vercel's Integrations tab — it
   syncs the domain automatically).
3. Redeploy (Deployments → ⋯ → Redeploy) so the new vars take effect.

## Phase 4 — Database migration (one-time)

From the repo root:

```bash
DATABASE_URL="<neon pooled url>" npm run db:migrate   # applies db/migrations/0000_init.sql
DATABASE_URL="<neon pooled url>" npm run db:seed      # workspace + roles bootstrap
```

Never `db:push` against production — migrations are the only path (see
`docs/backup-dr.md` for the safety procedure).

**Existing local data:** the dev DB's real records (leads, companies,
approvals) are not moved by migrate/seed. To clone them into Neon:

```bash
docker exec aexyl-postgres pg_dump -U postgres -d aexyl --data-only \
  -T vehicles -T vehicle_locations -T deliveries > /tmp/aexyl-data.sql
psql "<neon pooled url>" < /tmp/aexyl-data.sql
```

(Exclude the three orphan tables from the old project iteration.)

## Phase 5 — Automation heartbeat (external cron)

1. **https://cron-job.org** → free account → **Create cronjob**.
2. URL: `https://<your-app>.vercel.app/api/cron/tick`
3. Schedule: **every 15 minutes**.
4. Add header: `Authorization` = `Bearer <CRON_SECRET>` (the value from Phase 2).
5. Save → **Run now** → expect HTTP 200 with
   `{"ok":true,"workspacesProcessed":…,"eventsProcessed":…}` in the job log.

Without this, agents and follow-up sweeps only fire when someone has the
dashboard open (page-load opportunistic processing). The endpoint is
idempotent — calling it more often is safe.

## Phase 6 — Brevo (email + webhooks)

1. **Senders, Domains & Dedicated IPs → Webhooks** → transactional webhook
   URL: `https://<your-app>.vercel.app/api/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>`
   (events: opened, clicked, bounced, blocked, spam).
2. **Senders & IP whitelist → Security → Authorised IPs**: **disable IP
   restriction**. Vercel's egress IPs are dynamic and change per invocation —
   a static allowlist will break email delivery unpredictably. The API key is
   already the secret.
3. Confirm `EMAIL_FROM` matches a **verified sender** in Brevo.

## Phase 7 — Verification checklist

| Check | How | Expected |
|---|---|---|
| Health | `GET /api/health` | `{"status":"ok","db":"reachable"}` |
| Auth | visit `/`, sign in via Clerk | redirects to Command Center |
| Data | leads page renders | seeded/imported rows visible |
| Cron | cron-job.org "Run now" | 200 + `eventsProcessed` |
| Email | Settings → Team → invite yourself | delivered; Brevo events show it |
| Webhook | POST `/api/webhooks/brevo` without token | 401 |
| CSV | leads page → Export CSV | downloads 50-page-paginated data |
| Rate limit | hammer an endpoint | 429 once over limit (Upstash path) |

## Rollback / removal

- Redeploy any previous build from Vercel's Deployments list (instant).
- Neon keeps point-in-time history (free tier: 6h) — restore from the Neon
  console if a migration goes wrong.
