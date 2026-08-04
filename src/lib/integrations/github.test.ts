import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openFixPullRequest, testConnection } from "./github";

const VALID_AUTH = "Bearer ghp_test_token";

let server: Server;
let apiBase: string;
let originalFetch: typeof fetch;
const writtenFiles: { path: string; branch: string; sha?: string }[] = [];
let existingShas: Record<string, string> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://fixture");

    if (req.headers.authorization !== VALID_AUTH) {
      send(401, { message: "Bad credentials" });
      return;
    }

    if (url.pathname === "/repos/acme/site" && req.method === "GET") {
      send(200, { default_branch: "main", full_name: "acme/site" });
      return;
    }
    if (url.pathname === "/repos/acme/site/git/ref/heads/main" && req.method === "GET") {
      send(200, { object: { sha: "base-sha-123" } });
      return;
    }
    if (url.pathname === "/repos/acme/site/git/refs" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => send(201, { ref: JSON.parse(body).ref }));
      return;
    }
    const contentsMatch = /^\/repos\/acme\/site\/contents\/(.+)$/.exec(url.pathname);
    if (contentsMatch && req.method === "GET") {
      const path = decodeURIComponent(contentsMatch[1]);
      const sha = existingShas[path];
      if (sha) send(200, { sha });
      else send(404, { message: "Not Found" });
      return;
    }
    if (contentsMatch && req.method === "PUT") {
      const path = decodeURIComponent(contentsMatch[1]);
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        writtenFiles.push({ path, branch: parsed.branch, sha: parsed.sha });
        send(200, { content: { path } });
      });
      return;
    }
    if (url.pathname === "/repos/acme/site/pulls" && req.method === "POST") {
      send(201, { number: 7, html_url: `${apiBase}/acme/site/pull/7` });
      return;
    }

    send(404, { message: "No route" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  apiBase = `http://127.0.0.1:${port}`;

  // github.ts hits the real api.github.com host by construction; point it at
  // the fixture by wrapping global fetch and rewriting only that base URL.
  originalFetch = global.fetch;
  global.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const rewritten = url.replace("https://api.github.com", apiBase);
    return originalFetch(rewritten, init);
  }) as typeof fetch;
});

afterAll(async () => {
  global.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  writtenFiles.length = 0;
  existingShas = {};
});

const creds = () => ({ token: "ghp_test_token", owner: "acme", repo: "site" });

describe("testConnection", () => {
  it("succeeds with a valid token and returns the default branch", async () => {
    expect(await testConnection(creds())).toEqual({
      ok: true,
      defaultBranch: "main",
      fullName: "acme/site",
    });
  });

  it("fails with a clear message on a bad token", async () => {
    const result = await testConnection({ ...creds(), token: "wrong" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rejected/i);
  });

  it("fails with a clear message on an unknown repo", async () => {
    const result = await testConnection({ ...creds(), repo: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/couldn't find/i);
  });
});

describe("openFixPullRequest", () => {
  it("creates a branch, writes new files, and opens a PR", async () => {
    const result = await openFixPullRequest(
      creds(),
      [
        { path: "llms.txt", content: "# Acme\n" },
        { path: "robots.txt", content: "User-agent: *\nAllow: /\n" },
      ],
      { title: "WeBind fixes", body: "Adds llms.txt and robots.txt", branchName: "webind/fix-1" },
    );

    expect(result).toEqual({
      ok: true,
      prNumber: 7,
      prUrl: `${apiBase}/acme/site/pull/7`,
      branchName: "webind/fix-1",
    });
    expect(writtenFiles).toEqual([
      { path: "llms.txt", branch: "webind/fix-1", sha: undefined },
      { path: "robots.txt", branch: "webind/fix-1", sha: undefined },
    ]);
  });

  it("updates (not duplicates) a file that already exists on the branch", async () => {
    existingShas["robots.txt"] = "old-sha-456";
    const result = await openFixPullRequest(
      creds(),
      [{ path: "robots.txt", content: "User-agent: *\nAllow: /\n" }],
      { title: "t", body: "b", branchName: "webind/fix-2" },
    );
    expect(result.ok).toBe(true);
    expect(writtenFiles).toEqual([
      { path: "robots.txt", branch: "webind/fix-2", sha: "old-sha-456" },
    ]);
  });
});
