import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "./schema";
import { __setTestDb } from "./index";

// A stateful in-memory cookie jar so the real session logic can round-trip.
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
  // createSession reads request metadata (UA/IP) purely for display; a real
  // request never reaches this test, so an always-empty Headers is fine.
  headers: async () => new Headers(),
}));

// Imported after the mock so the module picks up the mocked next/headers.
import {
  cleanupExpiredSessions,
  createSession,
  createUser,
  deleteAccount,
  getCurrentUser,
  listSessions,
  logout,
  revokeOtherSessions,
  revokeSession,
  verifyCredentials,
} from "@/lib/auth";
import { consumePasswordResetToken, requestPasswordReset } from "@/lib/auth/passwordReset";
import { hashPassword } from "@/lib/auth/password";
import {
  consumeEmailVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/emailVerification";
import {
  attachEmail,
  claimPendingReport,
  getReportById,
  getReportForUser,
  latestReportForUserHost,
  listAllReports,
  listReportsForUser,
  listReportsForUserHost,
  saveReportRequest,
} from "@/lib/leads";
import {
  listVisibilityOutcomes,
  saveVisibilityOutcome,
} from "@/lib/visibility/store";
import type { VisibilityReport } from "@/lib/visibility/types";
import { makePage } from "@/lib/scoring/test-fixtures";
import { buildSnapshot } from "@/lib/fixgen/snapshot";
import { buildMetaDescriptionContext } from "@/lib/fixgen/context";
import {
  getRunWithCandidates,
  listReviewedExamples,
  persistFixRun,
  recordFixDeployment,
  saveReview,
} from "@/lib/fixgen/store";
import { buildSftDataset } from "@/lib/fixgen/sft-export";
import type { GenerateFixesOutcome } from "@/lib/fixgen/generate";
import type { FixCandidate } from "@/lib/fixgen/types";
import {
  currentDraftMarkdown,
  getDraftForUser,
  listDraftsForUser,
  saveDraft,
  saveDraftEdit,
  setAnyDraftStatus,
  setDraftStatus,
} from "@/lib/content/store";
import { generateDraft } from "@/lib/content/generate";
import {
  clearPlannerConversation,
  getPlannerConversation,
  savePlannerConversation,
} from "@/lib/content/planner-store";
import {
  finishBenchmarkRun,
  saveBenchmarkProgress,
  startOrResumeBenchmarkRun,
} from "@/lib/benchmark/store";
import { seedAccounts } from "./seed";
import type { ReportResult } from "@/lib/scoring/types";
import {
  deleteWordPressConnection,
  getWordPressConnectionStatus,
  getWordPressCredentials,
  saveWordPressConnection,
} from "@/lib/integrations/connections";
import {
  beginPublish,
  destinationMatches,
  getPublicationForDraft,
  recordPublished,
  recordPublishFailed,
  recordRolledBack,
  recordWpDraftCreated,
} from "@/lib/integrations/publications";
import {
  deleteGitHubConnection,
  getGitHubConnectionStatus,
  getGitHubCredentials,
  saveGitHubConnection,
} from "@/lib/integrations/githubConnections";
import { getPrForReport, recordPrOpened } from "@/lib/integrations/codeFixes";
import { listAuditLog, recordAudit } from "@/lib/audit";
import {
  addSite,
  latestReportForHost,
  listSites,
  removeSite,
  resolveActiveSite,
  setPrimarySite,
  touchSite,
} from "@/lib/sites/store";
import { getSubscription, upsertSubscription } from "@/lib/billing/store";

// Captures every "email" the password-reset flow would have sent, so tests
// can pull the reset token out of the link without hitting a real provider.
const { sentEmails } = vi.hoisted(() => ({
  sentEmails: [] as { to: string; subject: string; text: string }[],
}));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
    sentEmails.push(input);
    return { delivered: true };
  }),
}));

// deleteAccount() calls out to Stripe to cancel a live subscription before
// deleting anything — no real Stripe call in a unit test, but the test needs
// to control whether that cancellation succeeds or fails.
const { cancelSubscriptionMock } = vi.hoisted(() => ({
  cancelSubscriptionMock: vi.fn(
    async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }),
  ),
}));
vi.mock("@/lib/billing/stripe", () => ({
  cancelSubscription: cancelSubscriptionMock,
}));

function tokenFromResetEmail(text: string): string {
  const match = /token=([a-f0-9]+)/.exec(text);
  if (!match) throw new Error("no reset token found in email body");
  return match[1];
}

const report = (url: string): ReportResult => ({
  url,
  ai: { total: 50, signals: [], coverage: 1 },
  traditional: { total: 60, signals: [], coverage: 1 },
  prioritizedFixes: [],
  modelVersion: "test",
});

// Kept for tests that need to reach in and directly manipulate a row (e.g.
// backdating a session's expiry) rather than going through the public API.
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  testDb = drizzle(client, { schema });
  __setTestDb(testDb);
  // Apply every generated migration in order — the real schema, not a mock.
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.exec(readFileSync(join(dir, f), "utf8"));
  }
}, 60_000);

describe("accounts + sessions (real Postgres via PGlite)", () => {
  it("signup → session → getCurrentUser → logout round-trips", async () => {
    const created = await createUser("alice@example.com", "password123");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await createSession(created.user.id);
    const me = await getCurrentUser();
    expect(me?.email).toBe("alice@example.com");
    expect(me?.isAdmin).toBe(false);

    await logout();
    expect(await getCurrentUser()).toBeNull();
  });

  it("rejects a duplicate email", async () => {
    await createUser("dup@example.com", "password123");
    expect((await createUser("dup@example.com", "password123")).ok).toBe(false);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    await createUser("bob@example.com", "correcthorse");
    expect((await verifyCredentials("bob@example.com", "correcthorse"))?.email).toBe(
      "bob@example.com",
    );
    expect(await verifyCredentials("bob@example.com", "nope")).toBeNull();
  });
});

