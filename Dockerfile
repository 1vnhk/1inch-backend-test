# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

RUN npm prune --production

# Stage 2: Production
FROM node:22-alpine AS production

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs

ARG ETH_NODE_WS

ENV NODE_ENV=production
ENV PORT=3000
ENV UV_THREADPOOL_SIZE=64
ENV FASTIFY_LOGGER=true
ENV ETH_NODE_WS=${ETH_NODE_WS}

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", \
    "--max-old-space-size=2048", \
    "--tls-min-v1.3", \
    "--no-warnings", \
    "dist/main.js"]
