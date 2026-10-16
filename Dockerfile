# Connect: production image for Railway (or any Docker host).
# Multi-stage: deps -> build (Next standalone) -> slim runtime with only the traced server,
# static assets, migrations and a pinned Prisma CLI for `migrate deploy`.

FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
# Inlined into the client bundle at build time, so it must be present here (Railway passes
# service variables as build args when they are declared).
ARG NEXT_PUBLIC_RP_ID
ENV NEXT_PUBLIC_RP_ID=$NEXT_PUBLIC_RP_ID
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npx next build \
 && npx esbuild prisma/seed.ts --bundle --platform=node --format=cjs --external:@prisma/client --outfile=/app/seed.cjs

# Prisma CLI only (no dev dependencies), pinned to the same version as @prisma/client.
FROM base AS prisma-cli
WORKDIR /prisma-cli
COPY package.json /tmp/package.json
RUN v=$(node -p "require('/tmp/package.json').dependencies.prisma.replace(/^[^0-9]*/, '')") \
 && npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund "prisma@$v"

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=384
RUN useradd --system --uid 1001 --create-home connect
COPY --from=build --chown=connect /app/.next/standalone ./
COPY --from=build --chown=connect /app/.next/static ./.next/static
COPY --from=build --chown=connect /app/public ./public
COPY --from=build --chown=connect /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=connect /app/prisma/migrations ./prisma/migrations
COPY --from=build --chown=connect /app/seed.cjs ./seed.cjs
COPY --from=prisma-cli --chown=connect /prisma-cli ./prisma-cli
COPY --chown=connect scripts/start.mjs ./start.mjs
USER connect
EXPOSE 3000
CMD ["node", "start.mjs"]
