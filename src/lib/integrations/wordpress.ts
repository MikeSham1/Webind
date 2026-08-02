/**
 * WordPress REST API client for one-click-apply publishing.
 *
 * Auth is a WP Application Password (Users → Profile → Application Passwords
 * in the customer's own WP admin) sent as HTTP Basic auth — the credential
 * type WordPress core has built in since 5.6, so this needs no OAuth app
 * registration or approval process. Every function returns a discriminated
 * result instead of throwing: a flaky site or bad credentials should read as
 * "couldn't publish," not crash the caller.
 *
 * The site URL is customer-supplied and this client fetches it from the
 * server, so it's the same request-forgery shape as the crawler: every call
 * re-validates against the SSRF guard (see crawler/ssrf.ts) before touching
 * the network, not just once at connect time — a site's DNS can change after
 * it's saved.
 */

import { isPublicUrl } from "@/lib/crawler/ssrf";

const REQUEST_TIMEOUT_MS = 15_000;

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export type WordPressResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export interface WordPressCallOptions {
  /** Test-only injection point — mirrors CrawlOptions.isUrlAllowed. Defaults to the real SSRF guard. */
  isUrlAllowed?: (url: string) => Promise<boolean>;
}

function apiBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

function authHeader(creds: WordPressCredentials): string {
  const token = Buffer.from(`${creds.username}:${creds.appPassword}`).toString("base64");
  return `Basic ${token}`;
}

/** Admin edit-screen URL for a post/page — stable regardless of permalink structure. */
function editUrl(siteUrl: string, postId: number): string {
  return `${apiBase(siteUrl)}/wp-admin/post.php?post=${postId}&action=edit`;
}

async function call(
  creds: WordPressCredentials,
  path: string,
  init: RequestInit = {},
  { isUrlAllowed = isPublicUrl }: WordPressCallOptions = {},
): Promise<WordPressResult<{ status: number; body: Record<string, unknown> }>> {
  if (!(await isUrlAllowed(apiBase(creds.siteUrl)))) {
    return { ok: false, error: "That site address isn't allowed." };
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase(creds.siteUrl)}/wp-json/wp/v2${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(creds),
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? "The WordPress site took too long to respond."
        : "Couldn't reach that WordPress site — check the URL.",
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (e.g. a plain 404 HTML page) — fall through to the status check.
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = typeof record.message === "string" ? record.message : null;
    return {
      ok: false,
      error:
        res.status === 401
          ? "WordPress rejected that username or Application Password."
          : (message ?? `WordPress returned an error (${res.status}).`),
    };
  }

  return { ok: true, status: res.status, body: record };
}

/** Verify the credentials work at all, and surface whose account they are. */
export async function testConnection(
  creds: WordPressCredentials,
  opts: WordPressCallOptions = {},
): Promise<WordPressResult<{ name: string }>> {
  const result = await call(creds, "/users/me", {}, opts);
  if (!result.ok) return result;
  const name = typeof result.body.name === "string" ? result.body.name : creds.username;
  return { ok: true, name };
}

export interface PublishedPage {
  postId: number;
  viewUrl: string;
  editUrl: string;
}

/** Create a new WordPress page, published live immediately. */
export async function createPage(
  creds: WordPressCredentials,
  page: { title: string; contentHtml: string },
  opts: WordPressCallOptions = {},
): Promise<WordPressResult<PublishedPage>> {
  const result = await call(
    creds,
    "/pages",
    {
      method: "POST",
      body: JSON.stringify({ title: page.title, content: page.contentHtml, status: "publish" }),
    },
    opts,
  );
  if (!result.ok) return result;
  const postId = Number(result.body.id);
  const link = typeof result.body.link === "string" ? result.body.link : creds.siteUrl;
  if (!Number.isFinite(postId)) {
    return { ok: false, error: "WordPress didn't return a page id." };
  }
  return { ok: true, postId, viewUrl: link, editUrl: editUrl(creds.siteUrl, postId) };
}

/**
 * Set an existing page's status (`publish` to bring it live, `draft` to pull
 * it down without deleting it — this is the entire "roll back" mechanism).
 */
export async function setPageStatus(
  creds: WordPressCredentials,
  postId: number,
  status: "publish" | "draft",
  contentHtml?: string,
  opts: WordPressCallOptions = {},
): Promise<WordPressResult<PublishedPage>> {
  const result = await call(
    creds,
    `/pages/${postId}`,
    {
      method: "POST",
      body: JSON.stringify(contentHtml ? { status, content: contentHtml } : { status }),
    },
    opts,
  );
  if (!result.ok) return result;
  const link = typeof result.body.link === "string" ? result.body.link : creds.siteUrl;
  return { ok: true, postId, viewUrl: link, editUrl: editUrl(creds.siteUrl, postId) };
}
