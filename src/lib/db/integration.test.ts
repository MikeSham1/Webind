import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
}));

// Imported after the mock so the module picks up the mocked next/headers.
import {
  createSession,
  createUser,
  getCurrentUser,
  logout,
  verifyCredentials,
} from "@/lib/auth";
import {
  getReportById,
  getReportForUser,
  listAllReports,
  listReportsForUser,
  saveReportRequest,
} from "@/lib/leads";
import {
  getDraftForUser,
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
  getPublicationForDraft,
  recordPublished,
  recordRolledBack,
} from "@/lib/integrations/publications";
import {
  deleteGitHubConnection,
  getGitHubConnectionStatus,
  getGitHubCredentials,
  saveGitHubConnection,
} from "@/lib/integrations/githubConnections";
import { getPrForReport, recordPrOpened } from "@/lib/integrations/codeFixes";

const report = (url: string): ReportResult => ({
  url,
  ai: { total: 50, signals: [], coverage: 1 },
  traditional: { total: 60, signals: [], coverage: 1 },
  prioritizedFixes: [],
});

beforeAll(async () => {
  const client = new PGlite();
  __setTestDb(drizzle(client, { schema }));
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
    const draft = generateDraft(inputs);
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

describe("publications (WordPress apply + rollback)", () => {
  it("tracks publish → rollback → republish for a draft", async () => {
    const owner = await createUser("publisher@example.com", "password123");
    if (!owner.ok) throw new Error("setup failed");
    const inputs = {
      topic: "Managed IT",
      pageType: "landing" as const,
      audience: "smbs",
      tone: "professional",
      keyFacts: ["24/7 helpdesk"],
    };
    const draftId = await saveDraft(inputs, generateDraft(inputs), owner.user.id);
    if (!draftId) throw new Error("setup failed");

    expect(await getPublicationForDraft(draftId)).toBeNull();

    const page = { postId: 7, viewUrl: "https://acme.example/managed-it/", editUrl: "https://acme.example/wp-admin/post.php?post=7&action=edit" };
    expect(await recordPublished(draftId, owner.user.id, page)).toBe(true);

    let row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("published");
    expect(row?.wpPostId).toBe(7);
    expect(row?.rolledBackAt).toBeNull();

    expect(await recordRolledBack(draftId)).toBe(true);
    row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("rolled_back");
    expect(row?.rolledBackAt).not.toBeNull();

    // Republishing the same draft updates the existing row rather than duplicating it.
    expect(await recordPublished(draftId, owner.user.id, page)).toBe(true);
    row = await getPublicationForDraft(draftId);
    expect(row?.status).toBe("published");
    expect(row?.rolledBackAt).toBeNull();
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
