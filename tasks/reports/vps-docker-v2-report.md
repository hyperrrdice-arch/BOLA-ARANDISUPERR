# Laporan Sprint — Portable VPS & Docker V2

- **Brief:** `Agent_Brief_Vps_Docker_V2.md` (pemilik)
- **Basis kerja:** master `06ec3cc` (pasca ML1 Shadow A/B)
- **Jangkar isolasi Fase 0 (sha256, WAJIB identik di Fase 5):**
  - `data/model-manifest.json` = `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315`
  - `data/calibrated_ratings.json` = `be93286a1f55836e7645ea03d7f19415e8a193b6d6ab5c9d257229589a636685`
- **Status Docker di host ini:** `DOCKER_NOT_AVAILABLE_ON_HOST` — `docker info` gagal dan CLI `docker` tidak terpasang sama sekali di VM ini. Verifikasi jalur non-Docker (build standalone + backup script) dilakukan penuh sebagai gantinya, sesuai §0.4 brief.
- **Node host:** v24.22.1 (`node:sqlite` tersedia).

---

## Fase 0 — Audit Lengkap Path DB & Jadwal Cron Aktif

### Tabel Inventaris Database (aktual, `find data -maxdepth 2`, 25 Nov 2026)

| # | File DB (exact path) | Ukuran | Sifat / pemakai utama |
| :--- | :--- | ---: | :--- |
| 1 | `data/picks.db` | 58 MB | Ledger pick safe-bet (append-only) — `lib/picks/ledger.ts`, web, resolver, Fix-4 |
| 2 | `data/football_master.db` | 9,4 MB | Master Sportmonks warisan (read-only) — `scripts/build-league-canonical.ts` |
| 3 | `data/thestats_dataset.db` | 2,9 GB | Dataset hasil/telemetri kanonik — `lib/db/thestats-dataset.ts`, hampir semua rantai |
| 4 | `data/upcoming_fixtures.db` | 1,7 MB | Katalog fixture mendatang — `lib/db/upcoming-fixtures.ts`, capture, web |
| 5 | `data/analysis_snapshots.db` | 89 MB | Paket analisis/snapshot — `lib/db/analysis-snapshot.ts`, `lib/picks/packages.ts`, web |
| 6 | `data/predictions.db` | 17 MB | Panel prediksi Sportmonks — `scripts/pick-slate.ts`, `daily-refresh.ts`, `parlay-lab.ts` |
| 7 | `data/market_snapshots.db` | 340 KB | Snapshot odds API-Football (append-only) — `lib/market/market-snapshot.ts`, capture |

Temuan tambahan:
- **Tidak ada `.db` runtime lain** di repo di luar `data/` — satu-satunya pengecualian adalah `archive/analysis_snapshots-legacy-2026-10.db`, arsip warisan statis (bukan DB runtime; tidak masuk cakupan `DB_DIR`/backup dinamis).
- File `-wal`/`-shm` pendamping ada untuk beberapa DB (picks, analysis_snapshots, thestats_dataset) — ikut terlindungi lewat mekanisme `VACUUM INTO` (snapshot konsisten) di Fase 4.
- **Belum ada modul path terpusat.** Pola eksisting: tiap modul `lib/db/*`, `lib/picks/ledger.ts`, `lib/picks/packages.ts`, `lib/market/market-snapshot.ts` mendefinisikan lokal `path.join(process.cwd(), "data")`; `lib/web/data.ts` punya helper `db(file)` lokal; scripts campuran antara helper lokal `dataPath(file)`, `path.join(process.cwd(), "data", …)`, `path.join(ROOT, "data", …)`, dan string relatif `"data/…"`. Fase 1 membuat `lib/db/paths.ts` sebagai satu-satunya sumber.

### Tabel Inventaris Cron / systemd Aktif (dari sumber asli)

