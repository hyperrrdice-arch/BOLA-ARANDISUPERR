# Structure Map — football-agent

> Ditulis ulang 4 Nov 2026 (fase dokumentasi — fase terakhir rangkaian:
> sprint DB → overhaul backend → unifikasi kanonik → rekalibrasi →
> kalibrasi piala). Menggantikan peta Fase 4. Arsitektur sistem,
> model, dan alasan di balik struktur ini ada di `ARCHITECTURE.md`;
> bukti per fase ada di `tasks/` (peta di §7 bawah). Koreksi tujuan
> (5 Nov 2026): app ini alat pencari **safe bet untuk parlay** —
> framing value-bet di peta ini sudah disesuaikan; pohon & fakta
> tidak berubah.

## 1. Pohon teranotasi

```
football-agent/
├── ARCHITECTURE.md        arsitektur final (dokumen pendamping ini)
├── STRUCTURE.md           peta repo ini
├── AGENTS.md              aturan proyek (ditulis next dev + aturan owner)
├── CHANGELOG.md           riwayat versi (v2.0.0)
├── package.json           Next 16.4 / React 19; dev & start di port 3101
│                          ⚠️ 4 entry script menunjuk file yang TIDAK ada di
│                          snapshot ini (scripts/ingest-historical-data.ts,
│                          snapshot-report.ts, sync-match-outcomes.ts,
│                          sync-weekly-telemetry.ts) — sisa folder scripts/
│                          asli yang belum pernah dikirim; jangan diandalkan
├── app/                   Next.js App Router
│   ├── page.tsx, layout.tsx, globals.css
│   └── api/
│       ├── agent/route.tsx    shell HTTP pipeline analisis → planner 🔒
│       ├── matches/route.ts   katalog fixture (offline dari store)
│       ├── odds/route.ts      perbandingan odds (bonus)
│       └── betting/route.ts   analisis taruhan dual-model A/B (bonus)
├── components/dashboard/  UI dashboard (fase frontend MENYUSUL — di luar
│                          rangkaian backend ini) 17 komponen kartu + types/
│                          utils/use-logical-picks/motion
├── components/icons.tsx
├── lib/                   seluruh logika backend (42 file tracked)
│   ├── agent/             🔒 READ-ONLY: planner.ts (loop + buildQuantPackage),
│   │                      llm.ts (klien 9Router), schemas.ts (kontrak Zod),
│   │                      coverage.ts (evaluator re-plan)
│   ├── llm/               🔒 READ-ONLY: models.ts (roster model), voice-guide.ts
│   ├── syndicate-orchestrator.ts  🔒 debat 5-LLM dorman (di root lib karena
│   │                      path impor planner menunjuk persis ke sini)
│   ├── quant/             mesin deterministik — SUMBER SEMUA ANGKA
│   │   ├── dixon-coles.ts       Poisson bivariat + koreksi τ(rho), matriks 11×11
│   │   ├── ratings-loader.ts    prior ratings + blend James-Stein + gerbang;
│   │   │                        cabang piala → global-offsets
│   │   ├── league-identity.ts   identitas liga kanonik: registry loader,
│   │   │                        resolveServingForMatch, helper cup_model/cup_offset
│   │   ├── league-gate.ts       jembatan registry league_calibration → analisis
│   │   │                        (membaca status KANONIK)
│   │   ├── cup-offset-fit.ts    inti fit offset δ offline (dipakai backtest +
│   │   │                        fit produksi)
│   │   ├── global-offsets.ts    penyajian runtime model piala (att*/def*,
│   │   │                        G + HA graf, venue netral)
│   │   ├── vig-stripping.ts     Shin; kelly.ts sizing quarter-Kelly ber-cap
│   │   │                        (EV/Kelly = info sekunder — ARCH §1)
│   │   ├── fallback-guard.ts    gerbang kualitas data (fallback → SKIP <50%)
│   │   ├── special-markets-engine.ts  konteks pasar khusus (klaim EV-nya
│   │   │                        direkomendasikan nonaktif — lihat ARCH §10)
│   │   ├── momentum.ts, half-profile.ts, luck-regression.ts  konteks saja,
│   │   │                        dilarang mengubah probabilitas
│   │   ├── team-normalizer.ts   normalisasi nama tim lintas sumber
│   │   └── index.ts
│   ├── db/                akses store lokal
│   │   ├── upcoming-fixtures.ts   katalog + sm_id_map
│   │   ├── thestats-dataset.ts    dataset utama (matches, odds history, konteks)
│   │   ├── team-telemetry.ts      rolling telemetri anti-leakage + rata-rata
│   │   │                          kompetisi terukur dari store
│   │   ├── sqlite-master.ts       football_master.db
│   │   ├── thestats-vault.ts      raw_api_vault
│   │   └── analysis-snapshot.ts   🔒 akses snapshots (append-only)
│   ├── odds/              sportmonks-adapter.ts (fetch + budget guard; render
│   │                      tidak memanggil API), sportmonks-wire.ts (merge
│   │                      odds/lineup/predictions berlabel sumber)
│   ├── view/analysis-view.ts  BFF view-model — pure, angka copy 1:1
│   └── *.ts (root)        stats-fetcher-agent.ts (dispatcher intel offline),
│                          stats-validator.ts (Zod VerifiedMatchIntelligence),
│                          stats-fetch.ts (fail-fast API mati), stats-cache.ts,
│                          stats-log-mapper.ts (mapper anti-karangan),
│                          1xbet.ts, league-constants.ts, thestats-competitions.ts,
│                          api-budget.ts, rate-limit.ts, http-json.ts
├── scripts/               perkakas operasional (tsx) — per peran di §2
├── data/                  store runtime — tracked vs ignored di §3
├── tasks/                 dokumen kerja + bukti per fase — peta di §7
├── docs/                  PRD sprint (docs/plans/prd-database-expansion-
│                          sportmonks.md), db-snapshot.md, backtest-report.md,
│                          rencana frontend (docs/plans/)
├── design-system/         DESIGN.md, theme.css, tokens.json, contohdesign.webp
├── archive/               ⛔ backup legacy (legacy-backups/, legacy-scripts/,
│                          legacy-docs/) — tidak disentuh, tidak dihapus
├── .agents/               konfigurasi agent owner (265 file: skills + agents)
└── .taste-skill/          konfigurasi design tooling (gitignored)
```

