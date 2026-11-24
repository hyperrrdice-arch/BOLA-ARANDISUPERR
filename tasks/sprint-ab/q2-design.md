# Design Pra-Registrasi — Q2a ρ Dixon–Coles Terpool (Item 2, Sprint A+B)

Di-commit SEBELUM run Q2a. Langkah diagnostik (wajib pertama menurut
brief) sudah selesai: `tasks/sprint-ab/evidence/q2-diagnostic/diagnostic.json`
(n = 6.708 baris H; jangkar champion 1,0134022623271062 tereproduksi persis).

## Temuan diagnostik yang memotivasi Q2a

- Seri: prediksi 23,60% vs aktual 25,19% (gap +1,60pp) — champion
  kekurangan massa seri.
- Sel rendah: 0-0 +0,26pp · 0-1 −0,62pp · 1-0 −0,16pp · 1-1 +1,03pp
  (aktual − prediksi). Pola ini persis tanda tangan ρ < 0 pada
  τ Dixon–Coles: τ(0,0) = 1−λμρ dan τ(1,1) = 1−ρ naik, τ(0,1) = 1+λρ dan
  τ(1,0) = 1+μρ turun.
- BTTS dekat (prediksi 55,20% vs aktual 55,53%).
- Ekor tinggi model sedikit terlalu berat (total ≥6: prediksi 8,58% vs
  aktual 7,14%).

## Keputusan Q2b (Negative Binomial): SKIPPED_BY_DIAGNOSTIC_EVIDENCE

Dispersi Pearson terhadap rerata Poisson terpasang (λ, μ champion):
gol kandang **0,956**, gol tandang **1,012**, total **0,982** — tidak ada
overdispersi konsisten; kandang dan total justru sedikit UNDERdispersi.
Var/mean marginal total (1,022) adalah artefak heterogenitas rerata antar
laga, hilang sesudah dikondisikan pada λ/μ. Syarat perlu brief untuk Q2b
tidak terpenuhi → Q2b tidak dijalankan; opsi bivariat dicatat sebagai
kemungkinan masa depan di luar sprint ini.

## Kandidat Q2a (beku)

- Bentuk: SATU ρ terpool untuk semua liga, diterapkan pada λ/μ champion
  (Level B evaluator PR 3) lewat `matrixProbs(λ, μ, ρ)`; τ dari
  `lib/quant/dixon-coles.ts` (konvensi kanonis repo).
- Likelihood fit: Σ [poissonLogProb(λ, hs) + poissonLogProb(μ, as) +
  log τ(hs, as, λ, μ, ρ)] − penalti·ρ², ρ ∈ [−0,30; 0,30]; τ ≤ 0 pada
  baris mana pun → tidak layak (−∞). Optimasi: pindai grid 0,001 lalu
  perhalus 0,0001 (deterministik).
- Disiplin walk-forward (meniru Q1): ρ untuk lipatan V2 di-fit pada baris
  UJI V1 (λ/μ out-of-sample); ρ untuk H di-fit pada baris uji V1+V2.
  Lipatan V1: belum ada baris OOS lebih awal → ρ = 0 (identik champion).
  Grid penalti {0, 25, 100, 400} dipilih oleh kinerja V2 dari ρ fit-V1
  (seri → penalti lebih besar).
- Baris fallback champion → kandidat abstain (identik champion), seperti Q1.
- Gerbang: aturan PR 4 persis (applyKappaDecision + blockBootstrapDelta
  5.000, seed 20261124; Δ ≤ −0,005, UB CI < 0, cakupan, Brier, lantai
  sampel) pada holdout H + jangkar champion terkunci.
- **Status akhir bila gerbang lolos: READY_FOR_PROSPECTIVE_CONFIRMATION**
  (perintah brief sprint — H sudah dipakai K5/PR 3/PR 4; TIDAK ada
  promosi, tidak ada jalur promosi di sprint ini). Bila gagal: retain.

## Artefak

`tasks/sprint-ab/evidence/q2a-rho/`: design.md (salinan), run-manifest.json,
predictions.jsonl, metrics.json, decision.json, candidate-artifact.json,
run.log. Determinisme: dua run → predictions/metrics/decision
byte-identik. Penjaga isolasi L02 seperti PR 4.
