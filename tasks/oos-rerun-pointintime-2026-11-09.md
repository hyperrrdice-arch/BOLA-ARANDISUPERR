# Re-run OOS point-in-time — 2026-11-09 (audit T5)

Hasil `scripts/backtest-walkforward.ts` setelah normalisasi xG dibuat
point-in-time (commit `61e9470`). File hasil: `tasks/oos-results.json`
(run ini) vs `tasks/oos-results-pre-t5-2026-11-09.json` (run 2026-11-04).

## Angka held-out (lipatan H, tak pernah dipakai tuning)

| Level | Konfigurasi | n | Log-loss | Slope | ECE |
|---|---|---:|---:|---:|---:|
| A | baseline (kfit:0) | 6.317 | 1,0436 | 0,541 | 0,0196 |
| A | winner (hl365, rho 0, **kfit:20**) | 6.317 | **1,0179** | 1,125 | 0,0135 |
| A | naive rata-rata liga | 6.317 | 1,0697 | 0,816 | 0,0085 |
| B | produksi (κ blend ×1) | 6.317 | 1,0251 | 0,649 | 0,0208 |
| B | winner (**κ blend ×2**) | 6.317 | **1,0092** | 1,146 | 0,0170 |

Validasi V2 Level B: winner κ×2 = 1,0246 (terbaik di keluarganya;
κ×1 winner 1,0285; produksi κ×1 1,0378). Validasi Level A: kfit:20
1,0268 vs kfit:10 1,0294 vs kfit:5 1,0333 (n=12.580).

`invalid_fit_fallbacks`: **26** prediksi (dari seluruh run) dinilai
uniform karena fit-nya ditolak lib sebagai patologik — terhitung
terbuka, sesuai konvensi harness pasca-T2/T5.

## Perbandingan dengan run lama — baca dengan caveat ini

Run lama (2026-11-04, MASIH mengandung leakage): A winner 1,0295 /
slope 0,865; B winner κ×2 1,0202 / slope 0,953; n held-out 6.661.

Angka baru terlihat LEBIH BAIK, tapi selisihnya **tidak bisa
diatribusikan ke perbaikan leakage saja**, karena empat hal berubah
bersamaan:

1. Leakage ditutup (point-in-time) — efek terisolasinya tidak diukur
   (tidak ada run A/B dataset-sama yang hanya mengganti rata-rata).
2. Dataset berubah: cakupan kini 59 liga / 41.935 laga (dulu 63 /
   45.866) setelah dedup kanonik; n held-out 6.317 (dulu 6.661).
3. Matrix Dixon-Coles kini benar untuk fit ekstrem (T2) — dulu fit
   ekstrem dinilai dari matrix sampah ternormalisasi.
4. Konvensi fallback uniform untuk 26 fit patologik.

Klaim yang sah: **angka di tabel atas adalah angka point-in-time yang
berdiri sendiri**; angka lama pensiun, bukan pembanding sepadan.

## Konsekuensi produksi

- **κ blend ×2 TERKONFIRMASI ulang** di validasi + held-out → konstanta
  produksi (16/28/32) tetap berdiri di atas bukti. Komentar di
  ratings-loader diperbarui ke angka run ini.
- **Slope winner kini > 1 (1,125 / 1,146)**: prediksi held-out sedikit
  UNDER-confident (probabilitas terlalu konservatif), berbalik dari
  run lama (0,865 / 0,953). Log-loss tetap membaik. Observasi, bukan
  alarm — dicatat untuk pemantauan run berikutnya.
- **KEPUTUSAN TERBUKA (owner)**: winner Level A bergeser kfit:10 →
  kfit:20 (margin validasi 0,0026 LL). Produksi masih memakai shrinkage
  fit κ=10 dari adopsi 2026-11-04. Mengganti ke 20 = tuning model —
  TIDAK dilakukan sepihak; menunggu keputusan Arandi.