| Job | Jadwal exact (WIB) | Yang dijalankan |
| :--- | :--- | :--- |
| `football-free-refresh` (cron goal, interval 12 jam, jangkar 2026-11-05 16:21) | **04:21 & 16:21** tiap hari | `npx tsx scripts/free-refresh.ts` — rantai 9 langkah: import-free-feed → build-team-canonical → build-fixture-links → calibrate-ratings → fit-global-offsets → build-canonical-telemetry → pick-slate `--hours 72` → resolve-pick-outcomes → wal-checkpoint (PASSIVE) |
| `football-capture-apifootball-0900` (cron goal, daily) | **09:00** | `scripts/capture-odds-apifootball.ts` → `market_snapshots.db` |
| `football-capture-apifootball-1800` (cron goal, daily) | **18:00** | `scripts/capture-odds-apifootball.ts` → `market_snapshots.db` |
| `football-fix4-ticket` (cron goal, daily) | **13:30** (cutoff tiket 14:00) | `scripts/generate-fix4-ticket.ts` → tiket resmi ke `picks.db` |
| `football-backup-vps` (cron goal, weekly) | **Senin 04:52** | `~/workspace/football-backup/backup-to-vps.sh` — backup SQLite + tree ke VPS lama (di luar repo; mekanisme lama pra-Docker) |
| `bola-vm-watchdog` (cron goal, interval) | **tiap 5 menit** | `~/workspace/vm-services/ensure-bola-vm.sh` — khusus host VM ini (bukan bagian migrasi Docker) |
| `app-football-vm.service` (systemd, unit kanonik di `~/workspace/vm-services/`) | selalu jalan | Web app Next.js port 3101 dari checkout utama |
| `app-tunnel-vm.service` (systemd) | selalu jalan | Reverse SSH tunnel ke VPS lama `127.0.0.1:13101` (di Docker digantikan Caddy langsung) |
| `bola-liveness.timer` (systemd) | **tiap 30 detik** | Probe `GET /healthz`; restart app sesudah 3 gagal beruntun (di Docker digantikan healthcheck compose) |

**Catatan fdorg (jujur):** TIDAK ADA cron mandiri `import-fdorg-results.ts` di inventaris host saat ini (pencarian di seluruh definisi cron goal: nihil). Adapter fdorg selama ini dijalankan di luar jadwal tetap. Sesuai brief Fase 3, `ops/crontab.docker` tetap memuat baris harian fdorg — dijadwalkan **03:30 WIB** (jam sepi, sebelum free-refresh 04:21 supaya hasil FINISHED masuk sebelum rantai refresh) dan dicatat di sini sebagai jadwal BARU dari brief, bukan jadwal warisan host.

### Pemeriksaan Puppeteer / Chromium

- `puppeteer-core` + `@sparticuz/chromium` ada di `package.json`, tetapi pemakaian kode HANYA di `tests/helpers/` (`browser-resolve.mjs`, `lanjut1-probe.mjs`, `lanjut2-probe.mjs`, `verifikasi4-probe.mjs`).
- **Nol pemakaian di `app/`, `lib/`, dan seluruh `scripts/`** (termasuk `free-refresh.ts`).
- **Putusan Fase 2:** Dockerfile produksi TIDAK memasang dependensi OS Chromium.

### Keadaan awal git

- `git status` awal memuat churn refresh terjadwal yang sudah ada sebelum sprint (modifikasi JSON data + `tasks/*` dari rantai produksi, `data/market_snapshots.db` untracked karena memang gitignored-pola di luar daftar eksplisit, artefak model di `data/model-artifacts/`). Churn ini BUKAN hasil sprint dan tidak disentuh/di-commit oleh sprint.

---

## Fase 1 — Isolasi Semua Database SQLite ke `DB_DIR`

