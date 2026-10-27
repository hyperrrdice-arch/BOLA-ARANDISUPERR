# Implementation Plan: Performance Optimization — Analisis 476s & Jalur Dingin

> Tasks: `tasks/todo-perf.md` · Ledger: `PERF.md` (sudah ada, di-update, bukan dibuat baru).
> Plan ini **terpisah** dari `tasks/plan.md` (Dashboard Overhaul, Phase 2/3 masih jalan). Naming ikut konvensi repo: `plan-lint-fix.md` → `plan-perf.md`.

## Overview

`/api/agent` butuh **476s** untuk satu analisis dan tidak di-cache; analisis ulang match yang sama membakar 476s + biaya LLM penuh lagi. ~410s dari 476s **belum teratribusi** karena `plannerTrace` tidak punya field durasi. Jalur dingin lain (`/api/matches` 1.03s, `/api/odds` 420ms terukur) punya waterfall dua gelombang yang bisa dihapus.

Urutan kerja wajib: **instrumentasi dulu** (baru boleh optimasi), lalu cache, lalu potong critical path. Tiap langkah diukur ulang dengan metode baseline yang sama (`curl -w time_total`, log stage server) dan dicatat di `PERF.md` — termasuk yang di-revert.

## Baseline (terukur 17 Okt 2026, prod lokal `next start -p 3100`, build `bm0Rsd9z`)

| Pengukuran | Nilai | Sumber |
|---|---|---|
| `/api/agent` cold (1 analisis) | **476s** | PERF.md, log server |
| — Debat Stage 1 (3 persona paralel) | 28s | log server |
| — Debat Stage 2 (J1+J2 paralel) | 36s | log server |
| — Stage 2 worst case (abort 180s → retry model sama) | **226s** | log server |
| — Sisa (dispatcher, fetch, quant, editorial, verdict, round-trip planner) | **~410s, tanpa timing** | inferensi |
| `/api/matches` cold | 1.03s | PERF.md |
| `/api/matches?hours=12` warm | 15ms / 32.6KB | ukur ulang hari ini |
| `/api/odds` cold (first touch per match) | 420ms / 2.7KB | ukur ulang hari ini |
| `/api/odds` warm | 10ms | PERF.md |
| `/` HTML statis | 12ms / 15.9KB | ukur ulang hari ini |
| Initial JS (8 chunk, terkompresi di wire) | **171KB** | ukur ulang hari ini |

## Temuan (terlokasi di kode)

1. **Tidak ada cache hasil `/api/agent`** — `app/api/agent/route.tsx:50`. Hanya ada rate limit 10/menit (`lib/rate-limit.ts`). Analisis itu expensive dan jauh lebih sering **dibaca ulang** daripada ditulis ulang (buka match yang sama, refresh, balik dari tab) → target cache yang sah.
2. **Tidak ada cancellation** — `runPlannerAnalysis()` tidak pernah menerima `req.signal`; client (`app/page.tsx:160`) cuma pakai guard `reqId`, tidak `abort()`. Request yang sudah usang/disconnect tetap menghabiskan ~8 menit LLM.
3. **Tidak ada durasi per stage di trace** — `traceStep()` (`lib/agent/planner.ts:250`) tidak punya field durasi; `PlannerTraceSchema` (`lib/agent/schemas.ts:226`) juga tidak. Timing Stage 1/2 ada tapi cuma `console.log` (`lib/syndicate-orchestrator.ts:373,470`) — tidak pernah sampai ke trace/UI. Ini sebabnya ~410s tak teratribusi.
4. **Retry mengulang call yang sama dengan timeout penuh 180s** — `lib/syndicate-orchestrator.ts:189-204`. Worst case 360s per model (teramati 226s). Retry model sama itu **guardrail anti-bias yang disengaja** (ARCHITECTURE §6.5) → fix-nya batasi *anggaran waktu retry*, bukan ganti model.
5. **Chain LLM serial dengan satu pasangan yang sebenarnya paralel** — urutan `check_data_integrity → quant → debate → editorial → verdict` (`planner.ts:462`). Prompt editorial dibangun dari `intel` + `quant` saja (`planner.ts:412-421`) — **tidak** bergantung output debat. Menjalankan editorial bersamaan dengan debat menghapus satu round-trip LLM dari critical path. Ditambah 5+ round-trip planner (mimo-v2.6-pro) yang serial dan belum dihitung.
6. **`/api/matches` cold = waterfall 2 gelombang** — `app/api/matches/route.ts:31` (`/football/matches`) di-await sendirian, baru `:43` 4 halaman `/football/competitions` lewat `Promise.all`. Kelimanya independen → satu `Promise.all` menghapus satu round-trip upstream dari jalur dingin (1.03s).
7. **`lib/stats-cache.ts`: nol negative caching, nol in-flight dedupe** — response error (`:100-108`) dikembalikan tanpa disimpan, jadi upstream yang sedang rusak di-fetch ulang tiap request. Dua miss bersamaan pada key yang sama sama-sama menembak upstream (tanpa stampede guard).
8. **LCP `/` dibatasi fetch client-side** — katalog di-fetch di `useEffect` setelah hidrasi (`page.tsx:87,102-114`), jadi paint pertama = spinner. Initial JS 171KB.

