CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"progress" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;