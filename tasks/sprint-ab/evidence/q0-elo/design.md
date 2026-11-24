# Design Pra-Registrasi — Q0 Baseline Pembanding (Item 1, Sprint A+B)

Di-commit SEBELUM run apa pun (konvensi PR 4). Brief: Agent_Brief_Sprint_A_B_Lanjutan.md Fase 3 + brief induk hal. 10 (P2 · Q0).
Q0 BUKAN kandidat promosi — ia lantai pembanding wajib sebelum kandidat mana pun dinilai lagi.

## Protokol (mengikat)

- Evaluator: PR 3 `lib/eval/chronological-evaluator.ts`, mode as-of, konfigurasi champion.
- Universe + himpunan liga + irisan lipatan: IDENTIK dengan generasi champion di
  `scripts/evaluate-kandidat-q1.ts` (liga registry calibrated/partial, ≥120 laga;
  lipatan H hanya liga dengan fit κ10 DAN κ20 tidak null). Baris uji H harus
  mereproduksi jangkar champion terkunci PR 3: log-loss Level B H =
  1,0134022623271062 (toleransi 1e-9). Jangkar gagal → run tidak sah, berhenti.
- Metrik: konvensi harness (log-loss terjepit 1e-12) via `summarizePredictions`;
  Δ berpasangan vs champion per blok pekan ISO, `blockBootstrapDelta`
  (5.000 resample, seed 20261124) + `applyKappaDecision` hanya sebagai
  pembaca angka (Q0 tidak digerbang — ia baseline, bukan kandidat).
- Data: DB produksi dibaca readOnly; tulisan hanya di direktori evidence.
  Hash berkas saji + ukuran/mtime DB dicatat sebelum/sesudah (penjaga L02).

## Tiga baseline (semua point-in-time)

1. **Q0-Freq** — per liga: frekuensi empiris H/D/A dari irisan LATIH lipatan
   saja (tanpa penghalusan), diterapkan ke semua laga uji lipatan itu.
   Latih kosong → uniform [1/3,1/3,1/3] (tidak terjadi pada himpunan liga ini).
2. **Q0-NaivePoisson** — per liga, dari irisan latih: λ = rerata gol kandang
   tim kandang di latih (laga liga itu), μ = rerata gol tandang tim tandang
   di latih; tim tanpa laga latih di venue itu → rerata venue liga.
   TANPA shrinkage (naif sesuai nama). Probabilitas dari `matrixProbs(λ, μ, 0)`.
3. **Q0-Elo** — Elo sekuensial per liga atas seluruh garis waktu liga:
   rating awal 1500, K=20, keunggulan kandang 65 poin, skala 400 (konstanta
   baku, dinyatakan a priori — bukan hasil fit). Setiap laga diprediksi
   SEBELUM rating diperbarui oleh hasilnya (predict-then-update, termasuk
   di dalam blok uji). Mapper gap→1X2 dikalibrasi HANYA pada laga latih
   lipatan: gap (rating kandang + 65 − rating tandang) dibin lebar 50 poin
   pada grid [−600, 600], frekuensi H/D/A empiris per bin + penghalusan
   Laplace +1; bin kosong → frekuensi keseluruhan latih.

## Artefak per baseline

Direktori `tasks/sprint-ab/evidence/q0-<freq|naive|elo>/`:
design.md (salinan file ini), run-manifest.json, predictions.jsonl,
metrics.json, decision.json (berisi perbandingan vs champion; keputusan
selalu "baseline_only" — bukan kandidat), run.log.

## Determinisme

CLI dijalankan dua kali (direktori -rerun); predictions.jsonl +
metrics.json + decision.json harus byte-identik (run-manifest dikecualikan:
memuat generated_at). Uji sifat point-in-time per baseline ada di
tests/test-q0-baselines.ts (prediksi tidak berubah oleh laga masa depan).
