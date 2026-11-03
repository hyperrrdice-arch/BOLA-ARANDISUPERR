# Model Audit — football-agent (Fase 2 overhaul backend)

> Inventaris semua komponen matematis di jalur analisis: cara kerja,
> parameter, ASAL nilai parameter (fitted / asumsi / warisan), dan risiko
> overfitting. Vonis (kept / fixed / reverted) diisi dari bukti walk-forward
> out-of-sample Fase 3 (`scripts/backtest-walkforward.ts`,
> `tasks/oos-results.json`) — bukan dari rasa. Status awal: **DIAUDIT**;
> baris bertanda ⏳ menunggu hasil harness.

## Ringkasan parameter global

| # | Komponen | File | Parameter kunci | Asal nilai | Risiko overfit |
|---|---|---|---|---|---|
| 1 | Fit IPF attack/defense | `scripts/calibrate-ratings.ts` | half-life decay **365 hari** | ASUMSI (dipilih saat sprint) | Sedang — ⏳ diuji grid {180,365,730,∞} |
| 2 | Rho Dixon-Coles (liga SM) | `calibrate-ratings.ts` → JSON | **rho = 0** untuk semua 28 liga SM | ASUMSI (placeholder sprint) | Sedang — ⏳ diuji {0, global, fitted/liga} |
| 3 | Rho liga legacy | JSON (fit CSV lama) | −0.12…+0.02 per liga (E0 −0.11) | FITTED (data football-data, pra-2026) | Rendah-sedang; tidak di-fit ulang di fase ini |
| 4 | leagueAvgGoals / homeAdvantage | fit IPF | = mean gol away terbobot; HA = μH/μA terbobot | FITTED per liga | Rendah |
| 5 | Gerbang kalibrasi | `calibrate-ratings.ts` | uji skala ≤2% (tak terbobot) + cakupan telemetri ≥80% + min 30 match | KEPUTUSAN PRD; uji skala tak-terbobot vs fit terbobot = mismatch metodologis (36 liga partial semuanya gagal di sini pada cakupan 100%) | Bukan overfit — gerbang terlalu ketat secara konstruksi; ⏳ ditambah gerbang OOS |
| 6 | James-Stein shrinkage (blend telemetri) | `lib/quant/ratings-loader.ts` | κ = **8** (xG) / **14** (gol) / **16** (tanpa telemetri); w = n/(n+κ) | ASUMSI ("bimodal kappa", tanpa fit tercatat) | Sedang — ⏳ diuji skala κ {×0.5, ×1, ×2} di jalur blend |
| 7 | Window telemetri rolling | `team-telemetry.ts`, planner | **6 laga** terakhir, rata-rata datar (tanpa decay di dalam window) | ASUMSI desain | Rendah-sedang |
| 8 | Syarat xG untuk blend | `ratings-loader.ts` | xG dipakai bila **≥3** sampel xG; else gol | ASUMSI | Rendah |
| 9 | Clamp parameter | `ratings-loader.ts` | attack/defense hasil blend di-clamp ≥0.5 (away attack ≥0.4); λ,μ ≥ 0.2 di `dixon-coles.ts` | Pengaman numerik | Bukan overfit; memotong ekor distribusi — dicatat |
| 10 | Dixon-Coles core | `lib/quant/dixon-coles.ts` | matriks 11×11 (maxGoals 10), τ(rho) 4 sel, normalisasi Σ=1 | Standar literatur (Dixon & Coles 1997) | Rendah — implementasi terverifikasi aritmetikanya |
| 11 | Shin vig-strip | `lib/quant/vig-stripping.ts` | bisection z ∈ [0, 0.4], 40 iterasi | Standar literatur (Shin 1991/93) | Rendah. Catatan: hanya dipakai pada odds yang tiba via validator/wire |
| 12 | Kelly staking | `lib/quant/kelly.ts` | quarter-Kelly (0.25), cap per bet 4.0%, cap portofolio per match 5.0% | KEPUTUSAN risiko owner (bukan parameter statistik) | Bukan overfit. ⚠️ ARCHITECTURE §12: simulasi Kelly historis = semua strategi bangkrut vs closing line — staking tidak menciptakan edge |
| 13 | Fallback guard | `lib/quant/fallback-guard.ts` | edge minimum **50%** untuk sisi fallback; bobot shrinkage <0.25 + 0 sampel xG = fallback | KEPUTUSAN owner (21 Okt) | Bukan overfit — gerbang kualitas data |
| 14 | Diskon promosi divisi-2 | `ratings-loader.findTeamRating` | attack ×0.85, defense ×1.20; fallback lintas-liga TANPA diskon | ASUMSI tulisan tangan | Sedang — tidak diuji fase ini (dicatat sebagai utang terukur) |
| 15 | Scaling UCL | `ratings-loader` | koefisien UEFA Q(L) 11 liga, attack ×√Q, defense ÷√Q; pseudo-liga UCL (avg 2.04, rho −0.05) | ASUMSI + ablasi lama "UNDECIDED n=50" (ARCHITECTURE §10) | Sedang — kompetisi piala di luar parameterisasi registry; tidak diuji fase ini |
| 16 | Special markets (headers/corners/cards) | `lib/quant/special-markets-engine.ts` | benchmark per liga tulisan tangan (7 divisi + DEFAULT), eksponen faktor 0.6/0.4, floor 0.25, cap 2.2, home ×1.1/away ×0.9 header, corners ×1.05/×0.95 | ASUMSI (benchmark E0/SP1/… dari era TheStats) | **Tinggi untuk liga non-7** (jatuh ke DEFAULT generik). ⚠️ ARCHITECTURE §12: special markets Brier 0.30 vs base rate 0.25 = tidak ada skill terukur. Di luar jalur 1X2; tidak di-tuning fase ini — direkomendasikan owner menonaktifkan klaim EV-nya |
| 17 | Momentum | `lib/quant/momentum.ts` | ambang datar 0.34 gol / 0.25 xG; window 3v3 | Heuristik eksplisit | KONTEKS SAJA — dilarang mengubah probabilitas (terverifikasi di kode planner) |
| 18 | Half-profile | `lib/quant/half-profile.ts` | pita seimbang 0.15, strong 0.35, min 3 sampel | Heuristik eksplisit | KONTEKS SAJA — idem |
| 19 | Luck regression | `lib/quant/luck-regression.ts` | ambang status ±0.35 net luck/laga, window 6 | Heuristik eksplisit | KONTEKS SAJA — masuk metadata sindikat, bukan probabilitas |
| 20 | Normalisasi xG lintas kompetisi | `lib/db/team-telemetry.ts` | bobot = targetAvg/logAvg dari `COMPETITION_AVG_GOALS` (7 entri tulisan tangan) | ASUMSI sebagian | Sedang — diperbaiki Fase 1: rata-rata dihitung dari store (terukur) |

