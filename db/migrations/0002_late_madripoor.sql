CREATE TABLE "discovery_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"location" text NOT NULL,
	"category" text NOT NULL,
	"provider" text DEFAULT 'overpass' NOT NULL,
	"target_count" integer DEFAULT 5 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"qualified_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"config" jsonb,
	"errors" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"external_id" text,
	"source" text DEFAULT 'overpass' NOT NULL,
	"business_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text,
	"address" text,
	"city" text,
	"state" text,
	"country" text,
	"latitude" real,
	"longitude" real,
	"phone" text,
	"normalized_phone" text,
	"website" text,
	"normalized_domain" text,
	"source_url" text,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"website_status" text,
	"website_url" text,
	"website_checked_at" timestamp,
	"website_check_reason" text,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"opportunity_score" integer DEFAULT 0 NOT NULL,
	"qualification_status" text DEFAULT 'PENDING' NOT NULL,
	"reasons" jsonb,
	"gaps" jsonb,
	"discovery_metadata" jsonb,
	"lead_id" uuid,
	"company_id" uuid,
	"rejected_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_candidates_external_id_uniq" UNIQUE("workspace_id","source","external_id")
);
--> statement-breakpoint
ALTER TABLE "discovery_batches" ADD CONSTRAINT "discovery_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_batch_id_discovery_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."discovery_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_batches_workspace_idx" ON "discovery_batches" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "discovery_batches_run_id_idx" ON "discovery_batches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "discovery_batches_status_idx" ON "discovery_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discovery_candidates_workspace_idx" ON "discovery_candidates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "discovery_candidates_batch_idx" ON "discovery_candidates" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "discovery_candidates_status_idx" ON "discovery_candidates" USING btree ("qualification_status");--> statement-breakpoint
CREATE INDEX "discovery_candidates_normalized_name_idx" ON "discovery_candidates" USING btree ("workspace_id","normalized_name");