## 2. Skrip per peran (`scripts/`, 15 file)

**Ritme & rantai**
- `daily-refresh.ts` — entrypoint rantai harian: catalog → odds →
  predictions → telemetry → calibrate → **cup-offsets** → context →
  laporan cakupan. Urutan cup-offsets tepat sesudah calibrate itu
  kontraktual (lihat ARCHITECTURE §8).

**Sync / capture (satu-satunya jalur tulis dari API)**
- `sm-fetch.ts` — helper fetch Sportmonks bersama (token dari env saja,
  timeout 60 dtk + retry berjenjang).
- `sync-sportmonks-fixtures.ts` — katalog fixture SM → `upcoming_fixtures`
  + `competition_catalog` + `sm_id_map`.
- `capture-odds.ts` — tangkapan odds jatuh tempo → `match_odds_history`
  (baseline + titik T-24j/T-6j/T-1j/T-15m; `has_odds=0` jujur).
- `sync-predictions.ts` — probabilities + tabel value bets SM +
  predictability → `predictions.db` (terisolasi).
- `backfill-telemetry.ts` — hasil + statistik laga selesai → `matches` +
  `team_match_logs` (3 jendela musim; `--current-only` untuk ritme).
- `sync-context.ts` — standings, prematch news, expected lineups, H2H.

**Kalibrasi & fit**
- `build-league-canonical.ts` — generator `data/league-canonical.json`
  (join ternormalisasi + `FORCE_MERGE` berkomentar).
- `calibrate-ratings.ts` — fit IPF (half-life 365, shrinkage κ=10) →
  registry `league_calibration` (termasuk kolom `canonical_id` + baris
  status) + `data/calibrated_ratings.json` berkunci kanonik; menerapkan
  gerbang skala/cakupan/OOS.
- `fit-global-offsets.ts` — fit produksi offset piala: menanam blok
  `canonical.cupOffsets`, `cup_model`/`cup_offset` di registry kanonik,
  dan 17 baris `source='cup-offset'`; status diambil dari
  `tasks/cup-oos.json`.

**Validasi & verifikasi (read-only)**
- `backtest-walkforward.ts` — harness OOS domestik → `tasks/oos-results.json`
  + `tasks/oos-gate.json`; juga benchmark closing line.
- `backtest-cup-offsets.ts` — harness OOS piala (gerbang pradaftar di
  header file) → `tasks/cup-oos.json`.
- `verify-consumption.ts` — audit konsumsi atas seluruh katalog: resolusi
  fixture→fit, kedua-tim-ketemu, status gerbang, jalur offset piala.

**Driver E2E (offline; jalur analisis aktif Spark)**
- `run-one-analysis.ts` — satu analisis liga domestik end-to-end →
  `tasks/e2e-run-1-package.json`.
- `run-one-cup-analysis.ts` — satu analisis piala (UCL) lewat jalur
  offset → `tasks/e2e-cup-package.json`.

## 3. Artefak tergenerasi & produsennya

