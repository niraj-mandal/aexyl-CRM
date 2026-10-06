CREATE TABLE IF NOT EXISTS "outbound_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "enrollment_id" uuid NOT NULL REFERENCES "outbound_enrollments"("id"),
  "step_id" uuid REFERENCES "outbound_steps"("id"),
  "lead_id" uuid NOT NULL REFERENCES "leads"("id"),
  "channel" text NOT NULL,
  "direction" text NOT NULL,
  "status" text DEFAULT 'PREPARED' NOT NULL,
  "recipient" text,
  "subject" text,
  "body" text NOT NULL,
  "provider_message_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbound_messages_enrollment_idx" ON "outbound_messages" ("enrollment_id");
CREATE INDEX IF NOT EXISTS "outbound_messages_workspace_idx" ON "outbound_messages" ("workspace_id","created_at");

CREATE TABLE IF NOT EXISTS "outbound_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "enrollment_id" uuid NOT NULL REFERENCES "outbound_enrollments"("id"),
  "lead_id" uuid NOT NULL REFERENCES "leads"("id"),
  "channel" text NOT NULL,
  "body" text NOT NULL,
  "intent" text DEFAULT 'UNKNOWN' NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "objection" text,
  "timeline" text,
  "recommended_action" text,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbound_replies_enrollment_idx" ON "outbound_replies" ("enrollment_id");
