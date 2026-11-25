# ML1 Shadow A/B — Design Pra-Registrasi (Tahap A: Form/Elo; Tahap B: +Shots/SoT Proxy As-Of)

**Status:** DITULIS DAN DI-COMMIT SEBELUM run ML1 apa pun dijalankan (Fase 0).
Tidak ada angka hasil ML1 yang diketahui saat dokumen ini ditulis. Angka yang
dikutip hanyalah jangkar champion yang sudah terkunci dari PR 3/PR 4 dan
temuan audit Item 21.

**Sumber kontrak:** Brief pemilik `Agent_Brief_Ml1_Shadow_Ab.md` (25 Nov 2026),
putusan audit Item 21 (`tasks/reports/item21-xg-lineup-audit.md`), protokol
PR 4 (`tasks/pr4/design.md` + `scripts/evaluate-kandidat-q1.ts`), evaluator
kronologis PR 3 (`lib/eval/chronological-evaluator.ts`), dan mesin gate repo
(`lib/quant/experiment-stats.ts::applyKappaDecision`).

**Sifat:** 100% SHADOW / OFFLINE. Tidak mengubah champion live, tidak menulis
DB produksi (semua bacaan `mode=ro` / `readOnly`), tidak mempromosikan model,
tidak menyentuh cron/web. Status maksimal kandidat:
`READY_FOR_PROSPECTIVE_CONFIRMATION`.

---

## 1. Hipotesis

Di atas offset champion (`base_margin`), koreksi GBDT Poisson dangkal dari
fitur point-in-time — (A) form/Elo murni, (B) A + proxy shots/SoT as-of —
memperbaiki log-loss 1X2 out-of-sample pada holdout terkunci H melampaui
ambang gate PR 4. Ablasi bersih B − A mengukur kontribusi murni shots/SoT.

**Non-goals (brief §0):** xG asli (Item 21: NO-GO), lineup (PARKIR),
quote/odds pasar (Tahap C terpisah), tuning apa pun di H.

## 2. Backend ML (Fase 0 — keputusan terkunci)

- Urutan preferensi brief: lightgbm → xgboost → sklearn
  `HistGradientBoostingRegressor(loss='poisson')`.
- Host: Python 3.12.3 sistem externally-managed (PEP 668 menolak
  `pip install --user`). Backend dipasang di venv persisten
  `~/workspace/tools/ml1-venv` (di luar repo; selamat dari runtime
  replacement). Interpreter resmi sprint:
  `/home/hatch/workspace/tools/ml1-venv/bin/python`.
- **Terpilih: lightgbm 4.7.0** (API native `lgb.train`/`lgb.Dataset`;
  API sklearn lightgbm tidak dipakai karena scikit-learn tidak terpasang).
  numpy 2.5.5, scipy 1.18.1, pandas 3.1.1 (pandas tidak dipakai di jalur
  latih; jalur latih = stdlib + numpy + lightgbm).
- **Semantik offset (TERVERIFIKASI empiris di Fase 0, lihat
  `evidence/fase0/environment.json`):** `Booster.predict()` TIDAK
  menyertakan `init_score`. Komposisi resmi:
  `lambda = exp(init_score + raw_score)`, dengan
  `init_score = log(lambda_champion)`. Uji pemulihan koreksi tertanam:
  corr(raw, koreksi benar) = 0,9624; NLL komposisi < NLL offset-only.
- Determinisme: `seed` tetap, `num_threads=1`, `deterministic_force=true`;
  smoke test 2× run menghasilkan hash prediksi identik byte-per-byte.

## 3. Universe, lipatan, champion

- Universe = universe PR 3 penuh: `matches` dengan
  `competition_id LIKE 'sm:%'`, `status='finished'`, skor non-null, urutan
  kanonik `competition_id, utc_date` — 69.065 laga, 103 kompetisi
  (identik replika audit Item 21).
- Lipatan per kompetisi (evaluator): V1 = [55%, 70%), V2 = [70%, 85%),
  H = [85%, 100%).
- Champion = Level B evaluator PR 3, `CHAMPION_CONFIG` (κ-fit 10,
  half-life 365, ρ 0, κ-scale 2, compAvg `as-of`). Manifest aktif TIDAK
  disentuh. Jangkar berkas: sha256 `data/model-manifest.json` =
  `a6cf947a…`, `data/calibrated_ratings.json` = `be93286a…` (dicatat Fase 0,
  wajib identik di akhir sprint).
