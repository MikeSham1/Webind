/**
 * GitHub REST API client for Phase 3's one-click-apply: opening a pull
 * request with deterministic, file-shaped fixes (llms.txt, robots.txt).
 *
 * Auth is a fine-grained Personal Access Token the user generates in their own
 * GitHub account (Settings → Developer settings → Personal access tokens),
 * scoped to just this repo's Contents + Pull requests permissions — not a
 * GitHub App install. Every function returns a discriminated result instead
 * of throwing. Unlike the WordPress client, the target host is always
 * `api.github.com` (never customer-supplied), so there's no SSRF surface here.
 */

const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const API_VERSION = "2022-11-28";
/** Hard cap on any GitHub response body we buffer into memory. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface GitHubCredentials {
  token: string;
  owner: string;
  repo: string;
}

export type GitHubResult<T> = ({ ok: true } & T) | { ok: false; error: string };

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

async function call(
  creds: GitHubCredentials,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubResult<{ status: number; body: Record<string, unknown> }>> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "WebindApp",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut ? "GitHub took too long to respond." : "Couldn't reach GitHub.",
    };
  }

  const text = await readCappedText(res, MAX_RESPONSE_BYTES);
  if (text === null) {
    return { ok: false, error: "GitHub's response was too large to process." };
  }

  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // No JSON body (e.g. a 204) — fall through to the status check.
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = typeof record.message === "string" ? record.message : null;
    return {
      ok: false,
      error:
        res.status === 401
          ? "GitHub rejected that Personal Access Token."
          : res.status === 404
            ? "Couldn't find that repository — check the owner/name and the token's access."
            : (message ?? `GitHub returned an error (${res.status}).`),
    };
  }

  return { ok: true, status: res.status, body: record };
}

/** Verify the token can see the repo, and return its default branch. */
export async function testConnection(
  creds: GitHubCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubResult<{ defaultBranch: string; fullName: string }>> {
  const result = await call(creds, `/repos/${creds.owner}/${creds.repo}`, {}, fetchImpl);
  if (!result.ok) return result;
  const defaultBranch =
    typeof result.body.default_branch === "string" ? result.body.default_branch : "main";
  const fullName =
    typeof result.body.full_name === "string"
      ? result.body.full_name
      : `${creds.owner}/${creds.repo}`;
  return { ok: true, defaultBranch, fullName };
}

export interface FixFile {
  /** Repo-root-relative path, e.g. "llms.txt". */
  path: string;
  content: string;
  /**
   * Optional non-destructive merge with the file's EXISTING content. When set
   * and the file already exists in the repo, the committed content is
   * `merge(existing, content)` instead of a wholesale replace — used for
   * robots.txt so we never wipe a site's sitemaps or other crawler rules.
   */
  merge?: (existing: string, incoming: string) => string | null;
  /**
   * Only ever modify this file, never create it: skipped when it doesn't exist
   * on the branch. Used for a site's HTML pages, which must not be invented.
   * A `merge` returning null likewise means "leave this file alone".
   */
  existingOnly?: boolean;
}

/**
 * AI/answer-engine SEARCH crawler tokens we ask robots.txt to allow — the ones
 * that gate whether a site can be surfaced or cited. Training crawlers (GPTBot,
 * ClaudeBot, Google-Extended) are deliberately NOT here: blocking those is a
 * legitimate model-training choice that doesn't affect search inclusion, so a
 * WeBind PR must never quietly opt a site into training.
 */
const AI_ROBOT_AGENTS = [
  "Googlebot",
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
];

/**
 * Merge AI-crawler allow rules into an existing robots.txt without touching any
 * other line. Only bots that have no group of their own are appended (so we
 * never duplicate or override rules the site owner set deliberately), and every
 * existing sitemap/disallow/other-agent line is preserved verbatim.
 */
export function mergeRobotsTxt(existing: string, incoming: string): string {
  if (!existing.trim()) return incoming; // no file yet → use the generated one
  const lower = existing.toLowerCase();
  const missing = AI_ROBOT_AGENTS.filter(
    (bot) => !new RegExp(`user-agent:\\s*${bot.toLowerCase()}(\\s|$)`, "m").test(lower),
  );
  if (missing.length === 0) return existing; // already addressed — leave it alone
  const additions = missing.map((bot) => `User-agent: ${bot}\nAllow: /`).join("\n\n");
  return `${existing.trimEnd()}\n\n# Added by WeBind — allow AI answer engines\n${additions}\n`;
}

/**
 * The first of `paths` that exists on the repo's default branch, or null. Used
 * to find which file serves a page (index.html vs public/index.html, …).
 */
export async function findExistingPath(
  creds: GitHubCredentials,
  paths: string[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (const path of paths) {
    const res = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
      {},
      fetchImpl,
    );
    // A directory comes back as an array; only a file counts.
    if (res.ok && !Array.isArray(res.body) && res.body.type === "file") return path;
  }
  return null;
}

export interface OpenedPullRequest {
  prNumber: number;
  prUrl: string;
  branchName: string;
}

/** How many suffixed branch names to try before giving up on a collision. */
const MAX_BRANCH_ATTEMPTS = 5;

/**
 * Create `branchName` off `baseSha`. If that exact name already exists (a repeat
 * run, or a leftover from an earlier attempt), try `-2`, `-3`, … so a re-run
 * succeeds cleanly instead of failing with a raw "Reference already exists".
 */
async function createBranch(
  creds: GitHubCredentials,
  baseSha: string,
  branchName: string,
  fetchImpl: typeof fetch,
): Promise<GitHubResult<{ branch: string }>> {
  for (let i = 0; i < MAX_BRANCH_ATTEMPTS; i++) {
    const branch = i === 0 ? branchName : `${branchName}-${i + 1}`;
    const res = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/git/refs`,
      { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) },
      fetchImpl,
    );
    if (res.ok) return { ok: true, branch };
    // Only a name collision is retryable; a real error (auth, perms) is not.
    if (!/already exists/i.test(res.error)) return res;
  }
  return { ok: false, error: "Couldn't create a branch — too many name collisions." };
}

/** Best-effort delete of a branch we created but don't need (e.g. empty PR). */
async function deleteBranch(
  creds: GitHubCredentials,
  branch: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  await call(
    creds,
    `/repos/${creds.owner}/${creds.repo}/git/refs/heads/${branch}`,
    { method: "DELETE" },
    fetchImpl,
  );
}

/**
 * Create a branch off the repo's default branch, commit each file that actually
 * changes, and open a pull request. Improvements over a naive version:
 *   - a branch-name collision is retried with a suffix, so re-runs don't 422;
 *   - files whose content already matches are skipped (no empty commits), and
 *     if nothing changes at all the throwaway branch is deleted and a clear
 *     "nothing to change" result is returned instead of an empty PR;
 *   - an already-open PR reports a friendly message, not a raw API error.
 *
 * A partially-created branch left by a mid-run failure is a harmless leftover
 * the user can delete, not a broken state needing rollback.
 */
export async function openFixPullRequest(
  creds: GitHubCredentials,
  files: FixFile[],
  pr: { title: string; body: string; branchName: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GitHubResult<OpenedPullRequest>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const repoInfo = await testConnection(creds, fetchImpl);
  if (!repoInfo.ok) return repoInfo;

  const baseRef = await call(
    creds,
    `/repos/${creds.owner}/${creds.repo}/git/ref/heads/${repoInfo.defaultBranch}`,
    {},
    fetchImpl,
  );
  if (!baseRef.ok) return baseRef;
  const object = baseRef.body.object as Record<string, unknown> | undefined;
  const baseSha = typeof object?.sha === "string" ? object.sha : null;
  if (!baseSha) return { ok: false, error: "Couldn't read the base branch's commit." };

  const created = await createBranch(creds, baseSha, pr.branchName, fetchImpl);
  if (!created.ok) return created;
  const branch = created.branch;

  let changed = 0;
  for (const file of files) {
    const existing = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/contents/${file.path}?ref=${branch}`,
      {},
      fetchImpl,
    );
    const existingSha =
      existing.ok && typeof existing.body.sha === "string" ? existing.body.sha : undefined;

    if (!existingSha && file.existingOnly) continue;

    // Merge into existing content when asked (robots.txt, HTML heads),
    // otherwise replace.
    let content = file.content;
    if (existingSha) {
      const rawBase64 =
        existing.ok && typeof existing.body.content === "string" ? existing.body.content : "";
      const decoded = Buffer.from(rawBase64.replace(/\s/g, ""), "base64").toString("utf8");
      if (file.merge) {
        const merged = file.merge(decoded, file.content);
        if (merged === null) continue; // the merge declined: leave the file alone
        content = merged;
      }
      // Skip a write that would produce no change — an empty commit helps nobody.
      if (decoded === content) continue;
    }

    const written = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/contents/${file.path}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `WeBind: add/update ${file.path}`,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
      fetchImpl,
    );
    if (!written.ok) return written;
    changed += 1;
  }

  if (changed === 0) {
    // We created a branch but every file was already up to date: clean up the
    // throwaway branch and tell the caller there's nothing to open a PR for.
    await deleteBranch(creds, branch, fetchImpl);
    return {
      ok: false,
      error: "Everything's already in place — there's nothing to change in a pull request.",
    };
  }

  const opened = await call(
    creds,
    `/repos/${creds.owner}/${creds.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({ title: pr.title, body: pr.body, head: branch, base: repoInfo.defaultBranch }),
    },
    fetchImpl,
  );
  if (!opened.ok) {
    if (/already exists/i.test(opened.error)) {
      return { ok: false, error: "A pull request for this branch is already open on GitHub." };
    }
    return opened;
  }

  const prNumber = Number(opened.body.number);
  const prUrl = typeof opened.body.html_url === "string" ? opened.body.html_url : "";
  if (!Number.isFinite(prNumber) || !prUrl) {
    return { ok: false, error: "GitHub didn't return a pull request number/URL." };
  }

  return { ok: true, prNumber, prUrl, branchName: branch };
}
