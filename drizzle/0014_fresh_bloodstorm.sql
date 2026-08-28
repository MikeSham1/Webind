CREATE TABLE "fix_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_id" uuid NOT NULL,
	"target" text NOT NULL,
	"ref" text,
	"deployed_text" text
);
--> statement-breakpoint
ALTER TABLE "fix_deployments" ADD CONSTRAINT "fix_deployments_review_id_fix_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."fix_reviews"("id") ON DELETE cascade ON UPDATE no action;