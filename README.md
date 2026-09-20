# Aexyl — Agency Operating System

Aexyl is an internal agency operating system: a single, premium workspace where an agency runs its entire business — CRM, client delivery, business intelligence, and a controlled agentic layer that can observe the business, reason about it, and execute approved actions.

Built with **Next.js (App Router) · React 19 · TypeScript · PostgreSQL + Drizzle ORM · Clerk auth · Tailwind v4**.

> Every surface is backed by real database records — no mock data, no fake AI responses, no hallucinated actions.

---

## What Aexyl does

| Layer | Capability |
|---|---|
| **CRM** | Companies, contacts, leads, deals, kanban pipeline, activities timeline, follow-up scheduling |
| **Delivery** | Clients, projects, milestones, requirements, tasks with dependencies, workload view, project health |
| **Intelligence** | Command Center with live telemetry, attention items, insights, recommendations, event-driven intelligence |
| **AI Copilot** | Conversational assistant grounded in workspace data, with conversation memory and confirm-gated write actions |
| **Lead discovery** | Two chat-driven prospecting pipelines that import straight into the CRM: (1) **Web-search discovery** — describe an ICP, the engine searches the web, scrapes candidate sites, extracts structured data, and LLM-scores fit for general B2B prospecting; (2) **Local discovery (OpenStreetMap)** — free and keyless: geocodes the city (Nominatim) and queries Overpass for businesses by category (gyms, cafes, clinics…), qualifying them on the missing-web-presence signal — no website AND no phone = Hot, no website = Warm, has website = Cold — with optional LLM-suggested outreach angles, clearly labeled as suggestions. The Scout agent can call both via its research tools |
| **Agents** | Six autonomous agents (Scout, Sales, Outreach, Follow-up, Operations, Executive) running on a governed runtime — plans, typed tools, approval gates, traces, budgets |
| **Operations** | Integrations registry with real connectors, feature flags, notifications, observability dashboard, incidents, health checks, rate limiting, backups |

---

## Architecture: the six phases

Aexyl was built in deliberate layers — each phase builds on the previous one without rebuilding it:

```
Phase 1 — FOUNDATION      Auth (Clerk), workspaces, RBAC, design system (liquid glass)
Phase 2 — CRM             Leads → contacts → companies → deals → pipeline → activities
Phase 3 — OPERATIONS      Clients → projects → milestones → requirements → tasks → workload
Phase 4 — INTELLIGENCE    Events → insights → attention → Command Center → recommendations
Phase 5 — AGENTS          Agent runtime, tool registry, policy engine, approvals, traces, memory
Phase 6 — PRODUCTION      Integrations, feature flags, observability, incidents,
                          notifications, revenue intelligence, hardening, backup/DR
```

The agentic core principle: **agents never touch the database directly and never drive the UI.**

```
Event → Intelligence → Agent trigger → Reasoning → Plan
      → Tool selection → Schema validation → Permission & policy checks
      → Approval (when required) → Execution → Validation
      → Audit log → New event → Intelligence ↺
```

Key guarantees:

- **Typed tools only** — agents act through a tool registry (Zod-validated schemas, permission + risk metadata). No raw SQL, ever.
- **Autonomy levels L0–L4** — observe → recommend → prepare → execute-approved → (controlled autonomous). Conservative defaults; L4 is disabled.
- **Human approval** — risky actions (e.g. sending email) create an approval request that a human must grant; nothing is executed silently.
- **Untrusted external content** — scraped/fetched data is treated strictly as data, with prompt-injection defenses.
- **Idempotency, rate limits, cost budgets, kill switch** — per-run, per-agent, and per-workspace limits; a workspace-level emergency stop.
- **Full auditability** — every run has step traces; every mutation produces a receipt and an audit entry.

Deep dives: [`docs/architecture.md`](docs/architecture.md) · [`docs/agents.md`](docs/agents.md) · [`docs/security.md`](docs/security.md) · [`docs/backup-dr.md`](docs/backup-dr.md)

---

## Getting started

### Prerequisites

- **Node.js 20+**
- **PostgreSQL 14+** — the easiest way is Docker:
  ```bash
  docker run --name aexyl-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aexyl -p 5432:5432 -d postgres:16
  ```

### 1. Install

