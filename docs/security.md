# Aexyl Security Model

## Identity & access

- **Authentication:** Clerk-managed sessions. No passwords stored locally.
- **Authorization:** every server action and API route calls
  `requireWorkspace()` and receives `{ userId, workspaceId }`. All queries
  filter on `workspaceId`. Workspace isolation is enforced at the query layer,
  not the UI layer.
- **RBAC:** workspace roles govern member capabilities; agent capabilities are
  separate (`agents.run`, `agents.approve`, tool permissions) and assignable by
  owners/admins in `/agents/[id]`.

## Data isolation

- Every table carries `workspace_id`; the agent runtime, tools, and services
  resolve entities **by workspace-scoped queries only**. Cross-workspace ID
  access returns "not found".
- Copilot write-actions use **server-held single-use tokens** — the client
  never receives proposal payloads, only a token + human-readable summary.
  Confirmations older than the token TTL or younger than the human-pace
  minimum-age gate are rejected and the token is burned.

## Agent safety

- No raw SQL from agents — tools with Zod-validated arguments only.
- Policy engine enforces: kill switch, autonomy level, tool allowlist, budgets
  (run + monthly), rate/action limits, execution windows, idempotency.
- Risky tools require approval; approvals are single-use with receipts;
  replays are rejected.
- Unknown or unallowed tool IDs in a plan are degraded or blocked — never
  executed blindly.
- Every mutation is audited (`audit_logs`, `agent_traces`) with receipts.

## Untrusted content

External content (web pages, lead descriptions, emails) is **data, never
instructions**:

- `fenceExternalContent` wraps fetched content in delimiters and strips
  instruction-like framing.
- Fetched web content cannot redefine system prompts, permissions, or policies.
- Model output is schema-validated (Zod) before execution; free-form text is
  never treated as a command stream.

## Secrets

- Secrets live in `.env.local` (gitignored) — never committed.
- Secrets are never placed in model context, logs, traces, or agent memory.
- Provider keys (OpenRouter, Resend) are read server-side only.
- OAuth tokens (future integrations) are stored server-side in
  `integration_connections.metadata` with restricted columns; never returned
  to the client or model.

## API hardening

- All mutating API routes require an authenticated workspace session.
- Rate limiting (`lib/rate-limit.ts`) on expensive endpoints: AI copilot
  (20/min/user), pipeline audit (6/min/user), telemetry (120/min/user).
- Prompt size bounded (2 KB) on the copilot route.
- `/api/health` exposes only non-sensitive status.

## AI cost & abuse controls

- Per-run token limits and per-agent cost caps enforced in the gateway and
  policy engine; monthly budget breach pauses the agent.
- Workspace-level kill switch stops all agent activity instantly and is
  audited + notified.

## Reporting & incidents

Security issues → engage kill switch → create/inspect incident at
`/agents/observability` → preserve evidence (traces, audit logs) before
remediation → resolve with a root-cause note. See `docs/backup-dr.md` for the
snapshot-before-remediation rule.
