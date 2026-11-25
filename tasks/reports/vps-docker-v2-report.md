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
