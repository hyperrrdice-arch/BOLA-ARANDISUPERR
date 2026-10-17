# TODO — Performance Optimization Round 2 (lihat `tasks/plan-perf-2.md`)

## Task 1: Anggaran token per peran di debat
**Description:** `call9RouterDirect` dipanggil dengan `maxTokens = 16384` untuk semua persona (`lib/syndicate-orchestrator.ts`), padahal output yang diminta kecil. Turunkan per peran: persona (Bull/Neutral/Bear) dan hakim (J1/J2) dapat plafon yang cukup untuk skema JSON-nya saja. Sediakan override env supaya bisa dinaikkan tanpa ubah kode. Guardrail tidak diubah: model tetap tidak diseragamkan, timeout 180s tetap, retry tetap model sama.
**Acceptance criteria:**
- [ ] Persona & hakim tidak lagi memakai plafon 16384
- [ ] Nilai bisa dioverride lewat env (default aman)
- [ ] Persona/hakim tetap menghasilkan JSON valid (bukan `fallback_template`) pada run nyata
**Verification:** `npx tsc --noEmit` + `npm run build` hijau · `npx tsx scripts/test-planner-loop.ts` + `test-view-mapper.ts` lulus · 1 run nyata `?debug=1`: `source` tiap persona tetap `model`
**Dependencies:** Task 1–3 plan-perf (instrumentasi, cache, cancellation) · **Files:** `lib/syndicate-orchestrator.ts` · **Size:** XS

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
