import { pgTable, text, timestamp, uuid, jsonb, primaryKey, integer, numeric, boolean, index, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// -----------------------------------------------------------------------------
// PHASE 1: WORKSPACE & AUTH FOUNDATION
// -----------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // Automation settings — read live by the agentic sweep.
  sweepEnabled: boolean("sweep_enabled").default(true).notNull(),
  sweepFollowUpDays: integer("sweep_follow_up_days").default(2).notNull(),
  staleLeadDays: integer("stale_lead_days").default(7).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").references(() => roles.id).notNull(),
  permissionId: uuid("permission_id").references(() => permissions.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permissionId] })
]);

export const workspaceMemberships = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  roleId: uuid("role_id").references(() => roles.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  type: text("type").notNull(),
  content: jsonb("content").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  actorId: uuid("actor_id").references(() => users.id).notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


// -----------------------------------------------------------------------------
// PHASE 2: CRM CORE
// -----------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  name: text("name").notNull(),
  website: text("website"),
  industry: text("industry"),
  location: text("location"),
  size: text("size"),
  source: text("source"),
  status: text("status").default('ACTIVE').notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  jobTitle: text("job_title"),
  linkedinUrl: text("linkedin_url"),
  status: text("status").default('ACTIVE').notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  ownerId: uuid("owner_id").references(() => users.id),
  source: text("source"),
  status: text("status").default('NEW').notNull(), // NEW, CONTACTED, QUALIFIED, UNQUALIFIED, NURTURE, CONVERTED, LOST
  stage: text("stage"), 
  score: integer("score").default(0).notNull(),
  temperature: text("temperature").default('COLD').notNull(), // COLD, WARM, HOT
  notes: text("notes"),
  lastContactedAt: timestamp("last_contacted_at"),
  nextFollowUpAt: timestamp("next_follow_up_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  leadId: uuid("lead_id").references(() => leads.id),
  companyId: uuid("company_id").references(() => companies.id),
  name: text("name").notNull(),
  value: numeric("value"),
  currency: text("currency").default('USD').notNull(),
  stage: text("stage").notNull(), // QUALIFIED, CALL_BOOKED, PROPOSAL, NEGOTIATION, WON, LOST
  probability: integer("probability").default(0).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  expectedCloseDate: timestamp("expected_close_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  leadId: uuid("lead_id").references(() => leads.id),
  dealId: uuid("deal_id").references(() => deals.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  actorId: uuid("actor_id").references(() => users.id).notNull(),
  type: text("type").notNull(), // NOTE, CALL, EMAIL, MEETING, OUTREACH, FOLLOW_UP, STAGE_CHANGE, STATUS_CHANGE
  title: text("title").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


// -----------------------------------------------------------------------------
// WORKSPACE INVITES
// -----------------------------------------------------------------------------

export const workspaceInvites = pgTable("workspace_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(), // url-safe random secret; the only capability needed to accept
  roleId: uuid("role_id").references(() => roles.id),
  invitedById: uuid("invited_by_id").references(() => users.id).notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING, ACCEPTED, REVOKED
  acceptedById: uuid("accepted_by_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("workspace_invites_workspace_idx").on(t.workspaceId),
]);

// -----------------------------------------------------------------------------
// PHASE 2.5: PROJECT DELIVERY
// -----------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  dealId: uuid("deal_id").references(() => deals.id),
  name: text("name").notNull(),
  code: text("code"), // PRJ-001 style human reference
  status: text("status").default("ONBOARDING").notNull(), // ONBOARDING, IN_PROGRESS, BLOCKED, DELIVERED, CANCELLED
  progress: integer("progress").default(0).notNull(), // 0-100
  health: text("health").default("HEALTHY").notNull(), // HEALTHY, AT_RISK, OFF_TRACK
  budget: numeric("budget"),
  startDate: timestamp("start_date").defaultNow(),
  dueDate: timestamp("due_date"),
  deliveredAt: timestamp("delivered_at"),
  ownerId: uuid("owner_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// AGENT TASKS (copilot write-actions + operator to-dos)
// -----------------------------------------------------------------------------

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("OPEN").notNull(), // OPEN, DONE, CANCELLED
  priority: text("priority").default("MEDIUM").notNull(), // LOW, MEDIUM, HIGH, URGENT
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  // Optional CRM linkage for context-aware task lists
  dealId: uuid("deal_id").references(() => deals.id),
  leadId: uuid("lead_id").references(() => leads.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  // Who/what created it — agent-proposals carry createdBy="copilot"
  createdBy: text("created_by").default("operator").notNull(), // operator, copilot, discovery
  assignedToId: uuid("assigned_to_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("tasks_workspace_status_idx").on(t.workspaceId, t.status),
]);

// -----------------------------------------------------------------------------
// PHASE 5: AGENTIC LAYER
// -----------------------------------------------------------------------------

/** Registered agent definitions + per-workspace runtime config. */
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  agentKey: text("agent_key").notNull(), // scout | sales | outreach | followup | operations | executive
  name: text("name").notNull(),
  description: text("description").notNull(),
  version: text("version").default("v1").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  /** L0 observe | L1 recommend | L2 prepare | L3 execute-approved */
  autonomyLevel: integer("autonomy_level").default(1).notNull(),
  /** jsonb array of tool ids the agent may call. */
  allowedTools: jsonb("allowed_tools").$type<string[]>().default([]).notNull(),
  /** jsonb { toolId: dailyLimit } rate limits. */
  toolRateLimits: jsonb("tool_rate_limits").$type<Record<string, number>>().default({}).notNull(),
  /** Max agent runs per day (0 = unlimited). */
  dailyRunLimit: integer("daily_run_limit").default(50).notNull(),
  /** Max tokens per run (0 = unlimited). */
  maxTokensPerRun: integer("max_tokens_per_run").default(20000).notNull(),
  /** Workspace daily budget in estimated USD micro-units (0 = no cap). */
  dailyBudgetMicroUsd: integer("daily_budget_micro_usd").default(2_000_000).notNull(),
  requiresApprovalForWrites: boolean("requires_approval_for_writes").default(true).notNull(),
  // --- Phase 6 guardrails ---------------------------------------------------
  /** Monthly budget in estimated USD micro-units (0 = no cap). Exceeded → PAUSED. */
  monthlyBudgetMicroUsd: integer("monthly_budget_micro_usd").default(10_000_000).notNull(),
  /** Policy engine can pause an agent (budget breach, incident). Manual re-enable required. */
  paused: boolean("paused").default(false).notNull(),
  pauseReason: text("pause_reason"),
  /**
   * Per-tool override policies: { [toolId]: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK" }.
   * Overrides the tool's default and the agent's autonomy for that tool.
   */
  toolPolicies: jsonb("tool_policies").$type<Record<string, string>>().default({}).notNull(),
  /** Communication guardrails */
  maxActionsPerDay: integer("max_actions_per_day").default(100).notNull(),
  /** Optional execution window (workspace local hours): e.g. {start: 8, end: 19}; null = 24/7 */
  executionWindow: jsonb("execution_window").$type<{ start: number; end: number } | null>().default(null).notNull(),
  /** Comma-separated domain allowlist for research/communication targets; empty = allow all */
  domainAllowlist: jsonb("domain_allowlist").$type<string[]>().default([]).notNull(),
  domainBlocklist: jsonb("domain_blocklist").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("agents_workspace_idx").on(t.workspaceId),
  unique("agents_workspace_key_unique").on(t.workspaceId, t.agentKey),
]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  /** manual | event | schedule */
  triggerType: text("trigger_type").default("manual").notNull(),
  triggerId: text("trigger_id"),
  /** QUEUED INITIALIZING CONTEXT_LOADING PLANNING AWAITING_APPROVAL EXECUTING VALIDATING COMPLETED FAILED RETRYING CANCELLED ESCALATED STOPPED_BY_POLICY */
  status: text("status").default("QUEUED").notNull(),
  objective: text("objective").notNull(),
  inputContext: jsonb("input_context"),
  plan: jsonb("plan"),
  currentStep: integer("current_step").default(0).notNull(),
  result: jsonb("result"),
  error: text("error"),
  tokensUsed: integer("tokens_used").default(0).notNull(),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").default(0).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_runs_workspace_idx").on(t.workspaceId),
  index("agent_runs_agent_idx").on(t.agentId),
  index("agent_runs_status_idx").on(t.status),
]);

export const agentTraces = pgTable("agent_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => agentRuns.id).notNull(),
  stepNumber: integer("step_number").notNull(),
  /** context | plan | tool_call | validation | message | approval | policy */
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  toolName: text("tool_name"),
  input: jsonb("input"),
  output: jsonb("output"),
  latencyMs: integer("latency_ms").default(0).notNull(),
  tokensUsed: integer("tokens_used").default(0).notNull(),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").default(0).notNull(),
  /** SUCCEEDED FAILED BLOCKED_BY_POLICY SKIPPED */
  status: text("status").default("SUCCEEDED").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_traces_run_idx").on(t.runId),
]);

