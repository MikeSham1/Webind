import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ReportResult } from "../scoring/types";
import type { OptimizationAssets as OptimizationAssetsData } from "../optimize/assets";
import type {
  ContentInputs,
  DraftStatus,
  GateReport,
} from "../content/types";
import type { VisibilityReport } from "../visibility/types";
import type { PageSnapshot as PageSnapshotData } from "../fixgen/snapshot";
import type { FixCandidate as FixCandidateData } from "../fixgen/types";

/**
 * Every free-report run is logged here (the preview doubles as a lead funnel).
 * `email` is filled in later if the visitor opts into the follow-up.
 * `optimizations` is stored alongside the report (not just held in client
 * state) so the ready-to-apply fixes — and the "open a PR" action built on
 * them — are still there when a signed-in user revisits a past report.
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
  optimizations: jsonb("optimizations").$type<OptimizationAssetsData>(),
});

export type ReportRequest = typeof reportRequests.$inferSelect;

/**
 * Real AI-surfacing outcomes from Keyword Visibility runs — the ground-truth
 * signal the readiness model can eventually be retrained on. Each row is one
 * completed visibility check: for a domain's keywords, did an AI answer engine
 * actually surface the brand? `overallScore` is the measured 0-100 outcome
 * (null when no engine returned a definite verdict); the full `report` is kept
 * so the training export can aggregate however it needs. Append-only; the
 * `userId` FK is set-null so deleting an account anonymizes the sample rather
 * than discarding a measured outcome (matching report_requests).
 */
export const visibilityOutcomes = pgTable("visibility_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  domain: text("domain").notNull(),
  brandName: text("brand_name"),
  /** Measured 0-100 AI visibility across engines, or null if none was definite. */
  overallScore: integer("overall_score"),
  /** Fraction (0-1, stored ×1000 as int) of the probe matrix that ran. */
  coverageBps: integer("coverage_bps"),
  report: jsonb("report").$type<VisibilityReport>(),
});

export type VisibilityOutcomeRow = typeof visibilityOutcomes.$inferSelect;

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
  /**
   * The human's edited-and-approved version, when they changed the draft before
   * approving. The real fine-tuning target (vs the model's original `markdown`);
   * null means approved as-is or not yet approved.
   */
  humanFinal: text("human_final"),
  gates: jsonb("gates").$type<GateReport>(),
  status: text("status").$type<DraftStatus>().notNull().default("pending_review"),
});

export type ContentDraftRow = typeof contentDrafts.$inferSelect;

/**
 * Registered users (email + scrypt password hash). `emailVerifiedAt` is
 * informational only, never a login gate -- this app can run with no email
 * provider configured at all (see src/lib/email.ts), and blocking access on
 * an unverifiable email would lock everyone out in that case, including the
 * seeded admin account.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
});

export type UserRow = typeof users.$inferSelect;

/**
 * Server-side sessions; the cookie holds a token whose SHA-256 is stored here.
 * `userAgent`/`ip` are captured at creation purely so a signed-in user can
 * recognize their own sessions in Settings ("Chrome on Windows, last night") —
 * never used for anything security-decisive.
 */
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
  userAgent: text("user_agent"),
  ip: text("ip"),
});

export type SessionRow = typeof sessions.$inferSelect;

/**
 * Single-use, time-limited password reset tokens. Only the SHA-256 of the raw
 * token is stored (same pattern as sessions) — the raw token exists only in
 * the emailed link and is never persisted or logged anywhere.
 */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

/** Single-use email verification tokens — same shape and pattern as password resets. */
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export type EmailVerificationTokenRow = typeof emailVerificationTokens.$inferSelect;

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
 * One-click-apply record: a Content Studio draft pushed to WordPress.
 *
 * Lifecycle: `pending` (WeBind intends to write, hasn't called WordPress yet)
 * → `wp_draft` (created on WordPress as a DRAFT — not live) → `published`
 * (explicitly confirmed live) → `rolled_back` (flipped back to draft on WP).
 * `failed` marks an attempt whose WordPress call didn't succeed.
 *
 * The `pending` row is written BEFORE the WordPress call, not after — see
 * src/lib/integrations/publications.ts's `beginPublish`. That is what lets a
 * retry tell "nothing happened yet" apart from "something may have happened
 * and we lost track of it" instead of blindly creating a duplicate page.
 * wpPostId/urls are nullable because a `pending` row doesn't have them yet.
 */
export const publications = pgTable("publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => contentDrafts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  wpPostId: integer("wp_post_id"),
  wpViewUrl: text("wp_view_url"),
  wpEditUrl: text("wp_edit_url"),
  /**
   * The WordPress site this row's wpPostId actually belongs to, captured the
   * moment the page is first created — never updated afterward. A user can
   * disconnect and reconnect WordPress to a different site without deleting
   * old publications, and wordpress_connections.user_id is unique (one
   * connection row REPLACED in place on reconnect, same connection id), so
   * neither "the user's current connection" nor "the connection id" alone
   * proves this post still exists on that site. Every write against
   * wpPostId must check it still matches the currently connected site.
   */
  wpSiteUrl: text("wp_site_url"),
  wpConnectionId: uuid("wp_connection_id").references(() => wordpressConnections.id, {
    onDelete: "set null",
  }),
  status: text("status")
    .$type<"pending" | "wp_draft" | "published" | "rolled_back" | "failed">()
    .notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  error: text("error"),
});

