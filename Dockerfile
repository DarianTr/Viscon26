# syntax=docker/dockerfile:1
# Production image for the app. `docker compose up` builds and runs it along
# with Postgres — see docker-compose.yml.

FROM node:24-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies (cached until package*.json change) -----------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---------------------------------------------------------------------
FROM deps AS builder
COPY . .
RUN npm run build

# --- One-off job: apply migrations, then load demo data if the DB is empty ----
FROM deps AS migrate
COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src/db ./src/db
COPY src/lib ./src/lib
CMD ["sh", "-c", "npx drizzle-kit migrate && npx tsx src/db/seed-courses.ts && if [ \"$SEED_DEMO_DATA\" = true ]; then npx tsx src/db/seed.ts --if-empty; fi"]

# --- Runtime: only the standalone server and static assets -------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