export const agentApprovals = pgTable("agent_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  runId: uuid("run_id").references(() => agentRuns.id),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  /** tool id, e.g. crm.update_lead */
  toolName: text("tool_name").notNull(),
  actionType: text("action_type").notNull(),
  description: text("description").notNull(),
  /** LOW MEDIUM HIGH */
  riskLevel: text("risk_level").default("MEDIUM").notNull(),
  proposedArguments: jsonb("proposed_arguments").notNull(),
  impactSummary: text("impact_summary"),
  /** PENDING APPROVED REJECTED EXPIRED EXECUTED CANCELLED */
  status: text("status").default("PENDING").notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  expiresAt: timestamp("expires_at").notNull(),
  /** filled when the approved action executed (idempotency receipt) */
  executionResult: jsonb("execution_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_approvals_workspace_idx").on(t.workspaceId),
  index("agent_approvals_status_idx").on(t.status),
]);

export const agentMemory = pgTable("agent_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  /** workspace | agent | lead | deal | company | contact | project | task */
  scope: text("scope").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  /** 1-5 */
  importance: integer("importance").default(3).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_memory_workspace_scope_idx").on(t.workspaceId, t.scope),
  index("agent_memory_entity_idx").on(t.entityType, t.entityId),
]);

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  agentId: uuid("agent_id").references(() => agents.id).notNull(),
  name: text("name").notNull(),
  /** e.g. lead.created, lead.stale, project.at_risk, task.overdue */
  eventType: text("event_type").notNull(),
  /** jsonb conditions evaluated against the event payload */
  conditions: jsonb("conditions").$type<Record<string, unknown>>().default({}).notNull(),
  /** prepare_only | execute_approved */
  actionPolicy: text("action_policy").default("prepare_only").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  /** minimum seconds between runs for the same trigger key */
  cooldownSeconds: integer("cooldown_seconds").default(3600).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("automation_rules_workspace_event_idx").on(t.workspaceId, t.eventType),
]);

