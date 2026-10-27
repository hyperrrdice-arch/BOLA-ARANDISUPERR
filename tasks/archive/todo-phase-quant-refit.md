# TODO — Re-fit Ratings & Pembersihan Debt Pasca-Audit (lihat tasks/plan-phase-quant-refit.md)

Baseline saat mulai: `tsc` bersih · eslint 198e/52w · test-view-mapper 45/45 · test-quant-scale 10/10 · verify-tier1 15/15 · verify-foundation 47/47 · `data/backtest_report.json` pasca-fix leakage.

## ✅ STATUS AKHIR (2026-10-17) — 6/6 task selesai, Task 7 deferred sesuai keputusan

- **Task 1 — BUG DITEMUKAN & DIFIX:** double-normalization (α & β keduanya dipaksa mean 1.0) menghapus 1 derajat identifikasi → expected away goals kelebihan **9–24% di 16/16 liga** (audit empiris). Fix: moment-match `G_fit`/`γ_fit` ke momen data (weighted) di output `calibrateDivision`. Re-fit penuh + train cache dijalankan. Guard `test-quant-scale` [4]: worst err **17.9% → 0.1%**.
- **Delta backtest:** Track A Log-Loss **1.0331 → 1.0306**, ECE 0.0323 → 0.0295 (**gate ECE ❌→✅**), Track C Bimodal **0.9662 → 0.9641**. Market Shin kontrol tidak bergerak (0.9949). Kesimpulan utama tetap: belum ada edge vs closing line.
- **Task 2:** default ρ runtime **-0.13 → -0.04** + komentar standar [-0.04, -0.05]; mismatch komentar grid ρ diperbaiki. Ablasi kini rapat (1.0305–1.0306).
- **Task 3:** `?? 0` imputasi dihapus di xG/npxG/shots-on-target/pass-accuracy (counter terpisah per sisi). Delta backtest: **nol** (data absen langka) — zero regression.
- **Task 4:** audit Zod failure path **bersih** (route safeParse, stats-validator safeParse, analysis-view hard gate, dispatcher try/catch). `QuantEngineCard` xPTS diperbaiki ke kontrak `home_xpts/away_xpts` (sebelumnya selalu render "—").
- **Task 5-6:** `OneXBetDeepMarketsCard` 900 → **281 baris** (`use-logical-picks.ts` 314, `LogicalPickCard.tsx` 80, `MarketsTable.tsx` 298). Ekstraksi mekanis, guard Kelly + honest-nulls terverifikasi terbawa. eslint 0/0 di 4 file.
- **Verifikasi final:** `tsc` bersih · `next build` ✓ · test-view-mapper 45/45 · test-quant-scale 12/12 · verify-tier1 15/15 · verify-foundation 47/47 · eslint repo bersih dari kontribusi baru (sisa delta = `verify-tier1-offline-quant.ts` dari commit lain).

---

## Task 1: Audisi fit math + re-fit kondisional `scripts/calibrate-ratings.ts`

**Description:** Komentar `// BUG (known)` tidak pernah ter-commit, jadi defect-nya harus di-rediskoveri. Re-derive persamaan coordinate-ascent MLE (update α di baris ~151-172, β ~175-196, γ ~198-207, grid ρ ~210-228) terhadap kontrak `lambda = G·α_home·β_away·γ`, `mu = G·α_away·β_home`. Kalau ditemukan inkonsistensi → fix + re-fit ratings; kalau tidak → dokumentasikan hasil audit di file dan skip re-fit.

**Acceptance criteria:**
- [ ] Derivasi update α/β/γ ditulis di komentar/audit doc dan TERVERIFIKASI konsisten dengan kontrak skala runtime
- [ ] Keputusan: fix+re-fit ATAU skip+document — salah satu, dengan alasan tertulis
- [ ] Hasil re-fit (kalau jalan): mean α ≈ 1.0 (toleransi ±0.02), mean β ≈ 1.0, γ ∈ [1.05, 1.4], `leagueAvgGoals` ≈ 1.35
- [ ] Train window strictly < test window (tidak ada baris train di tanggal ≥ cutoff)

**Verification:**
- [ ] `npx.cmd tsx scripts/test-quant-scale.ts` PASS
- [ ] Backtest Track A: Log-Loss ≤ 1.0331 + 0.002 (tidak regres)
- [ ] `npx.cmd tsc --noEmit` bersih

**Dependencies:** None
**Files likely touched:** `scripts/calibrate-ratings.ts`, `data/calibrated_ratings.json`, `data/backtest_cache/`
**Estimated scope:** M

---

## Task 2: Standardisasi ρ ∈ [-0.04, -0.05] + fix mismatch komentar grid

**Description:** Report backtest0.1 §8.3 merekomendasikan ρ standar di [-0.04, -0.05]. Saat ini komentar bilang "grid search -0.15 s/d 0.05" tapi kode menjalankan -0.12..0.02 (baris ~214). Samakan default runtime (`dixon-coles.ts`), fit, dan caller backtest.

**Acceptance criteria:**
- [ ] Default ρ runtime & fit konsisten di [-0.04, -0.05]
- [ ] Komentar grid ρ sesuai kode
- [ ] Ablasi Track A tidak berubah di luar ±0.001

**Verification:**
- [ ] `npx.cmd tsx scripts/test-quant-scale.ts` PASS
- [ ] Output backtest Track A selisih ρ vs baseline ≤ 0.001

**Dependencies:** Task 1 (jalankan setelah keputusan re-fit, biar sekali run)
**Files likely touched:** `scripts/calibrate-ratings.ts`, `lib/quant/dixon-coles.ts`, `scripts/backtest-dixon-coles.ts`
**Estimated scope:** XS

---

## Checkpoint: Fondasi

