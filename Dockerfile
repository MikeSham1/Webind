# Uses the official Playwright image so Chromium + its system libraries are
# present at runtime (the crawler launches Chromium). Tag is pinned to the
# installed Playwright version — keep in sync with package.json.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Browsers live here in the base image; make Playwright look there.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install deps (incl. dev deps needed to build) strictly from the lockfile —
# verified to include every platform's optional native packages (Linux and
# Windows alike), so `npm ci` here fails loudly on drift instead of silently
# re-resolving.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Build the app (as root — the image's default user — so file ownership below
# is a single, predictable chown rather than fighting permissions mid-build).
COPY . .
RUN npm run build

ENV NODE_ENV=production

# Run as a dedicated, unprivileged user instead of root. Chromium's own OS
# sandbox still needs --no-sandbox in this container (see browser.ts's launch
# args — a container doesn't grant the extra privileges Chromium's sandbox
# wants), but running the PROCESS itself as non-root still meaningfully limits
# blast radius if the app or a dependency is ever compromised: no write access
# outside what's explicitly granted here, no ability to install packages or
# touch other users' files. Only /app is chowned — /ms-playwright (the browser
# binaries) is already world-readable in the base image, and recursively
# chowning several hundred MB of browser binaries would copy-on-write them
# into a new, much larger image layer for no actual gain. /tmp stays
# root-owned but world-writable (the standard sticky-bit default), which is
# where Chromium puts its per-launch temp profile, so no extra grant is
# needed there either.
RUN groupadd --system webind \
  && useradd --system --gid webind --home-dir /app --shell /usr/sbin/nologin webind \
  && chown -R webind:webind /app
USER webind

# Liveness for `docker run`/local use; Railway is configured against
# /api/health and /api/ready directly (see README) since it has its own
# HTTP-based health checking. Dependency-free: Node's builtin http, no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Migrations run before the app starts and, unlike the old best-effort
# behaviour, a failure here EXITS the container instead of starting a server
# against a stale/broken schema. A container that never comes up never passes
# its health check, so the platform won't cut traffic over to it — the
# practical equivalent of "fail the deploy" without depending on a
# platform-specific release-phase feature. (If your platform supports a
# genuine separate pre-deploy/release step — Railway's "Pre-Deploy Command",
# for one — prefer wiring `npm run db:migrate` there instead, so a failed
# migration never even spins up a container.)
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npm run db:migrate || { echo 'Migration failed — refusing to start.' >&2; exit 1; }; fi; npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