- **Modul terpusat baru:** `lib/db/paths.ts` — `dbDir()` membaca `process.env.DB_DIR`; tidak diset → `path.join(process.cwd(), "data")` (persis perilaku lama); diset → path absolut/relatif-cwd + `mkdirSync` recursive. `dbPath(file)` untuk .db; `dataDir()`/`dataFilePath()` untuk JSON statis yang SELALU dari `data/`.
- **Cakupan pengarahan (60 file):** seluruh getter path di `lib/db/*` (dataset, upcoming, snapshot), `lib/picks/ledger.ts`, `lib/picks/packages.ts`, `lib/market/market-snapshot.ts`, helper `db()`/`dbRo()` di `lib/web/data.ts` + `lib/web/rekam.ts` (termasuk tanda-tangan file `.db`/`-wal` di `landingStats`; JSON ratings tetap `data/`), `lib/odds/sportmonks-wire.ts`, 41 file `scripts/` (termasuk seluruh rantai produksi: free-refresh chain, `wal-checkpoint.ts`, `capture-odds-apifootball.ts`, `import-fdorg-results.ts`, `pick-slate.ts`; Fix-4 mengalir lewat `lib/picks/ledger.ts`), dan situs path-produksi di `tests/helpers/*` (seed/probe yang membuka DB produksi). Situs berbasis `env.dataDir` (sandbox tes) sengaja TIDAK diubah — itu mekanisme isolasi tes itu sendiri.
- **Skrip riset ber-argumen `--data-dir`** (`evaluate-*`, `ml1-*`, `diagnose-q2`, `experiment-k5-kappa`): ditambah `EVAL_DB_DIR = argVal("data-dir", dbDir())` — argumen sandbox tetap menang persis seperti sebelumnya; tanpa argumen, .db mengikuti `DB_DIR`/`data/` sementara JSON tetap dari `DATA_DIR` argumen. Kontrak reproduksibilitas artefak beku (PR 3/PR 4/ML1) tidak berubah.
- **`lib/quant/*` TIDAK disentuh** (hard non-goal) — fungsi di sana menerima `dataDir` sebagai parameter dari pemanggil; pemanggil produksi mengoper dir statis `data/` untuk JSON, sesuai kontrak.
- **`.env.example`:** ditambah blok `DB_DIR=./storage` berdokumentasi. **`.gitignore`:** ditambah `/storage/`, `storage/*.db*`, plus `data/market_snapshots.db*` (penyelarasan §0.3 — DB Sprint C itu sebelumnya belum ter-ignore dan tampil untracked).

### Bukti smoke kompatibilitas (wajib, dari parent brief)

Tanpa `DB_DIR` — semua resolve persis ke `data/` seperti sekarang:

```
dbDir(): /home/hatch/workspace/coding/app-football/data
picks.db -> data/picks.db · analysis_snapshots.db -> data/analysis_snapshots.db
thestats_dataset.db -> data/thestats_dataset.db · upcoming_fixtures.db -> data/upcoming_fixtures.db
market_snapshots.db -> data/market_snapshots.db · football_master.db -> data/football_master.db
predictions.db -> data/predictions.db
```

Dengan `DB_DIR=/tmp/dbdir-dummy` — semua resolve ke dummy (direktori terbuat otomatis):

```
dbDir(): /tmp/dbdir-dummy  →  ketujuh DB -> /tmp/dbdir-dummy/*.db
```

### Stop-gate Fase 1 (berurutan, semua hijau)

| Cek | Hasil |
| :--- | :--- |
| `npx --no-install tsc --noEmit` | exit 0 |
| `npm run lint:gate` | LOLOS (91 error ≤ baseline 92; 0 error baru) |
| `npm run test:data` | exit 0 — fix4 **46/46**, T02 market-snapshot **63/63**, fdorg **43/43**, cohort-duplikat **21/21** |
| `npm run test:api` | exit 0 — api-contract 42/42 |
| L02 `tests/test-kandidat-q1.ts` | **33/33** (33 lolos, 0 gagal) |

Catatan proses: satu sisipan import otomatis sempat mendarat di tengah blok import multi-baris `scripts/pick-slate.ts` (error parse ESLint) — diperbaiki manual, lalu seluruh 54 file yang menyentuh `db/paths` diaudit parse bersih via TypeScript compiler API (0 error) dan tsc diulang tanpa cache.

---

## Fase 2 — `Dockerfile` (Node 24 + Next.js Standalone) & `.dockerignore`

- **`next.config.ts`:** ditambah HANYA `output: "standalone"` (opsi eksisting lain tidak diubah).
- **`.dockerignore`:** persis daftar brief (`node_modules`, `.next`, `.git`, `storage`, `data/*.db*`, `data/historical/raw`, `data/backtest_cache`, `archive`, `tasks`, `.env`, `.env.local`, `*.log`, `coverage`).
- **`Dockerfile`** multi-stage `node:24-slim`:
  - `deps`: `npm ci` (semua dependensi — `tsx` adalah devDependency dan dibutuhkan peran scheduler).
  - `builder`: `npm run build`.
  - `runner`: `tzdata` + Supercronic terpasang, `ENV TZ=Asia/Jakarta`; **tanpa dependensi OS Chromium** (putusan Fase 0); salin `.next/standalone` + `.next/static`; `data/` (hanya JSON statis — `*.db*` ter-exclude dari konteks); `scripts/`, `lib/`, `ops/`, `package.json`, `tsconfig.json` (alias `@/*` untuk tsx); `node_modules` lengkap dari stage deps (kebutuhan tsx cron; web memakai subset ter-trace-nya dari direktori yang sama); `/app/storage` milik user `node`; `NODE_ENV=production`, `PORT=3101`, `HOSTNAME=0.0.0.0`, `DB_DIR=/app/storage`; `EXPOSE 3101`; `CMD ["node", "server.js"]`.
  - Repo **tidak punya `public/`** (terverifikasi) → baris COPY `public/` ditiadakan dengan komentar di Dockerfile.
  - `ops/` (jadwal cron) dibuat di Fase 3; Dockerfile sudah mereferensikannya.

