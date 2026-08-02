import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
  // Owner when the run was made while logged in; null for anonymous lead-gen.
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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
  // Owner when created while logged in; null for anonymous (gated-preview) drafts.
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  topic: text("topic").notNull(),
  targetUrl: text("target_url"),
  inputs: jsonb("inputs").$type<ContentInputs>(),
  title: text("title"),
  markdown: text("markdown"),
  gates: jsonb("gates").$type<GateReport>(),
  status: text("status").$type<DraftStatus>().notNull().default("pending_review"),
});

export type ContentDraftRow = typeof contentDrafts.$inferSelect;

/** Registered users (email + scrypt password hash). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

export type UserRow = typeof users.$inferSelect;

/** Server-side sessions; the cookie holds a token whose SHA-256 is stored here. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * A user's WordPress site, connected via a WP Application Password (not a full
 * account password — the user generates it in their own WP admin under Users →
 * Profile, and can revoke it there without touching their login). One site per
 * user in this first version. `encryptedAppPassword` is AES-256-GCM ciphertext
 * (see src/lib/integrations/crypto.ts) — never stored or logged in the clear.
 */
export const wordpressConnections = pgTable("wordpress_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  siteUrl: text("site_url").notNull(),
  username: text("username").notNull(),
  encryptedAppPassword: text("encrypted_app_password").notNull(),
});

export type WordPressConnectionRow = typeof wordpressConnections.$inferSelect;

/**
 * One-click-apply record: a Content Studio draft pushed to a WordPress page.
 * `status` mirrors the WP page's own publish/draft status, so "roll back" is
 * always a non-destructive toggle on the customer's own site — nothing WeBind
 * does here can delete a page or lose content.
 */
export const publications = pgTable("publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => contentDrafts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  wpPostId: integer("wp_post_id").notNull(),
  wpViewUrl: text("wp_view_url").notNull(),
  wpEditUrl: text("wp_edit_url").notNull(),
  status: text("status").$type<"published" | "rolled_back">().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

export type PublicationRow = typeof publications.$inferSelect;
