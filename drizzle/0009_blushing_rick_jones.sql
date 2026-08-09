CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"destination" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"result" text NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "publications" ALTER COLUMN "wp_post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ALTER COLUMN "wp_view_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ALTER COLUMN "wp_edit_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ALTER COLUMN "published_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;