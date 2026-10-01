import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { __setTestDb } from "@/lib/db";

// Same stateful-cookie-jar pattern as the studio/integration tests, so
// getCurrentUser() round-trips against a real session.
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
  headers: async () => new Headers(),
}));

const checkMock = vi.hoisted(() => ({ checkKeywordVisibility: vi.fn() }));
vi.mock("@/lib/visibility/check", () => ({
  checkKeywordVisibility: checkMock.checkKeywordVisibility,
  MAX_KEYWORDS: 10,
}));

import { createUser, createSession } from "@/lib/auth";
import { upsertSubscription } from "@/lib/billing/store";
import { usageThisMonth } from "@/lib/billing/usage";
import { runVisibilityCheck } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** A keyword result with at least one engine returning a definite verdict. */
function usableKeyword(keyword: string) {
  return {
    keyword,
    engines: [
      {
        engine: "gemini" as const,
        configured: true,
        present: true,
        prominence: 1,
        competitors: [],
        evidence: "cited",
      },
    ],
    score: 80,
  };
}

/** A keyword where every configured engine failed — nothing usable came back. */
function unusableKeyword(keyword: string) {
  return {
    keyword,
    engines: [
      {
        engine: "gemini" as const,
        configured: true,
        present: null,
        prominence: null,
        competitors: [],
        evidence: "Check failed: timeout",
      },
    ],
    score: null,
  };
}

let userId: string;

beforeAll(async () => {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  __setTestDb(testDb);
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await client.exec(readFileSync(join(dir, f), "utf8"));
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  jar.clear();
  const created = await createUser(`visibility-${Math.random()}@example.com`, "password123");
  if (!created.ok) throw new Error("setup failed");
  userId = created.user.id;
  await createSession(userId);
  await upsertSubscription({ userId, plan: "starter", status: "active" });
});

describe("runVisibilityCheck meters only usable results", () => {
  it("bills only keywords that got a real verdict, not ones every engine failed on", async () => {
    checkMock.checkKeywordVisibility.mockResolvedValue({
      ok: true,
      report: {
        domain: "acme.example",
        brandName: "Acme",
        keywords: [usableKeyword("best crm"), unusableKeyword("worst crm")],
        overallScore: 80,
      },
    });

    const result = await runVisibilityCheck(
      { status: "idle" },
      form({ domain: "acme.example", keywords: "best crm, worst crm" }),
    );
    expect(result.status).toBe("success");

    // Only the one keyword with a definite verdict counts against quota —
    // the one where every engine failed doesn't burn an allowance slot.
    expect(await usageThisMonth(userId, "visibility_probe")).toBe(1);
  });

  it("bills nothing when every keyword comes back with no usable result", async () => {
    checkMock.checkKeywordVisibility.mockResolvedValue({
      ok: true,
      report: {
        domain: "acme.example",
        brandName: "Acme",
        keywords: [unusableKeyword("a"), unusableKeyword("b")],
        overallScore: null,
      },
    });

    const result = await runVisibilityCheck(
      { status: "idle" },
      form({ domain: "acme.example", keywords: "a, b" }),
    );
    expect(result.status).toBe("success");
    expect(await usageThisMonth(userId, "visibility_probe")).toBe(0);
  });
});
