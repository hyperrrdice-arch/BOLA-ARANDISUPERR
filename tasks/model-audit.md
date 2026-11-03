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

## Vonis Fase 3 (dari harness — `tasks/oos-results.json`, run final)

Metode: walk-forward per liga (train [0,55%)→uji [55%,70%); [0,70%)→[70%,85%);
held-out final [0,85%)→[85%,100%) TIDAK pernah dipakai tuning). Cakupan
tuning = 63 liga registry calibrated/partial dengan ≥120 match (45.866
match; validasi n=13.260, held-out n=6.660). Kompetisi uncalibrated
by-design diukur terpisah sebagai referensi (baseline LL 1,4035 vs naive
1,0406 di semua lipatan — bukti kuantitatif bahwa gerbang piala benar).

### Angka headline (held-out, Level A = ratings murni)
| | Log-loss | Brier | ECE | Slope |
|---|---|---|---|---|
| Baseline produksi (hl365, rho 0, tanpa shrinkage) | 1,0503 | 0,6206 | 0,0187 | 0,534 |
| **Teradopsi (hl365, rho 0, shrinkage fit κ=10)** | **1,0298** | **0,6160** | **0,0096** | **0,864** |
| Naive rata-rata liga | 1,0737 | 0,6498 | 0,0053 | 0,575 |

Level B (jalur produksi penuh, prior + blend telemetri), held-out:
produksi lama (κ blend 8/14/16) LL **1,0340** → teradopsi (fit shrinkage
κ=10 + κ blend ×2) LL **1,0205**, Brier 0,6136→0,6105, slope 0,631→0,953.

Per tier (held-out Level A, baseline→teradopsi): EU1 1,0265→0,9996;
OTHER 1,1781→0,9980 (perbaikan terbesar — ledakan skala IPF tinggal di
tier ini); EU2 1,0712→1,0671; EU3 1,0505→1,0494; AM 1,0490→1,0480;
AS 1,0364→1,0394 (satu-satunya tier yang sedikit memburuk, n=762 —
shrinkage global tidak optimal untuk AS; dicatat, bukan disembunyikan).

### Vonis per komponen
1. **Fit IPF — FIXED (shrinkage fit diadopsi).** Ledakan skala terbukti
   terukur: sm:274 (Danish 1. Division) terfit attack 16,38 / defense
   0,01 karena tim promosi/degradasi bermatch ≤13 berbobot decay tinggi
   membuat komponen weakly-connected tak teridentifikasi skalanya.
   Shrinkage log-space κ_fit=10: validasi 1,0374→1,0279; held-out
   1,0503→1,0298. Diterapkan di `calibrate-ratings.ts` (`--shrink-kappa`,
   default 10). Half-life: **365 KEPT** — {180, 730, ∞} tidak mengalahkan
   365 secara material di validasi (semua dalam ±0,002 pada konfigurasi
   terpilih); asumsi lama lolos uji, bukan terbukti optimal.
2. **Rho liga SM — KEPT di 0 (hasil negatif, berbasis bukti).** Pada
   (half-life, κ_fit) tetap, kebijakan rho {0, global −0,03, global
   −0,08, fitted per-liga} berbeda ≤0,0006 log-loss di validasi; rho
   fitted justru keluarga terburuk. Kecurigaan awal (rho=0 penyebab
   miskalibrasi draw) TIDAK terbukti pada metrik 1X2 — efek rho
   terkonsentrasi di pasar skor-eksak yang tidak diukur harness ini.
