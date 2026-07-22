# Phase 0: Scoring Engine + Free Report — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the free "AI Authority Report" — a visitor enters a URL and gets two 0–100 scores (AI Authority + Traditional Authority) with plain-English explanations and a prioritized fix list.

**Architecture:** A pure, deterministic scoring core (`src/lib/scoring/`) computes both scores from a normalized `CrawledPage`. A Playwright crawler (`src/lib/crawler/`) produces that `CrawledPage` from a live URL. A Next.js server action ties them together and renders the report. The scoring core is pure functions with zero I/O, so it is fully unit-testable; the crawler and UI are thin shells around it. Live AI-citation checks and Claude-generated prose are the last tasks so the deterministic core is provable first.

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest for tests, Playwright for crawling, Tailwind + shadcn/ui for the report UI. Anthropic SDK (`@anthropic-ai/sdk`) for explanation prose (final task).

**Reference:** Design doc — `docs/plans/2026-07-22-webind-authority-platform-design.md` (Section 3 defines the exact score weights this plan implements).

---

### Task 0: Scaffold the Next.js + TypeScript project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`

**Step 1: Scaffold**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-import-alias --use-npm --yes
```
Expected: Next.js project created in the repo root.

**Step 2: Add dev/test deps**

Run:
```bash
npm install -D vitest @vitest/coverage-v8
npm install playwright @anthropic-ai/sdk
npx playwright install chromium
```

**Step 3: Add Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

**Step 4: Verify it builds and tests run**

Run: `npm run build && npm test`
Expected: build succeeds; Vitest reports "No test files found" (exit 0).

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + TypeScript + Vitest"
```

---

### Task 1: Define the scoring domain types

**Files:**
- Create: `src/lib/scoring/types.ts`

**Step 1: Write the types (no test — pure declarations)**

```ts
// A page normalized by the crawler. Everything the scorer needs, no I/O.
export interface CrawledPage {
  url: string;
  fetchedAt: string;            // ISO timestamp
  statusCode: number;
  html: string;                 // raw HTML as served (pre-JS)
  renderedText: string;         // visible text after render
  title: string | null;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  jsonLdBlocks: unknown[];      // parsed application/ld+json blocks
  wordCount: number;
  hasServerRenderedContent: boolean; // did raw html already contain body text?
  robotsAllowsAiBots: boolean;
  hasLlmsTxt: boolean;
  lastModified: string | null;  // ISO, from headers or article schema
}

export interface SignalScore {
  key: string;                  // e.g. "schema"
  label: string;                // human label
  score: number;                // 0..100 for this signal
  weight: number;               // 0..1
  reason: string;               // plain-English why
  fix: string | null;           // actionable fix, null if already good
}

export interface AuthorityScore {
  total: number;                // 0..100, weighted sum of signals
  signals: SignalScore[];
}

export interface ReportResult {
  url: string;
  ai: AuthorityScore;
  traditional: AuthorityScore;
  prioritizedFixes: string[];   // fixes sorted by weight*deficit, highest first
}
```

**Step 2: Commit**

```bash
git add src/lib/scoring/types.ts && git commit -m "feat: scoring domain types"
```

---

### Task 2: Signal weights (single source of truth)

**Files:**
- Create: `src/lib/scoring/weights.ts`
- Test: `src/lib/scoring/weights.test.ts`