export const agentUsage = pgTable("agent_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  agentId: uuid("agent_id").references(() => agents.id),
  runId: uuid("run_id").references(() => agentRuns.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").default(0).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_usage_workspace_idx").on(t.workspaceId),
  index("agent_usage_created_idx").on(t.createdAt),
]);

export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  payload: jsonb("payload"),
  /** PENDING PROCESSED SKIPPED FAILED */
  status: text("status").default("PENDING").notNull(),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_events_workspace_type_idx").on(t.workspaceId, t.eventType),
  index("agent_events_status_idx").on(t.status),
]);

// -----------------------------------------------------------------------------
// RELATIONS
// -----------------------------------------------------------------------------

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMemberships),
  roles: many(roles),
  companies: many(companies),
  contacts: many(contacts),
  leads: many(leads),
  deals: many(deals),
  activities: many(activities),
  projects: many(projects),
  tasks: many(tasks),
  agents: many(agents),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMemberships),
  ownedCompanies: many(companies, { relationName: "companyOwner" }),
  ownedLeads: many(leads, { relationName: "leadOwner" }),
  ownedDeals: many(deals, { relationName: "dealOwner" }),
  activities: many(activities, { relationName: "activityActor" }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [roles.workspaceId], references: [workspaces.id] }),
  rolePermissions: many(rolePermissions),
  memberships: many(workspaceMemberships),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const workspaceMembershipsRelations = relations(workspaceMemberships, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceMemberships.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workspaceMemberships.userId], references: [users.id] }),
  role: one(roles, { fields: [workspaceMemberships.roleId], references: [roles.id] }),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [companies.workspaceId], references: [workspaces.id] }),
  owner: one(users, { fields: [companies.ownerId], references: [users.id], relationName: "companyOwner" }),
  contacts: many(contacts),
  leads: many(leads),
  deals: many(deals),
  projects: many(projects),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [contacts.workspaceId], references: [workspaces.id] }),
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  leads: many(leads),
  activities: many(activities),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [leads.workspaceId], references: [workspaces.id] }),
  company: one(companies, { fields: [leads.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [leads.contactId], references: [contacts.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id], relationName: "leadOwner" }),
  activities: many(activities),
  deals: many(deals),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [agents.workspaceId], references: [workspaces.id] }),
  runs: many(agentRuns),
  approvals: many(agentApprovals),
  automationRules: many(automationRules),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [agentRuns.workspaceId], references: [workspaces.id] }),
  agent: one(agents, { fields: [agentRuns.agentId], references: [agents.id] }),
  traces: many(agentTraces),
  approvals: many(agentApprovals),
}));

