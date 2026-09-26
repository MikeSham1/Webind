import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPage, getPageStatus, setPageStatus, testConnection } from "./wordpress";

// The fixture server is loopback, which the real SSRF guard refuses on sight —
// same shape as crawl.test.ts's `offline` fixture for the crawler.
const offline = { isUrlAllowed: async () => true };

const VALID_AUTH = `Basic ${Buffer.from("editor:app-pass-1234").toString("base64")}`;

let server: Server;
let siteUrl: string;
let lastPagePayload: Record<string, unknown> | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.headers.authorization !== VALID_AUTH) {
      send(401, { message: "Incorrect username or password." });
      return;
    }

    if (req.url === "/wp-json/wp/v2/users/me" && req.method === "GET") {
      send(200, { id: 1, name: "Site Editor" });
      return;
    }

    if (req.url === "/wp-json/wp/v2/pages" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastPagePayload = JSON.parse(body);
        send(201, { id: 42, link: `${siteUrl}/managed-it/`, status: "publish" });
      });
      return;
    }

    if (req.url === "/wp-json/wp/v2/pages/42" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastPagePayload = JSON.parse(body);
        send(200, { id: 42, link: `${siteUrl}/managed-it/`, status: lastPagePayload?.status });
      });
      return;
    }

    if (req.url === "/wp-json/wp/v2/pages/42?context=edit" && req.method === "GET") {
      send(200, { id: 42, link: `${siteUrl}/managed-it/`, status: "draft" });
      return;
    }
    // No route registered for postId 999 — falls through to the generic 404
    // below, standing in for "WordPress genuinely has nothing at this id."

    // Redirect-behavior fixtures, selected by a path prefix on the "site URL"
    // used in the test (see the describe block below).
    if (req.url === "/redirect-same-origin/wp-json/wp/v2/users/me" && req.method === "GET") {
      res.writeHead(301, { location: `${siteUrl}/wp-json/wp/v2/users/me` });
      res.end();
      return;
    }
    if (req.url === "/redirect-cross-origin/wp-json/wp/v2/users/me" && req.method === "GET") {
      // Port 9 (discard) has nothing listening — if we ever actually attempted
      // this connection the test would see a generic "couldn't reach" error
      // instead of the specific same-origin refusal, so this doubles as proof
      // we never tried.
      res.writeHead(301, { location: "http://127.0.0.1:9/wp-json/wp/v2/users/me" });
      res.end();
      return;
    }
    if (req.url === "/redirect-write/wp-json/wp/v2/pages" && req.method === "POST") {
      res.writeHead(301, { location: `${siteUrl}/wp-json/wp/v2/pages` });
      res.end();
      return;
    }
    if (req.url === "/huge-response/wp-json/wp/v2/users/me" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(Buffer.alloc(5 * 1024 * 1024 + 1024, 0x61));
      return;
    }

    send(404, { message: "No route" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  siteUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const creds = () => ({ siteUrl, username: "editor", appPassword: "app-pass-1234" });

describe("SSRF guard", () => {
  it("refuses a loopback site URL by default (no override)", async () => {
    const result = await testConnection(creds());
    expect(result).toEqual({ ok: false, error: "That site address isn't allowed." });
  });
});

describe("testConnection", () => {
  it("succeeds with valid Application Password credentials", async () => {
    const result = await testConnection(creds(), offline);
    expect(result).toEqual({ ok: true, name: "Site Editor" });
  });

  it("fails with a clear message on bad credentials", async () => {
    const result = await testConnection({ ...creds(), appPassword: "wrong" }, offline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/rejected/i);
  });

  it("fails with a clear message when the site is unreachable", async () => {
    const result = await testConnection({ ...creds(), siteUrl: "http://127.0.0.1:1" }, offline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/couldn't reach/i);
  });
});

describe("createPage", () => {
  it("creates a published page and returns view/edit/preview URLs", async () => {
    const result = await createPage(
      creds(),
      { title: "Managed IT", contentHtml: "<p>Hello</p>", status: "publish" },
      offline,
    );
    expect(result).toEqual({
      ok: true,
      postId: 42,
      viewUrl: `${siteUrl}/managed-it/`,
      editUrl: `${siteUrl}/wp-admin/post.php?post=42&action=edit`,
      previewUrl: `${siteUrl}/?page_id=42&preview=true`,
    });
    expect(lastPagePayload).toEqual({
      title: "Managed IT",
      content: "<p>Hello</p>",
      status: "publish",
    });
  });

  it("creates a draft page when status is 'draft' (never live without explicit confirmation)", async () => {
    const result = await createPage(
      creds(),
      { title: "Managed IT", contentHtml: "<p>Hello</p>", status: "draft" },
      offline,
    );
    expect(result.ok).toBe(true);
    expect(lastPagePayload).toEqual({
      title: "Managed IT",
      content: "<p>Hello</p>",
      status: "draft",
    });
  });
});

describe("redirect handling", () => {
  it("follows a same-origin GET redirect", async () => {
    const result = await testConnection(
      { ...creds(), siteUrl: `${siteUrl}/redirect-same-origin` },
      offline,
    );
    expect(result).toEqual({ ok: true, name: "Site Editor" });
  });

  it("refuses a cross-origin redirect without ever contacting it", async () => {
    const result = await testConnection(
      { ...creds(), siteUrl: `${siteUrl}/redirect-cross-origin` },
      offline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/outside its own domain/i);
  });

  it("refuses to follow a redirect on a write (POST) request", async () => {
    const result = await createPage(
      { ...creds(), siteUrl: `${siteUrl}/redirect-write` },
      { title: "X", contentHtml: "<p>X</p>", status: "publish" },
      offline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/redirected this request/i);
  });
});

describe("response size limit", () => {
  it("rejects an oversized response body instead of buffering it", async () => {
    const result = await testConnection(
      { ...creds(), siteUrl: `${siteUrl}/huge-response` },
      offline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });
});

describe("setPageStatus", () => {
  it("flips an existing page to draft (the rollback mechanism)", async () => {
    const result = await setPageStatus(creds(), 42, "draft", undefined, offline);
    expect(result.ok).toBe(true);
    expect(lastPagePayload).toEqual({ status: "draft" });
  });

  it("can bring a page back to publish with refreshed content", async () => {
    const result = await setPageStatus(creds(), 42, "publish", "<p>Updated</p>", offline);
    expect(result.ok).toBe(true);
    expect(lastPagePayload).toEqual({ status: "publish", content: "<p>Updated</p>" });
  });
});

describe("getPageStatus", () => {
  it("reports the page's current status when it still exists", async () => {
    const result = await getPageStatus(creds(), 42, offline);
    expect(result).toEqual({ ok: true, status: "draft", link: `${siteUrl}/managed-it/` });
  });

  it("reports notFound — not a generic error — for a page that's genuinely gone", async () => {
    const result = await getPageStatus(creds(), 999, offline);
    expect(result).toEqual({ ok: false, notFound: true });
  });

  it("keeps every other failure distinct from notFound (e.g. bad credentials)", async () => {
    const badCreds = { ...creds(), appPassword: "wrong" };
    const result = await getPageStatus(badCreds, 42, offline);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.notFound).toBe(false);
    }
  });
});
