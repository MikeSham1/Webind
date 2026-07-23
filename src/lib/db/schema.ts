import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ReportResult } from "../scoring/types";
import type {
  ContentInputs,
  DraftStatus,
  GateReport,
} from "../content/types";

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

/** AI-assisted content drafts from the Content Studio, pending human approval. */
export const contentDrafts = pgTable("content_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  topic: text("topic").notNull(),
  targetUrl: text("target_url"),
  inputs: jsonb("inputs").$type<ContentInputs>(),
  title: text("title"),
  markdown: text("markdown"),
  gates: jsonb("gates").$type<GateReport>(),
  status: text("status").$type<DraftStatus>().notNull().default("pending_review"),
});

export type ContentDraftRow = typeof contentDrafts.$inferSelect;