## Temuan audit per komponen (bukti, bukan vonis)

### 1–2. Fit IPF + rho (inti — yang menentukan akurasi 1X2)
- Fit IPF di `calibrate-ratings.ts` benar secara konstruksi: iterasi
  multiplicative update attack/defense dengan normalisasi mean-1 per
  iterasi, bobot `0.5^(umur/365)`, `leagueAvgGoals` = mean gol AWAY
  terbobot dan `homeAdvantage = μH/μA` — konsisten dengan parameterisasi
  loader (λ_home = avg × att × def_opp × HA). Konvergensi 200 iterasi /
  Δ<1e-7 memadai untuk liga ≤ ±2.000 match.
- **rho = 0 untuk semua liga SM** berarti matriks skor murni Poisson
  independen: probabilitas skor rendah (0-0, 1-1) tidak dikoreksi.
  Liga legacy membuktikan rho fitted ≠ 0 (−0.11…+0.02). Ini tersangka
  utama miskalibrasi draw di liga SM. ⏳
- Half-life 365 hari tidak pernah divalidasi; dengan 3 jendela musim,
  pilihan ini menentukan seberapa besar musim 2024/25 memengaruhi rating
  hari ini. ⏳
- Per-team sample: fit menerima liga dengan ≥30 match TOTAL; tim promosi/
  baru bisa punya <10 match tapi rating-nya tersaji tanpa shrink tambahan
  di level fit (shrink hanya terjadi di blend telemetri runtime).
  Lantai sampel per-liga untuk status calibrated: registry saat ini
  mengkalibrasi J1 (130 match) sampai MLS (1.540). ⏳ gerbang OOS Fase 3
  adalah penyeimbangnya.

### 5. Gerbang skala (penyebab 36 partial)
Uji skala membandingkan Σλ **tak terbobot** vs Σ gol pada fit **terbobot
waktu**. Untuk liga yang rata-rata golnya berubah antar musim, rasio
menyimpang secara konstruksi (Bundesliga 1,079) walau fit-nya sah.
Status partial mereka JUJUR, tapi penyebabnya artefak metrik, bukan
kualitas prediksi. Perlakuan fase ini: gerbang lama dipertahankan
(konservatif), ditambah gerbang OOS (log-loss held-out vs baseline naive)
sebagai penentu status berbasis bukti — liga yang lolos skala tapi kalah
dari naive secara OOS tidak boleh duduk di `calibrated`.

### 6–8. Shrinkage & blend telemetri
- Formula w = n/(n+κ) adalah shrinkage empiris yang sah bentuknya, tapi
  κ {8, 14, 16} tidak punya catatan fit. Dengan window 6 laga, w_xG
  maksimum = 6/14 ≈ 0.43 — prior makro selalu dominan; itu konservatif
  dan mungkin benar, tapi harus dibuktikan OOS, bukan diasumsikan. ⏳
- Blend memakai telemetri dari SEMUA kompetisi tim (JOIN competition_id
  hanya untuk pembobotan xG) — termasuk piala/friendly. Risiko noise
  dicatat; tidak diubah tanpa bukti.
- `liveHomeDefense` fallback dari form gol lawan (`2.0 − liveAwayAttack`,
  di-clamp) adalah konstruksi ad-hoc era lama — hanya terpakai bila
  telemetri absen tapi form_split tersedia.

### 10. Dixon-Coles core — verifikasi aritmetika
- τ persis 4 sel standar DC; matriks dinormalisasi ulang Σ=1 setelah τ
  (penyimpangan kecil dari DC murni, konsisten internal).
- maxGoals=10: massa ekor >10 gol per sisi diabaikan lalu dinormalisasi —
  dampak <0,1% untuk λ realistis. Aman.
- `fair_odds` dibulatkan 2 desimal; probabilitas dibulatkan 4 desimal di
  output — presisi cukup untuk metrik Fase 3 bila harness memakai nilai
  tak-terbulatkan dari matriks (harness membaca `score_matrix`).

### 12. Kelly — catatan kejujuran
Kelly di sini hanya SIZING atas EV model; ARCHITECTURE §12 sudah
membuktikan EV 1X2 model vs closing line adalah ilusi pada data lama
(semua strategi bangkrut di simulasi 6.133 pick). Fase ini tidak mengubah
parameter Kelly (keputusan risiko owner) dan tidak mengklaim edge.

## Vonis Fase 3 (diisi dari harness — lihat oos-results.json)

_(diisi setelah walk-forward selesai: per komponen kept / fixed / reverted
+ angka sebelum–sesudah)_
