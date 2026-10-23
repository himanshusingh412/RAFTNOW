# Multi-stage Dockerfile for the NestJS API
#
# Build output contract: `nest build` with tsconfig.build.json (rootDir=src)
# emits dist/main.js. @raftnow/shared is consumed as a compiled package
# (packages/shared/dist) — never as TypeScript source at runtime.

FROM node:20-alpine AS builder
# Prisma engines need OpenSSL on Alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci --cache /tmp/npm-cache

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build --prefix packages/shared \
 && cd apps/api \
 && npx prisma generate \
 && npx nest build \
 && test -f dist/main.js \
 && mkdir -p node_modules

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl tini
WORKDIR /app/apps/api
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=builder /app/packages/shared/dist /app/packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/apps/api/tsconfig.json ./tsconfig.json
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/docker-entrypoint.sh ./docker-entrypoint.sh

# Private KYC document storage (STORAGE_DRIVER=local) — mount a volume here.
RUN mkdir -p /app/data/private-uploads && chown -R node:node /app/data
USER node

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/apps/api/docker-entrypoint.sh"]
