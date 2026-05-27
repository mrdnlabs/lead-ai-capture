CREATE TABLE IF NOT EXISTS "show_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"token" text NOT NULL,
	"role" text DEFAULT 'rep' NOT NULL,
	"max_uses" integer DEFAULT 50 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_rep_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "show_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN IF NOT EXISTS "live_fields" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "show_invites" ADD CONSTRAINT "show_invites_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "show_invites" ADD CONSTRAINT "show_invites_created_by_rep_id_reps_id_fk" FOREIGN KEY ("created_by_rep_id") REFERENCES "public"."reps"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;