**Diperiksa, bukan masalah (jangan diutak-atik tanpa bukti baru):** tidak ada N+1 di `lib/db/*` (2 tim per match, bukan loop per-row); `loadCalibratedRatings()` sudah di-memo module-scope (`lib/quant/ratings-loader.ts:213`); `db.prepare()` per-call itu compile murah, bukan bottleneck.

## Design Decisions

1. **Instrumentasi sebelum optimasi.** Task 1 mendahului semua. Tanpa atribusi ~410s, Task 4–5 cuma tebakan.
2. **Cache, bukan refactor.** `/api/agent` mahal dan read-heavy → cache hasil adalah perbaikan rasio terbesar per baris kode. Refactor pipeline ditunda sampai timing membuktikan di mana.
3. **Key cache lengkap.** `matchId` **dan** `competitionIdHint` sama-sama mengubah response (`route.tsx:29,50`) → keduanya masuk key. `?debug=1` tetap tanpa cache (semantiknya "jalankan ulang penuh") dan **tidak menulis** ke DB.
4. **SQLite, bukan in-memory — satu mekanisme untuk dua kebutuhan** (keputusan user). Cache hasil `/api/agent` **dan** riwayat analisis (ARCHITECTURE §11) = baris yang sama. In-memory per-instance ditolak karena ceiling-nya jelas (hilang saat restart, tak bisa jadi korpus backtest).
5. **Tabel baru di DB yang sudah ada, bukan file DB baru.** `data/thestats_dataset.db` dipilih karena ID space-nya identik dengan input `/api/agent` (`mt_*`/`tm_*`) → langsung join ke `matches`/`team_match_logs`. `data/football_master.db` **tidak** dipakai: ia pakai nama tim football-data.co.uk, butuh jembatan `lib/quant/team-normalizer.ts`. Tidak ada file DB baru; `getTheStatsDb()` sudah WAL (`synchronous=NORMAL`) + pola idempotent `CREATE TABLE IF NOT EXISTS`.
6. **Freshness vs riwayat dipisah.** TTL baca = 10 menit (window staleness disetujui, dicatat di `PERF.md`). Baris **tidak pernah dihapus** — jadi korpus backtest tumbuh sendiri tanpa ingestion terpisah. Odds yang bergerak tetap terlihat dari `/api/odds` (TTL 15 menit, terpisah).
7. **Guardrail anti-bias dihormati.** Fix retry = batas waktu + anggaran, bukan ganti vendor model.
8. **Tulis sinkron itu sadar, bukan tak sengaja.** `node:sqlite` `DatabaseSync` = blocking, tapi satu `INSERT` kecil per analisis (bukan per request katalog) di WAL. Ukur; kalau ternyata menggigit, itu sinyal untuk antre tulis, bukan alasan ganti DB.
7. **Jangan sentuh bundle/UI dulu.** 171KB initial JS tanpa bukti LCP jelek = premature. Task 8 di-gate pada pengukuran LCP.

## Task List

