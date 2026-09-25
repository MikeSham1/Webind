ALTER TABLE "report_requests" ADD COLUMN "narrative" text;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "narrative_is_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "suggestions" jsonb;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "suggestions_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "page_experience" jsonb;--> statement-breakpoint
ALTER TABLE "report_requests" ADD COLUMN "score_audit" jsonb;