- Baris generasi per lipatan: baris uji lipatan dari liga yang fit
  lipatannya (κ10) non-null (aturan `genRows` PR 4; syarat paritas κ20
  khusus-K5 PR 4 tidak dipakai — dicatat sebagai deviasi sadar). Jumlah
  liga/baris yang terbuang karena fit null dicatat di metrics.
- Jangkar sanity champion: probabilitas champion per baris H pada irisan
  baris yang sama dengan artefak beku PR 4
  (`tasks/pr4/evidence/q1-shadow/predictions.jsonl`) WAJIB cocok ±1e-9
  (termasuk log-loss H irisan itu = 1,0134022623271062). Bila tidak:
  berhenti dan selidiki sebelum menilai kandidat.
- Kebijakan abstain: bila champion jatuh ke fallback matriks, kandidat
  abstain identik (menyalin λ/μ/probabilitas champion) → cakupan kandidat
  = cakupan champion menurut konstruksi; diverifikasi empiris di run.

## 4. Fitur (dibekukan; semua point-in-time, cutoff = tanggal laga, strictly-before)

Offset (kedua tahap, kedua head): `base_margin_home = log(λ_champion)`,
`base_margin_away = log(μ_champion)` — diserahkan ke LightGBM sebagai
`init_score` per baris.

### ML1-A — vektor fitur per laga (urutan kolom beku)

| # | Kolom | Definisi |
|---|---|---|
| 1–4 | `form_gf5_home`, `form_ga5_home`, `form_gf10_home`, `form_ga10_home` | Rata-rata gol dicetak/kemasukan tim kandang atas 5 / 10 laga terakhirnya (semua kompetisi universe) strictly sebelum tanggal laga. Bila riwayat < jendela: rata-rata atas yang ada. Bila 0: nilai 0. |
| 5–8 | `form_gf5_away`, `form_ga5_away`, `form_gf10_away`, `form_ga10_away` | Sama untuk tim tandang. |
| 9–11 | `elo_home`, `elo_away`, `elo_diff` | Elo sekuensial **per kompetisi** konstruksi Q0-Elo persis (`lib/eval/q0-baselines.ts`: start 1500, K=20, HFA=65, skala 400), predict-then-update atas daftar laga liga terurut waktu; nilai = rating pra-laga. `elo_diff = elo_home − elo_away`. |
| 12 | `rest_adv` | Persis semantik Q1: `clamp((restH − restA)/7, −3, 3)`; rest = hari sejak laga tim sebelumnya (kompetisi universe mana pun) strictly sebelum tanggal laga. |
| 13 | `venue_neutral` | **Tidak teridentifikasi dari data** (sama seperti PR 4): selalu 0. Dicatat sebagai deviasi karena data, bukan penghapusan diam-diam. |
| 14–15 | `promoted_home`, `promoted_away` | Persis semantik Q1 (`Q1FeatureExtractor.promoted`, berbasis kolom `season` + musim sebelumnya ≥50 laga). |
| 16 | `miss_rest` | 1 bila salah satu tim tanpa laga sebelumnya (semantik Q1). |
| 17–18 | `miss_form_home`, `miss_form_away` | 1 bila jumlah laga lampau tim < 3. |
| 19–20 | `n_prior_home`, `n_prior_away` | Jumlah laga lampau tim (universe) strictly sebelum tanggal laga. |

### ML1-B = ML1-A + kolom 21–32 (proxy shots/SoT as-of)

Sumber: `team_match_logs_canonical` (85.194 baris), seri per tim dikunci
`team_id` (format `tm_*`, sama dengan `matches.home_team_id/away_team_id`),
predikat `match_date < tanggal laga` (tanggal saja — konvensi audit
Item 21). Per sisi (home/away):

| # | Kolom | Definisi |
|---|---|---|
| 21–28 | `shots_for_*`, `shots_against_*`, `sot_for_*`, `sot_against_*` | Rata-rata atas ≤10 log lampau terakhir tim dengan stat non-null. **Syarat riwayat minimum ≥3** log lampau ber-stat: bila < 3, nilai 0 dan flag sisi itu 0. |
| 29–30 | `n_prior_shots_home`, `n_prior_shots_away` | Jumlah log lampau tim dengan `shots_for` non-null (tanpa cap). |
| 31–32 | `has_prior_shots_home`, `has_prior_shots_away` | 1 bila `n_prior_shots_*` ≥ 3 (syarat audit Item 21), else 0. |

