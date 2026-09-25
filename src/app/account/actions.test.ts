import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { __setTestDb } from "@/lib/db";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: async () => new Headers(),
}));

// Captures the redirect target instead of actually throwing NEXT_REDIRECT,
// so the action's return value (never reached in production, since redirect()
// really does throw) is observable in a test.
const { redirects } = vi.hoisted(() => ({ redirects: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ delivered: true })) }));

import { createUser } from "@/lib/auth";
import { saveReportRequest } from "@/lib/leads";
import { signupAction, loginAction } from "./actions";
import { initialAuthState } from "./state";
import { PENDING_REPORT_COOKIE } from "@/lib/leads";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function expectRedirectTo(promise: Promise<unknown>, url: string) {
  await expect(promise).rejects.toThrow("NEXT_REDIRECT");
  expect(redirects.at(-1)).toBe(url);
}

beforeAll(async () => {
  const client = new PGlite();
  const testDb = drizzle(client, { schema });
  __setTestDb(testDb);
  const dir = join(process.cwd(), "drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await client.exec(readFileSync(join(dir, f), "utf8"));
  }
}, 60_000);

afterEach(() => {
  redirects.length = 0;
  jar.clear();
});

describe("post-auth redirect", () => {
  it("defaults to /studio with no next/plan/claimed report", async () => {
    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `default-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
      })),
      "/studio",
    );
  });

  it("honors an allowlisted next, carrying the selected plan to /pricing", async () => {
    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `withnext-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
        next: "/pricing",
        plan: "starter",
      })),
      "/pricing?plan=starter",
    );
  });

  it("ignores an unrecognized plan id even when next=/pricing", async () => {
    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `badplan-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
        next: "/pricing",
        plan: "enterprise-made-up",
      })),
      "/pricing",
    );
  });

  it("ignores a next value that isn't on the allowlist — this is the open-redirect guard", async () => {
    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `evilnext-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
        next: "https://evil.example",
      })),
      "/studio",
    );
  });

  it("lands on the claimed report when one was pending and no next was given", async () => {
    const reportId = await saveReportRequest(
      { url: "https://claim-redirect-test.com", ai: { total: 1, signals: [], coverage: 1 }, traditional: { total: 1, signals: [], coverage: 1 }, prioritizedFixes: [], modelVersion: "test" },
      null,
    );
    if (!reportId) throw new Error("setup failed");
    jar.set(PENDING_REPORT_COOKIE, reportId);

    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `claimredirect-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
      })),
      `/dashboard/reports/${reportId}`,
    );
    // The claim cookie is single-use.
    expect(jar.has(PENDING_REPORT_COOKIE)).toBe(false);
  });

  it("an allowlisted next still wins over a claimed report", async () => {
    const reportId = await saveReportRequest(
      { url: "https://claim-redirect-test-2.com", ai: { total: 1, signals: [], coverage: 1 }, traditional: { total: 1, signals: [], coverage: 1 }, prioritizedFixes: [], modelVersion: "test" },
      null,
    );
    if (!reportId) throw new Error("setup failed");
    jar.set(PENDING_REPORT_COOKIE, reportId);

    await expectRedirectTo(
      signupAction(initialAuthState, form({
        email: `claimvnext-${Math.random()}@example.com`,
        password: "password123",
        confirmPassword: "password123",
        termsAccepted: "accepted",
        next: "/dashboard",
      })),
      "/dashboard",
    );
  });

  it("login also honors next and claims a pending report", async () => {
    const email = `loginer-${Math.random()}@example.com`;
    const created = await createUser(email, "password123");
    if (!created.ok) throw new Error("setup failed");

    await expectRedirectTo(
      loginAction(initialAuthState, form({ email, password: "password123", next: "/dashboard" })),
      "/dashboard",
    );
  });
});