export type PublicationRow = typeof publications.$inferSelect;

/**
 * Audit trail for every write WeBind makes to a customer's external site or
 * repo (WordPress publish/rollback, GitHub PR open) — who did it, where, what
 * changed, and whether it worked. Append-only; nothing here is ever updated or
 * deleted by the app.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Monotonic insert order. `created_at` alone can't order two entries written
  // in the same instant (the UUID PK is random, so there's no stable tiebreak),
  // which matters for an append-only trail read newest-first — `seq` makes that
  // ordering deterministic.
  seq: bigserial("seq", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  destination: text("destination").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  result: text("result").$type<"success" | "failure">().notNull(),
  error: text("error"),
});

export type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * A user's GitHub repo, connected via a fine-grained Personal Access Token
 * (Settings → Developer settings → Personal access tokens in the user's own
 * GitHub account, scoped to just this repo's Contents + Pull requests
 * permissions) — not a full account credential, and revocable independently.
 * One repo per user in this first version. `encryptedToken` is AES-256-GCM
 * ciphertext (see src/lib/integrations/crypto.ts).
 */
export const githubConnections = pgTable("github_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
});

export type GitHubConnectionRow = typeof githubConnections.$inferSelect;

/**
 * One-click-apply record for Phase 3: a report's deterministic, file-shaped
 * fixes (llms.txt, robots.txt — never arbitrary template code) opened as a
 * pull request. Unlike WordPress publishing there is no separate "roll back"
 * action here: a PR is already a reversible, human-reviewed proposal — closing
 * it (or not merging it) is the rollback, done by the user on GitHub itself.
 */
export const codeFixPrs = pgTable("code_fix_prs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reportRequestId: uuid("report_request_id")
    .notNull()
    .unique()
    .references(() => reportRequests.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  prNumber: integer("pr_number").notNull(),
  prUrl: text("pr_url").notNull(),
  branchName: text("branch_name").notNull(),
});

export type CodeFixPrRow = typeof codeFixPrs.$inferSelect;

// ---------------------------------------------------------------------------
// Fix Generator — closed-loop intervention learning records.
//
// Deliberately NORMALIZED and multi-dimensional: human judgment, deployment,
// safety, and outcome are never flattened into one reward column. A fix run
// binds to an immutable page_snapshots row (the exact page state it was based
// on), so features/evidence can't drift out from under a recommendation.
// ---------------------------------------------------------------------------

/** The immutable page state a recommendation was generated against. */
export const pageSnapshots = pgTable("page_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  host: text("host").notNull(),
  /** sha256 of the canonical content fields — the snapshot's identity. */
  contentHash: text("content_hash").notNull(),
  pageType: text("page_type").notNull(),
  locale: text("locale"),
  /** The extracted PageSnapshot (title/meta/headings/body/json-ld), not raw HTML. */
  snapshot: jsonb("snapshot").$type<PageSnapshotData>(),
});
export type PageSnapshotRow = typeof pageSnapshots.$inferSelect;

/** One generation run: a diagnosis against a snapshot, by a specific model. */
export const fixRuns = pgTable("fix_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => pageSnapshots.id, { onDelete: "cascade" }),
  signalKey: text("signal_key").notNull(),
  category: text("category").notNull(),
  diagnosis: text("diagnosis").notNull(),
  generatorProvider: text("generator_provider").notNull(),
  generatorModel: text("generator_model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  /** Query context, kept per-run rather than averaged away. */
  queryCluster: text("query_cluster"),
  engine: text("engine"),
});
export type FixRunRow = typeof fixRuns.$inferSelect;

/** One generated candidate (or no_fix) plus its deterministic validation. */
export const fixCandidates = pgTable("fix_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  runId: uuid("run_id")
    .notNull()
    .references(() => fixRuns.id, { onDelete: "cascade" }),
  candidate: jsonb("candidate").$type<FixCandidateData>().notNull(),
  validationOk: boolean("validation_ok").notNull(),
  validationFailures: jsonb("validation_failures").$type<string[]>(),
  rerankerScore: integer("reranker_score"),
});
export type FixCandidateRow = typeof fixCandidates.$inferSelect;

