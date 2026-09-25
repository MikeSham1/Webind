# Launch checklist

Everything here is a deliberate pre-launch lock. Going live means removing
them in the right order — each step says what breaks if you get it wrong.

Work top to bottom. Steps 1 and 2 are the ones that will bite.

---

## 1. Open the site to the public — set `SITE_PUBLIC=true`, don't just unset `SITE_PASSWORD`

**Unsetting `SITE_PASSWORD` alone locks the site completely.** It does not open
it: `src/proxy.ts` fails *closed* — with no password configured it still
redirects every request to `/splash`. The result is a site nobody, including
you, can get into.

To actually open it, set `SITE_PUBLIC=true` on Railway (see `isPublicLaunch()`
in `src/lib/gate.ts`). This is the one switch that both lifts the shared
preview password in `src/proxy.ts` **and** drives every indexing control below
— there's nothing else to flip in code. `SITE_PASSWORD` can stay set or be
removed either way; once `SITE_PUBLIC=true` it's no longer consulted.

Per-account pages (`/dashboard`, `/login`, `/studio`'s signed-in actions, …)
are unaffected — they gate themselves via `getCurrentUser()`, independent of
this flag.

The Stripe webhook (`/api/billing/webhook`) is exempt from the gate
unconditionally, password set or not — Stripe can't carry our cookie, and the
route verifies Stripe's signature itself before trusting anything. If billing
needs to go live before the rest of the site, it already can.

Verify: an incognito window reaches `/` without a password prompt, and
`/api/billing/webhook` returns something other than a redirect to `/splash`
even while `SITE_PUBLIC` is unset.

## 2. Let search engines index the site

`next.config.ts`'s `X-Robots-Tag` header, `src/app/robots.ts`'s rules,
`src/app/sitemap.ts`'s output, and the root layout's `robots` metadata are all
driven by the same `SITE_PUBLIC` flag from step 1 — nothing left to edit by
hand. Auth-gated pages (`/dashboard`, `/visibility`, `/benchmark`, `/login`,
…) keep their own `robots: { index: false }` regardless of the flag, and
`robots.ts` also disallows those paths outright as a second layer.

Verify: `curl -I https://<domain>/` shows no `X-Robots-Tag`, and
`curl https://<domain>/robots.txt` no longer disallows `/`.

## 3. Required environment variables

Set in Railway before first boot:

- `DATABASE_URL` — Postgres. Migrations run on container start and a failure
  **exits** rather than serving a stale schema (see `Dockerfile`).
- `CREDENTIALS_KEY` — encrypts stored WordPress and GitHub credentials.
  Rotating it makes every stored connection undecryptable.
- `APP_BASE_URL` — the public URL. Used in verification and reset emails.
- `GEMINI_API_KEY` — reports, suggestions, Content Studio.
- `ANTHROPIC_API_KEY` — Keyword Visibility probes.
- `RESEND_API_KEY` + `EMAIL_FROM` — email verification and password reset.
  Without these, a signup cannot verify their address.
- `CRON_SECRET` — bearer token for `/api/cron/cleanup-sessions`.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`,
  `STRIPE_PRICE_GROWTH` — required only if billing is live. Confirm the key is
  the **live** one, not `sk_test_`.

Paste values unquoted. Railway's raw editor keeps the quotes from
`KEY="value"` and they become part of the value. The Gemini key is normalized
defensively (`src/lib/ai/gemini.ts`), but nothing else is.

Verify: sign in as an admin and open
`/api/health/integrations?probe=gemini`. It reports every integration's
configured state, the Gemini key's shape, and spends one real call to confirm
the key actually works. A 404 there means you are not an admin.

## 4. Confirm before announcing

- [ ] Sign up with a real address end to end — verification email arrives.
- [ ] Password reset arrives and works.
- [ ] Run a report on a real site; scores and prioritized fixes render.
- [ ] Content Studio: plan a page, build a brief, generate a draft.
- [ ] Connect WordPress in Settings, publish a draft, confirm it lands as a
      **draft** on the site, then go live, then roll back.
- [ ] Stripe checkout against the live key; confirm the webhook is received.
- [ ] `/this-does-not-exist` shows the branded 404, not a framework page.
- [ ] `curl -I` shows `Strict-Transport-Security` and `X-Frame-Options`.

## Known gaps (accepted, not blockers)

- **Rate limiting is per-instance**, held in memory (`src/lib/rateLimit.ts`).
  Scaling past one container weakens every limit proportionally. Move to Redis
  before adding a second replica — not before, since a shared store is only
  worth its failure modes once there is something to share.
- **`script-src` still allows inline scripts.** Every other CSP directive is
  strict (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`), so an externally-hosted
  injected script is refused — but an inline one is not. Closing that needs
  per-request nonces, which Next only supports under dynamic rendering, and
  that would force the static marketing pages off static rendering. Revisit if
  those pages ever need to be dynamic anyway.
- **GitHub integration uses a PAT**, not a GitHub App. Fine for a single
  operator; revisit before offering it broadly.
- **OpenAI / Perplexity / SERP visibility providers are honest stubs** — inert
  without a key, and an explicit "not implemented" error with one. Gemini and
  Claude are the real providers.
