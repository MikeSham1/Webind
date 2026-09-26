import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { __setTestDb } from "@/lib/db";

// Same stateful-cookie-jar pattern as src/lib/db/integration.test.ts, scoped
// to this file so getCurrentUser() round-trips against a real session.
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

// The audit's own methodology: WordPress calls are mocked, nothing real is
// published. Spying (not a fixture server) lets the test assert exactly what
// content/status was sent for each call.
const wp = vi.hoisted(() => ({
  createPage: vi.fn(),
  setPageStatus: vi.fn(),
  // Defaults to "still there" so every existing test's already-happy path is
  // unaffected by the reconciliation check — only tests that explicitly want
  // to exercise "the page is gone" override this to notFound: true.
  getPageStatus: vi.fn(async (): Promise<RemotePageStatus> => ({ ok: true, status: "draft", link: null })),
}));
vi.mock("@/lib/integrations/wordpress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/wordpress")>();
  return {
    ...actual,
    createPage: wp.createPage,
    setPageStatus: wp.setPageStatus,
    getPageStatus: wp.getPageStatus,
  };
});

import { createUser, createSession } from "@/lib/auth";
import { saveWordPressConnection } from "@/lib/integrations/connections";
import { generateDraft } from "@/lib/content/generate";
import { saveDraft, getDraftForUser } from "@/lib/content/store";
import type { ContentInputs } from "@/lib/content/types";
import {
  decideDraftAction,
  publishDraftAction,
  confirmGoLiveAction,
} from "./actions";
import type { RemotePageStatus } from "@/lib/integrations/wordpress";

let userId: string;

const inputs: ContentInputs = {
  topic: "Managed IT Support",
  pageType: "landing",
  audience: "small businesses",
  tone: "professional",
  keyFacts: ["24/7 helpdesk"],
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function newApprovedDraft(markdownOverride?: string): Promise<string> {
  const draft = await generateDraft(inputs);
  const draftId = await saveDraft(inputs, draft, userId);
  if (!draftId) throw new Error("setup failed");
  const decision = await decideDraftAction(
    { status: "idle" },
    form({
      draftId,
      decision: "approve",
      markdown: markdownOverride ?? draft.markdown,
    }),
  );
  if (decision.status !== "done") throw new Error(`approval failed: ${JSON.stringify(decision)}`);
  return draftId;
}

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
  const created = await createUser(`writer-${Math.random()}@example.com`, "password123");
  if (!created.ok) throw new Error("setup failed");
  userId = created.user.id;
  await createSession(userId);
  vi.stubEnv("CREDENTIALS_KEY", Buffer.alloc(32, 7).toString("base64"));
  await saveWordPressConnection(userId, {
    siteUrl: "https://acme.example",
    username: "editor",
    appPassword: "abcd efgh ijkl mnop",
  });
});

describe("publishing sends the approved revision, not the original", () => {
  it("sends the human-edited text to WordPress, not the model's draft", async () => {
    const edited = "# Managed IT Support\n\nEDITED BY THE HUMAN REVIEWER.";
    const draftId = await newApprovedDraft(edited);

    wp.createPage.mockResolvedValue({
      ok: true,
      postId: 1,
      viewUrl: "https://acme.example/managed-it/",
      editUrl: "https://acme.example/wp-admin/post.php?post=1&action=edit",
      previewUrl: "https://acme.example/?page_id=1&preview=true",
    });

    const result = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(result.status).toBe("wp_draft");

    expect(wp.createPage).toHaveBeenCalledTimes(1);
    const sentHtml = wp.createPage.mock.calls[0][1].contentHtml as string;
    expect(sentHtml).toContain("EDITED BY THE HUMAN REVIEWER");
    expect(sentHtml).not.toContain("24/7 helpdesk"); // the model's original fact list, gone from this edit
  });

  it("reload (getDraftForUser) also returns the approved edit, not the original", async () => {
    const edited = "# Managed IT Support\n\nEDITED BY THE HUMAN REVIEWER.";
    const draftId = await newApprovedDraft(edited);

    const row = await getDraftForUser(draftId, userId);
    expect(row?.humanFinal).toContain("EDITED BY THE HUMAN REVIEWER");
  });
});

describe("server-side safety enforcement on approval", () => {
  it("refuses to approve a revision that fails its own recomputed safety gates", async () => {
    const draft = await generateDraft(inputs);
    // Near-duplicate of "existing" site content triggers checkOriginality's
    // block status — the UI would disable Approve, but a direct submission
    // must be refused here too, regardless of what the client sends.
    const nearDuplicate = draft.markdown;
    const draftId = await saveDraft(
      { ...inputs, existingContent: nearDuplicate },
      draft,
      userId,
    );
    if (!draftId) throw new Error("setup failed");

    const decision = await decideDraftAction(
      { status: "idle" },
      form({ draftId, decision: "approve", markdown: nearDuplicate }),
    );
    expect(decision.status).toBe("error");

    const row = await getDraftForUser(draftId, userId);
    expect(row?.status).toBe("pending_review"); // never flipped to approved
  });
});

