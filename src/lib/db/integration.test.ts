import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
import {
  consumeEmailVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/emailVerification";
import {
  getReportById,
  getReportForUser,
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
  getDraftForUser,
  listDraftsForUser,
  saveDraft,
  setAnyDraftStatus,
  setDraftStatus,
} from "@/lib/content/store";
import { generateDraft } from "@/lib/content/generate";
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
  latestReportForHost,
  listSites,
  removeSite,
  resolveActiveSite,
  setPrimarySite,
  touchSite,
} from "@/lib/sites/store";

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
    expect(decrypted).toEqual(creds);

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

  it("records pending BEFORE any WordPress call, then progresses through the full lifecycle", async () => {
    const owner = await createUser("publisher@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const draftId = await newDraft(owner.user.id);

    expect(await getPublicationForDraft(draftId)).toBeNull();

    const begin = await beginPublish(draftId, owner.user.id);
    expect(begin.ok).toBe(true);
    let row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("pending");
    expect(row?.wpPostId).toBeNull(); // nothing on WordPress yet -- intent only

    expect(await recordWpDraftCreated(draftId, page)).toBe(true);
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

    await beginPublish(draftId, owner.user.id);
    await recordWpDraftCreated(draftId, page);

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
  it("creates an admin from env and re-syncs its password idempotently", async () => {
    vi.stubEnv("SEED_ADMIN_EMAIL", "admin@webind.design");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "adminpass123");
    await seedAccounts();

    const admin = await verifyCredentials("admin@webind.design", "adminpass123");
    expect(admin?.isAdmin).toBe(true);

    // Rotating the env password and re-seeding updates the existing account.
    vi.stubEnv("SEED_ADMIN_PASSWORD", "rotated456");
    await seedAccounts();
    expect(await verifyCredentials("admin@webind.design", "rotated456")).not.toBeNull();
    expect(await verifyCredentials("admin@webind.design", "adminpass123")).toBeNull();

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
  it("refuses with the wrong password and leaves the account intact", async () => {
    const owner = await createUser("delete1@example.com", "correctpass1");
    if (!owner.ok) throw new Error("setup failed");

    const result = await deleteAccount(owner.user.id, "wrongpassword");
    expect(result).toEqual({ ok: false, error: "Incorrect password." });
    expect(await verifyCredentials("delete1@example.com", "correctpass1")).not.toBeNull();
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
