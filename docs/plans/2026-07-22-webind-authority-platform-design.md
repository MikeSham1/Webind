# WeBind Design — AI-Era Authority Platform

**Design doc** · 2026-07-22 · Status: approved (shape + phasing + stack)

## 1. Product definition

WeBind Design is an **AI-era authority platform**. Its front door is a free **AI Authority Report**: a visitor enters a URL and gets two 0–100 scores, a plain-English explanation of *why*, and a prioritized fix list. That report is the lead magnet that converts into a self-serve SaaS where a business connects its site and WeBind:

1. **Scores** its authority for AI search *and* traditional search,
2. **Fixes** it — generating and, with human approval, applying technical + content optimizations,
3. **Grows** it — generating substantive, human-approved content from a guided Q&A.

**Core principle: every change requires explicit human approval.** WeBind proposes (a draft, a diff, a PR); a person reviews and approves; only then does it ship. Nothing publishes or edits a live site autonomously.

## 2. Why now — research basis

The scoring model is grounded in the 2026 landscape, where AI search and traditional search reward *different* signals:

- Classic Domain Authority (Moz/Ahrefs DR) predicts **<4% of AI citations** — nearly useless for AI search. ([authoritytech.io](https://authoritytech.io/curated/domain-authority-vs-eeat-ai-citation-signal-audit-2026))
- **Brand mentions correlate ~3x stronger with AI visibility than backlinks** (0.664 vs 0.218) — mentions are the "new backlinks." ([memorable.design](https://memorable.design/brand-mentions-vs-backlinks/))
- Each engine sources differently: **ChatGPT** leans Wikipedia-style authority (~48% of citations touch Wikipedia); **Perplexity** leans Reddit + freshness (2–3 month decay, live search every query); **Google AI Overviews** pull 97% of citations from top-20 organic results. **Only ~11% of domains are cited by both ChatGPT and Perplexity** → optimize per-engine, not one-size-fits-all. ([tryprofound.com](https://www.tryprofound.com/blog/ai-platform-citation-patterns), [leapd.ai](https://www.leapd.ai/blog/ai-visibility/how-chatgpt-google-ai-overviews-and-perplexity-source-information-in-2026))
- **E-E-A-T is the single strongest predictor of AI citation** across platforms. ([authoritytech.io](https://authoritytech.io/curated/domain-authority-vs-eeat-ai-citation-signal-audit-2026))
- Technical table stakes: schema (sites with "AI-complete" structured data get cited **3.1x more**), server-side rendering (AI crawlers handle JS poorly), unblocked AI bots in robots.txt, and an `llms.txt` file. ([sotaventomedios.com](https://www.sotaventomedios.com/how-to-use-structured-data-for-ai-crawlers/), [trysight.ai](https://www.trysight.ai/blog/optimize-website-for-ai-crawlers))

## 3. The Authority Score model

Every site gets **two scores, 0–100**, because they're driven by different signals.

### AI Authority Score — can the brand get cited by ChatGPT / Perplexity / AI Overviews
| Signal | Weight | Rationale |
|---|---|---|
| E-E-A-T signals (authorship, citations, first-hand experience) | 30% | Strongest predictor of AI citation |
| Brand mentions / entity presence (Reddit, Wikipedia, YouTube, press) | 25% | The "new backlinks" for AI |
| Structured data / schema completeness | 15% | ~3.1x citation lift |
| AI-crawlability (SSR, robots.txt, `llms.txt`) | 15% | Unreadable = invisible |
| Content freshness / recency | 15% | Perplexity decays content in 2–3 months |

### Traditional Authority Score — Google/Bing organic
| Signal | Weight | Rationale |
|---|---|---|
| Backlink profile quality | 30% | Still the biggest classic signal |
| Topical authority / content depth | 25% | Google rewards subject coverage |
| On-page + technical SEO | 20% | Core Web Vitals, meta, internal linking |
| Content quality / E-E-A-T | 15% | Overlaps AI, weighted differently |
| UX / engagement signals | 10% | Traffic, dwell |

The product presents both side-by-side, explains each in plain English, and emits a prioritized fix list that feeds the Optimization Engine and Content Studio.

## 4. Architecture — three engines on one shared core

### Engine 1 — Scoring Engine (shared core)
Crawls the site with **Playwright** (so we see what AI crawlers see, including SSR gaps), analyzes on-page/technical/schema signals, and **live-queries ChatGPT/Perplexity/Gemini** about the brand to measure real citations. Output: the two scores, explanations, and ranked recommendations. Powers both the free report and the paid dashboard.

### Engine 2 — Optimization Engine
Turns recommendations into concrete assets (JSON-LD schema, meta tags, `llms.txt`, rewritten copy) and applies them through swappable **adapters**:
- **Export** (copy-paste / download) — works for any site,
- **CMS API** (WordPress → Shopify → Webflow) — one-click apply,
- **Git PR** — for custom-coded sites, WeBind opens a reviewed pull request.

Every apply is gated by human approval + rollback.

### Engine 3 — Content Studio
Guided Q&A intake → drafts grounded **only** in user-supplied facts → four safety gates → human review → publish via the same adapters.

**Safety gates (all required; human approval mandatory on every piece):**
1. **No fabricated facts/stats** — use only user-supplied or verifiable-and-cited facts; flag anything unsourced; never invent numbers.
2. **YMYL detection** — detect medical/legal/financial topics; require human sign-off; add disclaimers; refuse disallowed claims.
3. **Originality check** — screen against existing/competitor content before publish.
4. **Brand voice + mandatory human approval** — nothing goes live without explicit review.

## 5. Phased roadmap

- **Phase 0 — MVP / front door:** Scoring Engine + free public report. Enter URL → two scores + why + fix list → capture lead. Hybrid data: own crawl (free) + live AI-citation checks; heuristic backlinks/mentions.
- **Phase 1 — SaaS v1:** Accounts, dashboard, saved projects, Optimization Engine in **generate + export** mode, Content Studio with full Q&A + safety gates + human approval, Stripe billing.
- **Phase 2 — One-click apply:** CMS integrations (WordPress first) with approval + rollback.
- **Phase 3 — Autonomous custom-code fixes:** Connect GitHub → WeBind opens reviewed PRs; add paid backlink APIs (Ahrefs/Semrush/DataForSEO) for higher-fidelity scores.

## 6. Tech stack

- **Next.js (App Router) + TypeScript** — one full-stack app for marketing site *and* dashboard; Tailwind + shadcn/ui.
- **Postgres** (Supabase or Neon) for data; Supabase Auth or Clerk; **Stripe** billing.
- **Claude API** — Opus 4.8 for scoring reasoning & the code-change agent, Sonnet for high-volume content drafting; **Claude Agent SDK** for the GitHub-PR flow.
- **Playwright** crawler + background worker/queue for crawls.
- Hosting: **Vercel**.

## 7. Decisions log

| # | Decision | Choice |
|---|---|---|
| 1 | Product shape | SaaS self-serve **+** free-report marketing front door |
| 2 | "Optimize for them" depth | CMS one-click apply **+** direct code changes (PRs) for custom sites, with permission |
| 3 | Score data sourcing | Hybrid: own crawl + live AI checks now; paid backlink APIs later |
| 4 | Content safety | All four guardrails; **every change requires human approval** |
| 5 | First build | Phase 0 — free scoring report |
| 6 | Stack | Recommended stack accepted (Next.js/TS, Postgres, Claude API, Playwright) |

## 8. Open items for the implementation plan

- Exact heuristics for backlink/mention estimation in Phase 0 (pre-paid-API).
- Which AI engines to query live first and how to automate/measure citation presence.
- Data model for projects, scans, recommendations, and content drafts.
- Lead capture + gating (how much of the free report is shown before email capture).