describe("publications are bound to the site they were created on", () => {
  it("refuses to go live once WordPress has been reconnected to a different site", async () => {
    const draftId = await newApprovedDraft();

    wp.createPage.mockResolvedValue({
      ok: true,
      postId: 3,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=3&action=edit",
      previewUrl: "https://acme.example/?page_id=3&preview=true",
    });
    const created = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(created.status).toBe("wp_draft");

    // The user disconnects and reconnects WordPress to a different client's
    // site — same connection row (unique on userId), different destination.
    await saveWordPressConnection(userId, {
      siteUrl: "https://a-different-clients-site.example",
      username: "editor",
      appPassword: "zzzz yyyy xxxx wwww",
    });

    const goLive = await confirmGoLiveAction({ status: "idle" }, form({ draftId }));
    expect(goLive.status).toBe("error");
    expect(wp.setPageStatus).not.toHaveBeenCalled();
  });
});

describe("go-live re-checks approval", () => {
  it("refuses to go live once approval has been revoked, even with a WordPress draft already created", async () => {
    const draftId = await newApprovedDraft();

    wp.createPage.mockResolvedValue({
      ok: true,
      postId: 2,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=2&action=edit",
      previewUrl: "https://acme.example/?page_id=2&preview=true",
    });
    const created = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(created.status).toBe("wp_draft");

    // Approval is revoked after the WordPress draft already exists.
    const revoke = await decideDraftAction(
      { status: "idle" },
      form({ draftId, decision: "reject", markdown: "" }),
    );
    expect(revoke.status).toBe("done");

    wp.setPageStatus.mockResolvedValue({
      ok: true,
      postId: 2,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=2&action=edit",
      previewUrl: "https://acme.example/?page_id=2&preview=true",
    });
    const goLive = await confirmGoLiveAction({ status: "idle" }, form({ draftId }));
    expect(goLive.status).toBe("error");
    expect(wp.setPageStatus).not.toHaveBeenCalled();
  });
});

describe("reconciliation: the cached publication record can drift from what's actually on WordPress", () => {
  it("republishes fresh instead of handing back a dead link, when the WordPress draft was deleted externally", async () => {
    const draftId = await newApprovedDraft();

    wp.createPage.mockResolvedValueOnce({
      ok: true,
      postId: 5,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=5&action=edit",
      previewUrl: "https://acme.example/?page_id=5&preview=true",
    });
    const first = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(first.status).toBe("wp_draft");

    // Someone deletes the page directly on WordPress. A second publish
    // attempt should discover that (not just trust the cached "wp_draft" row)
    // and recreate the page, rather than returning the now-dead link forever.
    wp.getPageStatus.mockResolvedValueOnce({ ok: false, notFound: true });
    wp.createPage.mockResolvedValueOnce({
      ok: true,
      postId: 6,
      viewUrl: "https://acme.example/x-again/",
      editUrl: "https://acme.example/wp-admin/post.php?post=6&action=edit",
      previewUrl: "https://acme.example/?page_id=6&preview=true",
    });

    const retry = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(retry.status).toBe("wp_draft");
    if (retry.status === "wp_draft") {
      expect(retry.editUrl).toContain("post=6");
    }
    expect(wp.createPage).toHaveBeenCalledTimes(2);

    const row = await getDraftForUser(draftId, userId);
    expect(row?.status).toBe("approved"); // the draft's own approval is untouched by this
  });

  it("does not discard a cached wp_draft on a transient status-check failure", async () => {
    const draftId = await newApprovedDraft();

    wp.createPage.mockResolvedValueOnce({
      ok: true,
      postId: 7,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=7&action=edit",
      previewUrl: "https://acme.example/?page_id=7&preview=true",
    });
    const first = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(first.status).toBe("wp_draft");

    // A network blip checking WordPress, NOT a confirmed 404 — must not be
    // treated as "the page is gone."
    wp.getPageStatus.mockResolvedValueOnce({ ok: false, notFound: false, error: "timeout" });

    const retry = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(retry.status).toBe("wp_draft");
    if (retry.status === "wp_draft") {
      expect(retry.editUrl).toContain("post=7"); // the original, cached page — not recreated
    }
    expect(wp.createPage).toHaveBeenCalledTimes(1); // no second create
  });

  it("refuses to go live and reports the real error, when the WordPress draft was deleted externally", async () => {
    const draftId = await newApprovedDraft();

    wp.createPage.mockResolvedValueOnce({
      ok: true,
      postId: 8,
      viewUrl: "https://acme.example/x/",
      editUrl: "https://acme.example/wp-admin/post.php?post=8&action=edit",
      previewUrl: "https://acme.example/?page_id=8&preview=true",
    });
    const created = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(created.status).toBe("wp_draft");

    wp.getPageStatus.mockResolvedValueOnce({ ok: false, notFound: true });
    const goLive = await confirmGoLiveAction({ status: "idle" }, form({ draftId }));
    expect(goLive.status).toBe("error");
    if (goLive.status === "error") {
      expect(goLive.error).toMatch(/no longer exists/i);
    }
    expect(wp.setPageStatus).not.toHaveBeenCalled();

    // The stale record is cleared, so a fresh publish attempt isn't stuck
    // forever behind the old "wp_draft" claim.
    wp.createPage.mockResolvedValueOnce({
      ok: true,
      postId: 9,
      viewUrl: "https://acme.example/x-again/",
      editUrl: "https://acme.example/wp-admin/post.php?post=9&action=edit",
      previewUrl: "https://acme.example/?page_id=9&preview=true",
    });
    const republish = await publishDraftAction({ status: "idle" }, form({ draftId }));
    expect(republish.status).toBe("wp_draft");
  });
});
