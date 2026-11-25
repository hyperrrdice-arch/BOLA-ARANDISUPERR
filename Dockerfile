# ============================================================================
# Dockerfile — Football Agent (Sprint Portable VPS & Docker V2)
# ----------------------------------------------------------------------------
# Multi-stage, basis node:24-slim (Node 24 WAJIB untuk node:sqlite).
# Satu image dipakai dua peran di docker-compose.yml:
#   - web:       `node server.js` (Next.js standalone, port 3101)
#   - scheduler: Supercronic membaca ops/crontab.docker, menjalankan
#                job cron produksi via tsx dari image yang sama.
# Database SQLite TIDAK masuk image: .dockerignore mengecualikan data/*.db*;
# seluruh .db hidup di volume ./storage yang di-mount ke /app/storage
# (DB_DIR=/app/storage, lihat lib/db/paths.ts). data/ di image hanya JSON
# statis ter-track Git.
# Chromium SENGAJA tidak dipasang: audit Fase 0 membuktikan puppeteer-core
# hanya dipakai tests/helpers, bukan runtime produksi.
# Python/lightgbm/ml1-venv SENGAJA tidak masuk image (riset offline;
# recreate-nya didokumentasikan di docs/VPS-MIGRATION-RUNBOOK.md).
# ============================================================================

# ---------- Stage 1: deps (semua dependensi, termasuk dev utk tsx cron) ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 2: builder (next build -> .next/standalone) --------------
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runner -------------------------------------------------
FROM node:24-slim AS runner
WORKDIR /app

# Zona waktu WIB krusial: jadwal cron 04:21/09:00/13:30/16:21/18:00 harus
# akurat di VPS mana pun. Supercronic = cron ringan untuk scheduler.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/supercronic \
       https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
  && chmod +x /usr/local/bin/supercronic

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta
ENV PORT=3101
ENV HOSTNAME=0.0.0.0
ENV DB_DIR=/app/storage
ENV NEXT_TELEMETRY_DISABLED=1

# Output standalone web (server.js + node_modules ter-trace untuk web saja).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Repo ini tidak memiliki direktori public/ (dicek Fase 2) — baris COPY
# public/ sengaja ditiadakan; tambahkan bila suatu saat public/ dibuat.

# JSON statis (data/*.db* sudah dikecualikan dari konteks oleh .dockerignore).
COPY --chown=node:node data/ ./data/

# Sumber untuk job cron (tsx menjalankan scripts/ + lib/ langsung).
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node ops/ ./ops/
COPY --chown=node:node package.json tsconfig.json ./

# node_modules lengkap dari stage deps: dibutuhkan tsx (devDependency) dan
# dependensi scripts/ di peran scheduler. Di peran web, server.js standalone
# memakai subset ter-trace-nya sendiri dari direktori yang sama.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Direktori volume database (di-compose di-mount ./storage dari host).
RUN mkdir -p /app/storage && chown node:node /app/storage

USER node
EXPOSE 3101

# Default = web. Service scheduler di compose menimpa command ini dengan
# `supercronic /app/ops/crontab.docker`.
CMD ["node", "server.js"]