| Artefak | Produsen | Tracked? |
|---|---|---|
| `data/league-canonical.json` (250 liga, 412 alias) | `scripts/build-league-canonical.ts` (+ `fit-global-offsets.ts` menanam field piala) | ✅ tracked |
| `data/calibrated_ratings.json` (72 liga / 1.842 tim + blok `canonical` + `cupOffsets`) | `scripts/calibrate-ratings.ts` (+ `fit-global-offsets.ts` untuk blok piala) | ✅ tracked (pengecualian eksplisit di `.gitignore`) |
| `tasks/coverage-latest.md` | langkah terakhir `scripts/daily-refresh.ts` | ✅ tracked |
| `tasks/oos-results.json`, `tasks/oos-gate.json` | `scripts/backtest-walkforward.ts` | ✅ tracked |
| `tasks/cup-oos.json` | `scripts/backtest-cup-offsets.ts` | ✅ tracked |
| `tasks/e2e-run-1-package*.json`, `tasks/e2e-cup-package.json` | driver E2E | ✅ tracked |
| 6 store SQLite di `data/` (±1,6 GB total) | skrip sync/capture/kalibrasi | ❌ gitignored — kecuali `thestats_raw_vault.db` yang terlanjur tracked dari era lama |
| `data/sm*.json/.jsonl`, state sync, `api-budget.json` | skrip sprint | ❌ gitignored (state runtime lokal) |

Aturan main artefak: JSON terpadu adalah sumber kebenaran yang dibaca
runtime; regenerasi selalu lewat produsennya (tidak pernah edit tangan),
dan ritme harian meregenerasinya dalam urutan §2 agar tidak ada langkah
yang menimpa hasil langkah sesudahnya.

## 4. Zona read-only 🔒 (perintah owner — byte-identik, hash terverifikasi)

Hash baseline: `tasks/backend-readonly-hashes.txt` (`sha256sum -c` =
8/8 OK di setiap fase, termasuk fase piala dan dokumentasi ini).

- `lib/agent/planner.ts`, `lib/agent/llm.ts`, `lib/agent/schemas.ts`,
  `lib/agent/coverage.ts`
- `lib/syndicate-orchestrator.ts`
- `lib/llm/models.ts`, `lib/llm/voice-guide.ts`
- `lib/db/analysis-snapshot.ts` + `data/analysis_snapshots.db`
  (append-only; jalur tulis satu-satunya = insert produksi app)

Path di atas juga **tidak boleh berpindah**: planner mengimpornya
persis dari lokasi ini, dan owner ingin sindikat bisa diaktifkan lagi
tanpa perbaikan wiring.

## 5. Keputusan penempatan (sengaja, beserta alasan)

- **File root `lib/*.ts` tidak dipindah ke subfolder.** Beberapa
  (stats-fetcher-agent, stats-validator) diimpor planner 🔒 lewat path
  persis ini; memindahkannya memaksa edit file read-only. Subfolder
  domain yang ada (agent/db/llm/odds/quant/view) sudah koheren.
- **`scripts/` tetap datar.** 15 skrip satu-tujuan; path dirujuk
  `daily-refresh.ts` dan dokumentasi ini — subfolder = churn tanpa
  keuntungan.
- **Logika identitas liga dipusatkan di satu modul**
  (`lib/quant/league-identity.ts`), menggantikan peta alias yang dulu
  tersebar di loader; mesin warisan menyusut jadi satu fungsi jaring
  pengaman bernama eksplisit (`legacyResolveDivForMatch`).
- **Model piala tidak membuat file data baru.** δ + status hidup sebagai
  field di dua artefak terpadu (§3) — prinsip satu sumber kebenaran
  (keputusan owner); graf benua adalah data, bukan file.
- **`archive/`, `.agents/`, `data/` (selain artefak §3) tidak disentuh**
  selama rangkaian backend ini.

## 6. Cara menjalankan (ringkas)

```bash
npm run dev                 # dashboard di http://localhost:3101
npx tsc --noEmit            # typecheck (0 error di semua checkpoint fase)
SPORTMONKS_API_TOKEN=... npx tsx scripts/daily-refresh.ts   # ritme harian penuh
npx tsx scripts/verify-consumption.ts                       # audit konsumsi (read-only)
npx tsx scripts/run-one-analysis.ts                         # E2E liga (offline)
npx tsx scripts/run-one-cup-analysis.ts                     # E2E piala (offline)
```

## 7. Peta bukti per fase (`tasks/`)

| Fase | Laporan utama | Artefak bukti |
|---|---|---|
| Sprint ekspansi DB Sportmonks | `sprint-report-2026-11-09.md` | `tier-table.json`, `mapping-review.md`, `plan.md`, `todo.md` |
| Overhaul backend F1–F4 | `backend-flow-map.md`, `model-audit.md` | `oos-results.json`, `oos-gate.json`, `backend-readonly-hashes.txt` |
| Unifikasi liga kanonik | `league-canonical-report.md` | `e2e-run-1-package.pre-canonical.json` (run #1) |
| Rekalibrasi domestik | `recalibration-report.md` | `e2e-run-1-package.canonical.json` (run #2), paket run #3 menimpa `e2e-run-1-package.json` |
| Kalibrasi piala (offset global) | `cup-offset-report.md` | `cup-oos.json`, `e2e-cup-package.json` |
| Berjalan | `coverage-latest.md` | dibangkitkan ulang tiap run ritme harian |
