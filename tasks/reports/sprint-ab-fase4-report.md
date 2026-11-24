# Laporan Sprint A+B — Fase 4: Q2 Dependensi Skor & Ekor (Item 2)

Basis: master `fb21f7f` · Branch: `sprint/a-b-lanjutan` · Design beku:
`tasks/sprint-ab/q2-design.md` (di-commit SEBELUM run Q2a, sesudah
diagnostik) · Artefak: `tasks/sprint-ab/evidence/q2-diagnostic/` +
`tasks/sprint-ab/evidence/q2a-rho/` · Kode: `lib/eval/kandidat-q2-rho.ts`,
`scripts/evaluate-kandidat-q2.ts`, `scripts/diagnose-q2-champion.ts`,
`tests/test-q2-rho.ts` (11/11, dirantai ke test:quant).

## 1. Diagnostik champion (H, n = 6.708; jangkar 1,0134022623271062 persis)

| Ukuran | Prediksi | Aktual | Gap |
|---|---|---|---|
| Seri | 23,60% | 25,19% | +1,60pp |
| Sel 0-0 | 6,22% | 6,48% | +0,26pp |
| Sel 0-1 | 7,43% | 6,81% | −0,62pp |
| Sel 1-0 | 8,99% | 8,83% | −0,16pp |
| Sel 1-1 | 10,65% | 11,67% | +1,03pp |
| BTTS | 55,20% | 55,53% | +0,33pp |
| Total gol ≥6 | 8,58% | 7,14% | ekor model lebih berat |

Pola sel rendah = tanda tangan klasik ρ < 0. Dispersi Pearson terhadap
rerata terpasang: kandang 0,956 · tandang 1,012 · total 0,982 → **tidak
ada overdispersi konsisten** → **Q2b Negative Binomial:
SKIPPED_BY_DIAGNOSTIC_EVIDENCE** (syarat perlu brief tidak terpenuhi;
var/mean marginal 1,022 adalah heterogenitas rerata antar laga).

## 2. Q2a — ρ terpool (walk-forward: fit V1 → V2; fit V1+V2 → H)

- Grid penalti {0, 25, 100, 400}: ρ dari V1 berkisar −0,0262…−0,0224
  (stabil); penalti terpilih 0 (gain V2 terbaik, selisih antar penalti
  sangat kecil). **ρ final = −0,0301.**
- Holdout H: champion 1,013402 → kandidat **1,012888**; **Δ = −0,000515**;
  UB satu-sisi 95% **−0,000206** (CI 95% [−0,000872; −0,000139] — seluruhnya
  negatif: perbaikan nyata secara statistik); Brier 0,60658 → 0,60634;
  cakupan 1,000 = 1,000.
- Penutup diagnostik: pangsa seri prediksi 23,60% → **24,24%** (aktual
  25,19%) — ρ menutup ±40% celah seri. BTTS Δ −0,0000750. OU2.5 Δ tepat 0
  (sifat matematis τ Dixon–Coles: massa total gol tak berubah).
- **Gerbang PR 4: RETAIN.** Cek mean_delta GAGAL: Δ −0,000515 tidak
  mencapai ambang manfaat −0,005 (seluruh cek lain lolos: lantai sampel,
  UB CI < 0, cakupan, Brier). Perbaikan terbukti nyata tetapi ±10× di
  bawah ambang materialitas brief → champion dipertahankan; status
  READY_FOR_PROSPECTIVE_CONFIRMATION tidak diberikan karena gerbang
  tidak lolos. promotion_performed: false.

## Stop-gate Fase 4

- Artefak lengkap (diagnostik + Q2a): LULUS.
- Injeksi masa depan 22/22: LULUS (test:quant exit 0 — evaluator 22/22,
  kandidat L02 33/33, promote-gate 21/21, q0 19/19, q2a 11/11).
- Determinisme: dua run CLI — predictions/metrics/decision/
  candidate-artifact **byte-identik 4/4**.
- Isolasi L02: penjaga identik kedua run; hash live (manifest 47c6a62c…,
  calibrated_ratings 8630e4b2…, picks.db 5d354305…) = Fase 0.
- tsc 0 · lint:gate LOLOS.