/**
 * The human's judgment on a candidate — the highest-value learning signal.
 * `decision` and the edited final are kept distinct from any downstream SEO
 * outcome so preference and value can be learned separately.
 */
export const fixReviews = pgTable("fix_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => fixCandidates.id, { onDelete: "cascade" }),
  reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
  /** accepted_unedited | accepted_minor_edit | accepted_major_edit | rejected | skipped */
  decision: text("decision").notNull(),
  /** The human's final text when edited — the real training target, not the model's. */
  humanFinal: text("human_final"),
  rejectionReason: text("rejection_reason"),
});
export type FixReviewRow = typeof fixReviews.$inferSelect;

/**
 * When an accepted fix is actually shipped to a live site. Closes the loop
 * between "a human accepted this" and "it went live", so the learning dataset
 * can tell a merely-accepted fix from a deployed one — the precondition for
 * ever measuring real outcomes. Only accepted reviews get a row (enforced in
 * the store). The deployed text is captured because what ships can differ from
 * what was reviewed. Outcome measurement (14/28/56-day) is a separate, later
 * concern that keys off this deployment timestamp.
 */
export const fixDeployments = pgTable("fix_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Deployment timestamp — the clock outcome windows are measured from. */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => fixReviews.id, { onDelete: "cascade" }),
  /** github_pr | wordpress | manual */
  target: text("target").notNull(),
  /** PR URL, post id, commit sha, or similar pointer to the live change. */
  ref: text("ref"),
  /** The exact text that went live, which may differ from the reviewed version. */
  deployedText: text("deployed_text"),
});
export type FixDeploymentRow = typeof fixDeployments.$inferSelect;

/**
 * Registry of every generator/reranker/fix-value model version, so a run,
 * a ranking, or an outcome can always be traced to the exact model + config
 * that produced it. Promotion is a config change recorded here, never a delete.
 */
export const modelVersions = pgTable("model_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(), // generator | reranker | fix_value
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  versionLabel: text("version_label").notNull(),
  metadata: jsonb("metadata"),
});
export type ModelVersionRow = typeof modelVersions.$inferSelect;

/**
 * A user's Stripe subscription. Cascade-deleted with the user (billing state
 * is meaningless without the account). `plan` mirrors the active plan id; the
 * app treats a user with no row (or a non-active status) as the free plan.
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /**
   * When the Stripe event that last actually applied to this row was
   * created. Stripe does not guarantee webhook delivery order; without this,
   * a delayed/retried older event arriving after a newer one has already
   * been applied would silently overwrite it. Null for rows never touched
   * by an event-ordered write (tests, manual fixes).
   */
  lastStripeEventCreatedAt: timestamp("last_stripe_event_created_at", { withTimezone: true }),
});
export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * Every Stripe webhook event id we've finished processing, so a redelivered
 * event (Stripe retries on a non-2xx, and can also just duplicate-deliver) is
 * acknowledged without being re-applied. Append-only; rows are never updated.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe's own event id (evt_...) — the dedupe key
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
export type StripeEventRow = typeof stripeEvents.$inferSelect;

/**
 * Metered feature usage, for enforcing plan quotas (Keyword Visibility probes,
 * Fix Generator runs). One row per usage event; `quantity` lets a single event
 * count for several units (a visibility run probes several keywords). Usage in a
 * calendar month is SUM(quantity) for a user + kind. Never deleted — it's the
 * audit trail behind a quota decision.
 */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** visibility_probe | fix_generation */
  kind: text("kind").notNull(),
  quantity: integer("quantity").notNull().default(1),
});
export type UsageEventRow = typeof usageEvents.$inferSelect;

/**
 * The websites a user works on. This is what lets the product know which site
 * someone means without making them re-type a URL into every conversation.
 *
 * Sites are DISCOVERED, not asked for: every report or site scan a signed-in
 * user runs touches the host here, and a new account backfills from whatever
 * report history it already has. `isPrimary` marks the one used as the default
 * context (the AI planner, prefilled forms); with a single site there is
 * nothing to choose and no prompt is shown.
 *
 * `host` is stored canonically (lowercased, no `www.`) so acme.com,
 * www.acme.com and https://Acme.com/ are one site, not three.
 */
export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Canonical host: lowercase, `www.` stripped. */
    host: text("host").notNull(),
    /** Optional friendly name; falls back to the host in the UI. */
    label: text("label"),
    /** The default site for this user's AI context. At most one true per user. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Last time we saw this site in a report/scan — drives "most recent" ordering. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sites_user_host_idx").on(t.userId, t.host)],
);
export type SiteRow = typeof sites.$inferSelect;
