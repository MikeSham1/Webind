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

export interface GitHubCredentials {
  token: string;
  owner: string;
  repo: string;
}

export type GitHubResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call(
  creds: GitHubCredentials,
  path: string,
  init: RequestInit = {},
): Promise<GitHubResult<{ status: number; body: Record<string, unknown> }>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
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

  let body: unknown = null;
  try {
    body = await res.json();
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
): Promise<GitHubResult<{ defaultBranch: string; fullName: string }>> {
  const result = await call(creds, `/repos/${creds.owner}/${creds.repo}`);
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
}

export interface OpenedPullRequest {
  prNumber: number;
  prUrl: string;
  branchName: string;
}

/**
 * Create a branch off the repo's default branch, commit each file to it
 * (creating or updating), and open a pull request. Stops at the first failed
 * step — a partially-created branch with no PR is a harmless leftover the
 * user can delete, not a broken state that needs its own rollback.
 */
export async function openFixPullRequest(
  creds: GitHubCredentials,
  files: FixFile[],
  pr: { title: string; body: string; branchName: string },
): Promise<GitHubResult<OpenedPullRequest>> {
  const repoInfo = await testConnection(creds);
  if (!repoInfo.ok) return repoInfo;

  const baseRef = await call(
    creds,
    `/repos/${creds.owner}/${creds.repo}/git/ref/heads/${repoInfo.defaultBranch}`,
  );
  if (!baseRef.ok) return baseRef;
  const object = baseRef.body.object as Record<string, unknown> | undefined;
  const baseSha = typeof object?.sha === "string" ? object.sha : null;
  if (!baseSha) return { ok: false, error: "Couldn't read the base branch's commit." };

  const branchRef = await call(creds, `/repos/${creds.owner}/${creds.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${pr.branchName}`, sha: baseSha }),
  });
  if (!branchRef.ok) return branchRef;

  for (const file of files) {
    const existing = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/contents/${file.path}?ref=${pr.branchName}`,
    );
    const existingSha =
      existing.ok && typeof existing.body.sha === "string" ? existing.body.sha : undefined;

    const written = await call(
      creds,
      `/repos/${creds.owner}/${creds.repo}/contents/${file.path}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: `WeBind: add/update ${file.path}`,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: pr.branchName,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    );
    if (!written.ok) return written;
  }

  const opened = await call(creds, `/repos/${creds.owner}/${creds.repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: pr.title,
      body: pr.body,
      head: pr.branchName,
      base: repoInfo.defaultBranch,
    }),
  });
  if (!opened.ok) return opened;

  const prNumber = Number(opened.body.number);
  const prUrl = typeof opened.body.html_url === "string" ? opened.body.html_url : "";
  if (!Number.isFinite(prNumber) || !prUrl) {
    return { ok: false, error: "GitHub didn't return a pull request number/URL." };
  }

  return { ok: true, prNumber, prUrl, branchName: pr.branchName };
}
