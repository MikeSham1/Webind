CREATE TABLE "visibility_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"domain" text NOT NULL,
	"brand_name" text,
	"overall_score" integer,
	"coverage_bps" integer,
	"report" jsonb
);
--> statement-breakpoint
ALTER TABLE "visibility_outcomes" ADD CONSTRAINT "visibility_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;