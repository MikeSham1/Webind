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
 * it's saved. Unlike a plain `fetch`, redirects are never followed
 * automatically: see `resolveWithinOrigin` below.
 */

import { isPublicUrl } from "@/lib/crawler/ssrf";

const REQUEST_TIMEOUT_MS = 15_000;
/** Redirect hops we'll follow ourselves before giving up (GET requests only). */
const MAX_REDIRECT_HOPS = 5;
/** Hard cap on any WordPress response body we buffer into memory. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export type WordPressResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status?: number };

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

/**
 * A draft page has no public permalink — `?page_id=&preview=true` is WP's own
 * mechanism for a logged-in editor to view one regardless of permalink
 * structure. Works for a published page too (WP just shows the live page).
 * Exported so callers can reconstruct it from a stored postId without a fresh
 * API round-trip (see beginPublish's "already_active" path in studio/actions.ts).
 */
export function buildPreviewUrl(siteUrl: string, postId: number): string {
  return `${apiBase(siteUrl)}/?page_id=${postId}&preview=true`;
}

/** Read a response body with a hard size cap, never buffering more than that. */
async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null; // too large
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Resolve a request's redirect chain manually, restricted to the SAME origin
 * as the connected site and re-validated against the SSRF guard at every hop.
 *
 * A WordPress REST endpoint has no legitimate reason to redirect our
 * authenticated request (Basic-auth header and all) to a different domain —
 * allowing that would let a compromised or misconfigured site redirect it
 * anywhere, including an internal address. So cross-origin redirects are
 * refused outright. Within the same origin (the common case: http->https or
 * www canonicalization), only GET requests are followed; a write (POST/PUT/
 * PATCH) that gets redirected fails with a clear error instead of silently
 * replaying its body/method to a different URL, which is the safer default
 * for a request that changes state.
 */
async function resolveWithinOrigin(
  startUrl: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  isUrlAllowed: (url: string) => Promise<boolean>,
): Promise<WordPressResult<{ response: Response }>> {
  const allowedOrigin = new URL(startUrl).origin;
  const isWrite = method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD";
  let target = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (hop > 0 && !(await isUrlAllowed(target))) {
      return { ok: false, error: "That site redirected somewhere that isn't allowed." };
    }

    let res: Response;
    try {
      res = await fetch(target, {
        method,
        headers,
        body,
        redirect: "manual",
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

    const isRedirect = res.status >= 300 && res.status < 400 && res.status !== 304;
    if (!isRedirect) return { ok: true, response: res };

    if (isWrite) {
      await res.body?.cancel().catch(() => {});
      return {
        ok: false,
        error:
          "That site redirected this request instead of handling it directly — " +
          "check the connected site URL (http vs https, or a domain change).",
      };
    }

    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!location) return { ok: false, error: "That site sent a redirect with no destination." };

    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return { ok: false, error: "That site redirected to an invalid address." };
    }
    if (next.origin !== allowedOrigin) {
      return {
        ok: false,
        error: "That site redirected outside its own domain — refusing to follow for safety.",
      };
    }
    target = next.toString();
  }

  return { ok: false, error: "That site redirected too many times." };
}

async function call(
  creds: WordPressCredentials,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  { isUrlAllowed = isPublicUrl }: WordPressCallOptions = {},
): Promise<WordPressResult<{ status: number; body: Record<string, unknown> }>> {
  const base = apiBase(creds.siteUrl);
  if (!(await isUrlAllowed(base))) {
    return { ok: false, error: "That site address isn't allowed." };
  }

  const resolved = await resolveWithinOrigin(
    `${base}/wp-json/wp/v2${path}`,
    init.method ?? "GET",
    {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
      ...init.headers,
    },
    init.body,
    isUrlAllowed,
  );
  if (!resolved.ok) return resolved;
  const res = resolved.response;

  const text = await readCappedText(res, MAX_RESPONSE_BYTES);
  if (text === null) {
    return { ok: false, error: "The WordPress site's response was too large to process." };
  }

  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. a plain 404 HTML page) — fall through to the status check.
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = typeof record.message === "string" ? record.message : null;
    return {
      ok: false,
      status: res.status,
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
  /** A logged-in-editor preview link — the only way to view a `draft` page's content on WP. */
  previewUrl: string;
}

/**
 * WordPress core's two built-in content types. "post" is the chronological
 * blog content type (REST endpoint /posts); "page" is static, hierarchical
 * content (REST endpoint /pages). Every draft used to go to /pages
 * regardless of its content type — a draft explicitly labeled "Blog post"
 * was still created as a Page, silently wrong for anyone whose theme/SEO
 * setup treats Posts and Pages differently (archives, feeds, the blog index).
 */
