CREATE TABLE IF NOT EXISTS "outbound_discovery_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "outbound_campaigns"("id"),
  "company_name" text NOT NULL,
  "website" text,
  "industry" text,
  "location" text,
  "contact_first_name" text,
  "contact_last_name" text,
  "contact_email" text,
  "contact_job_title" text,
  "linkedin_url" text,
  "source" text NOT NULL,
  "fit_score" integer DEFAULT 0 NOT NULL,
  "fit_tier" text DEFAULT 'POSSIBLE_FIT' NOT NULL,
  "reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbound_discovery_candidates_workspace_idx" ON "outbound_discovery_candidates" ("workspace_id","status");
CREATE INDEX IF NOT EXISTS "outbound_discovery_candidates_campaign_idx" ON "outbound_discovery_candidates" ("campaign_id");
