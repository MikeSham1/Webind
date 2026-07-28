ALTER TABLE "content_drafts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_requests" ADD CONSTRAINT "report_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;