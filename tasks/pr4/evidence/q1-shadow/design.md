# PR 4 — Design Pra-Registrasi: Kandidat Q1 (Shadow)

**Status:** DITULIS DAN DI-COMMIT SEBELUM run evaluasi apa pun dijalankan.
Tidak ada angka hasil yang diketahui saat dokumen ini ditulis, kecuali angka
champion yang sudah terkunci dari PR 3 / K5.

**Sumber kontrak:** Brief "Data, Akurasi & Efisiensi" (24 Nov 2026), bab
P2 "Model Quant — Model yang Mudah Diuji" (tangga kandidat Q0→Q1→Q2→Q3→ML1)
dan bab "Metrik dan Bukti" (aturan keputusan), serta urutan PR di bab
"Promosi, Rollout, dan Serah Terima" butir 5: "PR 4+ · Kandidat. Satu
hipotesis quant per PR eksperimen. Jalur odds dan ML menunggu coverage yang
dibutuhkan. Simpan shadow terpisah."

## 1. Hipotesis (satu-satunya di PR ini)

Brief tidak menamai rung PR 4 secara eksplisit; ia menetapkan tangga.
Q0 adalah *baseline wajib* (champion terpin + pembanding murah) — bukan
kandidat yang bisa dipromosikan. Rung kandidat pertama adalah **Q1**:

> **Q1 · Poisson terpenalti di atas champion.** Regresi gol home dan away
> dengan offset log-rate dari champion:
> `log(λ_new) = log(λ_champion) + β_home · X_home`
> `log(μ_new) = log(μ_champion) + β_away · X_away`
> `loss = mean(PoissonNLL(home) + PoissonNLL(away)) + α · ‖β‖²`
> `X = [rest_diff, venue_neutral, promoted, form_residual, missing_flags]`

Hipotesis yang diuji: koreksi linear terpenalti atas log-intensitas champion,
dari fitur konteks pra-laga yang point-in-time, memperbaiki log-loss 1X2
out-of-sample pada holdout terkunci H melampaui ambang gate brief.

Q2 (ρ/dependensi), Q3 (hibrida pasar — coverage pasar belum ada: 4/829 pick),
dan ML1 (GBDT) TIDAK dikerjakan di PR ini.

## 2. Champion (baseline terpin, Q0)

- Level B evaluator PR 3 (`lib/eval/chronological-evaluator.ts`), konfigurasi
  `CHAMPION_CONFIG`: κ-fit 10, half-life 365, ρ 0, blend James-Stein κ-scale 2,
  mode compAvg `as-of`. Manifest aktif TIDAK disentuh.
- Angka acuan terkunci (PR 3): H Level B κ10 log-loss **1,0134022623271062**
  (n = 6.708); benchmark penutupan jujur Δ **+0,0325** (model 1,00943 vs
  closing 0,97692, n = 1.223, jendela 2025-10-04 → 2026-10-12).
- Run ini WAJIB mereproduksi angka H champion itu (±1e-9) sebagai jangkar
  sanity; bila tidak, berhenti dan selidiki sebelum menilai kandidat.

## 3. Universe dan lipatan

- Universe liga = universe K5 yang sama dengan mode `k5-holdout` PR 3:
  kompetisi `sm:%` dengan status registry `calibrated|partial` dan ≥120 laga
  selesai (63 liga, 44.528 laga).
- Lipatan kronologis evaluator: V1 (uji 55–70%), V2 (uji 70–85%),
  H (uji 85–100%), per liga, semantik harness.
- Peran blok (brief bab Evaluasi Kronologis): V1 = latih β; V2 = pilih
  konfigurasi (α); V1+V2 = refit final β; **H = holdout terkunci, dinilai
  sekali, sesudah β beku.**

## 4. Fitur (dibekukan di sini; semua point-in-time)