export type WordPressPostType = "page" | "post";

/** Map a Content Studio page type to the WordPress content type it actually belongs in. */
export function wordPressPostTypeFor(pageType: string): WordPressPostType {
  return pageType === "blog" ? "post" : "page";
}

function restCollection(postType: WordPressPostType): string {
  return postType === "post" ? "/posts" : "/pages";
}

/**
 * Create a new WordPress page or post. `status` is required (not defaulted)
 * so every call site has to say explicitly whether it's writing a draft or
 * going live — see studio/actions.ts, which always creates as `"draft"`
 * first and requires a separate, explicit confirmation before ever passing
 * `"publish"`.
 */
export async function createPage(
  creds: WordPressCredentials,
  page: {
    title: string;
    contentHtml: string;
    status: "draft" | "publish";
    postType?: WordPressPostType;
  },
  opts: WordPressCallOptions = {},
): Promise<WordPressResult<PublishedPage>> {
  const postType = page.postType ?? "page";
  const result = await call(
    creds,
    restCollection(postType),
    {
      method: "POST",
      body: JSON.stringify({ title: page.title, content: page.contentHtml, status: page.status }),
    },
    opts,
  );
  if (!result.ok) return result;
  const postId = Number(result.body.id);
  const link = typeof result.body.link === "string" ? result.body.link : creds.siteUrl;
  if (!Number.isFinite(postId)) {
    return {
      ok: false,
      error: `WordPress didn't return a ${postType} id.`,
    };
  }
  return {
    ok: true,
    postId,
    viewUrl: link,
    editUrl: editUrl(creds.siteUrl, postId),
    previewUrl: buildPreviewUrl(creds.siteUrl, postId),
  };
}

/**
 * Set an existing page or post's status (`publish` to bring it live,
 * `draft` to pull it down without deleting it — this is the entire "roll
 * back" mechanism). `postType` MUST match what the resource was actually
 * created as — /pages/{id} and /posts/{id} are different resources on
 * WordPress's side, and hitting the wrong one 404s (best case) or, if the
 * numeric id happens to collide with an unrelated post/page, silently acts
 * on the wrong content.
 */
export async function setPageStatus(
  creds: WordPressCredentials,
  postId: number,
  status: "publish" | "draft",
  contentHtml?: string,
  opts: WordPressCallOptions & { postType?: WordPressPostType } = {},
): Promise<WordPressResult<PublishedPage>> {
  const { postType = "page", ...callOpts } = opts;
  const result = await call(
    creds,
    `${restCollection(postType)}/${postId}`,
    {
      method: "POST",
      body: JSON.stringify(contentHtml ? { status, content: contentHtml } : { status }),
    },
    callOpts,
  );
  if (!result.ok) return result;
  const link = typeof result.body.link === "string" ? result.body.link : creds.siteUrl;
  return {
    ok: true,
    postId,
    viewUrl: link,
    editUrl: editUrl(creds.siteUrl, postId),
    previewUrl: buildPreviewUrl(creds.siteUrl, postId),
  };
}

export type RemotePageStatus =
  | { ok: true; status: string; link: string | null }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: string };

/**
 * Look up a page/post's CURRENT state directly from WordPress, rather than
 * trusting a locally cached publication record — the record only reflects
 * what WeBind last did, not what's actually there now. A page can be deleted,
 * trashed, or have its status changed directly in WordPress at any time,
 * entirely outside this app. `?context=edit` matters: the default "view"
 * context only ever returns published content, so a page that was published
 * and later unpublished would look identical to "doesn't exist" without it.
 *
 * `notFound: true` is its own branch (not folded into the generic error) so a
 * caller can tell "there's genuinely nothing there anymore" — the one case
 * worth reconciling local state over — apart from every other failure (a
 * network blip, bad credentials), which should never be treated as proof the
 * page is gone.
 */
export async function getPageStatus(
  creds: WordPressCredentials,
  postId: number,
  opts: WordPressCallOptions & { postType?: WordPressPostType } = {},
): Promise<RemotePageStatus> {
  const { postType = "page", ...callOpts } = opts;
  const result = await call(creds, `${restCollection(postType)}/${postId}?context=edit`, {}, callOpts);
  if (!result.ok) {
    if (result.status === 404) return { ok: false, notFound: true };
    return { ok: false, notFound: false, error: result.error };
  }
  const status = typeof result.body.status === "string" ? result.body.status : "unknown";
  const link = typeof result.body.link === "string" ? result.body.link : null;
  return { ok: true, status, link };
}
