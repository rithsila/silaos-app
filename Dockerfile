# syntax=docker/dockerfile:1

# ---------- Rust Builder ----------
FROM rust:1-slim AS rust-builder
WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libsqlite3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/Cargo.toml backend/Cargo.lock* ./
RUN mkdir src \
    && echo "fn main() {}" > src/main.rs \
    && echo "pub fn dummy() {}" > src/lib.rs \
    && cargo build --release \
    && rm -rf src

COPY backend/src ./src
RUN touch src/lib.rs src/main.rs && cargo build --release

# ---------- Go Agent Builder ----------
FROM golang:1-bookworm AS go-builder
WORKDIR /app/agent

COPY agent/go.mod agent/go.sum ./
RUN go mod download

COPY agent/ ./
RUN CGO_ENABLED=0 go build -o /usr/local/bin/lifeos-agent ./cmd/lifeos-agent

# ---------- Next.js Builder ----------
FROM oven/bun:1 AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/app/data/prod.db"

COPY package.json bun.lock* bun.lockb* ./
RUN bun install

COPY . .
RUN bun run db:generate
RUN bun run build

# ---------- Runner ----------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="file:/app/data/prod.db" \
    BACKEND_URL="http://localhost:8080" \
    AGENT_URL="http://localhost:8081"

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates wget curl libsqlite3-0 sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# 1. Next.js standalone server + assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 2. Prisma schema + SQL migrations (applied with sqlite3 at start)
COPY --from=builder /app/prisma ./prisma

# 5. Rust backend + Go agent binaries
COPY --from=rust-builder /app/backend/target/release/lifeos-backend /usr/local/bin/lifeos-backend
COPY --from=go-builder /usr/local/bin/lifeos-agent /usr/local/bin/lifeos-agent

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/lifeos-backend /usr/local/bin/lifeos-agent \
    && mkdir -p /app/data \
    && chown -R node:node /app /usr/local/bin/lifeos-backend /usr/local/bin/lifeos-agent

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:3000/ > /dev/null && \
        curl -sf http://localhost:8080/health > /dev/null && \
        curl -sf http://localhost:8081/health > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