- [ ] `npx.cmd tsx scripts/test-quant-scale.ts` PASS
- [ ] Backtest harness ALL tracks jalan; delta vs `data/backtest_report.json` direview user sebelum lanjut
- [ ] `npx.cmd tsc --noEmit` bersih

---

## Task 3: Hapus imputasi `xg_against ?? 0` / `npxg_against ?? 0`

**Description:** `lib/db/team-telemetry.ts:261,268` mengisi nol untuk data xG yang absen — ini memperlemah rata-rata rolling secara diam-diam (kelas bug yang sama dengan `?? 1.5` yang sudah dihapus di `stats-validator.ts`). Ganti: exclude baris tanpa xG dari rata-rata, sample size xG dihitung dari baris yang benar-benar punya nilai.

**Acceptance criteria:**
- [ ] Tidak ada `?? 0` di jalur akumulasi xG/npxG
- [ ] Baris tanpa xG di-exclude dari rata-rata, bukan dihitung sebagai 0
- [ ] Sample size yang ter-ekspos = jumlah baris ber-xG

**Verification:**
- [ ] `npx.cmd tsx scripts/verify-tier1-offline-quant.ts` tetap 15/15
- [ ] `npx.cmd tsx scripts/verify-foundation-phase-a.ts` tetap 47/47

**Dependencies:** None
**Files likely touched:** `lib/db/team-telemetry.ts`
**Estimated scope:** S

---

## Task 4: Audit Zod bypass failure path + kontrak field render

**Description:** Dua temuan Required review pertama yang belum tuntas: (a) jalur failure masih bisa melewati Zod tanpa validasi (audit `lib/agent/planner.ts` + `lib/stats-validator.ts` — semua parse harus `safeParse`/throw jujur, bukan merge mentah); (b) `QuantEngineCard` membaca `expected_points.home` padahal kontrak data `home_xpts` — pastikan field yang dirender ada di kontrak.

**Acceptance criteria:**
- [ ] Tidak ada `Schema.parse` tanpa guard di jalur error/fallback
- [ ] Field yang dirender `QuantEngineCard` cocok dengan kontrak `ExpectedPointsMetrics` (`home_xpts`/`away_xpts`)
- [ ] Field absen render "—"/null, bukan 0

**Verification:**
- [ ] `npx.cmd tsc --noEmit` bersih
- [ ] `npx.cmd tsx scripts/test-view-mapper.ts` 45/45

**Dependencies:** None
**Files likely touched:** `lib/agent/planner.ts`, `lib/stats-validator.ts`, `components/dashboard/QuantEngineCard.tsx`
**Estimated scope:** S

---

## Task 5: Pecah `OneXBetDeepMarketsCard` bagian 1 — extract logicalPicks + metric strip

**Description:** File 870+ baris. Bagian 1: extract `useMemo` logicalPicks (dixon-coles quant matching + AI fallback) ke custom hook `useLogicalPicks` dan metric strip pick card ke sub-component kecil. Perilaku render identik.

**Acceptance criteria:**
- [ ] `logicalPicks` pindah ke hook/file terpisah, konsumen tetap sama output-nya
- [ ] Metric strip jadi komponen terpisah, props tiped (tanpa `any` baru)
- [ ] Tidak ada perubahan visual/perilaku

**Verification:**
- [ ] `npx.cmd tsc --noEmit` bersih
- [ ] `npx.cmd eslint components/dashboard/OneXBetDeepMarketsCard.tsx` tidak lebih buruk dari baseline
- [ ] `npx.cmd tsx scripts/test-view-mapper.ts` 45/45

**Dependencies:** Task 4 (kontrak field sudah beres sebelum dipindah)
**Files likely touched:** `components/dashboard/OneXBetDeepMarketsCard.tsx`, `components/dashboard/use-logical-picks.ts` (baru), `components/dashboard/LogicalPickCard.tsx` (baru)
**Estimated scope:** M

---

## Task 6: Pecah `OneXBetDeepMarketsCard` bagian 2 — extract tabel markets + filter

**Description:** Bagian 2: extract tabel 500+ baris markets + filter kategori/search/pagination (pageSize 30) ke sub-component. Sisa file = header + fetch state.

**Acceptance criteria:**
- [ ] Tabel + filter + pagination jadi komponen terpisah dengan props tiped
- [ ] `OneXBetDeepMarketsCard.tsx` tersisa < 400 baris
- [ ] Pagination & filter berfungsi identik (uji manual di dev server)

**Verification:**
- [ ] `npx.cmd tsc --noEmit` bersih
- [ ] Jumlah eslint repo TIDAK naik dari 198e/52w
- [ ] Smoke check: buka tab markets, filter kategori, ganti halaman

**Dependencies:** Task 5
**Files likely touched:** `components/dashboard/OneXBetDeepMarketsCard.tsx`, `components/dashboard/MarketsTable.tsx` (baru)
**Estimated scope:** M

---

## Checkpoint: Kejujuran & UI

- [ ] Jumlah eslint repo tidak naik dari 198e/52w
- [ ] `npx.cmd tsx scripts/test-view-mapper.ts` 45/45
- [ ] Smoke check home page + tab Odds: angka kosong render "—", bukan 0

---

## Task 7: DEFERRED — Cross-validation κ bimodal di train set

**DITUNDA** (keputusan user 2026-10-17: special markets belum dibutuhkan). Nilai rendah selama model 1X2 masih paritas vs closing line. Buka kembali bersamaan dengan pengembangan model Special Markets — deskripsi lengkap ada di riwayat plan ini.

---

## Checkpoint: Final

- [ ] Semua regression suite hijau: test-quant-scale, test-view-mapper, verify-tier1, verify-foundation-phase-a
- [ ] Commit terpisah per fase (Phase 1 / Phase 2 / Phase 3)