Cutoff fitur = tanggal laga (bagian tanggal `utc_date`), strictly-before —
konvensi yang sama dengan telemetri/form harness. Sumber: tabel `matches`
universe (urutan kanonik evaluator) + indeks prefix rata-rata kompetisi
evaluator. Untuk laga m (tim kandang H, tim tandang A), per sisi:

| # | Fitur | Definisi |
|---|---|---|
| 1 | `rest_adv` | Istirahat relatif: `clamp((restH − restA)/7, −3, 3)` untuk sisi home; negatifnya untuk sisi away. `rest` = selisih hari sejak laga tim sebelumnya (kompetisi universe mana pun) strictly sebelum tanggal m. Bila salah satu tim tak punya laga sebelumnya: nilai 0 dan `miss_rest = 1`. |
| 2 | `venue_neutral` | **Tidak teridentifikasi dari data yang tersedia** — tidak ada kolom venue netral di `matches` maupun sumber lain (kolom `venue` di `team_match_logs` adalah perspektif home/away tim, bukan netral). Nilai 0 untuk semua baris; **dikeluarkan dari fit** (β ditetapkan 0). Dicatat sebagai deviasi karena data, bukan penghapusan diam-diam: brief mendaftarkan fitur ini, datanya yang tidak ada. |
| 3 | `promoted` | 1 bila tim adalah pendatang promosi di kompetisi-musim laga ini: kompetisi punya musim sebelumnya (urutan musim per kompetisi menurut tanggal minimum) dengan ≥50 laga, dan tim memainkan 0 laga di kompetisi pada musim sebelumnya itu. Berlaku untuk semua laga tim di musim tersebut. Hanya memakai data sebelum musim berjalan → point-in-time aman. |
| 4 | `form_resid` | Rata-rata atas ≤6 laga terakhir tim strictly sebelum tanggal m (semua kompetisi universe) dari `(gol_dicetak − compAvgAsOf(kompetisi_laga_itu, tanggal_laga_itu))`, dengan compAvg = rata-rata gol per tim per laga point-in-time evaluator (termasuk fallback LEGACY_COMP_AVG-nya). Di-cap ke [−2, 2]. Butuh ≥3 laga sebelumnya; bila kurang: nilai 0 dan `miss_form = 1`. Definisi berbasis gol (bukan xG) karena xG hanya ada di 34.474/83.426 log (±41%) — cakupan fitur harus penuh. |
| 5 | `miss_rest`, `miss_form` | Bendera missing sesuai definisi di atas (`miss_rest` level laga, sama di kedua sisi; `miss_form` per sisi). |

Vektor per sisi yang DI-FIT: `[rest_adv, promoted, form_resid, miss_rest,
miss_form]` (5 koefisien per sisi, 10 total). Tanpa intersep — sesuai rumus
brief (offset murni dari champion). Transformasi bersifat tetap (skala/cap
tertulis di atas), tidak di-fit dari data.

**Batas intensitas (didaftarkan sebelum H):** λ_new, μ_new di-clamp ke
[0,05; 6,0]. **Kebijakan abstain:** bila champion jatuh ke fallback
(fit liga null / matriks fallback), kandidat abstain identik (menyalin
probabilitas fallback champion) → cakupan kandidat = cakupan champion
menurut konstruksi; diverifikasi empiris di run.

