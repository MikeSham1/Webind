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
    if (!owner.ok) throw new Error("setup failed");

    await saveReportRequest(report("https://owned.com"), owner.user.id);
    await saveReportRequest(report("https://anon.com"), null);

    const mine = await listReportsForUser(owner.user.id);
    expect(mine.map((r) => r.url)).toEqual(["https://owned.com"]);

    const all = await listAllReports();
    expect(all.some((r) => r.url === "https://anon.com")).toBe(true);
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