### Stop-gate Fase 2 — verifikasi jalur non-Docker (daemon tidak tersedia)

| Cek | Hasil |
| :--- | :--- |
| `docker info` / `docker build` | **`DOCKER_NOT_AVAILABLE_ON_HOST`** — CLI docker tidak terpasang di VM ini; tidak ada klaim build image |
| `npm run build` di **worktree terpisah** (bukan checkout produksi) | **exit 0** |
| `.next/standalone/server.js` | ada (7.812 byte) |
| Smoke boot standalone (`node .next/standalone/server.js`, port 3199) | `/healthz` **HTTP 200**, `/` **HTTP 200** |

Catatan proses build worktree (jujur): (1) symlink `node_modules` ditolak Turbopack → diganti hardlink-copy; (2) symlink `data/` meracuni cache Turbopack (error loader di luar root) → hardlink-copy + hapus `.next` worktree; (3) build sempat gagal di *collect page data* `/api/agent` karena worktree tidak memiliki `.env.local` (gitignored) → salinan lokal `.env.local` dipakai hanya di worktree dan ikut terhapus bersama worktree. Turbopack memberi 1 *warning* NFT untuk `lib/db/paths.ts` (akses fs dinamis `DB_DIR` → tracing lebih luas) — warning, bukan error; konsekuensi yang diterima demi fleksibilitas `DB_DIR`. Service produksi tidak pernah di-restart/di-redeploy selama fase ini; `.next` checkout utama tidak disentuh (build 100% di worktree, worktree sudah dihapus, checkout utama terverifikasi utuh).

---

## Fase 3 — `docker-compose.yml`, `Caddyfile`, & Scheduler Cron

- **`docker-compose.yml`** — 3 service persis brief:
  - `web`: build `.`, image `bola-arandisuperr:local`, `env_file: .env.local`, `DB_DIR=/app/storage` + `TZ=Asia/Jakarta`, volume `./storage:/app/storage`, healthcheck `fetch /healthz` tiap 30 detik (interval 30s, timeout 10s, retries 3, start_period 30s), `restart: unless-stopped`.
  - `scheduler`: image sama, `command: supercronic /app/ops/crontab.docker`, `working_dir: /app`, env + volume sama dengan web, `depends_on: web (service_healthy)`, `restart: unless-stopped`.
  - `caddy`: `caddy:2-alpine`, port 80/443, `./Caddyfile` read-only, volume `caddy_data` + `caddy_config`, env `APP_DOMAIN` (default domain produksi), `restart: unless-stopped`.
- **`Caddyfile`:** `{$APP_DOMAIN:bola.mhmdarandi.biz.id}` → `reverse_proxy web:3101` (sintaks placeholder env Caddy `{$VAR:default}`).
- **`ops/crontab.docker`** — jadwal produksi aktual WIB (dicocokkan inventaris Fase 0), semua baris ber-`flock -n` anti-tumpang-tindih (kunci di `/app/storage/.lock-*`, lepas otomatis bila proses mati):
  - `21 4,16 * * *` → `scripts/free-refresh.ts`
  - `0 9,18 * * *` → `scripts/capture-odds-apifootball.ts`
  - `30 13 * * *` → `scripts/generate-fix4-ticket.ts`
  - `0 3 * * *` → `scripts/import-fdorg-results.ts` (jadwal baru dari brief — di host lama tak ada cron fdorg mandiri; 03:00 sebelum refresh 04:21)
  - `30 3 * * *` → `scripts/backup-sqlite-safe.ts` (artefak Fase 4; sesudah fdorg, sebelum refresh)
- **Sentuhan lintas-fase:** `Dockerfile` ditambah paket `util-linux` (penyedia `flock`) di stage runner — kebutuhan scheduler Fase 3.

