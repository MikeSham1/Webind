import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ReportResult } from "../scoring/types";

/**
 * Every free-report run is logged here (the preview doubles as a lead funnel).
 * `email` is filled in later if the visitor opts into the follow-up.
 */
export const reportRequests = pgTable("report_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  url: text("url").notNull(),
  email: text("email"),
  aiTotal: integer("ai_total"),
  traditionalTotal: integer("traditional_total"),
  report: jsonb("report").$type<ReportResult>(),
});

export type ReportRequest = typeof reportRequests.$inferSelect;
