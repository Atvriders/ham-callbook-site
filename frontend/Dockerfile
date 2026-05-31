# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Frontend container — Next.js 15 App Router, standalone output.
# Multi-stage:
#   1. deps     — install npm dependencies with a clean cache
#   2. builder  — compile the Next.js app
#   3. runner   — minimal runtime image with the standalone server bundle
# ---------------------------------------------------------------------------

# ----- 1. deps -------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --prefer-offline --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

# ----- 2. builder ----------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ----- 3. runner -----------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone server + static assets + public/.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

USER nextjs
EXPOSE 3000

# `server.js` is emitted into the working directory by `output: 'standalone'`.
CMD ["node", "server.js"]
