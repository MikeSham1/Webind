CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"topic" text NOT NULL,
	"target_url" text,
	"inputs" jsonb,
	"title" text,
	"markdown" text,
	"gates" jsonb,
	"status" text DEFAULT 'pending_review' NOT NULL
);
