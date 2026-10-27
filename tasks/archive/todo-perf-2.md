# TODO — Performance Optimization Round 2 (lihat `tasks/plan-perf-2.md`)

## Task 1: Anggaran token per peran di debat — ❌ DIBATALKAN (hipotesis salah)
**Hasil:** Diimplementasikan (16384 → 2048 persona / 1536 hakim), diukur, lalu **direvert**. Bukti: straggler justru 110.9s saat plafon dipotong dan 173.0s saat plafon dikembalikan → waktu panggilan digerakkan latensi provider, bukan panjang output. Efek samping nyata: dengan plafon 2048, persona Bull menghabiskan anggaran untuk reasoning dan `thesis` terisi reasoning mentah (JSON tidak pernah keluar). Detail di `PERF.md`.
**Pelajaran:** jangan sentuh `max_tokens` sebagai lever latensi di pipeline ini; masalahnya ekor latensi per panggilan.

## Task 2: Ukur ulang & bandingkan fallback rate
**Description:** Jalankan ulang match yang sama dengan `?debug=1` (cache sengaja dilewati), baca `plannerTrace.steps[].durasi_ms` + `stage_timings`, bandingkan dengan run ronde 1 (238.5s). Catat juga berapa banyak persona ber-`fallback_template`.
**Acceptance criteria:**
- [ ] Angka before/after masuk `PERF.md` dengan metode yang sama
- [ ] Laju `fallback_template` tidak naik
- [ ] Putusan eksplisit: keep atau revert, bukan "netral dibiarkan"
**Verification:** `kn:plannerTrace` run baru vs lama · `source` persona di `analisis.syndicate_debate.*_case.source` · angka masuk `PERF.md`
**Dependencies:** Task 1 · **Files:** `PERF.md` · **Size:** S

### Checkpoint
- [ ] Total run turun > variasi antar-run · tidak ada regresi kualitas yang terlihat · tsc+build+lints hijau

## Task 3: Audit round-trip planner — ✅ SELESAI (ditutup sebagai bukan prioritas kode)
**Hasil:** Instrumentasi `onStepStart`/`onStepFinish` di `runPlannerLoop` + `trace.planner` (`loop_ms`, `tool_ms`, `planner_overhead_ms`, `step_timings`), tampil di ThinkingPlannerCard. Diukur dengan tool mock instan: **23,243ms / 7 step = 3.3s per step**, step terakhir tanpa tool tetap 4.4s ⇒ sisa tak teratribusi = waktu model planner, bukan tool. Invariant `Σ toolCalls` = tool dieksekusi ikut di-assert di `test-planner-loop.ts`.
**Putusan:** bukan prioritas kode. Lever yang tersisa cuma memangkas jumlah step atau mengganti model planner — dua-duanya keputusan produk.