### Phase 1: Instrumentasi (wajib pertama)
- [ ] Task 1: Durasi per stage masuk ke `plannerTrace` + tampil di receipt UI

### Checkpoint A
- [ ] `PERF.md` punya baris durasi per stage dari 1 run nyata; ~410s teratribusi atau tersisa terjelaskan

### Phase 2: Dampak terbesar (cache + cancellation)
- [ ] Task 2: Cache + riwayat hasil `/api/agent` di SQLite (`thestats_dataset.db`)
- [ ] Task 3: Cancellation saat client disconnect (`req.signal` turun sampai fetch)

### Checkpoint B
- [ ] Analisis kedua match yang sama < 50ms (baseline 476s); run yang di-abort berhenti di server (terbukti dari log)

### Phase 3: Potong critical path
- [ ] Task 4: Editorial jalan bersamaan dengan debat
- [ ] Task 5: Batas anggaran retry same-model
- [ ] Task 6: `/api/matches` satu gelombang `Promise.all`

### Checkpoint C
- [ ] Cold `/api/matches` turun dari 1.03s; critical path `/api/agent` terukur turun, dengan angka before/after

### Phase 4: Kebersihan cache
- [ ] Task 7: Negative caching + in-flight dedupe di `stats-cache`

### Phase 5: Guard anti-regresi
- [ ] Task 8: Gate pengukuran LCP + anggaran (bundle & latency) di `PERF.md`

## Risks & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Cache menyajikan analisis basi (lineup/odds berubah) | Sedang | TTL baca 10 menit + window staleness ditulis eksplisit di PERF.md; `/api/odds` tetap fresh sendiri |
| Cache key kurang satu input → hasil match lain bocor | Tinggi | `match_id` + `competition_id_hint` di key + index; test: 2 match beda harus beda entri |
| Baris riwayat tak bisa di-join saat backtest (nama tim beda) | Sedang | Simpan `match_id` **dan** nama tim apa adanya di baris; jembatan ke `football_master.db` lewat `team-normalizer` saat backtest dikerjakan |
| Tulis SQLite sinkron memblok event loop | Sedang | 1 INSERT kecil per analisis (bukan per request katalog), WAL sudah aktif; ukur durasi tulis di Task 1. Kalau menggigit → antre tulis, bukan ganti DB |
| DB tumbuh tanpa batas | Rendah | `view_json` per analisis ~10–30KB, ~1 baris/analisis; cek `getVaultMetrics`-style di Task 8. Prune bukan kebutuhan sekarang |
| `req.signal` di-thread ke fetch LLM membatalkan run yang sebenarnya masih dipakai | Sedang | Abort hanya saat client benar-benar disconnect; guard `reqId` di client dipertahankan |
| Paralelisasi editorial↔debat mengubah urutan panggilan planner (loop LLM-driven) | Sedang | Tool `run_editorial_analysis` tetap ada & kontraknya tak berubah; hanya eksekusi digabung. Verifikasi: output editorial identik (diff JSON) |
| Retry timeout diperpendek → lebih banyak `fallback_template` | Sedang | `is_fabricated_fallback` sudah jujur ke UI; ukur berapa run yang memburuk sebelum keep |
| `next build` bareng `next start` mengganggu server yang jalan | Rendah | Ukur pakai `curl` ke server yang sudah hidup; build hanya saat server dihentikan |

## Open Questions

1. Cakupan backtest: baris riwayat cukup `view_json` + `created_at` (cukup untuk evaluasi prediksi vs hasil), atau sekalian simpan input mentah yang dipakai pipeline (butuh kolom blob lebih besar)? **Rekomendasi: `view_json` saja dulu** — input mentah sudah tersimpan terpisah di `thestats_raw_vault.db`.
2. Task 5 (batas retry): cukup `retryTimeout = min(60s, remaining budget)`, atau tambah hard budget total per stage? **Rekomendasi: timeout retry 60s** — perubahan paling kecil yang menghapus worst case 360s.
3. Task 8: kalau LCP ternyata sudah ≤2.5s, tutup sebagai "bukan masalah" (revert), atau tetap SSR katalog? **Rekomendasi: tutup** kalau lulus threshold.
