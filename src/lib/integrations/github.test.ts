import { describe, it, expect, vi } from "vitest";
import { mergeRobotsTxt, openFixPullRequest, type FixFile } from "./github";

const FRAGMENT = "User-agent: GPTBot\nAllow: /";

describe("mergeRobotsTxt", () => {
  it("uses the generated fragment when there is no existing file", () => {
    expect(mergeRobotsTxt("", FRAGMENT)).toBe(FRAGMENT);
  });

  it("preserves every existing line and appends only missing AI bots", () => {
    const existing = [
      "User-agent: *",
      "Disallow: /admin/",
      "",
      "Sitemap: https://acme.com/sitemap.xml",
    ].join("\n");

    const merged = mergeRobotsTxt(existing, FRAGMENT);

    // Nothing existing is lost.
    expect(merged).toContain("Disallow: /admin/");
    expect(merged).toContain("Sitemap: https://acme.com/sitemap.xml");
    // Each AI SEARCH crawler without a group is added (training crawlers are
    // deliberately never added — blocking those doesn't affect search).
    for (const bot of ["Googlebot", "OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) {
      expect(merged).toContain(`User-agent: ${bot}`);
    }
    // A training crawler is NOT added by the merge.
    expect(merged).not.toContain("User-agent: GPTBot");
    expect(merged).not.toContain("User-agent: Google-Extended");
  });

  it("does not duplicate a bot that already has a group", () => {
    const existing = "User-agent: OAI-SearchBot\nDisallow: /private/";
    const merged = mergeRobotsTxt(existing, FRAGMENT);
    // The existing OAI-SearchBot rule is respected (not overridden or duplicated).
    expect(merged.match(/User-agent:\s*OAI-SearchBot/gi)?.length).toBe(1);
    expect(merged).toContain("Disallow: /private/");
    // Other AI search crawlers are still added.
    expect(merged).toContain("User-agent: Claude-SearchBot");
  });

  it("leaves the file untouched when every AI search crawler is already addressed", () => {
    const existing = [
      "User-agent: Googlebot",
      "Allow: /",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "User-agent: Claude-SearchBot",
      "Allow: /",
      "User-agent: PerplexityBot",
      "Allow: /",
    ].join("\n");
    expect(mergeRobotsTxt(existing, FRAGMENT)).toBe(existing);
  });
});

// --- openFixPullRequest (injected GitHub API) -------------------------------

const CREDS = { token: "t", owner: "o", repo: "r" };

interface Route {
  method: string;
  match: RegExp;
  respond: (call: { url: string; init: RequestInit }) => { status: number; body?: unknown };
}

/** A fake api.github.com that answers a fixed set of routes and records calls. */
function ghFetch(routes: Route[]) {
  const calls: { method: string; url: string }[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    const route = routes.find((r) => r.method === method && r.match.test(url));
    const { status, body } = route
      ? route.respond({ url, init })
      : { status: 500, body: { message: `unhandled ${method} ${url}` } };
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const repoAndBase: Route[] = [
  { method: "GET", match: /\/repos\/o\/r$/, respond: () => ({ status: 200, body: { default_branch: "main", full_name: "o/r" } }) },
  { method: "GET", match: /\/git\/ref\/heads\/main$/, respond: () => ({ status: 200, body: { object: { sha: "base123" } } }) },
];

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const pr = { title: "t", body: "b", branchName: "webind/x" };

describe("openFixPullRequest", () => {
  it("creates a branch, commits a new file, and opens a PR", async () => {
    const { impl, calls } = ghFetch([
      ...repoAndBase,
      { method: "POST", match: /\/git\/refs$/, respond: () => ({ status: 201, body: {} }) },
      { method: "GET", match: /\/contents\/llms\.txt/, respond: () => ({ status: 404, body: { message: "Not Found" } }) },
      { method: "PUT", match: /\/contents\/llms\.txt$/, respond: () => ({ status: 201, body: {} }) },
      { method: "POST", match: /\/pulls$/, respond: () => ({ status: 201, body: { number: 7, html_url: "https://github.com/o/r/pull/7" } }) },
    ]);
    const files: FixFile[] = [{ path: "llms.txt", content: "hello" }];

    const res = await openFixPullRequest(CREDS, files, pr, { fetchImpl: impl });
    expect(res).toEqual({ ok: true, prNumber: 7, prUrl: "https://github.com/o/r/pull/7", branchName: "webind/x" });
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });

  it("retries with a suffixed branch when the name already exists", async () => {
    let refPosts = 0;
    const { impl } = ghFetch([
      ...repoAndBase,
      {
        method: "POST",
        match: /\/git\/refs$/,
        respond: () => {
          refPosts += 1;
          return refPosts === 1
            ? { status: 422, body: { message: "Reference already exists" } }
            : { status: 201, body: {} };
        },
      },
      { method: "GET", match: /\/contents\/llms\.txt/, respond: () => ({ status: 404, body: {} }) },
      { method: "PUT", match: /\/contents\/llms\.txt$/, respond: () => ({ status: 201, body: {} }) },
      { method: "POST", match: /\/pulls$/, respond: () => ({ status: 201, body: { number: 8, html_url: "https://github.com/o/r/pull/8" } }) },
    ]);

    const res = await openFixPullRequest(CREDS, [{ path: "llms.txt", content: "x" }], pr, { fetchImpl: impl });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.branchName).toBe("webind/x-2");
    expect(refPosts).toBe(2);
  });

  it("skips an unchanged file, deletes the empty branch, and opens no PR", async () => {
    let deleted = false;
    let openedPr = false;
    const { impl } = ghFetch([
      ...repoAndBase,
      { method: "POST", match: /\/git\/refs$/, respond: () => ({ status: 201, body: {} }) },
      // The file already contains exactly what the merge would produce.
      { method: "GET", match: /\/contents\/robots\.txt/, respond: () => ({ status: 200, body: { sha: "s1", content: b64("SAME") } }) },
      { method: "DELETE", match: /\/git\/refs\/heads\//, respond: () => { deleted = true; return { status: 204 }; } },
      { method: "POST", match: /\/pulls$/, respond: () => { openedPr = true; return { status: 201, body: { number: 9, html_url: "x" } }; } },
    ]);
    // merge() returns the existing content verbatim → no change.
    const files: FixFile[] = [{ path: "robots.txt", content: "IGNORED", merge: (existing) => existing }];

    const res = await openFixPullRequest(CREDS, files, pr, { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/nothing to change/i);
    expect(deleted).toBe(true);
    expect(openedPr).toBe(false);
  });

  it("reports a friendly message when a PR is already open", async () => {
    const { impl } = ghFetch([
      ...repoAndBase,
      { method: "POST", match: /\/git\/refs$/, respond: () => ({ status: 201, body: {} }) },
      { method: "GET", match: /\/contents\/llms\.txt/, respond: () => ({ status: 404, body: {} }) },
      { method: "PUT", match: /\/contents\/llms\.txt$/, respond: () => ({ status: 201, body: {} }) },
      { method: "POST", match: /\/pulls$/, respond: () => ({ status: 422, body: { message: "A pull request already exists for o:webind/x." } }) },
    ]);
    const res = await openFixPullRequest(CREDS, [{ path: "llms.txt", content: "x" }], pr, { fetchImpl: impl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already open/i);
  });
});
