CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  agent_key text NOT NULL, name text NOT NULL, description text NOT NULL, version text NOT NULL DEFAULT 'v1',
  enabled boolean NOT NULL DEFAULT true, autonomy_level integer NOT NULL DEFAULT 1,
  allowed_tools jsonb NOT NULL DEFAULT '[]', tool_rate_limits jsonb NOT NULL DEFAULT '{}',
  daily_run_limit integer NOT NULL DEFAULT 50, max_tokens_per_run integer NOT NULL DEFAULT 20000,
  daily_budget_micro_usd integer NOT NULL DEFAULT 2000000, requires_approval_for_writes boolean NOT NULL DEFAULT true,
  monthly_budget_micro_usd integer NOT NULL DEFAULT 10000000, paused boolean NOT NULL DEFAULT false, pause_reason text,
  tool_policies jsonb NOT NULL DEFAULT '{}', max_actions_per_day integer NOT NULL DEFAULT 100,
  execution_window jsonb DEFAULT NULL, domain_allowlist jsonb NOT NULL DEFAULT '[]', domain_blocklist jsonb NOT NULL DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT agents_workspace_key_unique UNIQUE(workspace_id, agent_key)
);
CREATE INDEX IF NOT EXISTS agents_workspace_idx ON agents(workspace_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), agent_id uuid NOT NULL REFERENCES agents(id),
  trigger_type text NOT NULL DEFAULT 'manual', trigger_id text, status text NOT NULL DEFAULT 'QUEUED', objective text NOT NULL,
  input_context jsonb, plan jsonb, current_step integer NOT NULL DEFAULT 0, result jsonb, error text,
  tokens_used integer NOT NULL DEFAULT 0, estimated_cost_micro_usd integer NOT NULL DEFAULT 0,
  started_at timestamp DEFAULT now(), completed_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_workspace_idx ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs(status);

CREATE TABLE IF NOT EXISTS agent_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES agent_runs(id), step_number integer NOT NULL,
  type text NOT NULL, summary text NOT NULL, tool_name text, input jsonb, output jsonb, latency_ms integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0, estimated_cost_micro_usd integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'SUCCEEDED', error text, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_traces_run_idx ON agent_traces(run_id);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), run_id uuid REFERENCES agent_runs(id),
  agent_id uuid NOT NULL REFERENCES agents(id), tool_name text NOT NULL, action_type text NOT NULL, description text NOT NULL,
  risk_level text NOT NULL DEFAULT 'MEDIUM', proposed_arguments jsonb NOT NULL, impact_summary text,
  status text NOT NULL DEFAULT 'PENDING', requested_at timestamp NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamp, expires_at timestamp NOT NULL, execution_result jsonb, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_approvals_workspace_idx ON agent_approvals(workspace_id);
CREATE INDEX IF NOT EXISTS agent_approvals_status_idx ON agent_approvals(status);

CREATE TABLE IF NOT EXISTS agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), scope text NOT NULL,
  entity_type text, entity_id text, content text NOT NULL, metadata jsonb, importance integer NOT NULL DEFAULT 3, expires_at timestamp, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_memory_workspace_scope_idx ON agent_memory(workspace_id, scope);
CREATE INDEX IF NOT EXISTS agent_memory_entity_idx ON agent_memory(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), agent_id uuid NOT NULL REFERENCES agents(id),
  name text NOT NULL, event_type text NOT NULL, conditions jsonb NOT NULL DEFAULT '{}', action_policy text NOT NULL DEFAULT 'prepare_only',
  enabled boolean NOT NULL DEFAULT true, cooldown_seconds integer NOT NULL DEFAULT 3600, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_rules_workspace_event_idx ON automation_rules(workspace_id, event_type);

CREATE TABLE IF NOT EXISTS agent_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), agent_id uuid REFERENCES agents(id), run_id uuid REFERENCES agent_runs(id),
  provider text NOT NULL, model text NOT NULL, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_micro_usd integer NOT NULL DEFAULT 0, duration_ms integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_usage_workspace_idx ON agent_usage(workspace_id);
CREATE INDEX IF NOT EXISTS agent_usage_created_idx ON agent_usage(created_at);

CREATE TABLE IF NOT EXISTS agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), event_type text NOT NULL,
  entity_type text, entity_id text, payload jsonb, status text NOT NULL DEFAULT 'PENDING', processed_at timestamp, error text, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_workspace_type_idx ON agent_events(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS agent_events_status_idx ON agent_events(status);