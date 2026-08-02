import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPage, setPageStatus, testConnection } from "./wordpress";

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
  it("creates a published page and returns view + edit URLs", async () => {
    const result = await createPage(
      creds(),
      { title: "Managed IT", contentHtml: "<p>Hello</p>" },
      offline,
    );
    expect(result).toEqual({
      ok: true,
      postId: 42,
      viewUrl: `${siteUrl}/managed-it/`,
      editUrl: `${siteUrl}/wp-admin/post.php?post=42&action=edit`,
    });
    expect(lastPagePayload).toEqual({
      title: "Managed IT",
      content: "<p>Hello</p>",
      status: "publish",
    });
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