3. **Rho legacy — KEPT** (di luar fitting fase ini).
4. **leagueAvgGoals / homeAdvantage — KEPT** (fitted per liga di semua
   konfigurasi; bagian dari perbaikan di #1).
5. **Gerbang kalibrasi — FIXED (gerbang OOS ditambahkan).** Uji skala +
   cakupan dipertahankan; gerbang bukti ditambahkan sebagai tangga:
   calibrated gagal OOS → partial; partial gagal OOS → uncalibrated
   (diblokir); lantai sampel n held-out ≥20. Hasil penerapan (registry
   final: 29 SM calibrated / 28 partial / 52 uncalibrated + 16 legacy):
   sm:465 (Liga Portugal 2) calibrated→partial (1,0757 vs naive 1,0646,
   n=104); tujuh partial→diblokir: sm:14 (League Two, 1,0806/1,0783,
   n=192), sm:274 (1,5105/1,1296, n=70), sm:603 (1,1489/1,1165, n=135),
   sm:860 (1,1291/1,1142, n=79), sm:1073 (1,0923/1,0589, n=61),
   sm:1088 (1,1301/1,0682, n=43), sm:1356 (1,1634/1,1257, n=54).
   Kasus tangga khusus: sm:9 (Championship) lolos uji skala di bawah
   fit shrinkage (rasio 0,996) sehingga gradenya calibrated → demosi
   satu tangga ke partial (1,0990/1,0793, n=191), sementara sm:14 yang
   gradenya partial langsung diblokir — konsekuensi gerbang OOS memang
   bergantung grade skala saat ini; didokumentasikan agar owner bisa
   memperketat bila mau. Dua liga naik partial→calibrated (uji skala
   lolos di bawah fit baru + gerbang OOS lolos). Seluruh 29 calibrated
   SM kini membawa catatan "Gerbang OOS lolos" (n≥20). Watch item:
   sm:1085 (AFC Champions League Elite) calibrated dengan margin tipis
   (1,0999 vs 1,1105, n=43) — lolos bukti, tapi kompetisi lintas-negara;
   pantau di siklus berikutnya.
6. **James-Stein κ blend — FIXED (×2: 8/14/16 → 16/28/32).** Terpilih di
   validasi V2 (1,0249 vs produksi 1,0356 pada params teradopsi) dan
   terkonfirmasi held-out (1,0205 vs 1,0340). Telemetri 6 laga terbukti
   terlalu berisik untuk bobot asumsi lama. Catatan disiplin: κ×2 adalah
   tepi grid yang telah ditetapkan ex-ante {×0,5, ×1, ×2}; κ×3 TIDAK
   diuji di siklus ini (menguji setelah melihat hasil = fork garden) —
   kandidat siklus validasi berikutnya. Diterapkan di
   `lib/quant/ratings-loader.ts`.
7. **Window rolling 6 — KEPT** (tidak divariasikan; tervalidasi sebagai
   bagian dari jalur Level B).
8. **Syarat xG ≥3 sampel — KEPT** (idem).
9. **Clamp rasio — KEPT** (pengaman numerik; shrinkage #1 menyerang akar
   masalahnya, clamp tetap sebagai pagar).
10. **Dixon-Coles core — KEPT** (aritmetika terverifikasi; harness membaca
    `score_matrix` presisi penuh dari implementasi kanonis yang sama).
11. **Shin vig-strip — KEPT** (tidak berubah; benchmark closing-line di
    bawah tidak tersedia untuk mengujinya lebih jauh di fase ini).
12. **Kelly — KEPT** (parameter risiko owner; tidak ada klaim edge —
    lihat paragraf kejujuran di bawah).
13. **Fallback guard — KEPT** (+ flag `calibration_gate` Fase 1).
14. **Diskon promosi ×0,85/×1,20 — KEPT, BELUM TERUJI.** Harness menilai
    fit per-liga, bukan jalur pinjam lintas-divisi. Utang terukur:
    validasi khusus jalur promosi belum ada.
15. **Scaling UCL — KEPT, BELUM TERUJI** (jalur piala di luar cakupan
    tersaji; sm:2 tetap uncalibrated by design).
16. **Special markets — KEPT, BELUM TERUJI di fase ini.** Rekomendasi
    audit tetap berlaku: klaim EV-nya dinonaktifkan owner (Brier 0,30
    vs base rate 0,25 di ARCHITECTURE §12 = tanpa skill terukur).
17–19. **Momentum / half-profile / luck — KEPT** (konteks saja,
    terverifikasi tidak menyentuh probabilitas).
20. **Normalisasi xG lintas kompetisi — FIXED di Fase 1** (rata-rata
    terukur dari store menggantikan konstanta tulisan tangan + default
    1,48 yang diam-diam).

### Benchmark closing line — TIDAK TERSEDIA (n=0, jujur)
Nol tangkapan odds pre-kickoff yang ter-join ke match SELESAI di store:
916 tangkapan pre-kickoff ada, tapi fixture-nya masih upcoming (hasilnya
belum masuk `matches`). Benchmark ini baru bisa diukur setelah fixture
bertanggal odds itu dimainkan dan hasilnya tersinkron (jendela
daily-refresh 4–10 Nov). Satu-satunya perbandingan closing-line yang ada
tetap referensi ARCHITECTURE (model 1,0306 vs closing 0,9949) — diukur
pada set match legacy football-data yang BERBEDA dari store SM ini, jadi
tidak bisa dibandingkan angka-per-angka dengan held-out di atas.

### Paragraf kejujuran — posisi model vs pasar
Pada held-out liga tersaji, model teradopsi (LL 1,0298 Level A; 1,0205
jalur produksi Level B) mengalahkan baseline naive liga (1,0737) dengan
margin jelas dan terkalibrasi jauh lebih baik dari produksi lama
(slope 0,53→0,86–0,95) — modelnya sekarang JUJUR tentang
ketidakpastiannya. Tapi tidak ada bukti di fase ini bahwa model
mengalahkan pasar: benchmark closing-line tidak terukur (n=0), dan
satu-satunya bukti historis yang ada (ARCHITECTURE §12, data legacy)
menunjukkan model KALAH dari closing line (1,0306 vs 0,9949) dan semua
simulasi Kelly bangkrut. Kesimpulan yang didukung bukti: perapihan ini
membuat analisis tidak asal-asalan — ratings yang tersaji sekarang yang
terbaik yang bisa dibuktikan out-of-sample melawan baseline jujur —
bukan bahwa ada edge taruhan. Klaim edge menunggu benchmark
closing-line yang terukur.
