# WeBind Fix Agent — Design

**Status:** Draft for review
**Date:** 2026-08-18
**Author:** WeBind team

## Summary

The Fix Agent is a Claude-powered feature that turns a report's identified
miscues into concrete, **surgical**, page-grounded fixes — then stages them
through WeBind's existing human-approval gates (a GitHub pull request or a
WordPress draft) for one-click review. It is the missing middle between what
WeBind has today:

- deterministic *template* fixes (`buildOptimizations` — generic schema, meta,
  llms.txt, robots.txt), and
- smart `prioritizedFixes[]` that are only *text instructions to a human*.

The Fix Agent writes the actual edit — a meta description drawn from the page's
own content, an FAQPage schema extracted from real Q&A, a content-grounded
llms.txt — as a discrete, reviewable unit the owner approves before anything
touches their live site.

### Honest framing (non-negotiable, matches the rest of the product)

This is **not a trained/fine-tuned model.** "Built off Claude" means a
specialized Claude call: a tuned system prompt + the crawled page and report as
grounding + a strict output schema. It is branded in the UI as the "WeBind Fix
Agent, powered by Claude" — never "our own AI model." This matches the site's
existing honesty commitments (honest provider stubs, "not calibrated" scoring
disclosure, draft-first publishing).

## Goals

- Produce specific, page-grounded surgical fixes across four categories:
  head/metadata, structured data (JSON-LD), crawlability files, and on-page
  content structure.
- Keep every fix **surgical**: a discrete, individually-reviewable unit (one
  tag, one file, one heading change, one alt-text) — never a wholesale rewrite.
- Route fixes only through the existing human-approval gates. Nothing reaches a
  live site unreviewed.
- Never fabricate facts. Fixes are grounded in the crawled page; a
  deterministic validation pass drops anything unfounded.
- Degrade gracefully with no `ANTHROPIC_API_KEY` (fall back to today's
  deterministic assets). Never throw into the request path.

## Non-goals

- **No autonomous live edits.** The agent prepares; a human approves. (Decided
  with the user: "autonomous prep, human approves.")
- **No agentic tool-loop.** The page is fully crawled before the agent runs, so
  all needed data is already in memory. A single structured Claude call is the
  correct, simplest tier — an agentic loop would only re-serve in-hand data at
  higher cost/latency/failure surface.
- **No new external-write surface.** Reuses `openFixPullRequest` and the
  WordPress draft-first publish path exactly as they exist.
- **No site-wide multi-page fixing** in this iteration (single page per run,
  matching the report). That is a future extension.

## Architecture

### Data flow

```
CrawledPage + ReportResult
        │
        ▼
  proposeFixes()  ──►  single Claude call (claude-opus-4-8, adaptive thinking,
   (fixAgent.ts)        output_config.format = strict json_schema)
        │
        ▼
  validateFixes()  ──►  deterministic guardrails: each fix maps to a real
        │               report signal; content inserts verified against the
        │               crawled text; unfounded fixes dropped
        ▼
  ProposedFix[]  ──►  UI panel (checkbox per fix, before/after diff)
        │
        ▼
  user selects  ──►  stage via existing gate:
                       • github-file    → openFixPullRequest (standalone files)
                       • github-snippet → PR adding snippet file + paste
                                          instructions in PR body
                       • wordpress-post → draft-first WordPress publish
                       • manual         → copy-only (no safe automated target)
```

### Components

**`src/lib/agent/types.ts`** — the typed contract.

```ts
export type FixCategory =
  | "metadata"
  | "schema"
  | "crawlability"
  | "content-structure";

export type FixApplyVia =
  | "github-file"      // standalone file: llms.txt, robots.txt
  | "github-snippet"   // head/inline snippet — PR adds a file + paste guide
  | "wordpress-post"   // title/excerpt/meta/JSON-LD on the connected post
  | "manual";          // no safe automated target — copy only

export type FixConfidence = "high" | "medium" | "low";

export interface ProposedFix {
  category: FixCategory;
  /** Human-readable target, e.g. "llms.txt", "<head>", "hero <h1>". */
  target: string;
  /** Short human label for the fix. */
  title: string;
  /** Why this fix — cites the specific report signal it addresses. */
  rationale: string;
  /** The signal key from the report this maps to (validation anchor). */
  signalKey: string;
  /** Current state, or null when adding something new. */
  before: string | null;
  /** The exact surgical replacement/addition. */
  after: string;
  confidence: FixConfidence;
  applyVia: FixApplyVia;
}

export interface FixAgentResult {
  fixes: ProposedFix[];
  /** True when Claude produced these; false = deterministic fallback. */
  aiGenerated: boolean;
}
```

**`src/lib/agent/fixAgent.ts`** — the Claude call + validation. Modeled
directly on `src/lib/scoring/explain.ts`:

- No `ANTHROPIC_API_KEY` → return the deterministic fallback (wrap today's
  `buildOptimizations` output as `ProposedFix[]` with `aiGenerated: false`).
