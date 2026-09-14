# Aexyl Agents

The six Phase-5 agents are controlled software actors: explicit identity,
tools, permissions, budgets, and approval policies. They are not chatbots.

## Agents

| Agent | Purpose | Default autonomy | Risky tools |
| --- | --- | --- | --- |
| Scout | discover/research prospects matching ICP | L1 Recommend | none (research is read-only) |
| Sales | analyze leads, prioritize, recommend next actions | L1 Recommend | CRM writes (approval) |
| Outreach | prepare personalized outreach drafts | L2 Prepare | `send_email` (approval, HIGH risk) |
| Follow-up | monitor follow-up dates, stale leads, drafts | L2 Prepare | CRM writes (approval) |
| Operations | monitor projects, blockers, workload | L1 Recommend | task/project writes (approval) |
| Executive | business awareness, briefings, Q&A | L0 Observe | none (read-only) |

## Autonomy levels

- **L0 Observe** — read + analyze only; no mutations.
- **L1 Recommend** — produce recommendations; no automatic mutations.
- **L2 Prepare** — create drafts/prepared actions; human confirmation required.
- **L3 Execute Approved** — auto-execute only actions pre-approved by policy.
- **L4 Controlled Autonomous** — reserved; never enabled by default.

Autonomy is set per agent in `/agents/[id]` and enforced by the policy engine
before every tool call — a lower-autonomy agent cannot invoke a mutating tool
even if the model asks for it (the run is blocked and audited).

## Tool pipeline

Every tool call passes through, in order:

```
Tool Registry (Zod schema) → Permission check → Policy engine
  (kill switch, autonomy, allowlist, budget, rate/action limits,
   execution window, idempotency) → Approval (if required)
→ Execute → Validate result → Audit + receipt
```

Bypassing this pipeline is impossible from agent code: the runtime is the only
executor, and the policy engine is centralized (`agents/core/policies/engine.ts`).

## Approvals

Risky tools create `agent_approvals` rows (PENDING) and pause the run at
`AWAITING_APPROVAL`. Review happens in `/agents/approvals`. Approving executes
the stored proposal **once** — idempotency receipts block replays; rejection
leaves data untouched. Pending approvals expire automatically.

## Guardrails (Phase 6)

Per agent: enabled/disabled, autonomy, tool allowlist, daily run limit,
max cost per run, **monthly budget (breach → agent PAUSED + notification)**,
execution window, action budget per day, per-tool overrides.
Workspace-wide: kill switch (blocks all runs instantly, audited, notifies),
AI budget, rate limits.

## Memory

`agent_memory` rows are scoped (`WORKSPACE`, `AGENT`, `LEAD`, `PROJECT`, `RUN`)
with importance and expiry. The context builder retrieves only relevant
memories for the current objective — never the whole history. Memory is
lowest-priority context: system > workspace > agent policy > task > memory.

## Observability

- `/agents` — command center: agent states, recent activity, kill switch.
- `/agents/[id]` — settings (autonomy, tools, limits) + recent runs.
- `/agents/runs` — run history; `/agents/runs/[id]` — full trace, plan,
  approvals, receipts, 👍/👎 feedback.
- `/agents/observability` — 7-day success/failure rates, tool failures, AI
  spend, approval outcomes, incidents, feedback summary.

## Events & automations

Domain events (`lead.created`, `lead.stale`, `project.at_risk`, …) dispatch to
agents via `agents/events/bus.ts` with dedupe + cooldowns. Default automation
rules are seeded per workspace at provisioning; edit via `automation_rules`.