## 5. Model & protokol latih (dibekukan)

- Dua head GBDT Poisson independen: head home memprediksi `home_score`
  dengan offset `log(λ_champion)`; head away memprediksi `away_score`
  dengan offset `log(μ_champion)`. Kedua head memakai vektor fitur laga
  yang sama (ML1-A atau ML1-B).
- Intensitas kandidat: `λ_new = clamp(exp(log λ_champ + raw_home), 0.05, 6.0)`,
  `μ_new = clamp(exp(log μ_champ + raw_away), 0.05, 6.0)` (batas intensitas
  sama dengan yang didaftarkan PR 4). Probabilitas 1X2/O/U dari matriks
  Poisson/Dixon-Coles evaluator yang sama persis dengan champion
  (`matrixProbs`, ρ=0).
- Parameter tetap: `objective='poisson'`, `max_depth=3`,
  `learning_rate=0.05`, `min_data_in_leaf=50`, `seed=20261125`,
  `num_threads=1`, `deterministic_force=true`.
- **Grid seleksi (satu-satunya yang boleh dipilih, hanya dari V1→V2):**
  `num_boost_round ∈ {100, 200, 400}` × `lambda_l2 ∈ {1, 10}` (6 konfigurasi).
  Skor seleksi = mean Poisson NLL (home+away, tanpa penalti, λ/μ kandidat
  ter-clamp) pada baris V2 dari model yang dilatih di V1. Terendah menang;
  seri → `num_boost_round` lebih kecil, lalu `lambda_l2` lebih besar.
- Refit konfigurasi terpilih di V1+V2 → nilai H **satu kali**.
- Determinisme byte-identik: seluruh jalur latih+prediksi dijalankan 2×
  (proses terpisah); hash `predictions` + berkas masukan metrics WAJIB
  identik.

## 6. Gate & irisan (dibekukan)

- Gate resmi = `applyKappaDecision` repo atas H **pooled** (universe
  penuh): Δ mean ≤ −0,005; UB bootstrap satu-sisi 95% < 0; penurunan
  cakupan ≤ 0,02; kenaikan Brier ≤ 0,002; lantai sampel n ≥ 1000 &
  blok ≥ 20. Bootstrap blok berpasangan per pekan ISO, 5.000 resample,
  seed 20261124 (sama dengan PR 3/PR 4).
- Pemetaan keputusan brief: mesin `promote` →
  `READY_FOR_PROSPECTIVE_CONFIRMATION`; `retain`/`inconclusive` →
  `RETAIN_CHAMPION`. **Tidak ada promosi di sprint ini dalam kondisi apa
  pun.**
- Irisan Fase 4 (H, diagnostik — bukan dasar gate): (1) Pooled;
  (2) Liga Kompetitif/Terkalibrasi = status registry `calibrated|partial`;
  (3) Friendlies/Uncalibrated = status `uncalibrated` atau tanpa baris
  registry. Per irisan: Champion vs ML1-A vs ML1-B (n, log-loss, Δ,
  UB CI 95%, Brier).
- Ablasi bersih: Δ(ML1-B) − Δ(ML1-A) pada pooled & liga kompetitif
  (dari baris berpasangan yang sama).

## 7. Artefak & isolasi

- Per model: `tasks/ml1/evidence/ml1-a/` dan `tasks/ml1/evidence/ml1-b/`
  berisi `design.md` (salinan design ini), `run-manifest.json`,
  `predictions.jsonl` (format baris identik Q1), `metrics.json`,
  `decision.json`, `candidate-artifact.json`, `run.log`.
- Penjaga isolasi pola PR 4: snapshot sha256 berkas saji (manifest +
  artefak ratings) dan ukuran/mtime DB sebelum/sesudah setiap run,
  dicatat di run-manifest; WAJIB identik.
- Uji injeksi masa depan: suite `tests/test-ml1-features.ts` — 22 cek atas
  ekstraktor ML1-A **dan** ML1-B (invarians terhadap penanaman laga/log
  masa depan ekstrem + kepekaan terhadap penanaman masa lalu yang sah).
  Stop-gate Fase 1: 22/22 PASS + determinisme ekstraksi (2 run → hash
  fitur identik). Stop-gate Fase 2/3: + L02 (`tests/test-kandidat-q1.ts`)
  33/33 PASS.
