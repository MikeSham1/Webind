CREATE TABLE "code_fix_prs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text NOT NULL,
	"branch_name" text NOT NULL,
	CONSTRAINT "code_fix_prs_report_request_id_unique" UNIQUE("report_request_id")
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"encrypted_token" text NOT NULL,
	CONSTRAINT "github_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "optimizations" jsonb;--> statement-breakpoint
ALTER TABLE "code_fix_prs" ADD CONSTRAINT "code_fix_prs_report_request_id_report_requests_id_fk" FOREIGN KEY ("report_request_id") REFERENCES "public"."report_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_fix_prs" ADD CONSTRAINT "code_fix_prs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;