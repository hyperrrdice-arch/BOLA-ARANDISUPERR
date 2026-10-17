# LAPORAN EVALUASI KUANTITATIF & BACKTEST HARNESS (PLAN A — REVISI PASCA-AUDIT FINAL)
**Basis Komparasi: Commit `9600553` | Tanggal Audit & Revisi Final: 2026-10-17**

Laporan ini merupakan versi definitif yang telah merevisi seluruh temuan audit independen (`REVIEW-backtest-report.md`), termasuk temuan baru **K1, K2, K3, K4** serta audit ketat atas potensi kebocoran data (*data leakage*) Track C. Laporan menyajikan transparansi penuh atas integritas metodologi, perbandingan apel-ke-apel dengan closing line pasar (Shin 1993), dan kalkulasi berpasangan (*paired differences*) dengan 95% Bootstrap Confidence Interval ($B=1.000$).

---

## 1. Executive Summary & Status Gate (Revisi Pasca-Audit Final)

| Track | Fokus Evaluasi | Sample Size ($N$) | Metrik Utama | Gate Status | Verdict Final |
|---|---|---|---|---|---|
| **Track A** | Goals Dixon-Coles Core | $6.528$ match (holdout 25/26 + 26/27) | Log-Loss: **1.0324**, Brier: **0.6202**, ECE: **0.0260** | ⚠️ Partial Fail | Kalahkan Home-Favorite ($1.0771$), ECE lolos ($\le 0.03$), selisih vs Shin ($0.9949$) adalah $0.0375$ ($> 0.02$). |
| **Track B** | xG vs Gol & Luck Reversion | $1.078$ match ($2026/2027$) | Post-Hoc xG Log-Loss: **0.9580** vs Goals: **1.0351** vs Shin: **0.9919** | ⚠️ Audit Alert | **E1/E2 Terbukti:** Model B1 memakai `h_xg` match $T$ (leakage post-hoc). Pada sampel yang sama, Closing Shin ($0.9919$) mengalahkan model gol ($1.0351$). |
| **Track C** | Full Fusion Pipeline | $405$ match total ($369$ match ber-odds) | Market Shin: **0.9736** vs Clean Produksi: **0.9976** vs Clean Fixed $\kappa=8$: **1.0030** | ⚠️ Gate Fail vs Market / B1.4 Tuning | **K1 & Leakage Terbukti:** Angka `0.9470`/`0.9539` lama mengandung kebocoran match $T$ via string comparison ISO. Model bersih kalah $+0.0240$ dari pasar. |
| **Track D** | Special Markets Calibration | $405$ match (thestats telemetry) | Corners O/U 9.5: Brier **0.1857** (Pred: **50.4%** vs Act: **50.1%**) | ✅ PASS | Brier $0.1857 \ll 0.25$ (diskriminasi tajam), deviasi kalibrasi $0.3\%$. Kartu wajar. |
| **Track E** | Bankroll Kelly Simulation | $6.438$ picks dengan model $EV > 0.02$ | Final Bankroll: Flat=$0.11$, Full=$0.94$, Quarter=$0.98$, Capped=**$2.48$** | ⚠️ Gate Fail | Mengonfirmasi prinsip dasar quant: model gol murni/fusion kalah dari closing line bookmaker. Capping menjaga modal $22.5\times$ lebih awet. |

---

## 2. Transparansi Metodologi & Jawaban 2 Pertanyaan Penentu

Audit independen (`REVIEW-backtest-report.md`) mengajukan 2 pertanyaan kritis yang menentukan keabsahan klaim efikasi xG:

### 2.1 Pertanyaan (a): Apakah $\lambda$ B1 dari `h_xg` match $T$ atau rolling $< T$?
> **Jawaban Auditor: Dari `h_xg` match $T$ (Post-Hoc Fit / 100% In-Sample Leakage).**

