CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"wp_post_id" integer NOT NULL,
	"wp_view_url" text NOT NULL,
	"wp_edit_url" text NOT NULL,
	"status" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"rolled_back_at" timestamp with time zone,
	CONSTRAINT "publications_draft_id_unique" UNIQUE("draft_id")
);
--> statement-breakpoint
CREATE TABLE "wordpress_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_app_password" text NOT NULL,
	CONSTRAINT "wordpress_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_draft_id_content_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."content_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;