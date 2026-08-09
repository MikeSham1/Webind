# WeBind

An AI-era authority platform. The front door is a free **AI Readiness Report**:
enter a URL and get two 0–100 scores (AI Readiness + Traditional Authority) with
plain-English explanations and a prioritized fix list. It's a heuristic
assessment of the page itself (structure, evidence, trust signals) — it does
not query any AI model live. See `/methodology` (`src/app/methodology/page.tsx`)
for exactly what each score measures.

Signed-in users also get **Keyword Visibility** — a live, unbiased probe (the
brand is never named in the prompt) of whether an AI model surfaces your brand
for the questions your customers actually ask — and a **Content Studio** for
generating grounded, human-approved content that can be one-click published to
a connected WordPress site or opened as a GitHub pull request.

Built with Next.js 16 (App Router) + React 19, TypeScript, Tailwind, Playwright
(crawling), Drizzle + Postgres (persistence), and the Anthropic SDK.

### Provider support (honest status)

Only **Claude** is a fully implemented live answer-engine provider today
(`src/lib/visibility/providers.ts`, `src/lib/scoring/ai-citations.ts`). ChatGPT,
Gemini, Perplexity, and Google are wired into the same interface as clearly
labeled stubs: unconfigured until an API key is set, and a visible "not yet
implemented" result rather than a fabricated one if a key is added before the
integration is built. The UI only ever reports engines it actually queried.

## Getting started

```bash
npm install
npx playwright install chromium   # the crawler needs a browser
cp .env.example .env.local        # then fill in what you need
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Every environment variable
is optional — the app runs without any of them and degrades gracefully (see
[.env.example](.env.example) for what each one enables).

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Run the Vitest suite |
| `npm run lint` | ESLint |
| `npm run db:generate` / `db:migrate` | Drizzle migrations |

## Deployment

Ships as a Docker image (see `Dockerfile`) on the official Playwright base
image, since the crawler needs a real Chromium. Runs as a dedicated non-root
user. Set `SITE_PASSWORD` and `DATABASE_URL` (a Postgres instance) at minimum
— see `.env.example` for the full list and what degrades without each one.

**Health checks** — configure your platform's HTTP health check against:
- `/api/health` — liveness (process is up; no dependency checks). Both
  endpoints are exempt from the site password gate.
- `/api/ready` — readiness (runs a real query against the database when one
  is configured, plus crawler queue stats). Returns `503` only when the
  database is configured but unreachable.

**Migrations** run automatically before the server starts (`npm run
db:migrate`) and, if they fail, the container exits rather than serving
traffic against a stale schema — a container that never comes up never passes
its health check, so the platform won't route to it. If your platform
supports a genuine separate release/pre-deploy step (e.g. Railway's
**Pre-Deploy Command**), prefer wiring `npm run db:migrate` there instead, so
a failed migration never spins up a container in the first place.

## Publishing to WordPress & GitHub

Both integrations write to a customer's own external system, so they follow
the same safety pattern:

- **WordPress** (`src/lib/integrations/wordpress.ts`,
  `src/app/studio/actions.ts`) publishes in two explicit stages: "Publish"
  creates a **draft** on the connected WordPress site (never live) and shows
  a real WordPress preview link; a separate "Confirm & go live" is required
  to flip it to `publish`. A connection uses a WordPress Application
  Password — not the account password — encrypted at rest with
  AES-256-GCM, and we recommend connecting a least-privilege Author/Editor
  account rather than an Administrator.
- **GitHub** (`src/lib/integrations/github.ts`, `openFixPrAction` in
  `src/app/actions.ts`) opens a pull request with deterministic, file-shaped
  fixes (`llms.txt`, `robots.txt`) — never arbitrary generated code — using a
  fine-grained Personal Access Token scoped to one repo. `robots.txt` is
  merged into whatever the repo already has, never overwritten wholesale.
- Every write is recorded **before** it's attempted (`publications` table,
  `pending` → `wp_draft` → `published`/`failed`), so a crash mid-write is
  detectable as "unknown outcome" rather than silently retried into a
  duplicate. Every attempt — success or failure — is appended to an
  admin-visible audit trail (`src/lib/audit.ts`, `/dashboard/audit`) with
  actor, destination, and before/after state.
- Both connection credentials are still long-lived secrets stored
  server-side; migrating GitHub from a personal access token to a GitHub App
  (short-lived installation tokens, no user-managed secret) is a known
  follow-up, not yet done.

## Known operational risks and limitations

Documented here rather than left implicit, so nobody has to rediscover them:

- **DNS rebinding (crawler SSRF guard):** `src/lib/crawler/ssrf.ts` validates
  every hostname's resolved addresses before fetching, but Chromium performs
  its own independent DNS lookup for the actual connection. A hostile
  authoritative DNS server that answers differently to the two lookups (a
  narrow timing window) could defeat the guard. Pinning the validated IP for
  Chromium's connection would close this fully; Playwright doesn't expose
  that today, so it's tracked as an accepted residual risk, not silently
  ignored.
- **Scoring weights are not calibrated against a benchmark dataset.** The
  weights in `src/lib/scoring/weights.ts` are reasoned from published
  GEO/AEO research, not fit to labeled "does an AI actually cite this page"
  outcomes — no such dataset exists for us to calibrate against yet. See
  `/methodology`.
- **Rate limiting is in-memory and per-instance**, not shared across
  containers (`src/lib/rateLimit.ts`). Fine for a single-container
  deployment; scaling out horizontally needs a shared store (Redis) before
  the limits mean anything cluster-wide.
- **Session cleanup is best-effort without a cron.** Expired sessions are
  swept on ~2% of new logins regardless, but `POST /api/cron/cleanup-sessions`
  (guarded by `CRON_SECRET`) needs an external scheduler pointed at it for
  timely, complete cleanup — see `.env.example`.

## Layout

- `src/lib/scoring/` — the pure, deterministic scoring core (fully unit-tested)
- `src/lib/crawler/` — Playwright crawler + SSRF guard + browser pool
- `src/lib/visibility/` — keyword visibility across AI answer engines
- `src/lib/content/`, `src/lib/optimize/` — Content Studio + optimization assets
- `src/app/` — App Router pages and server actions

See [AGENTS.md](AGENTS.md) for contributor notes (this is Next.js 16 — read the
bundled docs before writing framework code).