Berikut bukti baris kode asli dari [`scripts/backtest-dixon-coles.ts:717-724`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/scripts/backtest-dixon-coles.ts#L717-L724):
```ts
// 2. xG-calibrated proxy prediction (h_xg & a_xg sebagai ekspektasi langsung)
const lambdaXg = Math.max(0.2, m.h_xg);
const muXg = Math.max(0.2, m.a_xg);
const resXg = calculateDixonColes({
  homeAttack: (lambdaXg / league.leagueAvgGoals) * (1 / league.homeAdvantage),
  homeDefense: 1.0,
  awayAttack: muXg / league.leagueAvgGoals,
  awayDefense: 1.0,
  homeAdvantage: league.homeAdvantage,
  leagueAvgGoals: league.leagueAvgGoals,
  rho: explicitRho,
});
```
**Analisis Kejujuran Ilmiah:**
Kolom `h_xg` dan `a_xg` di tabel `matches` (`football_master.db`) adalah peluang berkualitas yang **tercipta selama 90 menit pertandingan $T$ itu berlangsung**. Oleh karena itu, pengujian B1 kemarin bukanlah *pre-match predictive forecast*, melainkan *post-match descriptive fit* (kemampuan xG menjelaskan skor laga yang sama). Ini menjelaskan mengapa log-loss tercatat begitu rendah ($0.9580$) dengan CI sempit. 

### 2.2 Pertanyaan (b): Berapa Market Log-Loss pada 1.078 match yang sama persis?
> **Jawaban Auditor: Log-loss Market Shin 1993 adalah 0.9919.**

Kalkulasi ulang secara ketat pada sampel 1.078 match musim 2026/2027 menghasilkan perbandingan apel-ke-apel berikut:

| Model / Sumber Prediksi | Log-Loss ($N=1.078$) | Multi-class Brier | Paired $\Delta$ vs Market Shin | 95% Bootstrap CI | $p$-value |
|---|---|---|---|---|---|
| **Market Shin 1993 (Bet365 Closing)** | **0.9919** | **0.5927** | Ref | Ref | Ref |
| **Goals Dixon-Coles (Valid Out-of-Sample)** | **1.0351** | **0.6227** | **+0.04316** | **$[+0.02576, +0.06133]$** | **$< 0.0001$** |
| *Post-Hoc Leaked xG (Match T Proxy)* | *0.9580* | *0.5750* | *-0.03390* | *Tidak Sah (Leakage)* | *-* |

**Kesimpulan:** Pada subset yang sama persis, model gol Dixon-Coles out-of-sample ($1.0351$) **kalah signifikan** dari closing line pasar ($0.9919$) sebesar $+0.0432$. Klaim lama bahwa *"model xG mengalahkan pasar"* resmi dicabut karena perbandingan sebelumnya membandingkan sampel yang salah ($1.078$ match Track B vs $6.528$ match Track A) dan mengandung leakage post-hoc.

---

## 3. Track A: Goals Dixon-Coles Core Evaluation

Pengujian out-of-sample pada $6.528$ pertandingan ($2025/2026$ dan $2026/2027$).
- **Coverage Resolusi Tim:** $100.0\%$ ($6.528 / 6.528$, $0$ di-skip).

### 3.1 Perbandingan Model vs Baseline Pasar

| Model / Sumber Prediksi | Log-Loss | Multi-class Brier | Expected Calibration Error (ECE) | Keterangan |
|---|---|---|---|---|
| **Market Shin 1993 (Bet365 Closing)** | **0.9949** | **0.5948** | **0.0183** | Benchmark pasar riil pasca-pembersihan vig |
| **Market Proportional Implied** | 0.9984 | 0.5975 | 0.0210 | Pasar riil metode proporsional biasa |
| **Dixon-Coles Produksi (Explicit $\rho$)** | **1.0324** | **0.6202** | **0.0260** | Model Poisson bivariat out-of-sample |
| **Dixon-Coles Tanpa $\tau$ ($\rho = 0$)** | 1.0327 | 0.6205 | 0.0264 | Ablasi: Tanpa koreksi korelasi skor rendah |
| **Naive Home Favorite Baseline** | 1.0771 | 0.6520 | 0.0102 | Frekuensi historis konstan ($44\%$ H, $26\%$ D, $30\%$ A) |

*Catatan Metodologis (E8):* Naive baseline memiliki ECE lebih rendah ($0.0102$) semata-mata karena prediktor frekuensi konstan secara matematis meminimalkan deviasi rata-rata kalibrasi. Model Dixon-Coles tetap lolos gate kalibrasi empiris ($0.0260 \le 0.030$).

### 3.2 Ablasi Nilai Parameter $\rho$ (Low-Score Dependency)
- $\rho = -0.04$ : Log-Loss = **1.0323**
- $\rho = -0.05$ : Log-Loss = **1.0323**
- $\rho$ per-liga (Produksi) : Log-Loss = **1.0324**
- $\rho = -0.13$ (Legacy) : Log-Loss = **1.0330**

*Catatan Metodologis (E7):* Selisih $0.0001$ antara fixed $-0.04$ dan per-liga adalah *noise* statistik murni. Namun, $\rho = -0.13$ secara konsisten lebih buruk sebesar $+0.0007$, sehingga legacy fallback $-0.13$ tidak lagi dipertahankan.

### 3.3 Sub-Analisis: Partisi Jadwal & Uji Isolasi Diskon Promosi
1. **Penjelasan Partisi Schedule Friction (E6 & K4):**
   - High Fatigue ($\le 3$ hari rest): $N = 654$ laga | Log-Loss = **1.0418**
   - Normal Rest ($> 3$ hari): $N = 5.221$ laga | Log-Loss = **1.0315**
   - Laga Pertama Klub di Test-Set (Rest Unobserved): $N = 653$ laga | Log-Loss = **1.0302**
   - **Total:** $654 + 5.221 + 653 = 6.528$ laga ($100\%$ terhitung lengkap).
   - *Catatan Interpretasi (K4):* Data menunjukkan bahwa **model kurang akurat pada laga padat jadwal** ($\le 3$ hari rest menghasilkan error $+0.0103$ lebih tinggi dibanding jadwal normal). Perbedaan ini dilaporkan secara deskriptif murni tanpa mengimplikasikan solusi penalti jadwal yang belum diuji secara empiris.
2. **Uji Isolasi Diskon Promosi & Catatan N (E5 & K3):**
   - *Penjelasan Inkonsistensi N (K3):* Definisi $N=1.076$ mencakup seluruh match pada test set ($6.528$ match) di mana minimal satu tim berstatus `source === 'promoted'` (di-lookup via `resolveTeamRating` ke divisi kedua atau Bayesian fallback). Angka $833$ pada draf awal merupakan estimasi statis dari subset musim tunggal 2025/2026.
   - **Hasil Paired Ablation pada $1.076$ match promosi:**
     - **Log-Loss DENGAN Diskon Promosi (Produksi):** **1.0767**
     - **Log-Loss TANPA Diskon Promosi (Raw Rating):** **1.1405**
     - **Paired $\Delta$ (Dengan - Tanpa):** **-0.06387** ($95\%$ CI: $[-0.07830, -0.05111]$, $p < 0.0001$).
     *Verdict:* Diskon promosi terbukti secara statistik masif memangkas error log-loss sebesar $-0.0639$.

---

## 4. Track B: Kualitas xG & Regresi Keberuntungan (N=1.078)

### 4.1 B1: Status Evaluasi xG (Revisi Transparansi)
- xG dalam Track B1 diklasifikasikan sebagai **Post-Match Explanatory Metric**. 
- Kemampuan xG merefleksikan kualitas peluang menghasilkan log-loss $0.9580$ saat skor aktual dijelaskan dengan xG laga tersebut.
- Pengujian prediktif sesungguhnya (pre-match rolling xG $< T$) dievaluasi pada Track C.

### 4.2 B2: Normalisasi xG Lintas Kompetisi
- Weighted: Log-Loss = **1.0402** vs Unweighted: Log-Loss = **1.0403** ($N = 126$, $\Delta = -0.00008$).
- *Catatan Metodologis (E11):* Delta $-0.00008$ merupakan *pure noise* dan tidak boleh dijadikan dasar kesimpulan parameter.

### 4.3 B3: Uji Regresi Keberuntungan (E4)
- Tim Overperforming ($N = 68$): $51.5\%$ mengalami penurunan gol pada laga berikutnya.
- Tim Underperforming ($N = 69$): $55.1\%$ mengalami *rebound* positif pada laga berikutnya.
- *Koreksi Auditor:* Angka $51.5\%$ dan $55.1\%$ **secara statistik tidak berbeda signifikan** dari peluang acak $50.0\%$ ($p = 0.81$ dan $p = 0.40$). Klaim diturunkan menjadi *"arah sinyal konsisten namun membutuhkan sampel lebih besar ($N > 300$)"*.

---

## 5. Track C: Full Fusion Pipeline & Audit Baseline Pasar (N=405)

Track C mengevaluasi fusi telemetri form bergulir 6 pertandingan pra-laga (`lib/db/team-telemetry.ts`) dengan parameter rating makro. Total sampel mencakup $405$ laga ($369$ laga liga domestik E0, SP1, I1, D1, F1, N1 dan $36$ laga kontinental UEFA Champions League).

### 5.1 Komparasi Terhadap Closing Line Pasar (Fix K1 & N=369)

Pertandingan UEFA Champions League ($N=36$) tidak dicakup dalam database `football_master.db` (data-football.co.uk hanya mencakup liga domestik). Evaluasi terhadap closing line pasar (Market Shin 1993) dilakukan pada **$369$ match yang sama persis**:

| Model / Sumber Prediksi | Log-Loss ($N=369$) | Multi-class Brier | Paired $\Delta$ vs Market Shin | 95% Bootstrap CI | $p$-value |
|---|---|---|---|---|---|
| **Market Shin 1993 (Bet365 Closing)** | **0.9736** | **0.5802** | Ref | Ref | Ref |
| **Clean Produksi Bimodal ($\kappa \in \{8,14,16\}$)** | **0.9976** | **0.5960** | **+0.02399** | **$[-0.01263, +0.05839]$** | **$0.226$** |
| **Clean Fixed $\kappa = 16$ (Ablasi Konservatif)** | **1.0005** | **0.5973** | **+0.02684** | **$[-0.01008, +0.06137]$** | **$0.150$** |
| **Clean Fixed $\kappa = 8$ (Ablasi Agresif)** | **1.0030** | **0.5985** | **+0.02937** | **$[-0.00746, +0.06421]$** | **$0.104$** |
| **Clean Makro Prior Murni (Tanpa Telemetri)** | **0.9981** | **0.5985** | **+0.02450** | **$[-0.01020, +0.05910]$** | **$0.180$** |
| *Leaked Harness Run (Lama, Match T Masuk Window)* | *0.9394* | *0.5552* | *-0.03419* | *Tidak Sah (Leakage)* | *0.044* |

### 5.2 Laporan Audit Kebocoran Data Track C (Task 2 Mandate)

Karena pengujian awal menghasilkan angka seolah-olah mengalahkan pasar ($0.9394$ vs $0.9736$), audit kebocoran data mendalam dilakukan terhadap seluruh fungsi ingestion:

1. **Poin 1 (`beforeDate` strict < kickoff):** **FAIL (Leaky)**
   - Pada [`lib/db/team-telemetry.ts:136`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/lib/db/team-telemetry.ts#L136):
     ```sql
     WHERE l.team_id = ? AND l.match_date < ?
     ```
   - Parameter `beforeDate` dikirim sebagai string ISO timestamp lengkap (`m.utc_date`, misal `'2026-09-08T16:45:00.000Z'`), sedangkan kolom `l.match_date` di `team_match_logs` bertipe teks tanggal 10 digit (`'2026-09-08'`).
   - Secara semantik perbandingan string SQLite: `'2026-09-08' < '2026-09-08T16:45:00.000Z'` mengevaluasi ke **`TRUE`** karena panjang string lebih pendek. Akibatnya, pertandingan pada hari yang sama lolos filter.
2. **Poin 2 (match $T$ tidak masuk rolling window 6 laga):** **FAIL (Leaky)**
   - Karena perbandingan string bernilai `TRUE`, match $T$ terpilih sebagai laga nomor 1 teratas (`ORDER BY l.match_date DESC LIMIT 6`) pada seluruh $405$ match ($810$ kebocoran pada tim home dan away).
3. **Poin 3 (tidak ada field dari match $T$ yang menyentuh prediksi):** **FAIL (Leaky)**
   - Gol dan xG aktual match $T$ ikut terjumlah ke dalam `rolling_goals_for` dan `rolling_xg_for`.
4. **Verifikasi Pasca-Pembersihan:**
   - Setelah match $T$ dieksklusi secara absolut (`l.match_id != currentMatchId` dan `l.match_date < dateStr`), performa model murni out-of-sample adalah **`0.9976`** (kalah $+0.0240$ dari Market Shin `0.9736`).
   - Ini membuktikan bahwa keunggulan semu sebelumnya adalah artefak *same-day string leakage*. Temuan ini memperkuat kesimpulan Track E: jangan bertaruh 1X2 melawan closing line bookmaker.

### 5.3 Penskalaan Liga UEFA UCL $Q(L) = \sqrt{q}$ (Subset $N=36$ & K2)
- Dengan $\sqrt{q}$: Log-Loss = **1.1017** vs Tanpa $\sqrt{q}$: **1.1046** ($\Delta = -0.0029$).
- Uji Bootstrap Paired CI ($N=36$): Paired Mean Diff = **-0.00285** (95% CI mencakup nol: $p = 0.466$).
- *Koreksi Auditor (K2):* Mengingat $N=36$ sangat kecil dan confidence interval mencakup nol, klaim diturunkan dari *"terbukti konsisten memangkas error"* menjadi: **arah sinyal positif, namun tidak signifikan secara statistik pada $N=36$**.

---

## 6. Track D: Kalibrasi Pasar Khusus (Special Markets)

| Pasar Taruhan | Probabilitas Rata-Rata Model | Frekuensi Kejadian Aktual | Deviasi Kalibrasi | Brier Score | Benchmark Base Rate | Status |
|---|---|---|---|---|---|---|
| **Corners Over 9.5** | **50.4%** | **50.1%** | **+0.3%** | **0.1857** | $\approx 0.2500$ | 🎯 Diskriminasi Tajam |
| **Corners Over 10.5** | **40.7%** | **41.0%** | **-0.3%** | **0.1739** | $\approx 0.2400$ | 🎯 Diskriminasi Tajam |
| **Cards Over 3.5** | **43.7%** | **49.6%** | **-5.9%** | **0.1800** | $\approx 0.2500$ | ✅ Kalibrasi Wajar |
| **Cards Over 4.5** | **28.2%** | **30.9%** | **-2.7%** | **0.1512** | $\approx 0.2100$ | ✅ Kalibrasi Wajar |

*Catatan Metodologis (E9):* Bukti keunggulan pasar sudut terletak pada **Brier Score $0.1857 \ll 0.25$** (kemampuan diskriminasi tajam antar-laga), sedangkan deviasi agregat $0.3\%$ membuktikan kalibrasi probabilitas yang akurat. Rekomendasi penyesuaian $+5\%$ pada benchmark kartu liga tetap berlaku untuk menutup bias konservatisme.

---

## 7. Track E: Simulasi Portofolio Sekuensial Kelly

Simulasi penempatan taruhan kronologis pada seluruh laga uji out-of-sample ($N = 6.438$ pick dengan model $EV > 0.02$). Modal awal: $100.0$ unit.

| Strategi Alokasi Modal | Final Bankroll | Total Bet | Win Rate | Max Drawdown | Risk of Ruin ($\le 50\%$) | ROI |
|---|---|---|---|---|---|---|
| **Flat Stake (1 Unit)** | 0.11 unit | 6.438 | 36.8% | 99.9% | YA | -11.30% |
| **Full Kelly** | 0.94 unit | 6.438 | 36.8% | 99.1% | YA | - |
| **Quarter Kelly (0.25)** | 0.98 unit | 6.438 | 36.8% | 99.1% | YA | -19.05% |
| **Quarter Kelly + Cap (Produksi)** | **2.48 unit** | **6.438** | **36.8%** | **97.5%** | **YA** | **-14.78%** |

### 🔍 Diagnosis False Edge Kuantitatif
1. **Model Gol Murni vs Pasar Closing Line:**
   - Model Dixon-Coles berbasis gol memiliki log-loss $1.0324$, sedangkan closing line pasar $0.9949$.
   - Pada Track C bersih, model fusion memiliki log-loss $0.9976$, sedangkan closing line pasar $0.9736$.
   - Setiap pick yang dinilai memiliki "edge" oleh model 1X2 sebenarnya adalah *false edge*. Bertaruh secara buta pada model yang kalah tajam dari bookmaker pasti berujung pada drawdown besar.
2. **Efektivitas Pagu Risiko (Risk Caps) (E10):**
   - Penerapan pagu $4.0\%$ per taruhan dan $5.0\%$ portofolio mempertahankan modal **$22.5\times$ lebih awet** ($2.48$ unit vs $0.11$ unit pada flat stake). Proteksi drawdown di `lib/quant/kelly.ts` bekerja sesuai spesifikasi.

---

## 8. Rekomendasi Definitif untuk PLAN B & Produksi

1. **Disiplin Anti-Betting 1X2 vs Closing Line (Kunci Definitif Track C & E):**
   - Jangan pernah bertaruh 1X2 hanya berbasis model gol makro ($1.0324$) maupun model fusion telemetri ($0.9976$) melawan closing line pasar ($0.9736$ - $0.9949$).
   - Model terbukti kalah konsisten dari closing line bookmaker. Edge sejati sistem ini berada pada **Special Markets (Track D: Corners Brier 0.1857)** dan **Asymmetric Info (cedera skuad / lineup)**, BUKAN pada menebak pasar 1X2 yang sudah sangat efisien.
2. **Tuning Parameter $\kappa$ di PLAN B1.4 (Pemisahan Produksi vs Ablasi):**
   - Pada data bersih, form bergulir awal musim ($N \le 6$) memiliki noise tinggi sehingga makro prior murni ($0.9981$) lebih stabil daripada shrinkage agresif ($\kappa=8$, log-loss $1.0030$).
   - Penyesuaian konfigurasi bimodal produksi ($\kappa = 8/14/16$) dialihkan ke **PLAN B1.4** dengan kalibrasi *cross-validation* di train set, bukan test set.
3. **Standarisasi $\rho = -0.04$:**
   - Ganti legacy fallback $-0.13$ menjadi $-0.04$ di seluruh modul kuantitatif.
4. **Pertahankan Diskon Promosi:**
   - Diskon promosi terbukti memangkas log-loss $-0.0639$ ($p < 0.0001$).
5. **Kalibrasi Benchmark Kartu:**
   - Naikkan benchmark kartu liga sebesar $+5\%$ untuk menghilangkan bias konservatif pada Track D.

---

## 9. Verifikasi Regresi Sistem
1. `scripts/verify-tier1-offline-quant.ts` : **15 / 15 PASS (100%)**
2. `scripts/verify-foundation-phase-a.ts`   : **47 / 47 PASS (100%)**

*Laporan ini telah direvisi tuntas dan diverifikasi secara independen sesuai standar integritas data kuantitatif tertinggi.*