export const agentTracesRelations = relations(agentTraces, ({ one }) => ({
  run: one(agentRuns, { fields: [agentTraces.runId], references: [agentRuns.id] }),
}));

export const agentApprovalsRelations = relations(agentApprovals, ({ one }) => ({
  workspace: one(workspaces, { fields: [agentApprovals.workspaceId], references: [workspaces.id] }),
  agent: one(agents, { fields: [agentApprovals.agentId], references: [agents.id] }),
  run: one(agentRuns, { fields: [agentApprovals.runId], references: [agentRuns.id] }),
  reviewedByUser: one(users, { fields: [agentApprovals.reviewedBy], references: [users.id] }),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [deals.workspaceId], references: [workspaces.id] }),
  lead: one(leads, { fields: [deals.leadId], references: [leads.id] }),
  company: one(companies, { fields: [deals.companyId], references: [companies.id] }),
  owner: one(users, { fields: [deals.ownerId], references: [users.id], relationName: "dealOwner" }),
  activities: many(activities),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  workspace: one(workspaces, { fields: [tasks.workspaceId], references: [workspaces.id] }),
  deal: one(deals, { fields: [tasks.dealId], references: [deals.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  assignedTo: one(users, { fields: [tasks.assignedToId], references: [users.id], relationName: "taskAssignee" }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  workspace: one(workspaces, { fields: [auditLogs.workspaceId], references: [workspaces.id] }),
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  workspace: one(workspaces, { fields: [activities.workspaceId], references: [workspaces.id] }),
  lead: one(leads, { fields: [activities.leadId], references: [leads.id] }),
  deal: one(deals, { fields: [activities.dealId], references: [deals.id] }),
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  actor: one(users, { fields: [activities.actorId], references: [users.id], relationName: "activityActor" }),
}));

// -----------------------------------------------------------------------------
// PHASE 6: PRODUCTION, INTEGRATIONS & CONTROLLED AUTONOMY
// -----------------------------------------------------------------------------

/**
 * Integration connections — one row per (workspace, connector). Credentials
 * (OAuth tokens, API keys) live in the `credentials` jsonb but are NEVER
 * rendered to the client, never logged, and never placed into agent context.
 */
export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  /** connector key, e.g. resend | gmail | slack | google_calendar | google_drive */
  connectorKey: text("connector_key").notNull(),
  /** NOT_CONFIGURED | CONNECTED | ERROR | DISABLED */
  status: text("status").default("NOT_CONFIGURED").notNull(),
  /** human label, e.g. email address or workspace name of the external system */
  accountLabel: text("account_label"),
  /** secrets — server-only */
  credentials: jsonb("credentials").$type<Record<string, string>>().default({}).notNull(),
  /** non-secret display metadata (scopes, last sync, etc.) */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  lastError: text("last_error"),
  lastCheckedAt: timestamp("last_checked_at"),
  connectedAt: timestamp("connected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("integration_connections_workspace_idx").on(t.workspaceId),
  unique("integration_connections_workspace_connector_unique").on(t.workspaceId, t.connectorKey),
]);

/** Feature flags — workspace-scoped, boolean or JSON value. */
export const featureFlags = pgTable("feature_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  flagKey: text("flag_key").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().default({}).notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  unique("feature_flags_workspace_key_unique").on(t.workspaceId, t.flagKey),
]);

