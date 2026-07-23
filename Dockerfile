# Uses the official Playwright image so Chromium + its system libraries are
# present at runtime (the crawler launches Chromium). Tag is pinned to the
# installed Playwright version — keep in sync with package.json.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Browsers live here in the base image; make Playwright look there.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install deps (incl. dev deps needed to build) against the lockfile.
COPY package.json package-lock.json ./
RUN npm ci

# Build the app.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# On boot: apply DB migrations when a database is configured (best-effort — a
# migration hiccup must not stop the server), then start bound to Railway's PORT.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then npx drizzle-kit migrate || echo 'drizzle migrate failed; continuing'; fi; npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
