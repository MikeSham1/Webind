# Phase 3 — Status and Remaining Steps

Phase 3 in the original roadmap ([2026-07-22-webind-authority-platform-design.md](2026-07-22-webind-authority-platform-design.md),
§5) is two independent items: **autonomous custom-code fixes** (GitHub → WeBind
opens reviewed PRs) and **paid backlink APIs** for higher-fidelity Traditional
Authority scoring. This note tracks what's built, what's deliberately deferred,
and why — so a later pass doesn't have to reconstruct that context. No
credentials, customer data, or business terms are recorded here.

## What's built (this pass)

**GitHub connection.** A user connects one repo via a fine-grained Personal
Access Token (`src/lib/integrations/github.ts`, `githubConnections` table),
generated in their own GitHub account and scoped to just that repo's Contents
+ Pull requests permissions. Stored AES-256-GCM encrypted, same as the
WordPress connection.

**Open a PR.** From a saved report's "Ready-to-apply fixes," a connected user
can open a pull request that adds or updates `llms.txt` and `robots.txt` on
their repo (`openFixPrAction` in `src/app/actions.ts`). One PR is tracked per
report (`code_fix_prs` table); opening again just reports the existing PR
rather than duplicating it.

**Why only those two files.** Every other generated asset (JSON-LD schema,
meta tags) is an HTML *snippet* meant for an unknown location in an unknown
template — committing it blindly into an arbitrary repo would be a guess, not
a fix, and the whole product's premise (per the decisions log) is that
**every change requires human approval**. `llms.txt` and `robots.txt` are the
only assets that are genuinely standalone files with a fixed, well-known
location (repo root), so they're the only ones safe to commit autonomously.
A pull request is itself the approval gate — nothing merges without the
repo owner reviewing and clicking merge.

## Remaining for a fuller version of "autonomous custom-code fixes"

- **GitHub App instead of a PAT.** A Personal Access Token is the simplest
  thing that works (no app registration, no installation flow, no webhook
  infrastructure), but it means the user hand-generates and pastes a token per
  repo. A GitHub App would let a user "install" WeBind on one or more repos
  from GitHub's own UI, with narrower, revocable-in-one-place permissions —
  better UX at real scale, more setup cost now.
- **PR status sync.** A PR's status (`code_fix_prs.status` isn't even tracked
  yet — every row is implicitly "opened") never updates after creation. GitHub
  webhooks (or polling) would be needed to reflect merged/closed state back
  into the dashboard.
- **Template-aware fixes.** Injecting the JSON-LD schema and meta-tag snippets
  into a site's actual templates would require understanding the target
  repo's framework and file layout well enough to do it safely across
  arbitrary codebases — a meaningfully harder problem than writing two
  root-level files, and not attempted here.
- **Multiple repos per user.** The connection is one repo per user for now
  (mirrors the WordPress connection's one-site-per-user shape). An agency
  managing several client sites would need one connection per site.

## Not started: paid backlink APIs

Traditional Authority's backlink signal is still excluded rather than
guessed (see `SignalBreakdown`'s "off-page data we don't collect yet"
messaging). Wiring up a real backlink index (Ahrefs, Semrush, or DataForSEO,
per the original roadmap) is a separate, unstarted piece of work — it's a
paid, metered API, so it also needs a usage/cost-control story before
turning it on, not just a client and an API key.

## Also flagged, not a code task

Deploying with a custom domain over HTTPS is a Railway dashboard + DNS step
(attach the domain in Railway, point DNS at the value it gives you — Railway
issues and renews the certificate automatically once that resolves). Nothing
in this repo needs to change for it; it isn't tracked further here.
