# Laporan Sprint A+B — Fase 3: Q0 Baseline Pembanding (Item 1)

Basis: master `fb21f7f` · Branch: `sprint/a-b-lanjutan` · Design beku:
`tasks/sprint-ab/q0-design.md` (commit `d3b0da9`, SEBELUM run) · Kode:
`lib/eval/q0-baselines.ts`, `scripts/evaluate-q0-baselines.ts`,
`tests/test-q0-baselines.ts` (19/19, dirantai ke test:quant) · Artefak:
`tasks/sprint-ab/evidence/q0-{freq,naive,elo}/` (design.md, run-manifest.json,
predictions.jsonl, metrics.json, decision.json, run.log) + log run kedua
`q0-determinism-run2.log`.

## Protokol

Evaluator PR 3, himpunan liga + irisan lipatan IDENTIK dengan generasi
champion PR 4 (V1 6.676 / V2 6.683 / H 6.708 baris). Jangkar wajib:
champion H = 1,0134022623271062 — **tereproduksi PERSIS** (anchor_ok true
di kedua run). Freq = frekuensi empiris latih per liga; NaivePoisson =
rerata gol venue per tim dari latih (fallback rerata liga, tanpa
shrinkage); Elo = sekuensial (1500/K20/HFA65/400), mapper bin 50 poin
dikalibrasi hanya pada latih lipatan.

## Hasil (log-loss; Δ = baseline − champion pada H, bootstrap blok pekan)

| Baseline | V1 | V2 | H | Δ H | UB 95% | CI 95% | Brier H | Cakupan |
|---|---|---|---|---|---|---|---|---|
| Champion | 1,014861 | 1,023657 | 1,013402 | — | — | — | 0,6066 | 1,000 |
| Q0-Freq | 1,069900 | 1,071546 | 1,070220 | +0,056818 | +0,061898 | [+0,0498; +0,0629] | 0,6479 | 1,000 |
| Q0-NaivePoisson | 1,046832 | 1,050405 | 1,040883 | +0,027481 | +0,031504 | [+0,0225; +0,0324] | 0,6255 | 1,000 |
| Q0-Elo | 1,040734 | 1,046352 | 1,036013 | +0,022611 | +0,028180 | [+0,0149; +0,0291] | 0,6217 | 1,000 |

Ketiga lantai berada di bawah champion secara meyakinkan (seluruh CI Δ
positif) — tangga pembanding brief sekarang lengkap: tidak ada kandidat
masa depan yang bisa tampak bagus hanya karena dibandingkan kekosongan.
Q0 bukan kandidat; decision.json setiap baseline = "baseline_only",
promotion_performed: false.

## Stop-gate Fase 3

- Artefak lengkap per baseline: LULUS.
- Uji injeksi masa depan evaluator 22/22: LULUS (test:quant exit 0;
  evaluator-kronologis 22/22, kandidat L02 33/33 di rantai yang sama,
  promote-gate 21/21, q0-baselines 19/19).
- Determinisme: CLI dijalankan dua kali — predictions.jsonl +
  metrics.json + decision.json **byte-identik 9/9 berkas**. (Run kedua
  pertama hilang karena /tmp terhapus saat runtime VM diganti ~22:44 WIB;
  diulang dengan output di workspace — hasil identik. Dicatat sebagai
  insiden lingkungan, bukan kegagalan protokol.)
- Isolasi L02/penjaga: guard berkas saji + stat DB identik sebelum/sesudah
  di kedua run.
- Hash live vs Fase 0: model-manifest.json 47c6a62c…, calibrated_ratings
  8630e4b2…, picks.db 5d354305… — **100% identik**.
- tsc 0 · lint:gate LOLOS.