**Ablasi (brief: "Ukur ablation form/xG karena champion sudah punya
blend"):** pada α terpilih, fit ulang di V1 TANPA kolom `form_resid`;
bandingkan Poisson NLL di V2 terhadap model penuh. Diagnostik saja —
bukan kandidat kedua, tidak masuk gate.

## 5. Protokol fit β dan pemilihan α

- Baris latih/validasi = prediksi Level B champion out-of-sample pada blok
  uji V1 dan V2 di universe §3, beserta fitur §4 dan skor aktual.
- Grid α (didaftarkan): **{0,3; 1; 3; 10; 30; 100}** atas loss rata-rata
  per laga (kedua sisi digabung) + α‖β‖².
- Pemilihan: fit β(α) di V1 → α* = argmin Poisson NLL rata-rata di V2.
  Refit β di V1+V2 pada α*. Bekukan. Semua α yang dicoba dicatat.
- Optimizer: Newton dari β = 0, toleransi gradien 1e-10, maks 100 iterasi —
  deterministik (tanpa acak, tanpa jam).
- Stabilitas: β(V1) pada α* juga dilaporkan di samping β(V1+V2).

## 6. Irisan evaluasi (identik untuk champion dan kandidat)

1. **Headline H** (endpoint primer gate): 6.708 laga H universe §3.
   Metrik: log-loss 1X2 (konvensi harness terjepit — konvensi angka
   terkunci; log-loss mentah juga dilaporkan), Brier, ECE, cakupan,
   fallback. Δ berpasangan per laga → bootstrap blok pekan ISO,
   5.000 resample, **seed 20261124** (konvensi PR 3), lewat
   `blockBootstrapDelta` repo.
2. **Benchmark penutupan** (irisan PR 3, set pasangan dump jalur lama,
   `tasks/pr3/evidence/cb-pairs-dump.json`): 1X2 n = 1.223 + OU2.5 n = 561,
   konvensi −ln p tanpa jepit. Ketersediaan β mengikuti waktu lipatan
   (walk-forward jujur): laga lipatan H → β(V1+V2); lipatan V2 → β(V1, α*)
   (di set ini 0 laga); lipatan V1 → kandidat = champion (belum ada OOS
   lebih awal untuk melatih β); tanpa lipatan → fallback champion.
   Dilaporkan pooled + subset lipatan-H saja (n = 663) sebagai baris
   sekunder tempat kandidat aktif penuh.
3. **Irisan pasar sekunder di H:** Poisson NLL gol (metrik native
   kandidat), log-loss biner OU2.5, log-loss biner BTTS — champion vs
   kandidat pada laga yang sama.

## 7. Aturan keputusan (gate brief, fail-closed)

Memakai mesin repo yang sudah ada, `applyKappaDecision`
(`lib/quant/experiment-stats.ts`, ambang = brief bab Metrik dan Bukti):

- Δ = LL_kandidat − LL_champion pada H ≤ **−0,005**;
- batas atas CI satu sisi 95% (bootstrap) < **0**;
- penurunan cakupan ≤ **2 poin persentase**;
- kenaikan Brier ≤ **0,002**;
- lantai sampel: ≥ **1.000** laga unik dan ≥ **20** blok pekan.

Pemetaan putusan mesin → kosakata brief (`decision.json`):
`promote` → **eligible_for_shadow** (gate LOLOS — informasi untuk keputusan
Arandi); `retain` → **retain** (gate GAGAL); `inconclusive` →
**inconclusive** (sampel/bukti kurang).

**PR ini TIDAK mempromosikan apa pun dalam keadaan apa pun.** Manifest
aktif, artefak saji, dan picks.db tidak ditulis. Kandidat hidup hanya
sebagai artefak di `tasks/pr4/evidence/`.

## 8. Artefak wajib (brief bab Evaluasi Kronologis)

Di `tasks/pr4/evidence/q1-shadow/`:
`design.md` (salinan dokumen ini) · `run-manifest.json` (git SHA, hash
input, konfigurasi, seed, hash penjaga sebelum/sesudah) ·
`predictions.jsonl` (1 baris per fixture H: champion + kandidat + fitur +
hasil) · `metrics.json` · `decision.json` · `candidate-artifact.json`
(β beku + α* + hash) · `run.log`.

## 9. Penjaga isolasi shadow

CLI mencatat sha256 `data/model-manifest.json` + `data/model-artifacts/*.json`
dan ukuran+mtime `picks.db`, `analysis_snapshots.db`,
`thestats_dataset.db` di direktori data produksi SEBELUM dan SESUDAH run;
keduanya harus identik dan dicatat di run-manifest. Semua tulisan kandidat
hanya di worktree `app-football-pr4` bawah `tasks/pr4/`. DB produksi dibaca
`readOnly`.
