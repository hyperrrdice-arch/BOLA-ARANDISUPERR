# Structure Map — football-agent

> Peta struktur proyek pasca overhaul backend (4 Nov 2026, Fase 4).
> Prinsip fase ini: konservatif — organisasi hanya di tempat yang tidak
> menyentuh wiring dorman sindikat dan tidak memutus path impor mana pun.
> Alur data end-to-end ada di `tasks/backend-flow-map.md`; arsitektur
> produk di `ARCHITECTURE.md`.

## Layout

```
app/                  Next.js App Router (di luar scope backend fase ini)
  api/agent/          endpoint analisis (shell HTTP → planner)
  api/matches/        katalog fixture
  api/odds/, api/betting/
components/dashboard/ UI dashboard (fase frontend menyusul)
lib/                  seluruh logika backend
  agent/              🔒 planner loop + llm + schemas + coverage (READ-ONLY)
  llm/                🔒 model registry + voice guide (READ-ONLY)
  syndicate-orchestrator.ts  🔒 debat 5-LLM dorman (READ-ONLY, di root lib
                        karena path impor planner menunjuk ke sini)
  quant/              mesin kuantitatif deterministik (sumber semua angka)
    dixon-coles.ts      Poisson bivariat + koreksi rho (kanonis)
    ratings-loader.ts   prior ratings + blend James-Stein + gerbang
    league-gate.ts      jembatan registry league_calibration → analisis
    fallback-guard.ts   gerbang kualitas data + flag calibration_gate
    vig-stripping.ts    Shin; kelly.ts sizing; special-markets-engine.ts
    momentum.ts, half-profile.ts, luck-regression.ts  (konteks saja)
    team-normalizer.ts  normalisasi nama tim lintas sumber
  db/                 akses store lokal (upcoming, dataset, snapshots 🔒)
  odds/               wire/adapter Sportmonks (baca store lokal saat render)
  view/               BFF view-model (analysis-view.ts) — angka copy 1:1
  *.ts (root lib)     stats-fetcher-agent, stats-validator, stats-fetch,
                      1xbet, api-budget, rate-limit, http-json,
                      stats-cache, stats-log-mapper, league-constants,
                      thestats-competitions — lihat "Non-moves" di bawah
scripts/              perkakas operasional (tsx, dipanggil npm/daily-refresh)
  daily-refresh.ts      rantai harian: sync → capture → calibrate
  calibrate-ratings.ts  fit IPF → registry + calibrated_ratings.json
  backtest-walkforward.ts  gerbang akurasi OOS Fase 3
  verify-consumption.ts    ukur cakupan resolusi fixture→ratings
  sync-*.ts, capture-odds.ts, backfill-telemetry.ts, sm-fetch.ts
data/                 store runtime (gitignored kecuali calibrated_ratings.json)
tasks/                dokumen kerja + bukti: backend-flow-map.md,
                      model-audit.md, oos-results.json, oos-gate.json,
                      sprint-report-*, plan/todo, coverage-latest
docs/                 PRD + laporan lama (docs/plans/)
design-system/        aset design: DESIGN.md, theme.css, tokens.json,
                      contohdesign.webp (referensi visual)
archive/              ⛔ backup legacy — tidak disentuh, tidak dihapus
.agents/, .taste-skill/  konfigurasi agent/design tooling owner
```

## Zona read-only (perintah owner)

Path berikut byte-identik dengan baseline dan TIDAK boleh berpindah
path — planner mengimpornya persis dari lokasi ini, dan owner ingin
sindikat bisa diaktifkan lagi tanpa perbaikan wiring:

- `lib/agent/planner.ts`, `lib/agent/llm.ts`, `lib/agent/schemas.ts`,
  `lib/agent/coverage.ts`
- `lib/syndicate-orchestrator.ts`
- `lib/llm/models.ts`, `lib/llm/voice-guide.ts`
- `lib/db/analysis-snapshot.ts` + `data/analysis_snapshots.db` (append-only)

Hash baseline: `tasks/backend-readonly-hashes.txt`.

## Perubahan Fase 4

- `contohdesign.webp`: root → `design-system/` (aset referensi design;
  terverifikasi tidak dirujuk kode/dokumen mana pun; `git mv`).

## Non-moves (disengaja, beserta alasan)

- **File root `lib/*.ts` tidak dipindah ke subfolder.** Beberapa
  (stats-fetcher-agent, stats-validator) diimpor oleh planner read-only
  lewat path persis ini; memindahkannya memaksa edit file read-only.
  Subfolder domain yang ada (agent/db/llm/odds/quant/view) sudah koheren.
- **`scripts/` tetap datar.** Sepuluh skrip satu-tujuan; path mereka
  dirujuk `package.json` dan `daily-refresh.ts` — subfolder = churn
  tanpa keuntungan.
- **`archive/`, `.agents/`, `.taste-skill/`, `data/` tidak disentuh**
  (aturan owner untuk archive/backups; sisanya home tooling/store).
