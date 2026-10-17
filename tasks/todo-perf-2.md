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

## Task 3: Audit round-trip planner (hanya bila Phase 1 tidak cukup)
**Description:** 23.9s (10%) habis di round-trip planner antar tool (~6 step). Sebelum dikerjakan: buktikan dulu bahwa biaya itu memang di panggilan model planner (butuh hook `onStepFinish` AI SDK), bukan di tool. Jangan optimasi berdasarkan dugaan.
**Acceptance criteria:**
- [ ] Terbukti berapa ms per langkah planner (bukan per tool)
- [ ] Kalau < 10% dari total, tutup sebagai bukan prioritas
**Verification:** log `onStepFinish` pada 1 run nyata
**Dependencies:** Task 2 · **Files:** `lib/agent/planner.ts` · **Size:** S
