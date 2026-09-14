# Aexyl Architecture

Aexyl is an internal agency operating system: CRM, delivery, intelligence, and
a controlled agentic layer — one Next.js app over PostgreSQL (Drizzle ORM),
auth via Clerk, AI via OpenRouter behind a gateway.

## System map

```
UI (Next.js App Router, server components + server actions)
  ↓
Server Actions / API routes        ← auth via Clerk; requireWorkspace() scoping
  ↓
Domain services (crm, sales, revenue-intelligence, notification, integrations)
  ↓
Agent layer (agents/*)             ← runs, tools, policies, approvals
  ↓
PostgreSQL (Drizzle)               ← single source of truth
```

## Layers

### 1. Foundation
- **Auth:** Clerk sessions; every data path funnels through
  `requireWorkspace()` → `{ userId, workspaceId }`. All queries filter by
  `workspaceId` — cross-workspace access is structurally prevented by scoping,
  not by UI.
- **RBAC:** workspace memberships + roles; agent permissions extend this
  (`agents.run`, `agents.approve`, tool-level permissions).
- **Design system:** liquid-glass Apple-inspired components
  (`components/ui/*`), shared typography (`Display`, `PageTitle`, `MonoLabel`).

### 2. CRM (Phase 2)
Leads, companies, contacts, deals, pipeline, activities. Mutations flow
through `app/actions/crm.actions.ts` → `services/crm.service.ts`, write
`audit_logs` entries, and publish domain events.

### 3. Delivery (Phase 3)
Clients, projects, milestones, requirements, tasks (with the `tasks` table
surfacing in My Day), workload views.

### 4. Intelligence (Phase 4)
Pipeline audit, attention items, insights, realtime telemetry
(`/api/crm/telemetry`), event-driven triggers. The Command Center renders live
data only — no static filler.

### 5. Agents (Phase 5)
```
agents/
  core/
    registry/tools.ts     typed tool registry (Zod schemas, risk, approval flags)
    policies/engine.ts    policy engine: kill switch, autonomy, budgets, windows
    runtime/runtime.ts    run lifecycle, traces, validation, receipts
    runtime/reaper.ts     stale-run reaper + failure-spike incidents
    context/builder.ts    minimal per-agent context assembly (no secrets)
  events/bus.ts           event → agent dispatch with dedupe + cooldowns
  services/
    approvals.service.ts  approval lifecycle + idempotent execute-on-approve
    runner.service.ts     registry → runtime bridge, LLM planners
  registry.ts             6 agents (Scout, Sales, Outreach, Follow-up,
                          Operations, Executive) + provisioning
```

Key invariants:
- **Agents never touch the DB directly** — only via registered tools, which
  validate inputs (Zod), check permissions, and are audited.
- **Every model call goes through `lib/ai/gateway.ts`** — provider abstraction,
  structured output validation, usage/cost capture to `agent_usage`, budget
  enforcement.
- **No hallucinated actions:** a mutation only "happened" when its tool
  returned success; plans degrade unknown tool IDs to analysis steps.
- **External content is untrusted data** (`fenceExternalContent`), never
  instructions.

Run lifecycle: `QUEUED → INITIALIZING → CONTEXT_LOADING → PLANNING →
EXECUTING → VALIDATING → COMPLETED`, with `FAILED`, `CANCELLED`,
`STOPPED_BY_POLICY`, `ESCALATED` failure paths. Approvals gate risky tools;
execution on approval is idempotent (receipt-checked).

### 6. Production layer (Phase 6)
- **Reliability:** stale-run reaper (no agent stuck RUNNING), failure-spike
  incident auto-open, rate limits on AI/telemetry APIs (`lib/rate-limit.ts`),
  health probe (`/api/health`), structured logger (`lib/logger.ts`).
- **Guardrails:** autonomy levels L0–L4 (defaults conservative), per-agent
  monthly budget → agent `PAUSED`, per-tool policy overrides, execution
  windows, action budgets.
- **Integrations:** connector registry (`services/integrations/registry.ts`)
  with connect/disconnect/verify; Resend live for email, others honest about
  requiring external setup. `/settings/integrations` UI + workspace feature
  flags (`lib/flags.ts`).
- **Observability:** `/agents/observability` — run/tool/approval aggregates,
  AI spend, incidents. Run detail pages carry traces and a 👍/👎 human
  feedback loop (`agent_feedback`).
- **Revenue & predictive intelligence:** `services/revenue-intelligence.service.ts`
  computes weighted pipeline, win rate, velocity, 30-day forecast, and
  evidenced risks; feeds the daily operating brief on the Command Center.
- **Notifications:** `services/notification.service.ts` + header bell;
  approvals, failures, incidents, and kill-switch events notify users.
- **Backups/DR:** see `docs/backup-dr.md`.

## Data model (core tables)

`workspaces, users, workspace_memberships, roles, companies, contacts, leads,
deals, activities, projects, milestones, requirements, tasks, audit_logs,
notifications, agents, agent_runs, agent_traces, agent_approvals, agent_memory,
agent_usage, agent_events, automation_rules, agent_feedback, incidents,
integration_connections, feature_flags, workspace_invites`

Everything workspace-scoped with FKs and timestamps; hot paths indexed on
`(workspace_id, status, created_at)`.

## Security model

- Workspace isolation via `requireWorkspace()` scoping on every query/action.
- Server-held write tokens for copilot actions (client never sees payloads).
- Approval system for risky agent tools; approvals are single-use and audited.
- Secrets only in `.env.local` (never committed, never in prompts/logs/agent
  context). OAuth tokens (future providers) live server-side in
  `integration_connections`, never exposed to the model.
- Prompt-injection defense: external content fenced as data; tool arguments
  validated; unknown/destructive tool requests rejected by policy.

## Where things live

| Concern | Path |
| --- | --- |
| Pages | `app/(app)/*` (dashboard, my-day, pipeline, projects, agents, settings) |
| Server actions | `app/actions/*` |
| API routes | `app/api/*` (health, telemetry, AI endpoints) |
| Agent runtime | `agents/core/*`, `agents/services/*`, `agents/events/*` |
| Tools | `agents/core/registry/tools.ts` |
| Domain services | `services/*` |
| Tests | `tests/agents.scenarios.ts` (`npm run test`) |
| Backups | `scripts/backup-db.sh`, `docs/backup-dr.md` |