**Step 1: Write the failing test** (`weights.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS } from "./weights";

describe("weights", () => {
  it("AI weights sum to 1", () => {
    const sum = Object.values(AI_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it("Traditional weights sum to 1", () => {
    const sum = Object.values(TRADITIONAL_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/scoring/weights.test.ts`
Expected: FAIL — cannot find module `./weights`.

**Step 3: Implement** (`weights.ts`) — mirrors design doc Section 3

```ts
export const AI_WEIGHTS = {
  eeat: 0.30,
  brandMentions: 0.25,
  schema: 0.15,
  aiCrawlability: 0.15,
  freshness: 0.15,
} as const;

export const TRADITIONAL_WEIGHTS = {
  backlinks: 0.30,
  topicalAuthority: 0.25,
  technicalSeo: 0.20,
  contentQuality: 0.15,
  engagement: 0.10,
} as const;
```

**Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/scoring/weights.test.ts`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/lib/scoring/weights.ts src/lib/scoring/weights.test.ts
git commit -m "feat: authority score weights with sum-to-1 invariant"
```

---

### Task 3: Signal extractors (pure functions over CrawledPage)

Each extractor returns a 0–100 sub-score plus a reason and optional fix. Implement one at a time, TDD. Below is the pattern for the **schema** extractor; repeat the same 5-step cycle for the others listed after.

**Files:**
- Create: `src/lib/scoring/signals.ts`
- Test: `src/lib/scoring/signals.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreSchema } from "./signals";
import type { CrawledPage } from "./types";

const base: CrawledPage = {
  url: "https://ex.com", fetchedAt: "", statusCode: 200, html: "", renderedText: "",
  title: null, metaDescription: null, headings: [], jsonLdBlocks: [], wordCount: 0,
  hasServerRenderedContent: true, robotsAllowsAiBots: true, hasLlmsTxt: false, lastModified: null,
};

describe("scoreSchema", () => {
  it("scores 0 and emits a fix when no JSON-LD present", () => {
    const s = scoreSchema({ ...base, jsonLdBlocks: [] });
    expect(s.score).toBe(0);
    expect(s.fix).toMatch(/schema|json-ld/i);
  });
  it("scores 100 with no fix when Organization + WebSite schema present", () => {
    const s = scoreSchema({
      ...base,
      jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    });
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/scoring/signals.test.ts`
Expected: FAIL — `scoreSchema` not exported.

**Step 3: Implement `scoreSchema`** in `signals.ts`

```ts
import type { CrawledPage, SignalScore } from "./types";

function typesOf(blocks: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    const t = (b as { "@type"?: string | string[] })?.["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => out.add(String(x)));
  }
  return out;
}

export function scoreSchema(page: CrawledPage): SignalScore {
  const types = typesOf(page.jsonLdBlocks);
  const wanted = ["Organization", "WebSite"];
  const present = wanted.filter((w) => types.has(w)).length;
  const score = Math.round((present / wanted.length) * 100);
  return {
    key: "schema",
    label: "Structured data / schema",
    score,
    weight: 0.15,
    reason: score === 100
      ? "Organization and WebSite schema detected."
      : `Missing ${wanted.filter((w) => !types.has(w)).join(", ")} schema.`,
    fix: score === 100 ? null : "Add JSON-LD Organization and WebSite schema to the homepage.",
  };
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/scoring/signals.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/scoring/signals.ts src/lib/scoring/signals.test.ts
git commit -m "feat: schema signal extractor"
```

**Repeat Steps 1–5 for each remaining extractor** (one commit each). Each returns a `SignalScore` with the weight from `weights.ts`:

- `scoreAiCrawlability(page)` — start 100; −40 if `!hasServerRenderedContent`, −30 if `!robotsAllowsAiBots`, −30 if `!hasLlmsTxt`. Fix names whichever are missing.
- `scoreFreshness(page)` — from `lastModified`: 100 if <90 days, 60 if <180, 30 if <365, else 0. Fix: "Update this page; Perplexity decays content in 2–3 months." No date → 0.
- `scoreEeat(page)` — heuristic MVP: +34 if any author/byline text, +33 if outbound citations (links in renderedText), +33 if `wordCount > 600`. (Real E-E-A-T deepens in Phase 3.)
- `scoreTechnicalSeo(page)` — title present (25), metaDescription present (25), exactly one H1 (25), statusCode 200 (25).
- `scoreContentQuality(page)` — buckets on `wordCount`: 0/<200→20, <600→60, else 100.
- `scoreTopicalAuthority(page)` — MVP proxy on heading depth + wordCount (documented as a placeholder until multi-page crawl in Phase 1).
- `scoreBrandMentions` / `scoreBacklinks` / `scoreEngagement` — MVP: return a neutral 50 with `fix: null` and `reason` noting "requires off-page data (Phase 3 paid APIs)". Keeps weights honest without faking precision.

---

### Task 4: Compose the two authority scores

**Files:**
- Create: `src/lib/scoring/authority.ts`
- Test: `src/lib/scoring/authority.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";
import type { CrawledPage } from "./types";

const good: CrawledPage = {
  url: "https://ex.com", fetchedAt: "", statusCode: 200,
  html: "<body>lots of real text</body>", renderedText: "word ".repeat(700),
  title: "T", metaDescription: "D",
  headings: [{ level: 1, text: "H1" }], jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
  wordCount: 700, hasServerRenderedContent: true, robotsAllowsAiBots: true,
  hasLlmsTxt: true, lastModified: new Date().toISOString(),
};

describe("authority", () => {
  it("weighted total is between 0 and 100", () => {
    const ai = scoreAiAuthority(good);
    expect(ai.total).toBeGreaterThanOrEqual(0);
    expect(ai.total).toBeLessThanOrEqual(100);
  });
  it("a fully-optimized page scores high on AI authority", () => {
    expect(scoreAiAuthority(good).total).toBeGreaterThan(70);
  });
  it("returns one SignalScore per AI weight", () => {
    expect(scoreAiAuthority(good).signals).toHaveLength(5);
  });
});
```

**Step 2: Run to verify it fails** — `npx vitest run src/lib/scoring/authority.test.ts` → FAIL.

**Step 3: Implement** `authority.ts` — assemble the relevant `SignalScore`s, then `total = round(Σ score*weight)`. Return `{ total, signals }` for each of AI and Traditional.

**Step 4: Run to verify it passes** — Expected: PASS (3 tests).

**Step 5: Commit** — `git commit -m "feat: compose AI + traditional authority scores"`

---

### Task 5: Top-level report builder + prioritized fixes

**Files:**
- Create: `src/lib/scoring/report.ts`
- Test: `src/lib/scoring/report.test.ts`

**Step 1: Failing test** — `buildReport(page)` returns a `ReportResult` whose `prioritizedFixes` are the non-null fixes sorted by `weight * (100 - score)` descending, and excludes signals with no fix.

**Step 2–4:** Implement `buildReport`, run, pass.

**Step 5: Commit** — `git commit -m "feat: report builder with weight-ranked fixes"`

---

### Task 6: Playwright crawler → CrawledPage

**Files:**
- Create: `src/lib/crawler/crawl.ts`
- Test: `src/lib/crawler/crawl.test.ts` (uses a Playwright `route` mock — no live network)

**Step 1: Failing test** — mock a response with known HTML + JSON-LD; assert `crawl()` returns a `CrawledPage` with parsed `jsonLdBlocks`, `title`, `wordCount > 0`, and `hasServerRenderedContent === true`.

**Step 2–4:** Implement `crawl(url)`: launch chromium, `page.goto`, capture raw `response.text()` for `html` (pre-JS SSR check), `page.content()`/`innerText` for rendered text, parse `<script type="application/ld+json">`, read `Last-Modified`, and fetch `/robots.txt` + `/llms.txt` (HEAD/GET) to set `robotsAllowsAiBots` + `hasLlmsTxt`. Run, pass.

**Step 5: Commit** — `git commit -m "feat: playwright crawler producing CrawledPage"`

---

### Task 7: Report UI — URL form → server action → rendered scores

**Files:**
- Create: `src/app/actions.ts` (server action: `crawl` → `buildReport`), `src/app/report/[...]` route or `src/app/page.tsx` form, `src/components/ScoreDial.tsx`, `src/components/FixList.tsx`

**Step 1:** Build the homepage: an input for URL + submit. On submit, server action runs `buildReport(await crawl(url))` and renders both `ScoreDial`s (AI + Traditional) and the `FixList`.

**Step 2:** Manual verification — Run `npm run dev`, enter a real URL, confirm two scores + fixes render. (Use the `verify` skill to drive the flow end-to-end.)

**Step 3: Commit** — `git commit -m "feat: free authority report UI"`

---

### Task 8: Live AI-citation check + Claude explanations (final)

**Files:**
- Create: `src/lib/scoring/ai-citations.ts`, `src/lib/scoring/explain.ts`

**Step 1:** `ai-citations.ts` — query ChatGPT/Perplexity/Gemini (via their APIs or the Anthropic SDK for Claude) asking about the brand/domain; measure whether the domain is cited. Feed the result into `scoreBrandMentions`/`eeat` as a real signal (replacing the neutral 50). Guard with env keys; degrade gracefully when absent.

**Step 2:** `explain.ts` — pass the `ReportResult` to Claude (Opus 4.8) to turn `SignalScore.reason`s into a friendly narrative summary. Model id: `claude-opus-4-8`. Keep raw scores authoritative; Claude only narrates.

**Step 3:** Tests mock the SDK; assert graceful degradation when no API key. Commit each.

---

## Deferred to Phase 1+ (not in this plan)

Lead capture/email gating, accounts, Optimization Engine apply-adapters, Content Studio + safety gates, Stripe. Tracked in the design doc roadmap.