describe("report ownership", () => {
  it("scopes reports to their owner; admin sees anonymous ones too", async () => {
    const owner = await createUser("reporter@example.com", "password123");
    const other = await createUser("otherreporter@example.com", "password123");
    if (!owner.ok || !other.ok) throw new Error("setup failed");

    const id = await saveReportRequest(report("https://owned.com"), owner.user.id);
    await saveReportRequest(report("https://anon.com"), null);
    if (!id) throw new Error("setup failed");

    const mine = await listReportsForUser(owner.user.id);
    expect(mine.map((r) => r.url)).toEqual(["https://owned.com"]);

    const all = await listAllReports();
    expect(all.some((r) => r.url === "https://anon.com")).toBe(true);

    // A different user cannot fetch it directly; the owner and an admin can.
    expect(await getReportForUser(id, other.user.id)).toBeNull();
    expect((await getReportForUser(id, owner.user.id))?.url).toBe("https://owned.com");
    expect((await getReportById(id))?.url).toBe("https://owned.com");
  });

  it("persists the narrative, suggestions, and CWV alongside the report so a revisit shows the same thing", async () => {
    const owner = await createUser("narrative-persist@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    const suggestions = [
      {
        key: "metaDescription",
        title: "Tighten the meta description",
        steps: ["Lead with the specific service", "Cut to under 155 characters"],
        rationale: "A tighter description improves click-through from search.",
        aiGenerated: true,
      },
    ];
    const pageExperience = {
      url: "https://narrative-persist.com",
      source: "page" as const,
      overall: "good" as const,
      metrics: [{ metric: "LCP" as const, value: 2100, rating: "good" as const }],
    };
    const scoreAudit = { configured: true, flags: [], note: "Scores look consistent with the page." };

    const id = await saveReportRequest(report("https://narrative-persist.com"), owner.user.id, {
      narrative: "This page is in decent shape.",
      narrativeIsAi: true,
      suggestions,
      suggestionsLocked: false,
      pageExperience,
      scoreAudit,
    });
    if (!id) throw new Error("setup failed");

    const row = await getReportForUser(id, owner.user.id);
    expect(row?.narrative).toBe("This page is in decent shape.");
    expect(row?.narrativeIsAi).toBe(true);
    expect(row?.suggestions).toEqual(suggestions);
    expect(row?.suggestionsLocked).toBe(false);
    expect(row?.pageExperience).toEqual(pageExperience);
    expect(row?.scoreAudit).toEqual(scoreAudit);
  });

  it("defaults the new report extras to unset when the caller doesn't pass any", async () => {
    const owner = await createUser("narrative-default@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const id = await saveReportRequest(report("https://narrative-default.com"), owner.user.id);
    if (!id) throw new Error("setup failed");

    const row = await getReportForUser(id, owner.user.id);
    expect(row?.narrative).toBeNull();
    expect(row?.narrativeIsAi).toBe(false);
    expect(row?.suggestions).toBeNull();
    expect(row?.suggestionsLocked).toBe(false);
    expect(row?.pageExperience).toBeNull();
    expect(row?.scoreAudit).toBeNull();
  });
});

describe("claiming an anonymous report onto a new/existing account", () => {
  it("claims an unowned report", async () => {
    const owner = await createUser("claim1@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const reportId = await saveReportRequest(report("https://claim-test-1.com"), null);
    if (!reportId) throw new Error("setup failed");

    expect(await claimPendingReport(owner.user.id, reportId)).toBe(true);
    expect((await getReportForUser(reportId, owner.user.id))?.url).toBe(
      "https://claim-test-1.com",
    );
  });

  it("refuses to claim a report someone else already owns", async () => {
    const original = await createUser("claim2@example.com", "password123");
    const attacker = await createUser("claim3@example.com", "password123");
    if (!original.ok || !attacker.ok) throw new Error("setup failed");
    const reportId = await saveReportRequest(
      report("https://claim-test-2.com"),
      original.user.id,
    );
    if (!reportId) throw new Error("setup failed");

    expect(await claimPendingReport(attacker.user.id, reportId)).toBe(false);
    expect((await getReportForUser(reportId, original.user.id))?.url).toBe(
      "https://claim-test-2.com",
    );
    expect(await getReportForUser(reportId, attacker.user.id)).toBeNull();
  });
});

describe("report/site host identity matching", () => {
  it("finds a www-prefixed report against its canonical (www-stripped) site host", async () => {
    const owner = await createUser("wwwmatch@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await saveReportRequest(report("https://www.acme-host-test.com/pricing"), owner.user.id);

    // The site is tracked canonically (no www), but the report was run
    // against the www-prefixed URL — a raw host-string comparison would
    // miss it entirely.
    const runs = await listReportsForUserHost(owner.user.id, "acme-host-test.com");
    expect(runs).toHaveLength(1);
    expect(await latestReportForUserHost(owner.user.id, "acme-host-test.com")).not.toBeNull();
    expect(await latestReportForHost(owner.user.id, "acme-host-test.com")).not.toBeNull();
  });

  it("does not match a similarly-named but different domain", async () => {
    const owner = await createUser("similardomain@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await saveReportRequest(report("https://notexample-host-test.com/"), owner.user.id);

    expect(await listReportsForUserHost(owner.user.id, "example-host-test.com")).toEqual([]);
    expect(await latestReportForUserHost(owner.user.id, "example-host-test.com")).toBeNull();
    expect(await latestReportForHost(owner.user.id, "example-host-test.com")).toBeNull();
  });

  it("latestReportForUserHost returns the newest report, not the oldest", async () => {
    const owner = await createUser("newestreport@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await saveReportRequest(report("https://newest-host-test.com/"), owner.user.id);
    await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
    await saveReportRequest(
      { ...report("https://newest-host-test.com/"), ai: { total: 91, signals: [], coverage: 1 } },
      owner.user.id,
    );

    // listReportsForUserHost is deliberately oldest-first (the history/trend
    // shape) — its own first element is the OLDEST match, which is exactly
    // the bug this dedicated function exists to not reproduce.
    const history = await listReportsForUserHost(owner.user.id, "newest-host-test.com");
    expect(history[0].aiTotal).not.toBe(91);

    const latest = await latestReportForUserHost(owner.user.id, "newest-host-test.com");
    expect(latest?.aiTotal).toBe(91);
  });
});

describe("draft ownership + moderation", () => {
  it("only the owner can read/decide, and an admin can override", async () => {
    const owner = await createUser("draftowner@example.com", "password123");
    const other = await createUser("draftother@example.com", "password123");
    if (!owner.ok || !other.ok) throw new Error("setup failed");

    const inputs = {
      topic: "Managed IT",
      pageType: "landing" as const,
      audience: "smbs",
      tone: "professional",
      keyFacts: ["24/7 helpdesk"],
    };
    const draft = await generateDraft(inputs);
    const id = await saveDraft(inputs, draft, owner.user.id);
    expect(id).toBeTruthy();
    if (!id) return;

    // A different user cannot see or moderate it.
    expect(await getDraftForUser(id, other.user.id)).toBeNull();
    expect(await setDraftStatus(id, other.user.id, "approved")).toBe(false);

    // The owner can.
    expect(await getDraftForUser(id, owner.user.id)).not.toBeNull();
    expect(await setDraftStatus(id, owner.user.id, "approved")).toBe(true);

    // Admin override reaches any draft.
    expect(await setAnyDraftStatus(id, "rejected")).toBe(true);
  });

  it("autosaves an in-progress edit and shows it on reload, without touching the original generation", async () => {
    const owner = await createUser("draftautosave@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    const inputs = {
      topic: "Managed IT",
      pageType: "landing" as const,
      audience: "smbs",
      tone: "professional",
      keyFacts: ["24/7 helpdesk"],
    };
    const draft = await generateDraft(inputs);
    const id = await saveDraft(inputs, draft, owner.user.id);
    if (!id) throw new Error("setup failed");

    // Before any edit, the working copy is just the original generation.
    const fresh = await getDraftForUser(id, owner.user.id);
    expect(fresh && currentDraftMarkdown(fresh)).toBe(draft.markdown);

    expect(await saveDraftEdit(id, owner.user.id, "edited but not yet approved")).toBe(true);
    const withEdit = await getDraftForUser(id, owner.user.id);
    expect(withEdit?.markdown).toBe(draft.markdown); // original generation untouched
    expect(withEdit && currentDraftMarkdown(withEdit)).toBe("edited but not yet approved");

    // Someone else's autosave attempt doesn't touch it.
    const other = await createUser("draftautosave-other@example.com", "password123");
    if (!other.ok) throw new Error("setup failed");
    expect(await saveDraftEdit(id, other.user.id, "hijacked")).toBe(false);

    // Once approved, the approved revision wins over any autosaved edit.
    expect(await setDraftStatus(id, owner.user.id, "approved", "the actually-approved text")).toBe(
      true,
    );
    const decided = await getDraftForUser(id, owner.user.id);
    expect(decided && currentDraftMarkdown(decided)).toBe("the actually-approved text");

    // And a further autosave attempt is refused now that it's no longer pending review.
    expect(await saveDraftEdit(id, owner.user.id, "too late")).toBe(false);
  });
});

describe("planner conversation persistence", () => {
  it("round-trips a saved conversation, and starts empty for a user who's never saved one", async () => {
    const u = await createUser("planner-persist@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    expect(await getPlannerConversation(u.user.id, null)).toEqual([]);

    const turn1 = [{ role: "user" as const, text: "Write a landing page for my IT support business" }];
    await savePlannerConversation(u.user.id, null, turn1);
    expect(await getPlannerConversation(u.user.id, null)).toEqual(turn1);

    // A later save replaces the row rather than accumulating a second one.
    const turn2 = [...turn1, { role: "assistant" as const, text: "What's your target audience?" }];
    await savePlannerConversation(u.user.id, null, turn2);
    expect(await getPlannerConversation(u.user.id, null)).toEqual(turn2);
  });

  it("clears the saved conversation on request", async () => {
    const u = await createUser("planner-clear@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    await savePlannerConversation(u.user.id, null, [{ role: "user", text: "hello" }]);
    expect(await getPlannerConversation(u.user.id, null)).toHaveLength(1);

    await clearPlannerConversation(u.user.id, null);
    expect(await getPlannerConversation(u.user.id, null)).toEqual([]);
  });

  it("scopes conversations per user", async () => {
    const a = await createUser("planner-a@example.com", "password123");
    const b = await createUser("planner-b@example.com", "password123");
    if (!a.ok || !b.ok) throw new Error("setup failed");

    await savePlannerConversation(a.user.id, null, [{ role: "user", text: "a's message" }]);
    expect(await getPlannerConversation(b.user.id, null)).toEqual([]);
    expect(await getPlannerConversation(a.user.id, null)).toEqual([{ role: "user", text: "a's message" }]);
  });

  it("scopes conversations per site, not just per user — switching sites switches the conversation", async () => {
    const u = await createUser("planner-sites@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    // Free's 1-site cap would silently drop the second touchSite below; this
    // test is about per-site conversation scoping, not plan limits.
    await upsertSubscription({ userId: u.user.id, plan: "growth", status: "active" });
    await touchSite(u.user.id, "site-a.example");
    await touchSite(u.user.id, "site-b.example");
    const [siteA, siteB] = (await listSites(u.user.id)).sort((x, y) => x.host.localeCompare(y.host));

    await savePlannerConversation(u.user.id, siteA.id, [{ role: "user", text: "about site A" }]);
    await savePlannerConversation(u.user.id, siteB.id, [{ role: "user", text: "about site B" }]);

    expect(await getPlannerConversation(u.user.id, siteA.id)).toEqual([
      { role: "user", text: "about site A" },
    ]);
    expect(await getPlannerConversation(u.user.id, siteB.id)).toEqual([
      { role: "user", text: "about site B" },
    ]);
    // Clearing one site's conversation doesn't touch the other's.
    await clearPlannerConversation(u.user.id, siteA.id);
    expect(await getPlannerConversation(u.user.id, siteA.id)).toEqual([]);
    expect(await getPlannerConversation(u.user.id, siteB.id)).toEqual([
      { role: "user", text: "about site B" },
    ]);
  });

  it("doesn't let a site-less scratchpad accumulate duplicate rows across repeated saves", async () => {
    // Regression guard for the NULL-uniqueness gap called out in the schema
    // comment: without the application-level select-then-branch, two saves
    // with siteId=null could both insert instead of the second updating.
    const u = await createUser("planner-nosite-dedup@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    await savePlannerConversation(u.user.id, null, [{ role: "user", text: "first" }]);
    await savePlannerConversation(u.user.id, null, [{ role: "user", text: "second" }]);
    // If a duplicate row had been inserted, getPlannerConversation's LIMIT 1
    // could non-deterministically return either row — asserting the exact
    // latest content (not just "some row exists") catches that.
    expect(await getPlannerConversation(u.user.id, null)).toEqual([{ role: "user", text: "second" }]);
  });
});

describe("resumable benchmark runs", () => {
  it("starts fresh with empty progress when nothing's running yet", async () => {
    const u = await createUser("benchmark-fresh@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    const { id, progress } = await startOrResumeBenchmarkRun(
      u.user.id,
      "https://target.example",
      "best crm",
    );
    expect(id).toBeTruthy();
    expect(progress).toEqual({ cohort: null, target: null, competitors: [] });
  });

  it("resumes the same running row for the same user + url + query, and stops offering it once finished", async () => {
    const u = await createUser("benchmark-resume@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    const first = await startOrResumeBenchmarkRun(u.user.id, "https://target.example", "best crm");
    const checkpoint = {
      cohort: [{ url: "https://r1.example", domain: "r1.example", position: 1, cohort: "top" as const }],
      target: { ai: 80, traditional: 70 },
      competitors: [],
    };
    await saveBenchmarkProgress(first.id, checkpoint);

    // A second call with identical inputs picks up exactly where the first left off.
    const second = await startOrResumeBenchmarkRun(u.user.id, "https://target.example", "best crm");
    expect(second.id).toBe(first.id);
    expect(second.progress).toEqual(checkpoint);

    // Once finished, that same running row is no longer offered — a fresh
    // request starts a brand-new run.
    await finishBenchmarkRun(first.id, "done");
    const third = await startOrResumeBenchmarkRun(u.user.id, "https://target.example", "best crm");
    expect(third.id).not.toBe(first.id);
    expect(third.progress).toEqual({ cohort: null, target: null, competitors: [] });
  });

  it("never resumes another user's run, or a different query for the same user", async () => {
    const owner = await createUser("benchmark-owner@example.com", "password123");
    const other = await createUser("benchmark-other@example.com", "password123");
    if (!owner.ok || !other.ok) throw new Error("setup failed");

    const run = await startOrResumeBenchmarkRun(owner.user.id, "https://target.example", "best crm");
    await saveBenchmarkProgress(run.id, {
      cohort: [],
      target: { ai: 1, traditional: 1 },
      competitors: [],
    });

    const otherUser = await startOrResumeBenchmarkRun(other.user.id, "https://target.example", "best crm");
    expect(otherUser.id).not.toBe(run.id);

    const differentQuery = await startOrResumeBenchmarkRun(
      owner.user.id,
      "https://target.example",
      "a totally different query",
    );
    expect(differentQuery.id).not.toBe(run.id);
  });

  it("a run that errors out cleanly is marked failed, not left resumable", async () => {
    const u = await createUser("benchmark-failed@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    const run = await startOrResumeBenchmarkRun(u.user.id, "https://target.example", "best crm");
    await finishBenchmarkRun(run.id, "failed");

    const next = await startOrResumeBenchmarkRun(u.user.id, "https://target.example", "best crm");
    expect(next.id).not.toBe(run.id);
  });
});

describe("WordPress connection", () => {
  it("stores credentials encrypted, and fails closed without the key", async () => {
    const owner = await createUser("wpuser@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    vi.stubEnv("CREDENTIALS_KEY", Buffer.alloc(32, 3).toString("base64"));
    const creds = { siteUrl: "https://acme.example", username: "editor", appPassword: "abcd 1234 efgh 5678" };
    expect(await saveWordPressConnection(owner.user.id, creds)).toBe(true);

    const status = await getWordPressConnectionStatus(owner.user.id);
    expect(status).toEqual({ siteUrl: creds.siteUrl, username: creds.username });

    const decrypted = await getWordPressCredentials(owner.user.id);
    expect(decrypted).toEqual({ ...creds, connectionId: decrypted?.connectionId });
    expect(decrypted?.connectionId).toBeTruthy();

    // Without the key configured, the row exists but the secret is unusable.
    vi.unstubAllEnvs();
    expect(await getWordPressCredentials(owner.user.id)).toBeNull();
    expect(await getWordPressConnectionStatus(owner.user.id)).toEqual({
      siteUrl: creds.siteUrl,
      username: creds.username,
    });

    expect(await deleteWordPressConnection(owner.user.id)).toBe(true);
    expect(await getWordPressConnectionStatus(owner.user.id)).toBeNull();
  });
});

describe("publications (pending -> wp_draft -> published -> rolled_back)", () => {
  async function newDraft(userId: string): Promise<string> {
    const inputs = {
      topic: "Managed IT",
      pageType: "landing" as const,
      audience: "smbs",
      tone: "professional",
      keyFacts: ["24/7 helpdesk"],
    };
    const draftId = await saveDraft(inputs, await generateDraft(inputs), userId);
    if (!draftId) throw new Error("setup failed");
    return draftId;
  }

  const page = {
    postId: 7,
    viewUrl: "https://acme.example/managed-it/",
    editUrl: "https://acme.example/wp-admin/post.php?post=7&action=edit",
    previewUrl: "https://acme.example/?page_id=7&preview=true",
  };

  /** A real WordPress connection, so a destination has a real connectionId to reference. */
  async function connectWordPress(
    userId: string,
  ): Promise<{ siteUrl: string; connectionId: string; postType: "page" | "post" }> {
    vi.stubEnv("CREDENTIALS_KEY", Buffer.alloc(32, 9).toString("base64"));
    await saveWordPressConnection(userId, {
      siteUrl: "https://acme.example",
      username: "editor",
      appPassword: "abcd efgh ijkl mnop",
    });
    const creds = await getWordPressCredentials(userId);
    if (!creds) throw new Error("setup failed");
    return { siteUrl: creds.siteUrl, connectionId: creds.connectionId, postType: "page" };
  }

  it("records pending BEFORE any WordPress call, then progresses through the full lifecycle", async () => {
    const owner = await createUser("publisher@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);
    const destination = await connectWordPress(owner.user.id);

    expect(await getPublicationForDraft(draftId)).toBeNull();

    const begin = await beginPublish(draftId, owner.user.id);
    expect(begin.ok).toBe(true);
    let row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("pending");
    expect(row?.wpPostId).toBeNull(); // nothing on WordPress yet -- intent only

    expect(await recordWpDraftCreated(draftId, page, destination)).toBe(true);
    row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("wp_draft");
    expect(row?.wpPostId).toBe(7);
    expect(row?.publishedAt).toBeNull(); // draft, not live

    expect(await recordPublished(draftId, owner.user.id, page)).toBe(true);
    row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("published");
    expect(row?.publishedAt).not.toBeNull();
    expect(row?.rolledBackAt).toBeNull();

    expect(await recordRolledBack(draftId)).toBe(true);
    row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("rolled_back");
    expect(row?.rolledBackAt).not.toBeNull();
  });

  it("beginPublish refuses a duplicate attempt while one is genuinely in flight", async () => {
    const owner = await createUser("publisher2@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);

    expect((await beginPublish(draftId, owner.user.id)).ok).toBe(true);
    const second = await beginPublish(draftId, owner.user.id);
    expect(second).toMatchObject({ ok: false, reason: "in_progress" });
  });

  it("beginPublish reconciles a stale pending row instead of blocking forever", async () => {
    const owner = await createUser("publisher3@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);

    await beginPublish(draftId, owner.user.id);
    // Simulate a crashed attempt: age the pending row past the reconciliation
    // window without ever calling recordWpDraftCreated/recordPublishFailed.
    await testDb
      .update(schema.publications)
      .set({ updatedAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(schema.publications.draftId, draftId));

    const retried = await beginPublish(draftId, owner.user.id);
    expect(retried.ok).toBe(true); // reclaimed, not stuck behind the abandoned attempt
  });

  it("beginPublish returns already_active for an existing wp_draft or published row, never duplicating", async () => {
    const owner = await createUser("publisher4@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);
    const destination = await connectWordPress(owner.user.id);

    await beginPublish(draftId, owner.user.id);
    await recordWpDraftCreated(draftId, page, destination);

    const attempt = await beginPublish(draftId, owner.user.id);
    expect(attempt).toMatchObject({ ok: false, reason: "already_active" });
    if (!attempt.ok && attempt.reason === "already_active") {
      expect(attempt.row.status).toBe("wp_draft");
      expect(attempt.row.wpPostId).toBe(7);
    }
  });

  it("recordPublishFailed marks the attempt failed, and a later beginPublish allows retry (no duplicate)", async () => {
    const owner = await createUser("publisher5@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);

    await beginPublish(draftId, owner.user.id);
    expect(await recordPublishFailed(draftId, "WordPress timed out")).toBe(true);

    const row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("WordPress timed out");

    // A failed attempt never created anything on WordPress, so a retry is safe.
    const retried = await beginPublish(draftId, owner.user.id);
    expect(retried.ok).toBe(true);
  });

  it("two concurrent claims on the same never-published draft: exactly one wins", async () => {
    const owner = await createUser("publisher6@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);

    // Both calls read "no existing row" before either has inserted — the
    // unique constraint on draftId decides the race, and the loser must get
    // a clean claim_failed, never { ok: true }.
    const [a, b] = await Promise.all([
      beginPublish(draftId, owner.user.id),
      beginPublish(draftId, owner.user.id),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toMatchObject({ ok: false, reason: "claim_failed" });
  });

  it("confirming go-live refuses when the WordPress connection now points at a different site", async () => {
    const owner = await createUser("publisher7@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);
    await connectWordPress(owner.user.id);

    await beginPublish(draftId, owner.user.id);
    await recordWpDraftCreated(draftId, page, {
      siteUrl: "https://acme.example",
      connectionId: (await getWordPressCredentials(owner.user.id))!.connectionId,
      postType: "page",
    });

    // Reconnect to a completely different site — same connection row (unique
    // on userId), new siteUrl.
    vi.stubEnv("CREDENTIALS_KEY", Buffer.alloc(32, 9).toString("base64"));
    await saveWordPressConnection(owner.user.id, {
      siteUrl: "https://different-client.example",
      username: "editor",
      appPassword: "zzzz yyyy xxxx wwww",
    });

    const row = await getPublicationForDraft(draftId);
    expect(row?.wpSiteUrl).toBe("https://acme.example");
    const creds = await getWordPressCredentials(owner.user.id);
    expect(creds?.siteUrl).toBe("https://different-client.example");
    expect(destinationMatches(row!, creds!.siteUrl)).toBe(false);
  });
});

describe("GitHub connection", () => {
  it("stores the token encrypted, and fails closed without the key", async () => {
    const owner = await createUser("ghuser@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    vi.stubEnv("CREDENTIALS_KEY", Buffer.alloc(32, 5).toString("base64"));
    const creds = { owner: "acme", repo: "site", token: "ghp_abcd1234" };
    expect(await saveGitHubConnection(owner.user.id, creds)).toBe(true);

    const status = await getGitHubConnectionStatus(owner.user.id);
    expect(status).toEqual({ owner: creds.owner, repo: creds.repo });

    const decrypted = await getGitHubCredentials(owner.user.id);
    expect(decrypted).toEqual(creds);

    vi.unstubAllEnvs();
    expect(await getGitHubCredentials(owner.user.id)).toBeNull();
    expect(await getGitHubConnectionStatus(owner.user.id)).toEqual({
      owner: creds.owner,
      repo: creds.repo,
    });

    expect(await deleteGitHubConnection(owner.user.id)).toBe(true);
    expect(await getGitHubConnectionStatus(owner.user.id)).toBeNull();
  });
});

describe("code fix PRs", () => {
  it("tracks the PR opened for a report", async () => {
    const owner = await createUser("prowner@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    const reportId = await saveReportRequest(report("https://fixme.com"), owner.user.id);
    if (!reportId) throw new Error("setup failed");

    expect(await getPrForReport(reportId)).toBeNull();

    const pr = { prNumber: 12, prUrl: "https://github.com/acme/site/pull/12", branchName: "webind/fix-1" };
    expect(await recordPrOpened(reportId, owner.user.id, pr)).toBe(true);

    const row = await getPrForReport(reportId);
    expect(row?.prNumber).toBe(12);
    expect(row?.prUrl).toBe(pr.prUrl);
  });
});

describe("account seeding", () => {
  it("creates an admin from env on first run, but a later boot never rewrites its password", async () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", "admin@webind.design");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "adminpass123");
    await seedAccounts();

    const admin = await verifyCredentials("admin@webind.design", "adminpass123");
    expect(admin?.isAdmin).toBe(true);

    // Simulates the account holder changing their password through the
    // normal flow (password reset, or Settings) — this must survive every
    // later restart's re-run of seedAccounts(), not get silently reverted to
    // whatever's still sitting in SEED_ADMIN_PASSWORD.
    await testDb
      .update(schema.users)
      .set({ passwordHash: await hashPassword("hand-changed-789") })
      .where(eq(schema.users.id, admin!.id));

    // A later boot with a DIFFERENT env password must not touch the password
    // the account holder actually set.
    vi.stubEnv("SEED_ADMIN_PASSWORD", "rotated456");
    await seedAccounts();
    expect(await verifyCredentials("admin@webind.design", "hand-changed-789")).not.toBeNull();
    expect(await verifyCredentials("admin@webind.design", "rotated456")).toBeNull();

    vi.unstubAllEnvs();
  });

  it("still syncs the admin flag on an existing seeded account — a deliberate operator config, not a self-service action", async () => {
    vi.stubEnv("SEED_USER_EMAIL", "promote-me@webind.design");
    vi.stubEnv("SEED_USER_PASSWORD", "userpass123");
    await seedAccounts();
    expect((await verifyCredentials("promote-me@webind.design", "userpass123"))?.isAdmin).toBe(
      false,
    );

    vi.stubEnv("SEED_ADMIN_EMAIL", "promote-me@webind.design");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "userpass123");
    vi.stubEnv("SEED_USER_EMAIL", "");
    vi.stubEnv("SEED_USER_PASSWORD", "");
    await seedAccounts();
    expect((await verifyCredentials("promote-me@webind.design", "userpass123"))?.isAdmin).toBe(
      true,
    );

    vi.unstubAllEnvs();
  });
});

describe("session management", () => {
  it("lists a user's sessions and lets them revoke one by id", async () => {
    const owner = await createUser("sessions1@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await createSession(owner.user.id);
    const mine = await listSessions(owner.user.id);
    expect(mine).toHaveLength(1);

    // Another user can't revoke it.
    const other = await createUser("sessions2@example.com", "password123");
    if (!other.ok) throw new Error("setup failed");
    expect(await revokeSession(other.user.id, mine[0].id)).toBe(false);

    // The owner can.
    expect(await revokeSession(owner.user.id, mine[0].id)).toBe(true);
    expect(await listSessions(owner.user.id)).toHaveLength(0);
  });

  it("revokeOtherSessions can keep one session and drop the rest, or drop all", async () => {
    const owner = await createUser("sessions3@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await createSession(owner.user.id);
    await createSession(owner.user.id);
    await createSession(owner.user.id);
    const [keep, ...rest] = await listSessions(owner.user.id);
    expect(rest).toHaveLength(2);

    await revokeOtherSessions(owner.user.id, keep.id);
    const afterPartial = await listSessions(owner.user.id);
    expect(afterPartial.map((s) => s.id)).toEqual([keep.id]);

    await revokeOtherSessions(owner.user.id);
    expect(await listSessions(owner.user.id)).toHaveLength(0);
  });

  it("cleanupExpiredSessions removes only expired rows", async () => {
    const owner = await createUser("sessions4@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    await createSession(owner.user.id);

    // Directly age one session into the past to simulate expiry without
    // waiting 30 real days.
    const [row] = await listSessions(owner.user.id);
    await testDb
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.id, row.id));

    const removed = await cleanupExpiredSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await listSessions(owner.user.id)).toHaveLength(0);
  });
});

describe("account deletion", () => {
  afterEach(() => {
    cancelSubscriptionMock.mockClear();
    cancelSubscriptionMock.mockResolvedValue({ ok: true });
  });

  it("refuses with the wrong password and leaves the account intact", async () => {
    const owner = await createUser("delete1@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");

    const result = await deleteAccount(owner.user.id, "wrongpassword");
    expect(result).toEqual({ ok: false, error: "Incorrect password." });
    expect(await verifyCredentials("delete1@example.com", "correctpass1")).not.toBeNull();
  });

  it("cancels a live Stripe subscription before deleting the account", async () => {
    const owner = await createUser("delete-billing1@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");
    await upsertSubscription({
      userId: owner.user.id,
      stripeCustomerId: "cus_del1",
      stripeSubscriptionId: "sub_del1",
      plan: "starter",
      status: "active",
    });

    const result = await deleteAccount(owner.user.id, "correctpass1");
    expect(result).toEqual({ ok: true });
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("sub_del1");
    expect(await verifyCredentials("delete-billing1@example.com", "correctpass1")).toBeNull();
  });

  it("refuses to delete the account when canceling billing fails, and leaves everything intact", async () => {
    const owner = await createUser("delete-billing2@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");
    await upsertSubscription({
      userId: owner.user.id,
      stripeCustomerId: "cus_del2",
      stripeSubscriptionId: "sub_del2",
      plan: "starter",
      status: "active",
    });
    cancelSubscriptionMock.mockResolvedValueOnce({ ok: false, error: "Stripe is down" });

    const result = await deleteAccount(owner.user.id, "correctpass1");
    expect(result.ok).toBe(false);

    // Nothing was touched: the account and its subscription record still exist.
    expect(await verifyCredentials("delete-billing2@example.com", "correctpass1")).not.toBeNull();
    expect((await getSubscription(owner.user.id))?.status).toBe("active");
  });

  it("deletes an account with no subscription without ever calling Stripe", async () => {
    const owner = await createUser("delete-billing3@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");

    expect(await deleteAccount(owner.user.id, "correctpass1")).toEqual({ ok: true });
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
  });

  it("clears the lead-capture email from a deleted user's reports — unlinking userId alone is not anonymization", async () => {
    const owner = await createUser("delete-email@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");

    const reportId = await saveReportRequest(report("https://redact-email-test.com"), owner.user.id);
    if (!reportId) throw new Error("setup failed");
    expect(await attachEmail(reportId, "owner-left-this@example.com")).toBe(true);

    expect(await deleteAccount(owner.user.id, "correctpass1")).toEqual({ ok: true });

    const [row] = await testDb
      .select()
      .from(schema.reportRequests)
      .where(eq(schema.reportRequests.id, reportId));
    expect(row.userId).toBeNull();
    expect(row.email).toBeNull();
  });

  it("deletes the user, cascades sessions/connections, but anonymizes reports and drafts", async () => {
    const owner = await createUser("delete2@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");
    const userId = owner.user.id;

    await createSession(userId);
    await saveWordPressConnection(userId, {
      siteUrl: "https://example.com",
      username: "editor",
      appPassword: "abcd efgh ijkl mnop",
    });
    await saveGitHubConnection(userId, { owner: "acme", repo: "site", token: "ghp_test" });
    const reportId = await saveReportRequest(report("https://example.com"), userId);
    const inputs = {
      topic: "Widgets",
      pageType: "landing" as const,
      audience: "smbs",
      tone: "professional",
      keyFacts: ["ships worldwide"],
    };
    const draftId = await saveDraft(inputs, await generateDraft(inputs), userId);

    const result = await deleteAccount(userId, "correctpass1");
    expect(result).toEqual({ ok: true });

    // The account itself, and everything FK-cascaded to it, is gone.
    expect(await verifyCredentials("delete2@example.com", "correctpass1")).toBeNull();
    expect(await listSessions(userId)).toHaveLength(0);
    expect(await getWordPressConnectionStatus(userId)).toBeNull();
    expect(await getGitHubConnectionStatus(userId)).toBeNull();

    // Reports/drafts are anonymized (userId cleared), not deleted outright —
    // same rule an anonymous, logged-out run already uses.
    expect(reportId).not.toBeNull();
    const [reportRow] = await testDb
      .select()
      .from(schema.reportRequests)
      .where(eq(schema.reportRequests.id, reportId!));
    expect(reportRow.userId).toBeNull();

    expect(draftId).not.toBeNull();
    const [draftRow] = await testDb
      .select()
      .from(schema.contentDrafts)
      .where(eq(schema.contentDrafts.id, draftId!));
    expect(draftRow.userId).toBeNull();
  });
});

describe("password reset", () => {
  it("requests a reset, emails a working link, and the new password takes effect", async () => {
    const owner = await createUser("reset1@example.com", "originalpass1");
    if (!owner.ok) throw new Error("setup failed");
    sentEmails.length = 0;

    await requestPasswordReset("reset1@example.com", "https://app.example.com");
    expect(sentEmails).toHaveLength(1);
    const token = tokenFromResetEmail(sentEmails[0].text);

    const result = await consumePasswordResetToken(token, "brandnewpass1");
    expect(result.ok).toBe(true);

    expect(await verifyCredentials("reset1@example.com", "brandnewpass1")).not.toBeNull();
    expect(await verifyCredentials("reset1@example.com", "originalpass1")).toBeNull();
  });

  it("is silent (no email, no error) for an unregistered address — prevents enumeration", async () => {
    sentEmails.length = 0;
    await requestPasswordReset("nobody-here@example.com", "https://app.example.com");
    expect(sentEmails).toHaveLength(0);
  });

  it("rejects reusing an already-consumed token", async () => {
    const owner = await createUser("reset2@example.com", "originalpass1");
    if (!owner.ok) throw new Error("setup failed");
    sentEmails.length = 0;

    await requestPasswordReset("reset2@example.com", "https://app.example.com");
    const token = tokenFromResetEmail(sentEmails[0].text);

    expect((await consumePasswordResetToken(token, "firstnewpass1")).ok).toBe(true);
    const second = await consumePasswordResetToken(token, "secondnewpass1");
    expect(second.ok).toBe(false);

    // The FIRST reset's password is what actually took effect.
    expect(await verifyCredentials("reset2@example.com", "firstnewpass1")).not.toBeNull();
  });

  it("rejects a garbage/unknown token", async () => {
    const result = await consumePasswordResetToken("not-a-real-token", "somenewpassword1");
    expect(result.ok).toBe(false);
  });

  it("revokes existing sessions when a reset succeeds", async () => {
    const owner = await createUser("reset3@example.com", "originalpass1");
    if (!owner.ok) throw new Error("setup failed");
    await createSession(owner.user.id);
    await createSession(owner.user.id);
    expect(await listSessions(owner.user.id)).toHaveLength(2);

    sentEmails.length = 0;
    await requestPasswordReset("reset3@example.com", "https://app.example.com");
    const token = tokenFromResetEmail(sentEmails[0].text);
    await consumePasswordResetToken(token, "brandnewpass1");

    expect(await listSessions(owner.user.id)).toHaveLength(0);
  });
});

describe("email verification", () => {
  it("is unverified on signup, verified after consuming the emailed link", async () => {
    const owner = await createUser("verify1@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    await createSession(owner.user.id);
    expect((await getCurrentUser())?.emailVerifiedAt).toBeNull();

    sentEmails.length = 0;
    await sendVerificationEmail(owner.user.id, "verify1@example.com", "https://app.example.com");
    expect(sentEmails).toHaveLength(1);
    const token = tokenFromResetEmail(sentEmails[0].text);

    expect((await consumeEmailVerificationToken(token)).ok).toBe(true);
    expect((await getCurrentUser())?.emailVerifiedAt).not.toBeNull();
  });

  it("rejects reusing an already-consumed verification token", async () => {
    const owner = await createUser("verify2@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    sentEmails.length = 0;
    await sendVerificationEmail(owner.user.id, "verify2@example.com", "https://app.example.com");
    const token = tokenFromResetEmail(sentEmails[0].text);

    expect((await consumeEmailVerificationToken(token)).ok).toBe(true);
    expect((await consumeEmailVerificationToken(token)).ok).toBe(false);
  });

  it("rejects a garbage/unknown verification token", async () => {
    expect((await consumeEmailVerificationToken("not-a-real-token")).ok).toBe(false);
  });

  it("seeded accounts are pre-verified", async () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", "preverified-admin@webind.design");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "adminpass123");
    await seedAccounts();

    const [row] = await testDb
      .select({ emailVerifiedAt: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.email, "preverified-admin@webind.design"))
      .limit(1);
    expect(row?.emailVerifiedAt).not.toBeNull();

    vi.unstubAllEnvs();
  });
});

describe("audit trail", () => {
  it("records both successful and failed writes, newest first, and never throws", async () => {
    const owner = await createUser("auditor@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");

    await recordAudit({
      actorUserId: owner.user.id,
      action: "wordpress.publish",
      destination: "https://acme.example",
      beforeState: { status: "wp_draft" },
      afterState: { status: "published" },
      result: "success",
    });
    await recordAudit({
      actorUserId: owner.user.id,
      action: "github.open_pr",
      destination: "acme/site",
      result: "failure",
      error: "GitHub rejected that Personal Access Token.",
    });

    const entries = await listAuditLog(10);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(entries[0].action).toBe("github.open_pr");
    expect(entries[0].result).toBe("failure");
    expect(entries[0].error).toMatch(/rejected/);
    expect(entries[1].action).toBe("wordpress.publish");
    expect(entries[1].result).toBe("success");
    expect(entries[1].beforeState).toEqual({ status: "wp_draft" });
    expect(entries[1].afterState).toEqual({ status: "published" });
  });

  it("accepts a null actor for system-initiated entries", async () => {
    await recordAudit({
      actorUserId: null,
      action: "cron.cleanup_sessions",
      destination: "system",
      result: "success",
    });
    const entries = await listAuditLog(1);
    expect(entries[0].actorUserId).toBeNull();
  });
});

describe("visibility outcomes (real training data)", () => {
  function report(overrides: Partial<VisibilityReport> = {}): VisibilityReport {
    return {
      domain: "acme.test",
      brandName: "Acme",
      keywords: [],
      overallScore: 55,
      coverage: 0.75,
      topCompetitors: ["Globex"],
      recommendations: [],
      enginesUsed: ["claude"],
      ...overrides,
    };
  }

  it("persists a measured outcome and reads it back", async () => {
    const owner = await createUser("vis-owner@example.com", "correcthorse1");
    if (!owner.ok) throw new Error("setup failed");

    const id = await saveVisibilityOutcome(
      report({ domain: "roundtrip.test", overallScore: 62, coverage: 0.5 }),
      owner.user.id,
    );
    expect(id).not.toBeNull();

    const rows = await listVisibilityOutcomes();
    const row = rows.find((r) => r.domain === "roundtrip.test");
    expect(row).toBeDefined();
    expect(row?.overallScore).toBe(62);
    expect(row?.coverageBps).toBe(500); // 0.5 stored ×1000
    expect(row?.userId).toBe(owner.user.id);
    expect(row?.report?.brandName).toBe("Acme");
  });

  it("stores an anonymous-safe null score without dropping the row", async () => {
    const id = await saveVisibilityOutcome(
      report({ domain: "noscore.test", overallScore: null, coverage: 0 }),
      null,
    );
    expect(id).not.toBeNull();
    const rows = await listVisibilityOutcomes();
    const row = rows.find((r) => r.domain === "noscore.test");
    expect(row?.overallScore).toBeNull();
    expect(row?.userId).toBeNull();
  });
});

describe("fix generator persistence", () => {
  function fix(overrides: Partial<FixCandidate> = {}): FixCandidate {
    return {
      candidateId: "c1",
      action: "fix",
      category: "metadata",
      target: "<head>",
      before: null,
      after: '<meta name="description" content="Acme widgets for small business.">',
      rationale: "Summarizes the page.",
      evidenceSpanIds: ["ev_001"],
      confidence: "high",
      applyVia: "github-snippet",
      noFixReason: null,
      ...overrides,
    };
  }

  it("persists a run + candidates bound to an immutable snapshot, and a review", async () => {
    const owner = await createUser("fixgen@example.com", "correcthorse9");
    if (!owner.ok) throw new Error("setup failed");

    const snapshot = buildSnapshot(
      makePage({ url: "https://acme.test/w", metaDescription: null, title: "Acme Widgets" }),
    );
    const gate = buildMetaDescriptionContext(snapshot);
    if (gate.kind !== "context") throw new Error("expected a context");

    const outcome: GenerateFixesOutcome = {
      accepted: [fix()],
      rejected: [
        {
          candidate: fix({ candidateId: "c2", after: "Trusted by 9,999 firms.", evidenceSpanIds: [] }),
          result: { ok: false, failures: ["introduces factual tokens but cites no evidence"] },
        },
      ],
      generation: {
        provider: "fake",
        model: "fake-1",
        text: "{}",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        purpose: "fix_generate",
        fallback: false,
      },
    };

    const ids = await persistFixRun(snapshot, gate.context, outcome, owner.user.id);
    expect(ids).not.toBeNull();

    const loaded = await getRunWithCandidates(ids!.runId);
    expect(loaded).not.toBeNull();
    // The run is bound to the snapshot, with the model + prompt version recorded.
    expect(loaded!.run.snapshotId).toBe(ids!.snapshotId);
    expect(loaded!.run.generatorModel).toBe("fake-1");
    expect(loaded!.run.category).toBe("metadata");
    // Both candidates stored, with their validation verdicts kept distinct.
    expect(loaded!.candidates).toHaveLength(2);
    const ok = loaded!.candidates.filter((c) => c.validationOk);
    const bad = loaded!.candidates.filter((c) => !c.validationOk);
    expect(ok).toHaveLength(1);
    expect(bad[0].validationFailures?.[0]).toMatch(/cites no evidence/);

    // A human review round-trips.
    const reviewId = await saveReview({
      candidateId: ok[0].id,
      reviewerUserId: owner.user.id,
      decision: "accepted_minor_edit",
      humanFinal: '<meta name="description" content="Durable Acme widgets for small businesses.">',
    });
    expect(reviewId).not.toBeNull();

    // Deployment: an accepted fix can be marked shipped; the dataset then shows
    // it as deployed. A candidate WITHOUT an accepted review cannot.
    const deployId = await recordFixDeployment({
      candidateId: ok[0].id,
      target: "manual",
      ref: "https://example.com/pr/1",
    });
    expect(deployId).not.toBeNull();

    const rejectedOnly = await recordFixDeployment({
      candidateId: bad[0].id, // never reviewed/accepted
      target: "manual",
    });
    expect(rejectedOnly).toBeNull();

    const examples = await listReviewedExamples();
    const deployed = examples.find((e) => e.reviewId === reviewId);
    expect(deployed?.deployedAt).toBeInstanceOf(Date);
    expect(deployed?.deploymentTarget).toBe("manual");
    expect(deployed?.deploymentRef).toBe("https://example.com/pr/1");
  });
});

describe("SFT export eligibility", () => {
  function fix(overrides: Partial<FixCandidate> = {}): FixCandidate {
    return {
      candidateId: "c1",
      action: "fix",
      category: "metadata",
      target: "<head>",
      before: null,
      after: '<meta name="description" content="A description drawn from the page.">',
      rationale: "Summarizes the page.",
      evidenceSpanIds: [],
      confidence: "high",
      applyVia: "github-snippet",
      noFixReason: null,
      ...overrides,
    };
  }

  it("exports only accepted reviews (edited-final target), never rejected/unreviewed", async () => {
    const owner = await createUser("sft@example.com", "correcthorse7");
    if (!owner.ok) throw new Error("setup failed");

    const snapshot = buildSnapshot(makePage({ url: "https://sft.test/p", metaDescription: null }));
    const gate = buildMetaDescriptionContext(snapshot);
    if (gate.kind !== "context") throw new Error("expected a context");

    const outcome: GenerateFixesOutcome = {
      accepted: [fix({ candidateId: "a" }), fix({ candidateId: "b" }), fix({ candidateId: "c" })],
      rejected: [],
      generation: {
        provider: "fake",
        model: "fake-1",
        text: "{}",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        purpose: "fix_generate",
        fallback: false,
      },
    };
    const ids = await persistFixRun(snapshot, gate.context, outcome, owner.user.id);
    if (!ids) throw new Error("persist failed");
    const loaded = await getRunWithCandidates(ids.runId);
    const cands = loaded!.candidates;
    expect(cands.length).toBe(3);

    // One accepted-unedited, one edited-and-accepted (the training target is the
    // human's final), one rejected (must be excluded from SFT).
    await saveReview({ candidateId: cands[0].id, reviewerUserId: owner.user.id, decision: "accepted_unedited" });
    await saveReview({
      candidateId: cands[1].id,
      reviewerUserId: owner.user.id,
      decision: "accepted_minor_edit",
      humanFinal: '<meta name="description" content="HUMAN EDITED FINAL.">',
    });
    await saveReview({ candidateId: cands[2].id, reviewerUserId: owner.user.id, decision: "rejected" });

    const mine = (await listReviewedExamples()).filter((e) => e.runId === ids.runId);
    expect(mine.length).toBe(3);

    const { rows, provenance } = buildSftDataset(mine);
    // Only the two accepted reviews become training rows; the rejected is dropped.
    expect(rows.length).toBe(2);
    expect(provenance.every((p) => p.decision.startsWith("accepted"))).toBe(true);

    const modelTurns = rows.map((r) => r.contents.find((c) => c.role === "model")!.parts[0].text);
    // The edited row trains on the HUMAN final, not the model's original.
    expect(modelTurns.some((t) => t.includes("HUMAN EDITED FINAL"))).toBe(true);
    // The user turn is the reconstructed context (system instruction is separate).
    expect(rows[0].systemInstruction.parts[0].text).toMatch(/WeBind Fix Generator/);
  });
});

describe("user sites (which website the AI is talking about)", () => {
  it("discovers a site from a report run and makes the first one primary", async () => {
    const u = await createUser("sites-first@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    await touchSite(u.user.id, "https://www.Acme.com/pricing");

    const list = await listSites(u.user.id);
    expect(list).toHaveLength(1);
    expect(list[0].host).toBe("acme.com"); // canonicalized
    // A single-site user should never be asked to choose one.
    expect(list[0].isPrimary).toBe(true);
    expect((await resolveActiveSite(u.user.id))?.host).toBe("acme.com");
  });

  it("treats www/case/path variants as the SAME site, not duplicates", async () => {
    const u = await createUser("sites-dedupe@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");

    await touchSite(u.user.id, "acme.com");
    await touchSite(u.user.id, "https://www.acme.com/");
    await touchSite(u.user.id, "http://ACME.com/blog/post");

    expect(await listSites(u.user.id)).toHaveLength(1);
  });

  it("backfills sites from existing report history (no interrogation)", async () => {
    const u = await createUser("sites-backfill@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    // Free's 1-site cap would collapse this scenario to one site; this test
    // is about backfill mechanics, not plan limits, so give it room.
    await upsertSubscription({ userId: u.user.id, plan: "growth", status: "active" });

    // The user already ran reports before sites existed as a concept.
    await saveReportRequest(report("https://shop.example/pricing"), u.user.id);
    await saveReportRequest(report("https://www.shop.example/"), u.user.id);
    await saveReportRequest(report("https://other.example/"), u.user.id);

    // resolveActiveSite backfills on first use.
    const active = await resolveActiveSite(u.user.id);
    expect(active).not.toBeNull();

    const hosts = (await listSites(u.user.id)).map((s) => s.host).sort();
    // Two distinct sites — the two shop.example URLs collapse into one.
    expect(hosts).toEqual(["other.example", "shop.example"]);
  });

  it("switches the primary site and keeps exactly one primary", async () => {
    const u = await createUser("sites-primary@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    await upsertSubscription({ userId: u.user.id, plan: "growth", status: "active" });

    await touchSite(u.user.id, "first.example");
    await touchSite(u.user.id, "second.example");
    const before = await listSites(u.user.id);
    const second = before.find((s) => s.host === "second.example")!;

    expect(await setPrimarySite(u.user.id, second.id)).toBe(true);

    const after = await listSites(u.user.id);
    expect(after.filter((s) => s.isPrimary)).toHaveLength(1);
    expect((await resolveActiveSite(u.user.id))?.host).toBe("second.example");
  });

  it("refuses to re-point another user's site", async () => {
    const mine = await createUser("sites-mine@example.com", "password123");
    const theirs = await createUser("sites-theirs@example.com", "password123");
    if (!mine.ok || !theirs.ok) throw new Error("setup failed");

    await touchSite(theirs.user.id, "theirs.example");
    const theirSite = (await listSites(theirs.user.id))[0];

    expect(await setPrimarySite(mine.user.id, theirSite.id)).toBe(false);
    // And it stays primary for its real owner.
    expect((await listSites(theirs.user.id))[0].isPrimary).toBe(true);
  });

  it("re-points primary to a surviving site when the primary is removed", async () => {
    const u = await createUser("sites-remove@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    await upsertSubscription({ userId: u.user.id, plan: "growth", status: "active" });

    await touchSite(u.user.id, "a.example");
    await touchSite(u.user.id, "b.example");
    const primary = (await listSites(u.user.id)).find((s) => s.isPrimary)!;

    expect(await removeSite(u.user.id, primary.id)).toBe(true);

    const left = await listSites(u.user.id);
    expect(left).toHaveLength(1);
    // Context survives: the remaining site becomes the active one.
    expect(left[0].isPrimary).toBe(true);
    expect((await resolveActiveSite(u.user.id))?.host).toBe(left[0].host);
  });

  it("enforces the plan's site cap: Growth advertised 5 sites but nothing stopped a 6th from being tracked for free", async () => {
    const u = await createUser("sites-limit-growth@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    await upsertSubscription({ userId: u.user.id, plan: "growth", status: "active" });

    for (const host of ["s1.example", "s2.example", "s3.example", "s4.example", "s5.example"]) {
      await touchSite(u.user.id, host);
    }
    expect(await listSites(u.user.id)).toHaveLength(5);

    // A 6th site silently isn't added — touchSite is best-effort background
    // discovery, so it fails soft rather than throwing on every report run.
    await touchSite(u.user.id, "s6.example");
    expect(await listSites(u.user.id)).toHaveLength(5);
    expect((await listSites(u.user.id)).some((s) => s.host === "s6.example")).toBe(false);
  });

  it("addSite reports the limit explicitly, unlike touchSite's silent no-op", async () => {
    const u = await createUser("sites-limit-explicit@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    // Free plan: 1 site.
    await touchSite(u.user.id, "only-site.example");

    const result = await addSite(u.user.id, "second-site.example");
    expect(result).toEqual({ ok: false, reason: "limit", limit: 1 });
    expect(await listSites(u.user.id)).toHaveLength(1);
  });

  it("adding a site you're already tracking is not blocked by the cap (touch, not a new slot)", async () => {
    const u = await createUser("sites-limit-retouch@example.com", "password123");
    if (!u.ok) throw new Error("setup failed");
    await touchSite(u.user.id, "already-tracked.example");

    const result = await addSite(u.user.id, "already-tracked.example");
    expect(result.ok).toBe(true);
  });
});

describe("a new account starts empty", () => {
  /**
   * The tenant-isolation test stated the way a user would state it: someone who
   * signs up today must not see the site, scores, history or drafts of someone
   * who signed up yesterday. The per-object ownership checks above prove a
   * stranger can't reach a KNOWN id; this proves nothing is handed to them in
   * the first place — including by the sites backfill, which derives a user's
   * websites from report history and is the one place a fresh profile could
   * silently inherit somebody else's domain.
   */
  it("sees none of an established user's sites, reports or drafts", async () => {
    const established = await createUser("established@example.com", "password123");
    if (!established.ok) throw new Error("setup failed");

    // An established account with a site, a scored report, and a draft.
    await saveReportRequest(
      report("https://shouselaw.com/practice"),
      established.user.id,
    );
    await touchSite(established.user.id, "shouselaw.com");
    const inputs = {
      topic: "Criminal defense",
      pageType: "landing" as const,
      audience: "defendants",
      tone: "professional",
      keyFacts: ["Free consultation"],
    };
    const theirDraft = await saveDraft(inputs, await generateDraft(inputs), established.user.id);
    if (!theirDraft) throw new Error("setup failed");

    // Their data is really there — otherwise the assertions below prove nothing.
    expect((await listSites(established.user.id)).map((s) => s.host)).toContain("shouselaw.com");
    expect(await listReportsForUser(established.user.id)).not.toHaveLength(0);

    // Now a brand-new signup.
    const fresh = await createUser("fresh@example.com", "password123");
    if (!fresh.ok) throw new Error("setup failed");

    expect(await listSites(fresh.user.id)).toEqual([]);
    expect(await listReportsForUser(fresh.user.id)).toEqual([]);
    expect(await listDraftsForUser(fresh.user.id)).toEqual([]);

    // resolveActiveSite backfills from report history on first use. With no
    // reports of their own that must yield nothing — never the other user's
    // host, which is what the AI would then treat as "my site".
    expect(await resolveActiveSite(fresh.user.id)).toBeNull();
    expect(await listSites(fresh.user.id)).toEqual([]);

    // The dashboard's key-insights query, asked directly about the other
    // user's host, must still come back empty.
    expect(await listReportsForUserHost(fresh.user.id, "shouselaw.com")).toEqual([]);
    expect(await latestReportForHost(fresh.user.id, "shouselaw.com")).toBeNull();

    // And they cannot reach the established user's draft by id.
    expect(await getDraftForUser(theirDraft, fresh.user.id)).toBeNull();
  });

  it("does not make a new user an admin", async () => {
    // isAdmin gates the dashboard's "every report, every draft" view, so a
    // signup silently landing there would expose every tenant at once.
    const fresh = await createUser("notanadmin@example.com", "password123");
    if (!fresh.ok) throw new Error("setup failed");
    expect(fresh.user.isAdmin).toBe(false);

    await createSession(fresh.user.id);
    expect((await getCurrentUser())?.isAdmin).toBe(false);
    await logout();
  });
});
