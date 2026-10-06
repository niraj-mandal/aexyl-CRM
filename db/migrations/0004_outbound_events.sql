CREATE TABLE IF NOT EXISTS "outbound_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "campaign_id" uuid REFERENCES "outbound_campaigns"("id"),
  "company_id" uuid REFERENCES "companies"("id"),
  "lead_id" uuid REFERENCES "leads"("id"),
  "type" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "source" text NOT NULL,
  "source_url" text,
  "confidence" integer DEFAULT 50 NOT NULL,
  "relevance_score" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'NEW' NOT NULL,
  "occurred_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbound_events_workspace_idx" ON "outbound_events" ("workspace_id","status");
CREATE INDEX IF NOT EXISTS "outbound_events_company_idx" ON "outbound_events" ("company_id","created_at");
CREATE INDEX IF NOT EXISTS "outbound_events_campaign_idx" ON "outbound_events" ("campaign_id");
