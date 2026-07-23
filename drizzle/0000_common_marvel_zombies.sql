CREATE TABLE "report_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"email" text,
	"ai_total" integer,
	"traditional_total" integer,
	"report" jsonb
);
