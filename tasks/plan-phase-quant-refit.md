# Implementation Plan: Re-fit Ratings & Pembersihan Debt Pasca-Audit

## Overview

Tindak lanjut setelah seluruh Critical fix + fix leakage Track D mendarat. Tujuan: (1) mengaudit dan me-re-fit kalibrasi ratings terhadap kontrak skala ratio (mean 1.0) yang kini dipakai runtime, (2) menuntaskan debt kejujuran data yang tersisa dari review pertama (`xg_against ?? 0`, Zod bypass failure path, kontrak field render), dan (3) memecah komponen 870 baris. Semua angka backtest yang sudah jujur dijadikan baseline pembanding — tidak ada perubahan perilaku di luar scope.

**Status repo saat mulai:** semua perubahan sudah di-commit oleh sesi lain (`78ee4a1` dst). Baseline: `tsc` bersih, eslint 198e/52w (pre-existing `no-explicit-any`), `test-view-mapper` 45/45, `test-quant-scale` 10/10, `verify-tier1` 15/15, `verify-foundation-phase-a` 47/47, `data/backtest_report.json` (pasca-fix leakage).

## Architecture Decisions

- **Kontrak skala (sudah final, jangan diubah):** `attack`/`defense` = rasio dimensionless (mean 1.0), `leagueAvgGoals` = gol per-tim-per-laga (~1.35), runtime `lambda = leagueAvg × atk × def × homeAdv`, `mu = leagueAvg × atk × def` (tanpa homeAdv).
- **Re-fit bersifat kondisional:** komentar `// BUG (known)` di `scripts/calibrate-ratings.ts` tidak pernah ter-commit (subagent mati sebelum sempat menulisnya). Task 1 wajib me-re-derive persamaan MLE lebih dulu. **Kalau audit menemukan bug → fix + re-fit. Kalau tidak → dokumentasikan hasil audit dan SKIP re-fit** (re-fit tanpa perubahan kode = no-op yang membuang waktu).
- **Honest-nulls contract tetap berlaku:** imputasi angka default (`?? 0`) di jalur perhitungan = bug, bukan convenience. Contoh sukses: `stats-validator.ts` exclude laga tanpa skor (sample size jujur).
- **Baseline backtest jangan diredam:** kalau re-fit mengubah angka Track A/B/C/E, laporkan delta apa adanya — jangan tune ulang agar cocok angka lama.

## Task List

### Phase 1: Fondasi Ratings (urutan wajib, high-risk duluan)

- [ ] Task 1: Audisi fit math + re-fit kondisional `scripts/calibrate-ratings.ts`
- [ ] Task 2: Standardisasi ρ ∈ [-0.04, -0.05] + perbaiki mismatch komentar grid ρ

### Checkpoint: Fondasi
- [ ] `npx.cmd tsx scripts/test-quant-scale.ts` PASS
- [ ] Backtest harness ALL tracks jalan; delta vs `data/backtest_report.json` direview user
- [ ] `npx.cmd tsc --noEmit` bersih

### Phase 2: Debt Kejujuran Data & UI (paralel-safe, tak saling bergantung)

- [ ] Task 3: Hapus imputasi `xg_against ?? 0` / `npxg_against ?? 0` di `lib/db/team-telemetry.ts`
- [ ] Task 4: Audit Zod bypass failure path + kontrak field render (`expected_points` vs `home_xpts`)
- [ ] Task 5: Pecah `OneXBetDeepMarketsCard` bagian 1 — extract `logicalPicks` + metric strip
- [ ] Task 6: Pecah `OneXBetDeepMarketsCard` bagian 2 — extract tabel markets + filter/pagination

### Checkpoint: Kejujuran & UI
- [ ] Jumlah eslint repo TIDAK naik dari 198e/52w
- [ ] `npx.cmd tsx scripts/test-view-mapper.ts` 45/45
- [ ] Smoke check home page + tab Odds di dev server (angka kosong render "—", bukan 0)

### Phase 3: DEFERRED (tidak dikerjakan sekarang)

Ditunda sesuai keputusan user (special markets belum dibutuhkan):

- [ ] ~~Task 7: Cross-validation κ bimodal di train set~~ — ditunda; nilai rendah selama model 1X2 masih paritas vs closing line
- [ ] Improvement model Special Markets (Track D) — butuh fitur baru, bukan tuning; dibuka lagi saat dibutuhkan
- [ ] Pengujian numerik edge *asymmetric info* (cedera/lineup)

### Checkpoint: Final
- [ ] Seluruh regression suite hijau (4 script)
- [ ] Commit terpisah per fase

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Re-fit mengubah ratings → semua angka backtest bergeser | Med | Delta dilaporkan apa adanya; bandingkan vs `backtest_report.json`, jangan tune agar cocok |
| Bug fit math ternyata tidak ada (komentar hilang begitu saja) | Rendah | Task 1 eksplisit mengizinkan skip re-fit dengan dokumentasi hasil audit |
| Kredit provider LLM habis (gangguan sesi sebelumnya) | Med | Semua task di plan ini offline/deterministik — tidak butuh LLM |
| Tabrakan dengan plan aktif lain (`plan.md` Dashboard Overhaul, `plan-phase-c-llm-foundation.md`) | Med | File plan ini terpisah; Task 4 tidak menyentuh `app/api/**` (milik Fase C) |

## Open Questions

- [x] ~~Track D sekarang FAIL~~ → **DIPUTUSKAN: special markets di-deprioritaskan** (user, 2026-10-17). Model corners/cards tidak dikembangkan sampai dibutuhkan.
- [ ] Edge *asymmetric info* (cedera/lineup) belum teruji numerik — masuk plan berikutnya?

## Paralelisme dengan Subagent Lain

Subagent lain sedang mengerjakan optimasi (UI/LLM) di working tree yang sama. Aturan aman:

- **Task 1-3 boleh jalan paralel** — file set disjoint (`scripts/calibrate-ratings.ts`, `lib/quant/*`, `scripts/backtest-dixon-coles.ts`, `lib/db/team-telemetry.ts`); commit per task supaya tree tetap terpisah rapi.
- **Task 4 bagian QuantEngineCard + Task 5-6 TUNGGU subagent lain kelar** — risiko tabrakan file komponen UI tinggi.
- Kalau subagent lain ternyata menyentuh `lib/db/team-telemetry.ts` atau `lib/quant/*` → hentikan paralel, koordinasi dulu.

## Catatan Konflik Plan Lama

`tasks/plan.md` (Dashboard Overhaul v2) dan `tasks/todo-phase-c-llm-foundation.md` masih punya task unchecked — **tidak disentuh, tidak ditimpa**. Pekerjaan sesi lain berjalan di sana.
