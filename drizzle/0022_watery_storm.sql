CREATE TABLE "planner_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"messages" jsonb NOT NULL,
	CONSTRAINT "planner_conversations_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "edited_markdown" text;--> statement-breakpoint
ALTER TABLE "planner_conversations" ADD CONSTRAINT "planner_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;