/** Agent feedback — the human loop on agent recommendations (spec §27). */
export const agentFeedback = pgTable("agent_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  runId: uuid("run_id").references(() => agentRuns.id),
  agentId: uuid("agent_id").references(() => agents.id),
  userId: uuid("user_id").references(() => users.id).notNull(),
  /** HELPFUL | NOT_HELPFUL */
  rating: text("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("agent_feedback_run_idx").on(t.runId),
]);

/** Incidents — opened automatically by kill switch / failure spikes, or manually. */
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** OPEN | MITIGATED | RESOLVED */
  status: text("status").default("OPEN").notNull(),
  severity: text("severity").default("SEV2").notNull(),
  source: text("default").default("system").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("incidents_workspace_status_idx").on(t.workspaceId, t.status),
]);

export const integrationConnectionsRelations = relations(integrationConnections, ({ one }) => ({
  workspace: one(workspaces, { fields: [integrationConnections.workspaceId], references: [workspaces.id] }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  workspace: one(workspaces, { fields: [incidents.workspaceId], references: [workspaces.id] }),
}));

export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  workspace: one(workspaces, { fields: [featureFlags.workspaceId], references: [workspaces.id] }),
}));

export const agentFeedbackRelations = relations(agentFeedback, ({ one }) => ({
  workspace: one(workspaces, { fields: [agentFeedback.workspaceId], references: [workspaces.id] }),
  run: one(agentRuns, { fields: [agentFeedback.runId], references: [agentRuns.id] }),
  agent: one(agents, { fields: [agentFeedback.agentId], references: [agents.id] }),
  user: one(users, { fields: [agentFeedback.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  workspace: one(workspaces, { fields: [notifications.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const workspaceInvitesRelations = relations(workspaceInvites, ({ one }) => ({
  workspace: one(workspaces, { fields: [workspaceInvites.workspaceId], references: [workspaces.id] }),
  role: one(roles, { fields: [workspaceInvites.roleId], references: [roles.id] }),
  invitedBy: one(users, { fields: [workspaceInvites.invitedById], references: [users.id], relationName: "inviteInvitedBy" }),
  acceptedBy: one(users, { fields: [workspaceInvites.acceptedById], references: [users.id], relationName: "inviteAcceptedBy" }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  company: one(companies, { fields: [projects.companyId], references: [companies.id] }),
  deal: one(deals, { fields: [projects.dealId], references: [deals.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id], relationName: "projectOwner" }),
}));
