# TODO — Performance Optimization (lihat `tasks/plan-perf.md`)

> Aturan: instrumentasi dulu. Tiap task diukur ulang dengan metode baseline yang sama
> (`curl -w time_total`, log stage server) dan dicatat di `PERF.md` — termasuk yang di-revert.

## Task 1: Durasi per stage di `plannerTrace`
**Description:** Tambah field durasi ke `traceStep()` (`lib/agent/planner.ts:250`) — ukur wall-clock di tiap `execute` tool, simpan `durasi_ms` per step. Stempel juga timing internal debat (Stage 1/2 dan per-model) yang hari ini cuma `console.log` (`lib/syndicate-orchestrator.ts:373,470`) ke step `run_syndicate_debate`. Map ke `PlannerTraceSchema` (`lib/agent/schemas.ts:226`) dan tampilkan di receipt `plannerTrace` yang sudah dirender UI (Task 8 plan overhaul).
**Acceptance criteria:**
- [ ] Tiap step trace punya `durasi_ms` (number, bukan null)
- [ ] Stage 1, Stage 2, dan durasi per model debat terlihat di trace
- [ ] Total `durasi_ms` step ≳ 90% dari `thinking.durasi_ms` → sisa ~410s teratribusi
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · 1 run nyata: jumlah durasi step dibandingkan dengan total response (selisih < 10%)
**Dependencies:** None · **Files:** `lib/agent/planner.ts`, `lib/agent/schemas.ts`, `lib/syndicate-orchestrator.ts`, `lib/view/analysis-view.ts` · **Size:** M

### Checkpoint A
- [ ] `PERF.md` punya tabel durasi per stage dari 1 run nyata (baris ~410s diganti angka terukur)

