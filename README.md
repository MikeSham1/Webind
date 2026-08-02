# WeBind

An AI-era authority platform. The front door is a free **AI Authority Report**:
enter a URL and get two 0–100 scores (AI Authority + Traditional Authority) with
plain-English explanations and a prioritized fix list. Signed-in users also get
**Keyword Visibility** — see whether AI answer engines surface your brand for the
queries your customers actually type — and a **Content Studio** for generating
grounded, human-approved content.

Built with Next.js 16 (App Router) + React 19, TypeScript, Tailwind, Playwright
(crawling), Drizzle + Postgres (persistence), and the Anthropic SDK.

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

## Layout

- `src/lib/scoring/` — the pure, deterministic scoring core (fully unit-tested)
- `src/lib/crawler/` — Playwright crawler + SSRF guard + browser pool
- `src/lib/visibility/` — keyword visibility across AI answer engines
- `src/lib/content/`, `src/lib/optimize/` — Content Studio + optimization assets
- `src/app/` — App Router pages and server actions

See [AGENTS.md](AGENTS.md) for contributor notes (this is Next.js 16 — read the
bundled docs before writing framework code).