### Stop-gate Fase 3

| Cek | Hasil |
| :--- | :--- |
| `docker compose config` | tidak bisa dijalankan — `DOCKER_NOT_AVAILABLE_ON_HOST` (CLI tidak terpasang) |
| Parse YAML compose (PyYAML) + assert struktur | OK — 3 service, healthcheck 30s, `service_healthy`, port caddy, 2 volume bernama |
| Sintaks `ops/crontab.docker` (regex 5 kolom cron) | OK — 5 baris valid |
| Path script di crontab ada di repo | 4/5 ada sekarang; `scripts/backup-sqlite-safe.ts` adalah artefak Fase 4 — validasi diulang penuh sesudah Fase 4 dan dicatat di sana |
| File rujukan compose (`Dockerfile`, `Caddyfile`, `ops/crontab.docker`, `.env.local`) | semua ada |

---

## Fase 4 — Safe Backup, Templat Off-Host, & Runbook

- **`scripts/backup-sqlite-safe.ts`** (Node 24 `node:sqlite`):
  - Memindai **dinamis** semua `*.db` di `DB_DIR` (via `lib/db/paths.ts`) — tanpa hardcode; DB masa depan otomatis ikut.
  - Snapshot konsisten per DB via `VACUUM INTO` ke direktori bertimestamp `bola-backup-<ts>` (aman terhadap WAL & penulisan bersamaan; snapshot = file mandiri tanpa WAL).
  - `PRAGMA integrity_check` pada **setiap** snapshot — satu saja ≠ `ok` → gagal keras (exit 1, arsip tidak dibuat, snapshot dipertahankan untuk forensik).
  - Arsip `.tar.gz` + `.sha256` pendamping; direktori snapshot mentah dibuang sesudah arsip jadi.
  - Retensi lokal default 7 hari (`RETENTION_DAYS`), mencakup arsip + `.sha256` + sisa direktori.
  - `RCLONE_REMOTE` diset → unggah arsip + `.sha256` via rclone; biner rclone absen → peringatan keras di log, backup lokal tetap selesai (exit 0).
  - Env: `DB_DIR`, `BACKUP_DIR` (default `<DB_DIR>/backups`), `RETENTION_DAYS`, `RCLONE_REMOTE`. `.gitignore` ditambah `data/backups/` supaya arsip lokal tak pernah ter-commit.
- **`litestream.yml.example`:** templat replikasi kontinu 3 DB kritis (`picks.db`, `market_snapshots.db`, `analysis_snapshots.db`) ke S3/R2 dengan kredensial via `${VAR}` environment, `sync-interval: 10s`, plus petunjuk restore.
- **`docs/VPS-MIGRATION-RUNBOOK.md`:** SOP < 10 menit — persiapan TTL DNS → backup final + `sha256sum -c` → VPS baru (clone, `.env.local`, ekstrak `.db` ke `./storage/`, `docker compose up -d --build`) → verifikasi (`/healthz` 200, angka kohor `/` & `/bukti` sama, `integrity_check` di container, DNS A record → SSL Caddy otomatis, host lama sebagai rollback) → opsional 3 baris recreate `ml1-venv`.

### Stop-gate Fase 4 — uji terisolasi di /tmp (bukti aktual)

Fixture: 2 DB dummy di `/tmp/bola-bktest/dbs` (`alpha.db` jurnal default 1 baris; `beta.db` mode WAL 5 baris — meniru picks.db). Jalankan dengan `DB_DIR` + `BACKUP_DIR` terisolasi:

| Cek | Hasil |
| :--- | :--- |
| Exit code `backup-sqlite-safe.ts` | **0** |
| Log snapshot + integritas | `snapshot alpha.db`, `snapshot beta.db`, `integrity_check: ok untuk 2/2 snapshot` |
| Artefak | `bola-backup-2026-11-25T17-27-34-685Z.tar.gz` (486 byte) + `.tar.gz.sha256` terbentuk |
| `sha256sum -c` atas arsip | **OK** |
| Isi tar | kedua snapshot `.db` ada |
| Restore uji | `alpha.db` integrity ok, 1 baris; `beta.db` integrity ok, 5 baris (persis fixture) |
| Validasi susulan Fase 3 | `ops/crontab.docker` kini **5/5** path script ada di repo — stop-gate Fase 3 tertutup penuh |

---