```bash
git clone https://github.com/niraj-mandal/aexyl-CRM.git
cd aexyl-CRM
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local` (see [Environment variables](#environment-variables) below). Only `DATABASE_URL` and the Clerk keys are required to boot.

### 3. Create the schema

Two supported paths:

```bash
npm run db:migrate   # preferred: apply the versioned SQL migrations in db/migrations/
npm run db:push      # dev-only convenience: sync schema directly (can drop data)
```

**Migration workflow (production):** edit `db/schema.ts` → `npm run db:generate`
(review the generated SQL in `db/migrations/`) → `npm run db:migrate` on staging →
verify → `npm run db:migrate` on production. `db:push` is a dev convenience only —
it never runs against staging/prod.

### 4. (Optional) Seed demo workspace

```bash
npm run db:seed
```

Inserts a starter workspace with roles/permissions and a small set of CRM records so the UI isn't empty on first run.

### 5. Run

```bash
npm run dev        # http://localhost:3000
```

Sign in with Clerk, and the workspace bootstraps itself (agents, feature flags, and default policies are registered per-workspace on first use).

### Production build

```bash
npm run build && npm start
```

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR against an ephemeral Postgres 16:
`npm ci` → `drizzle-kit migrate` (proves the migration chain replays cleanly) →
`tsc --noEmit` → `eslint` → the 52-check agent scenario suite. Nothing merges broken.

## Inbound email webhooks (Brevo)

Point a Brevo transactional webhook at:

```
POST https://<host>/api/webhooks/brevo?token=<BREVO_WEBHOOK_TOKEN>
```

Open/click/bounce/spam/unsubscribe events are matched to the recipient's contact,
and a real EMAIL activity lands on the lead's timeline — so the follow-up engine
stops blind-sending unresponsive contacts and can see engagement. Token-gated;
invalid tokens get 401; processing is fail-soft (always 200 on valid tokens).

---

## Environment variables

`.env.local` is git-ignored — never commit real values. `.env.example` documents the placeholders.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://postgres:postgres@localhost:5432/aexyl` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (`pk_test_…` / `pk_live_…`) |
| `CLERK_SECRET_KEY` | Clerk secret key (`sk_test_…` / `sk_live_…`) |

Clerk route variables (`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`, etc.) are in `.env.example` with sensible defaults.

### Optional — LLM provider (AI Copilot + agents)

Aexyl talks to model providers through one gateway (`lib/ai/gateway.ts` → `services/ai/llm.service.ts`). It picks the first provider whose key is present, in this order:

| Variable | Default model |
|---|---|
| `OPENAI_API_KEY` | `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | `claude-3-5-haiku` |
| `GEMINI_API_KEY` | `gemini-2.0-flash` |
| `OPENROUTER_API_KEY` | `meta-llama/llama-3.1-8b-instruct` |

Override the model on any provider with `AEXYL_LLM_MODEL` (e.g. a larger OpenRouter model). With **no** key, the app still runs — the copilot falls back to deterministic data-driven answers and agents use their deterministic planners; the UI honestly shows the LLM as offline. Never expose any of these keys to the client.

### Local lead discovery (OpenStreetMap — no key needed)

The local-business pipeline (`services/ai/local-lead-discovery.service.ts`) uses free public OpenStreetMap services — **no API key, no billing**: [Nominatim](https://nominatim.openstreetmap.org) geocodes the city and [Overpass](https://overpass-api.de) queries businesses by category tag. The service respects both services' usage policies (descriptive User-Agent, ~1 req/s geocoding queue, polite Overpass pacing, QL-level timeout). The Scout agent calls it via `research.discover_local_leads`.

### Optional — Email (team invites, notifications)

| Variable | Description |
|---|---|
| `BREVO_API_KEY` | [Brevo](https://app.brevo.com) transactional API key (SMTP & API page) — primary provider when set; sender must be verified in the Brevo dashboard |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key — fallback provider; enables real invite-email delivery when Brevo is not configured |
| `EMAIL_PROVIDER` | Optional explicit `brevo` or `resend`; otherwise Brevo wins when both keys exist |
| `EMAIL_FROM` | Verified sender address, e.g. `Aexyl <onboarding@resend.dev>` (Brevo: verify it in the dashboard first) |

### Optional — App URL

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL used in invite links and emails (defaults to the request origin in dev) |

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npm run db:push` | Push Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations |
| `npm run db:seed` | Seed demo workspace |
| `npm test` | Agent scenario test suite (runs against the real DB in `.env.local`) |

## Testing

`npm test` executes the agent scenario suite (`tests/agents.scenarios.ts`) against a dedicated ephemeral workspace — it never touches live data. It covers policy enforcement, autonomy levels, tool allowlists, approval gates, idempotency, cost/budget stops, execution windows, domain blocklists, the stale-run reaper, kill switch, and prompt-injection handling.

## Operations

- **Health check**: `GET /api/health` → `{ "status": "ok", "db": "reachable" }` (exempt from auth for uptime probes)
- **Backups**: `bash scripts/backup-db.sh` — pg_dump with retention pruning; runbook in [`docs/backup-dr.md`](docs/backup-dr.md)
- **Integrations**: `/settings/integrations` — connect/disconnect connectors (email, etc.) with status, verification, and audit
- **Agent controls**: `/agents` (registry), `/agents/approvals`, `/agents/observability`, per-agent settings with autonomy, tool allowlists, and budgets

## Project structure

```
app/            Routes (App Router): dashboard, CRM, projects, agents, settings, APIs
agents/         Agent registry, runtime, policy engine, tools, context, traces
services/       Domain services (crm, calendar, intelligence, revenue, integrations, ai)
components/     UI: layout, glass design system, CRM, agents, settings
lib/            Auth/workspace, permissions, AI gateway, rate limiting, hooks
db/             Drizzle schema, migrations, seed
docs/           Architecture, agents, security, backup/DR
scripts/        Backup and maintenance scripts
tests/          Agent scenario suite, live verification scripts
```

## Security notes

- Secrets live only in `.env.local` (git-ignored) or a proper secret manager — never in source, logs, or model context.
- Every query is workspace-scoped; agents inherit RBAC and can only call tools their policy allows.
- See [`docs/security.md`](docs/security.md) for the threat model (IDOR, injection, prompt injection, secret handling) and [`docs/backup-dr.md`](docs/backup-dr.md) for the Backup → Restore → Verify procedure.
