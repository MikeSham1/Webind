ALTER TABLE "planner_conversations" DROP CONSTRAINT "planner_conversations_user_id_unique";--> statement-breakpoint
ALTER TABLE "planner_conversations" ADD COLUMN "site_id" uuid;--> statement-breakpoint
ALTER TABLE "planner_conversations" ADD CONSTRAINT "planner_conversations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;