## Task 2: Cache + riwayat `/api/agent` di SQLite
**Description:** Tabel baru `analysis_runs` di `data/thestats_dataset.db` (DB yang sudah ada, **bukan file baru**): `match_id TEXT`, `competition_id_hint TEXT`, `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, `duration_ms INTEGER`, `view_json TEXT`, `planner_trace_json TEXT`. Index `(match_id, competition_id_hint, created_at DESC)`. Alur route: baca baris terbaru yang `created_at` ≤ 10 menit → hit, langsung `Response.json(view_json)`. Miss → jalankan pipeline seperti sekarang, lalu `INSERT` (di dalam `try`, gagal tulis **tidak** boleh menggagalkan response). `?debug=1` lewati baca **dan** tulis.
Ikut pola existing: `getTheStatsDb()` + `CREATE TABLE IF NOT EXISTS` (`lib/db/thestats-dataset.ts:170-184`), WAL sudah aktif.
**Acceptance criteria:**
- [ ] Analisis kedua match yang sama: **< 50ms** (baseline 476s), berasal dari DB (bukan dari pipeline)
- [ ] Dua match berbeda tidak pernah bertukar hasil (`match_id` + `competition_id_hint` di key)
- [ ] `?debug=1` tidak membaca dan tidak menulis cache
- [ ] Baris **tidak dihapus** setelah 10 menit — tetap ada sebagai riwayat/backtest
- [ ] Nama tim + `match_id` tersimpan apa adanya supaya bisa di-join ke `football_master.db` lewat `team-normalizer` nanti
- [ ] Gagal tulis DB → response tetap 200 dengan hasil analisis segar
- [ ] Window staleness (10 menit) ditulis di `PERF.md`
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · `curl -w time_total` dua kali pada `match_id` sama (baseline vs cache) · `npx tsx scripts/test-view-mapper.ts` lulus · assert-based check: dua `match_id` berbeda → dua baris berbeda; `SELECT count(*) FROM analysis_runs` naik 1 per analisis baru
**Dependencies:** Task 1 (butuh `duration_ms` + trace valid di jalur cache) · **Files:** `lib/db/thestats-dataset.ts`, `app/api/agent/route.tsx` · **Size:** M

## Task 3: Cancellation saat client disconnect
**Description:** Thread `req.signal` dari `app/api/agent/route.tsx` → `runPlannerAnalysis()` → `runPlannerLoop()` → tool `execute` → `call9RouterDirect`/`fetchAndValidateMatchIntelligence`/`cachedStatsGet`. Bila signal aborted: batalkan fetch LLM yang in-flight, jangan simpan hasil partial. Client (`app/page.tsx:160`) sudah punya guard `reqId`; tambah `AbortController` yang di-abort di cleanup/supersede.
**Acceptance criteria:**
- [ ] Run yang di-abort berhenti di server (log menunjukkan abort, bukan lanjut 8 menit)
- [ ] Hasil partial tidak masuk cache
- [ ] Analisis normal (tanpa disconnect) tidak terpengaruh
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · run nyata: cancel dari browser → log server berhenti < 5s · run nyata normal tetap sukses
**Dependencies:** Task 2 (pagar cacat: cache dulu, baru abort) · **Files:** `app/api/agent/route.tsx`, `lib/agent/planner.ts`, `lib/syndicate-orchestrator.ts`, `lib/stats-cache.ts`, `app/page.tsx` · **Size:** M

### Checkpoint B
- [ ] Analisis kedua < 50ms · run yang di-abort berhenti di server · tidak ada regresi output
- [ ] Review dengan user sebelum lanjut ke Phase 3

## Task 4: Editorial jalan bersamaan dengan debat
**Description:** Prompt editorial hanya butuh `intel` + `quant` (`planner.ts:412-421`), tidak butuh output debat — tapi saat ini ia di-await setelah debat selesai di chain planner. Jalankan `run_editorial_analysis` berbarengan dengan `run_syndicate_debate` supaya satu round-trip LLM keluar dari critical path. Kontrak tool & urutan `plannerTrace` tidak berubah.
**Acceptance criteria:**
- [ ] Output editorial identik (diff JSON) sebelum vs sesudah
- [ ] Wall-clock segmen debat+editorial turun mendekati `max(debat, editorial)` bukan `debat + editorial`
- [ ] `is_fabricated_fallback` dan `plannerTrace` tetap konsisten
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · `npx tsx scripts/test-planner-loop.ts` lulus · 1 run nyata: bandingkan durasi step (Task 1) sebelum vs sesudah
**Dependencies:** Task 1, Task 3 · **Files:** `lib/agent/planner.ts` · **Size:** M

## Task 5: Batas anggaran retry same-model
**Description:** Retry di `lib/syndicate-orchestrator.ts:189-204` mengulang model yang sama dengan timeout penuh 180s → worst case 360s (teramati 226s). Perpendek timeout retry (usul: 60s) sambil **mempertahankan** retry model yang sama (guardrail anti-bias, ARCHITECTURE §6.5). Jangan ganti vendor model.
**Acceptance criteria:**
- [ ] Worst case satu model turun dari 360s ke ≤ 240s (180s + 60s)
- [ ] Retry tetap memakai model yang sama (independensi vendor terjaga)
- [ ] Jumlah run ber-`fallback_template` tidak naik signifikan (ukur sebelum vs sesudah)
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · 3 run nyata: catat durasi Stage 2 dan `is_fabricated_fallback`; kalau fallback naik → **revert**
**Dependencies:** Task 1 (butuh angka durasi per stage) · **Files:** `lib/syndicate-orchestrator.ts` · **Size:** XS

## Task 6: `/api/matches` satu gelombang `Promise.all`
**Description:** `app/api/matches/route.ts:31` meng-await `/football/matches` sendirian, baru `:43` 4 halaman `/football/competitions` paralel — padahal kelimanya independen. Gabung jadi satu `Promise.all` supaya jalur dingin turun satu round-trip upstream.
**Acceptance criteria:**
- [ ] Cold `/api/matches` turun dari 1.03s
- [ ] Response identik (jumlah match, `leagues`, urutan sama)
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · `curl -w time_total` pada cache kosong (restart server) sebelum vs sesudah · diff JSON response
**Dependencies:** None · **Files:** `app/api/matches/route.ts` · **Size:** XS

### Checkpoint C
- [ ] Cold `/api/matches` < 1.03s · critical path `/api/agent` terukur turun, angka before/after di `PERF.md`

## Task 7: Negative caching + in-flight dedupe di `stats-cache`
**Description:** Dua celah di `lib/stats-cache.ts`: (a) response error (`:100-108`) tidak disimpan → upstream yang rusak di-fetch ulang tiap request; (b) miss bersamaan pada key sama sama-sama menembak upstream. Tambah cache TTL pendek untuk error (mis. 30s) dan peta in-flight promise per key supaya pemanggil bersamaan berbagi satu fetch.
**Acceptance criteria:**
- [ ] Upstream error di-cache singkat (tidak refetch tiap request)
- [ ] N request bersamaan pada key dingin = 1 fetch upstream (bukan N)
- [ ] TTL error lebih pendek dari TTL sukses (data bagus tidak tertahan error lama)
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · assert-based check: panggil `cachedStatsGet` 5x bersamaan pada key dingin → hitung fetch upstream = 1 · `cacheMetrics.misses` naik tepat 1
**Dependencies:** Task 6 (menyentuh jalur yang sama) · **Files:** `lib/stats-cache.ts` · **Size:** S

## Task 8: Gate pengukuran LCP + anggaran
**Description:** Ukur dulu, jangan optimasi. Catat LCP/INP/CLS `/` di DevTools (mobile throttling) sebagai baseline di `PERF.md`, plus ukuran initial JS (171KB terukur) dan CSS. Kalau LCP > 2.5s baru pertimbangkan SSR katalog (LCP saat ini dibatasi fetch client-side, `page.tsx:87,102-114`); kalau ≤ 2.5s, tutup sebagai bukan masalah dan **jangan** ubah apa pun.
**Acceptance criteria:**
- [ ] Baseline LCP/INP/CLS tercatat di `PERF.md` dengan kondisi pengukuran
- [ ] Anggaran tertulis: initial JS < 200KB, `/api/odds` p95 < 200ms, `/api/agent` warm < 50ms
- [ ] Ukuran `analysis_runs` (baris + MB) tercatat sebagai baseline pertumbuhan riwayat
- [ ] Keputusan eksplisit: kerjakan SSR atau tutup (dengan angka)
**Verification:** trace DevTools 1x (mobile throttle) · `curl` ulang ukuran JS/CSS · angka masuk `PERF.md` sebagai baris baseline
**Dependencies:** Task 2, Task 6 (angka akhir jalur dingin sudah ada) · **Files:** `PERF.md`, `app/page.tsx` (hanya bila terbukti perlu) · **Size:** S

### Checkpoint Final
- [ ] `PERF.md` berisi before/after semua task yang di-keep, plus yang di-revert beserta alasannya
- [ ] `npx tsc --noEmit` + `npm run build` hijau · `npx tsx scripts/test-view-mapper.ts` + `npx tsx scripts/test-planner-loop.ts` lulus
- [ ] User review