- Otherwise: one `client.messages.create` with
  - `model: "claude-opus-4-8"`
  - `thinking: { type: "adaptive" }`
  - `output_config: { format: { type: "json_schema", schema: FIX_SCHEMA } }`
    (strict — guarantees a parseable `ProposedFix[]`)
  - a system prompt that (a) enumerates the four allowed categories and the
    surgical constraint, (b) forbids inventing facts/stats/testimonials —
    "use ONLY the provided page content," mirroring explain.ts's
    "never invent numbers," and (c) requires each fix to name the report
    signal it addresses.
  - the user message serializes the crawled page's relevant fields
    (`title`, `metaDescription`, `headings`, `jsonLdBlocks`, `renderedText`
    excerpt, `hasLlmsTxt`, `robotsAllowsAiBots`, `imageCount`/`imagesWithAlt`,
    `hasCanonical`, `hasOpenGraph`, etc.) plus the report's signals and
    reasons.
- Token usage logged via the existing `logInfo("ai_call.ok", …)` shape.
- On any error → the deterministic fallback. Never throws.

**`validateFixes(fixes, page, report)`** — deterministic guardrails, run on
every AI-produced fix before it is ever shown:

1. `signalKey` must exist in `report.ai.signals` or
   `report.traditional.signals`. Drop otherwise.
2. `category` and `applyVia` must be a known enum value. Drop otherwise.
3. For `content-structure` fixes whose `after` asserts factual prose, every
   non-structural claim's tokens must be traceable to `page.renderedText`
   (the agent may restructure/summarize existing content, never assert new
   facts). Structural-only changes (heading level, TL;DR assembled from
   existing text, alt text describing an existing image context) pass.
4. `crawlability` fixes are cross-checked against the deterministic truth we
   already compute (`page.hasLlmsTxt`, `page.robotsAllowsAiBots`) so the agent
   can't propose an llms.txt when one already exists.

Anything failing validation is dropped silently — we never surface an
unvalidated fix.

**`src/app/agent/actions.ts`** — `proposeFixesAction(requestId)`:

- Owner-scoped lookup (`getReportForUser`, matching the write-authority model
  established this session — never the admin bypass).
- Rate-limited (`fix-agent:${user.id}`, in line with the other AI actions).
- **Re-crawls the report's URL on demand** to get a fresh `CrawledPage`. The
  stored `reportRequests` row holds only `ReportResult` + `OptimizationAssets`,
  not the full `CrawledPage` the agent needs (renderedText, headings,
  jsonLdBlocks, …), so we re-fetch through the existing SSRF-guarded `crawl()`.
  This is deliberate over running the agent inline during every report: the
  agent's Claude cost is only paid when the owner explicitly opts in, and the
  extra crawl is cheap and already SSRF-guarded. It also means fixes reflect
  the page's *current* state, not a stale snapshot.
- Runs `proposeFixes(page, report)`, returns `FixAgentResult`.

**`src/components/FixAgentPanel.tsx`** — a client component rendered below the
existing `FixList` on the report page:

- One row per `ProposedFix`: category chip, title, confidence, before/after
  diff, and a checkbox.
- A "Stage selected →" control that groups the checked fixes by `applyVia` and
  hands off to the existing `OpenPrBar` (GitHub) / `PublishBar` (WordPress)
  plumbing. `manual` fixes get a copy button only.

### Where it plugs into the existing report flow

`ReportResults.tsx` already renders `FixList` and `OptimizationAssets`. The
Fix Agent panel slots between them for signed-in users with a saved
`requestId` (same gating `OptimizationAssets` already uses for the PR action).
Anonymous/unsaved runs still see the deterministic `OptimizationAssets` exactly
as today — the agent is an enhancement, not a replacement.

## Error handling

- No DB / no `requestId` → panel not shown (nothing to stage against).
- No `ANTHROPIC_API_KEY` → deterministic fallback fixes, labeled as such.
- Claude call fails / returns malformed data → caught, deterministic fallback.
- A staged PR/WordPress write fails → surfaced through the existing
  `OpenPrBar`/`PublishBar` error states and the existing audit trail; no new
  error surface.

## Testing

- **`fixAgent.test.ts`**: `proposeFixes` with no API key returns the
  deterministic fallback (`aiGenerated: false`) and never throws.
- **`validateFixes` unit tests**: drops a fix with an unknown `signalKey`;
  drops a `content-structure` fix asserting a fact absent from
  `renderedText`; keeps a structural-only fix; drops a `crawlability` llms.txt
  fix when `page.hasLlmsTxt` is true.
- **Action test**: `proposeFixesAction` refuses for a non-owner and rate-limits.
- All deterministic — no live Claude call in the test suite (mirrors how
  `explain.ts` is exercised via its fallback path).

## Rollout

1. Backend (`types.ts`, `fixAgent.ts` with fallback + validation) + tests.
2. Server action, owner-scoped + rate-limited.
3. UI panel wired to existing PR/WordPress plumbing.
4. Verify: lint, typecheck, tests, build; live smoke test of the fallback path
   and (if a key is configured) one real proposal end-to-end.

## Open questions

- Should `content-structure` fixes ship in v1, or start with the three lower-
  risk categories and add content-structure once the validation pass is proven
  in practice? (User selected all four in scope; flagging that content-structure
  carries the highest review burden and could be a fast-follow.)
