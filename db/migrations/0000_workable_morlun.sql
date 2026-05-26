CREATE TYPE "public"."capture_status" AS ENUM('queued', 'uploaded', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'select', 'multiselect', 'boolean', 'number');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('audio', 'photo');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."processing_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_config_kind" AS ENUM('realtime', 'transcription', 'vision', 'extraction');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('openai', 'gemini', 'google_stt', 'deepgram', 'anthropic');--> statement-breakpoint
CREATE TYPE "public"."rep_role" AS ENUM('admin', 'rep');--> statement-breakpoint
CREATE TABLE "reps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"role" "rep_role" DEFAULT 'rep' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reps_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"lead_form_id" uuid,
	"realtime_provider_config_id" uuid,
	"transcription_provider_config_id" uuid,
	"vision_provider_config_id" uuid,
	"extraction_provider_config_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shows_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "show_reps" (
	"show_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"role" text DEFAULT 'rep' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_reps_show_id_rep_id_pk" PRIMARY KEY("show_id","rep_id")
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"label" text NOT NULL,
	"encrypted_api_key" "bytea" NOT NULL,
	"encryption_key_id" text NOT NULL,
	"last4" text NOT NULL,
	"created_by_rep_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "provider_config_kind" NOT NULL,
	"provider" "provider_kind" NOT NULL,
	"model" text NOT NULL,
	"credential_id" uuid NOT NULL,
	"label" text NOT NULL,
	"default_instructions" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_ab_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"kind" "provider_config_kind" NOT NULL,
	"provider_config_a_id" uuid NOT NULL,
	"provider_config_b_id" uuid NOT NULL,
	"split_pct" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"accessed_by_rep_id" uuid,
	"purpose" text NOT NULL,
	"context_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_sample_csv" text,
	"icapture_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_form_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"ai_extraction_hint" text,
	"csv_header" text NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "opportunity_status" DEFAULT 'open' NOT NULL,
	"created_by_rep_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"merged_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"badge_photo_blob_key" text,
	"processed_capture_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	CONSTRAINT "leads_opportunity_id_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"show_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"audio_blob_key" text,
	"photo_blob_key" text,
	"duration_ms" integer,
	"had_realtime_assist" boolean DEFAULT false NOT NULL,
	"realtime_provider_config_id" uuid,
	"realtime_transcript" jsonb,
	"status" "capture_status" DEFAULT 'queued' NOT NULL,
	"client_captured_at" timestamp with time zone NOT NULL,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "capture_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"transcription_provider_config_id" uuid,
	"transcript" text,
	"extracted_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"badge_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_estimate_usd" numeric(10, 6),
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"capture_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_id" uuid NOT NULL,
	"workflow_run_id" text,
	"step" text NOT NULL,
	"status" "processing_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "csv_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"generated_by_rep_id" uuid,
	"row_count" integer NOT NULL,
	"blob_key" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_created_by_reps_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_reps" ADD CONSTRAINT "show_reps_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_reps" ADD CONSTRAINT "show_reps_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_created_by_rep_id_reps_id_fk" FOREIGN KEY ("created_by_rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_ab_assignments" ADD CONSTRAINT "provider_ab_assignments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_ab_assignments" ADD CONSTRAINT "provider_ab_assignments_provider_config_a_id_provider_configs_id_fk" FOREIGN KEY ("provider_config_a_id") REFERENCES "public"."provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_ab_assignments" ADD CONSTRAINT "provider_ab_assignments_provider_config_b_id_provider_configs_id_fk" FOREIGN KEY ("provider_config_b_id") REFERENCES "public"."provider_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_accessed_by_rep_id_reps_id_fk" FOREIGN KEY ("accessed_by_rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_lead_form_id_lead_forms_id_fk" FOREIGN KEY ("lead_form_id") REFERENCES "public"."lead_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_rep_id_reps_id_fk" FOREIGN KEY ("created_by_rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_realtime_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("realtime_provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_extractions" ADD CONSTRAINT "capture_extractions_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_extractions" ADD CONSTRAINT "capture_extractions_transcription_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("transcription_provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_blobs" ADD CONSTRAINT "media_blobs_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_exports" ADD CONSTRAINT "csv_exports_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_exports" ADD CONSTRAINT "csv_exports_generated_by_rep_id_reps_id_fk" FOREIGN KEY ("generated_by_rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_show_code_unique" ON "opportunities" USING btree ("show_id","code");