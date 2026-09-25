ALTER TABLE "publications" ADD COLUMN "wp_site_url" text;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "wp_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_wp_connection_id_wordpress_connections_id_fk" FOREIGN KEY ("wp_connection_id") REFERENCES "public"."wordpress_connections"("id") ON DELETE set null ON UPDATE no action;