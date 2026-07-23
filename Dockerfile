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
# Railway injects PORT; bind to it on all interfaces.
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
