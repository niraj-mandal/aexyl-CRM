CREATE TABLE IF NOT EXISTS "outbound_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "target_profile" text,
  "value_prop" text,
  "channels" jsonb DEFAULT '["EMAIL"]'::jsonb NOT NULL,
  "daily_send_limit" integer DEFAULT 25 NOT NULL,
  "approval_required" boolean DEFAULT true NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbound_campaigns_workspace_idx" ON "outbound_campaigns" ("workspace_id");
CREATE INDEX IF NOT EXISTS "outbound_campaigns_status_idx" ON "outbound_campaigns" ("workspace_id","status");

CREATE TABLE IF NOT EXISTS "outbound_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "outbound_campaigns"("id"),
  "step_number" integer NOT NULL,
  "channel" text NOT NULL,
  "delay_days" integer DEFAULT 0 NOT NULL,
  "title" text NOT NULL,
  "instructions" text,
  "template" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_steps_campaign_number_unique" UNIQUE ("campaign_id","step_number")
);
CREATE INDEX IF NOT EXISTS "outbound_steps_campaign_idx" ON "outbound_steps" ("campaign_id");

CREATE TABLE IF NOT EXISTS "outbound_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "outbound_campaigns"("id"),
  "lead_id" uuid NOT NULL REFERENCES "leads"("id"),
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "current_step" integer DEFAULT 1 NOT NULL,
  "next_action_at" timestamp,
  "last_action_at" timestamp,
  "last_channel" text,
  "intent" text DEFAULT 'UNKNOWN' NOT NULL,
  "objection" text,
  "timeline" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enrolled_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outbound_enrollments_campaign_lead_unique" UNIQUE ("campaign_id","lead_id")
);
CREATE INDEX IF NOT EXISTS "outbound_enrollments_workspace_idx" ON "outbound_enrollments" ("workspace_id");
CREATE INDEX IF NOT EXISTS "outbound_enrollments_campaign_idx" ON "outbound_enrollments" ("campaign_id");
CREATE INDEX IF NOT EXISTS "outbound_enrollments_next_action_idx" ON "outbound_enrollments" ("workspace_id","next_action_at");
