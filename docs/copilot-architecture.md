# AEXYL Copilot — Architecture & CRM Mapping

The AEXYL copilot is an AI operating layer **on top of** the existing CRM. It does not
replace any CRM subsystem: it reads live workspace data through the existing service
layer and writes only through a proposal-and-confirmation protocol that is fully
audited. This document maps the copilot spec onto the real implementation.

## Request flow (ASK → UNDERSTAND → SHOW EVIDENCE → RECOMMEND → ACT)

```
USER (AiCopilotDrawer chat UI)
  ↓  sendCopilotPromptAction            app/actions/ai.actions.ts   "use server"
AUTH (requireWorkspace)                 lib/auth/workspace          session → {userId, workspaceId}
  ↓
CONTEXT BUILDER (buildWorkspaceSnapshot) services/ai/ai-agent.service.ts
  │   CrmService.getPipeline / getLeads / getCompanies,
  │   ProjectService.getProjects, CrmService.getOpenTasks — all workspace-scoped
  ↓
INTENT (LLM tier ⇄ deterministic tier)
  │   LLM: copilot-persona.ts system prompt + snapshot + ≤10-turn transcript
  │   → LlmService.completeJson (OpenRouter/OpenAI/Anthropic/Gemini, fail-closed)
  │   Fallback: keyword intent over the same snapshot (always available)
  ↓
ACTION DECISION (≤3 suggestedActions, strict allow-list)
  │   reads: NAVIGATE (URL allow-list), RUN_SWEEP, DISCOVER_LEADS, DISCOVER_LOCAL_LEADS
  │   writes: UPDATE_DEAL_STAGE · LOG_ACTIVITY · CREATE_TASK · CREATE_FOLLOW_UP
  ↓
ARMING (write proposals only)           CopilotWriteService.issue
  │   proposal stored SERVER-SIDE; client receives an unforgeable single-use token
  │   + a human summary. Payload never round-trips through the client.
  ↓
UI (confirmation card)                  components/crm/AiCopilotDrawer.tsx
  │   isTrusted guard + two-stage arm→confirm (6s window) — synthetic single
  │   clicks can only arm harmlessly
  ↓
EXECUTION (executeCopilotWriteAction)   CopilotWriteService.execute
  │   token: single-use, 10-min TTL, workspace+user bound, 2.5s anti-stray-click
  │   gate (fast attempts BURN the token); entity resolved BY NAME inside the
  │   caller's workspace; writes go through CrmService / ActivityService
  ↓
VALIDATION + AUDIT                      audit_logs (via="copilot") + revalidatePath
```

The LLM never receives database access, never emits SQL, and can only propose
actions from the fixed protocol. The backend, not the model, decides what is allowed.

## CRM entity → existing table → service → permission

| CRM entity        | Table (db/schema.ts)      | Service used by copilot                          | Access               |
| ----------------- | ------------------------- | ------------------------------------------------ | -------------------- |
| Company           | `companies`               | `CrmService.getCompanies` / `findDealByName` etc. | workspace-scoped read/write |
| Contact           | `contacts`                | joined via lead relations                        | workspace-scoped read |
| Lead              | `leads`                   | `CrmService.getLeads` / `findLeadByName` / `updateLead` | workspace-scoped read/write |
| Activity          | `activities`              | `ActivityService.createActivity`                 | workspace-scoped write |
| Follow-up         | `leads.next_follow_up_at` | `CrmService.updateLead` (copilot) / `queueStaleFollowUpsAction` (sweep) | workspace-scoped write |
| Deal              | `deals`                   | `CrmService.getPipeline` / `findDealByName` / `updateDealStage` | workspace-scoped read/write |
| Task              | `agent_tasks`             | `CrmService.createTask` (`createdBy: "copilot"`) | workspace-scoped write |
| Project           | `projects`                | `ProjectService.getProjects`                     | workspace-scoped read |
| User / workspace  | `users` / `workspaces` / `workspace_memberships` | `requireWorkspace()`          | session-bound        |
| Audit             | `audit_logs`              | `ActivityService.logAudit`                       | append               |

Auth/RBAC is enforced server-side by `requireWorkspace()` before any copilot code
runs; every query and write is keyed on that `workspaceId`. The copilot adds no new
tables and no new permission surface.

## Write-action safety model (§11–13, §17 of the spec)

- **Proposals, never actions** — the model says "I can…"; execution requires the
  operator's explicit double-confirm in the UI.
- **Server-held payloads** — the client carries only an opaque token; nothing can be
  tampered with between proposal and confirm.
- **Single-use + TTL** — replay, expiry, and forged tokens all fail with one
  identical message (no oracle).
- **Session-bound** — cross-workspace or cross-user spends are rejected; and because
  *any* execute attempt pops the token, a stolen token cannot be probed repeatedly.
- **Anti-stray-click gate** — confirms younger than 2.5s are rejected and burn the
  token (one attempt per proposal, ever).
- **Named resolution** — proposals reference entities by snapshot name; resolution
  happens server-side inside the caller's workspace, so a name that doesn't exist
  fails honestly.
- **Audited** — every successful write lands in `audit_logs` with `via="copilot"`
  and the exact field changes (e.g. `nextFollowUpAt`, `dueInDays`,
  `previousFollowUpAt`).
- **No external sends** — the copilot drafts copy in the answer text only; sending
  email remains a separate, pre-existing approval-gated agent flow
  (`communication.send_email` in the agent tool registry).

## Where the pieces live

| Piece | File |
| --- | --- |
| System prompt (AEXYL persona + action protocol) | `services/ai/copilot-persona.ts` (`COPILOT_SYSTEM_PROMPT`) |
| Copilot brain (snapshot, LLM tier, deterministic tier, action validation) | `services/ai/ai-agent.service.ts` (`processCopilotCommand`) |
| Write-action service (tokens, normalization, execution, audit) | `services/ai/copilot-writes.ts` (`CopilotWriteService`) |
| Server actions (auth boundary, arming, revalidation) | `app/actions/ai.actions.ts` |
| Chat UI + confirmation cards + quick prompts | `components/crm/AiCopilotDrawer.tsx` |
| Scenario tests | `tests/copilot.scenarios.ts` (`npx tsx --env-file=.env.local tests/copilot.scenarios.ts`) |

## Extending the copilot (future agentic OS path)

1. **New write action** — add the kind to `CopilotWriteKind` + `normalizeWriteProposal`
   + `summarizeProposal` in `copilot-writes.ts`, implement its `case` in
   `CopilotWriteService.execute` (resolve by name → validate → write via existing
   service → `logAudit` → return `revalidatePaths`), add it to `allowedTypes` in
   `ai-agent.service.ts`, the ACTIONS list in `copilot-persona.ts`, and `WRITE_KINDS`
   in `AiCopilotDrawer.tsx`. All five lists must stay in sync.
2. **New read surface** — extend `buildWorkspaceSnapshot`; the persona's
   "snapshot is the retrieval layer" rule does the rest. Keep the cap in mind and
   say so in the prompt if you raise it.
3. **Real tool-calling loop** — the snapshot builder is already the shape of a
   `get_context` tool; the agent tool registry (`agents/core/registry/tools.ts`)
   plus the AiGateway (budgets, usage capture, injection fencing) is the tested
   path to upgrade the single-shot LLM tier into a multi-step loop without
   changing the protocol above.
