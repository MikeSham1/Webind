CREATE TABLE "fix_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate" jsonb NOT NULL,
	"validation_ok" boolean NOT NULL,
	"validation_failures" jsonb,
	"reranker_score" integer
);
--> statement-breakpoint
CREATE TABLE "fix_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reviewer_user_id" uuid,
	"decision" text NOT NULL,
	"human_final" text,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE TABLE "fix_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"snapshot_id" uuid NOT NULL,
	"signal_key" text NOT NULL,
	"category" text NOT NULL,
	"diagnosis" text NOT NULL,
	"generator_provider" text NOT NULL,
	"generator_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"query_cluster" text,
	"engine" text
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"version_label" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"content_hash" text NOT NULL,
	"page_type" text NOT NULL,
	"locale" text,
	"snapshot" jsonb
);
--> statement-breakpoint
ALTER TABLE "fix_candidates" ADD CONSTRAINT "fix_candidates_run_id_fix_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fix_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_reviews" ADD CONSTRAINT "fix_reviews_candidate_id_fix_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."fix_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_reviews" ADD CONSTRAINT "fix_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD CONSTRAINT "fix_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_runs" ADD CONSTRAINT "fix_runs_snapshot_id_page_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."page_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;