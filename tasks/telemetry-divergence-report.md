# Laporan Perbaikan Divergensi Telemetri Saji vs Harness

Tanggal: 2026-11-05 · Branch `safe-bet-parlay` · Status: **SELESAI — jalur saji kini memakai definisi telemetri yang sama dengan yang divalidasi harness; terverifikasi ekuivalen input + non-degradasi OOS**

Ringkasan satu kalimat: telemetri last-6 yang disajikan ke jalur analisis
sebelumnya **tidak difilter sumber dan (di jalur planner) tidak
dinormalisasi kompetisi**, sementara semua harness validasi memakai log
`source='sportmonks'` tertimbang kompetisi — perbaikan menutup divergensi
itu di tiga file non-🔒 tanpa menyentuh planner, dan validasi membuktikan
input saji kini **persis** sama dengan input harness pada sampel, dengan
OOS Level B yang tidak menurun.

---

## 1. Recon — jalur rakitan & divergensi eksak

**Jalur saji.** `lib/db/team-telemetry.ts::getPreMatchLogs()` mengambil
baris `team_match_logs` untuk satu `team_id` (`ORDER BY match_date DESC
LIMIT 6`, cutoff tanggal-10 strictly-before) dan
`getTeamRollingTelemetry()` mengagregasinya (gol tak-tertimbang; xG
tertimbang rasio rata-rata kompetisi **hanya bila** argumen
`targetDivCode` diberikan). Dua konsumen probabilitas:

- **Jalur planner** (🔒 `lib/agent/planner.ts`): memanggil
  `getTeamRollingTelemetry(name, 6, today)` **tanpa targetDivCode**, lalu
  meneruskan objeknya ke `getShrunkMatchParameters({homeTelemetry, …})`
  bila `sample_size > 0`. Jalur inilah yang dipakai `buildQuantPackage`
  → slate, driver live, dan app. Telemetri planner mengalahkan hitungan
  loader sendiri.
- **Jalur loader langsung** (`lib/quant/ratings-loader.ts`): bila opsi
  telemetri tak diberikan, loader menghitung sendiri **dengan** divCode
  (ternormalisasi) — tetapi tetap dari log tak-terfilter.

Konsumen lain `getPreMatchLogs`: `lib/quant/momentum.ts`,
`lib/quant/half-profile.ts` (fitur konteks — ikut terkoreksi).
`lib/quant/luck-regression.ts` men-query tabel yang sama tanpa filter
(masuk metadata paket saja, bukan λ/μ).

**Definisi tervalidasi (harness).** `rollingTelem` di
`scripts/parlay-lab.ts`, `scripts/backtest-walkforward.ts`,
`scripts/backtest-cup-form-blend.ts`: log `source='sportmonks'` saja,
6 terakhir strictly-before cutoff, bobot xG per log
`round3(targetAvg/logAvg)` (target = kompetisi fixture; rata-rata
kompetisi terukur dari `matches` selesai), jumlah tertimbang dibagi
**count** sampel non-null per sisi, gol tak-tertimbang.

**Divergensi (tiga):**
1. **Tanpa filter sumber di saji** — baris TheStats warisan
   (`source` NULL, 2.348 baris / 1.174 laga / 195 tim, s/d 17 Okt 2026)
   dan `source='master'` (75 baris) ikut terambil.
2. **Duplikasi laga fisik** — laga yang sama ada sebagai baris `mt_…`
   (TheStats) dan `sm_…` (Sportmonks) di bawah `team_id` yang sama;
   `(team_id, match_id)` duplikat = 0, semua duplikasi adalah kembaran
   lintas id fixture.
3. **Tanpa normalisasi kompetisi di jalur planner** — planner 🔒 tidak
   bisa memberikan target, jadi xG mentah (bobot 1,0) mengalir ke blend
   loader apa adanya.

**Skala terukur (store saat ini, 85.521 baris log):**
- Grup (tim, tanggal, GF, GA) berisi >1 sumber berbeda: **1.974 grup /
  168 tim** — duplikasi lintas sumber.
- Simulasi jendela last-6 saat ini pada 200 tim berisiko (punya ≥1 baris
  non-SM dan ≥6 log): **74,5% jendela berisi ≥1 baris non-SM; 43,0%
  berisi laga yang terhitung ganda secara harfiah.** Slot non-SM per
  jendela terkontaminasi bersifat bimodal: 1 (72 jendela), 2 (45),
  atau 6 penuh (32).
- Di dalam baris sportmonks sendiri: 500 grup (tim, tanggal) berisi >1
  baris, tetapi hanya **24 grup (23 tim)** yang berbagi
  (tanggal, lawan, GF, GA) = kembaran fisik sejati di bawah dua id
  fixture SM (mis. Brighton–Strasbourg 4–3, 2026-08-01). Sisanya
  konflasi identitas atau double-header betulan dengan skor berbeda
  (Liverpool–Como 0–0 dan 2–0 di hari yang sama) — kunci dedupe wajib
  memuat skor.
- **32 `team_id` tidak punya baris sportmonks sama sekali** (mis. Angers
  `tm_01158`) — warisan ruang id TheStats yang padanan SM-nya ber-key
  lain. Untuk mereka, jendela bersih = kosong (lihat residual §6).

Arah distorsi tidak satu sisi: Leeds served GA 1,17 vs bersih 1,00;
Espanyol served GA 1,00 vs bersih 1,50 (kontaminasi *menurunkan*);
Frankfurt netral kebetulan. Ini distorsi, bukan bias konstan.

---

## 2. Perbaikan (tiga file, tanpa 🔒)

**`lib/db/team-telemetry.ts`** (commit `4674ba9`)
- `getPreMatchLogs`: kedua varian query kini `AND l.source =
  'sportmonks'`; fetch `LIMIT limit * 3`, dedupe in-memory dengan kunci
  `tanggal(10)|opponent_id|goals_for|goals_against` (baris pertama =
  urutan most-recent menang), lalu slice ke `limit`. Jendela hasil =
  `limit` laga **berbeda** terakhir. Semantik cutoff & ORDER BY tidak
  berubah.
- Agregasi xG/npxG diekstrak verbatim menjadi helper bersama yang
  diekspor, **`aggregateRollingXg(logs, targetDivCode?)`** — satu
  definisi, satu rumah; `getTeamRollingTelemetry` memakainya (output
  pemanggil ber-target terbukti byte-identik pra/pasca refactor pada
  jendela yang sudah bersih).
- Field aditif `xg_weighted_toward?: string | null` pada
  `TeamRollingTelemetry`: competition_id yang menjadi target pembobotan
  xG, atau `null` bila tanpa target / target tak ter-resolve.

**`lib/quant/ratings-loader.ts`** (commit `63da14c`, +28 baris)
- Sesudah telemetri home/away final (sebelum evaluasi cabang blend),
  per sisi: bila objek telemetri ada DAN
  `xg_weighted_toward !== competitionIdForDiv(divCode)` DAN
  `recent_logs` tak kosong → hitung ulang agregat xG tertimbang dari
  `recent_logs` via `aggregateRollingXg(…, divCode)` dan pakai **salinan
  dangkal** dengan `rolling_xg_for/against` + `rolling_npxg_for/against`
  diganti (objek pemanggil tidak pernah dimutasi — planner memakai
  salinannya untuk konteks intel). Count sampel tidak berubah oleh
  pembobotan dan memang tidak diganti. Telemetri hitungan loader
  sendiri (penanda sudah = target) lolos utuh. κ (16/28/32), jendela,
  ambang cabang, clamp: **tidak berubah**.

**`lib/quant/luck-regression.ts`** (commit `4674ba9`)
- Query `calculateTeamLuckMetrics` kini `AND source = 'sportmonks'`
  (definisi sama; sinyal ini hanya masuk metadata konteks, bukan λ/μ).

**Blocker 🔒: tidak ada.** Planner tidak perlu disentuh — lognya bersih
di sumbernya, dan loader menimbang ulang telemetri pasokan planner dari
`recent_logs`. Yang tersisa sebagai residual tampilan (bukan
probabilitas): angka xG *konteks* di intel planner tetap tak-tertimbang
karena panggilan planner memang tanpa target; probabilitas tidak
memakai angka tampilan itu (loader menimbang ulang sebelum blend).

---

## 3. Validasi

Bukti: `scripts/validate-telemetry-equivalence.ts` +
`tasks/telemetry-equivalence.json`; `scripts/validate-telemetry-oos.ts`
+ `tasks/telemetry-oos.json` (commit `e214ea2`).

### 3a. Ekuivalensi input (sampel 30 fixture domestik, 28 kompetisi, jendela 72 jam; termasuk Leeds, Espanyol, Everton, Frankfurt)

- **Level rolling: 59/60 pemeriksaan tim PERSIS** (keenam field —
  rolling xG/gol for-against, sample_size, observed_xg_samples —
  selisih abs maksimum **0,000**).
- **Level parameter (bentuk planner): 29/30 fixture lolos, selisih abs
  maksimum 0,000** pada att/def kedua sisi, homeAdvantage,
  leagueAvgGoals, dan bobot shrinkage — jauh di dalam toleransi
  0,001–0,002.
- Satu-satunya mismatch, terklasifikasi: **St. Johnstone vs Dundee**
  (sm:501) — *perbedaan resolusi tim*, bukan drift definisi: nama
  fixture "St. Johnstone" tidak ter-resolve ke `team_id` mana pun
  (tabel `teams` menyimpan "St Johnstone"; `normalizeTeamName` tidak
  membuang titik) — loader sendiri pun mengembalikan null; sisi Dundee
  lolos persis. **Drift definisi murni: nol. Mismatch dedupe/konflasi:
  nol.**

Apa yang ditunjukkan pemeriksaan ini: fungsi saji yang sebenarnya
(dipanggil persis seperti produksi memanggilnya) kini mereproduksi
agregat harness secara eksak. Apa yang tidak: ia sampel 72 jam, bukan
seluruh populasi historis — celah populasi ditutup lengan OOS §3b.

### 3b. Level B OOS — tiga lengan telemetri (populasi uji identik per lengan; lipatan V2 + H, V1 dilewati demi runtime — dinyatakan di JSON)

Cerminan `backtest-walkforward.ts` Level B (params pemenang tercatat
`hl365|rho:zero|kfit:10`, κ×2): lengan `old` = definisi saji lama (semua
sumber, bobot 1,0); `filter` = SM-only tanpa pembobotan; `fixed` =
SM-only + tertimbang kompetisi (definisi saji sekarang = harness).

| Lengan | V2 (n=6.193) LL / Brier / slope | H (n=6.216) LL / Brier / slope | Pooled (n=12.409) LL / Brier / slope |
|---|---|---|---|
| old | 1,0250 / 0,6147 / 0,920 | 1,0067 / 0,6016 / 1,019 | 1,0158 / 0,6081 / 0,970 |
| filter | 1,0247 / 0,6145 / 0,925 | 1,0061 / 0,6012 / 1,034 | 1,0154 / 0,6078 / 0,980 |
| **fixed** | **1,0245 / 0,6144 / 0,927** | **1,0060 / 0,6012 / 1,037** | **1,0152 / 0,6078 / 0,982** |

- **Verdict: tidak ada degradasi** — urutan monoton (old terburuk →
  fixed terbaik) pada **setiap** lipatan dan **setiap** metrik.
- Bacaan jujur soal besarnya: efek pooled kecil — LL −0,0006 total
  (−0,0004 dari filter sumber, −0,0002 dari pembobotan). Nilai perbaikan
  ini adalah **kebenaran definisi** (saji = yang tervalidasi) dan
  koreksi besar per tim (§4–§5), bukan lonjakan LL pooled: mayoritas
  laga uji memang tidak terkontaminasi, jadi rata-rata pooled menipiskan
  efek yang di laga terkontaminasi itu besar.
- LL lengan fixed di H (1,0060) vs angka tercatat overhaul (1,0205)
  **bukan** klaim perbaikan: populasinya berbeda (58 vs 63 liga —
  registry terkalibrasi ulang dan store tumbuh lewat daily-refresh;
  n 6.216 vs 6.661; jendela uji bergeser). Perbandingan yang sah adalah
  antar-lengan pada populasi identik di tabel ini.
- Batas perbandingan: lengan `old` mereplikasi definisi saji lama
  *bentuk planner* (konsumen probabilitas produksi). Varian jalur loader
  lama (tak-terfilter tapi tertimbang) berada di antara `old` dan
  `filter` secara konstruksi dan tidak dijalankan terpisah.

---

## 4. Regresi

- **`pick-engine-acceptance.ts`: PASS, tidak berubah.** Kedua paket
  tersimpan mereproduksi 10 kuantitas dalam toleransi (Δ ≤ 0,00008);
  kasus wajib Fase B tetap: BTTS Fenerbahçe grade C, OU2.5 grade C,
  kombo eksak 57,27% vs produk naif 44,89%.
- **A/B regenerasi di store yang sama** (kode lama direproduksi dari
  `4674ba9^` hanya untuk tiga file, lalu direstorasi; `git status` lib
  bersih + tsc 0 sesudahnya). Kode lama mereproduksi paket kanonik
  tersimpan Everton **persis** (47,22/25,27/27,52; λ/μ 1,552/1,123) —
  A/B valid, selisih = efek perbaikan saja.
- **Penggerak >2pp: TIDAK ADA** di kedua fixture.
- **Everton vs Coventry** (fixed vs old): H 47,22 → **48,66** (+1,44pp),
  D 25,27 → 25,27, A 27,52 → **26,06** (−1,46pp); OU2.5 over 50,02 →
  49,01; BTTS yes 53,18 → 51,98; λ/μ 1,552/1,123 → 1,562/1,072.
  Atribusi: (i) **Coventry** — jendela lama menghitung ganda satu laga
  (kembaran `mt_022588781` 12 Okt + `sm_19722150`, plus kembaran
  `mt_733622110` 19 Sep) dan menggeser keluar `sm_19872563`; jendela
  fixed = 6 laga SM berbeda (GF 2,17→1,67, GA 1,17→1,50, xGA 1,53→1,64)
  — inilah penggerak μ. (ii) **Everton** — jendela lama mengambil
  kembaran TheStats untuk laga 17 Okt yang sama (skor sama, xG sedikit
  beda): xGF 1,31→1,32, xGA 1,95→1,93, gol identik.
- **Fenerbahçe vs Liverpool**: probabilitas headline **identik** old vs
  fixed (25,82/21,10/53,08; OU2.5 67,82; BTTS 66,19; parameter offset
  byte-identik) — jalur piala terbukti independen-telemetri, sesuai
  desain. Hanya konteks telemetri Fenerbahçe yang berubah (§5).
- **Slate smoke** (`pick-slate.ts --limit 5 --no-ledger`): selesai
  tanpa error; 5 diproses → **3 ter-rate** (paket tertulis via modul
  packages), **2 unrated** eksplisit "uncalibrated" (fail-closed),
  ledger +0 sesuai flag.

---

## 5. Koreksi worked example — Fenerbahçe vs Liverpool (cutoff 2026-11-04, via fungsi lib pasca-fix)

**Dengan target `SM2` (→ `sm:2`, targetAvg 1,588450):**

| Tim | GA | GF | xGF | xGA | n | Jendela |
|---|---|---|---|---|---|---|
| Fenerbahçe `tm_91646` | **2,00** | 1,67 | 1,83 | **1,79** | 6 | sm_19746567 (31 Okt, sm:600) · sm_19746576 (26 Okt, sm:600) · sm_19873677 (20 Okt, sm:2) · sm_19746585 (17 Okt, sm:600) · sm_19873676 (14 Okt, sm:2 — laga 0–6, terhitung **sekali**) · sm_19746597 (10 Okt, sm:600) |
| Liverpool `tm_0406` | **0,67** | 1,67 | 1,89 | **1,41** | 6 | sm_19901614 (1 Nov, sm:770) · sm_19722117 (1 Nov, sm:8) · sm_19897227 (25 Okt, sm:770) · sm_19722126 (25 Okt, sm:8) · sm_19872628 (20 Okt, sm:2) · sm_19895015 (18 Okt, sm:770) |

**Bentuk planner (tanpa target — nilai konteks):** Fenerbahçe GA 2,00 /
xGA 1,67 / xGF 1,67; Liverpool GA 0,67 / xGA 1,31 / xGF 1,77. Jendela
sama seperti tabel di atas.

**Koreksi atas angka Fase C (penting):** laporan Fase C mencatat xGA
bersih Fenerbahçe **1,653**. Angka itu direproduksi hanya dengan
penyebut Σbobot (`Σ(xGA·w)/Σw`); ketiga implementasi `rollingTelem`
harness — dan kini kode saji — membagi dengan **count** sampel:
`Σ(xGA·w)/n` = 10,7362/6 = **1,789 → 1,79**. Jadi 1,653 adalah
diskrepansi penyebut pada ekstraksi worked example Fase C, bukan pada
kode mana pun; target pasca-fix yang setia-harness adalah **1,79**, dan
itulah yang dihasilkan fungsi saji sekarang. (GA 2,00 Fase C terkonfirmasi
persis.) Hal yang sama berlaku untuk Liverpool Fase C: tertimbang
setia-harness = **1,41**, bukan turunan Σw 1,30.

---

## 6. Residual yang TIDAK diperbaiki pekerjaan ini (tercatat, di luar scope)

1. **Konflasi identitas di dalam baris sportmonks** — filter sumber
   secara benar tidak membuang baris SM: jendela Liverpool `tm_0406`
   masih memuat 3 laga Liverpool FC Montevideo (sm:770); jendela
   Everton `tm_8091` masih memuat 2 laga Everton de Viña del Mar
   (sm:663). Ini keluarga resolusi identitas (satu `team_id`, dua klub)
   — pekerjaan terpisah dari definisi telemetri.
2. **32 `team_id` tanpa baris sportmonks** — pasca-fix jendela mereka
   kosong → telemetri null → cabang fallback prior (sesuai definisi
   tervalidasi: harness pun melihat nol log SM untuk id itu). Akarnya
   resolusi identitas/nama antar-ruang-id, bukan definisi telemetri.
3. **Resolusi nama "St. Johnstone"** — tanda titik membuat nama fixture
   tak ter-resolve (tabel menyimpan "St Johnstone"); celah resolusi
   loader yang sudah ada sebelumnya, terungkap oleh pemeriksaan
   ekuivalensi.
4. **Angka xG konteks di intel planner** tetap tak-tertimbang sebagai
   tampilan (panggilan planner tanpa target, 🔒) — probabilitas tidak
   terpengaruh (loader menimbang ulang), tetapi label konteks dan input
   blend kini bisa berbeda angka xG-nya; menyelaraskan tampilan itu
  butuh perubahan di planner 🔒.

---

## 7. Verifikasi & commit

- Commit: `4674ba9` (team-telemetry + luck-regression) · `63da14c`
  (ratings-loader) · `e214ea2` (dua script validasi + dua JSON bukti) ·
  laporan ini.
- `npx tsc --noEmit` = **0** pada setiap checkpoint dan pohon final.
- 🔒 **utuh**: tidak ada file di `lib/agent/*`, `lib/coverage.ts`,
  `lib/syndicate-orchestrator.ts`, `lib/llm/*` yang diubah (daftar file
  per commit terverifikasi via `git show --stat`); `analysis_snapshots.db`
  (store paket) dan `picks.db` hanya ditulis lewat modulnya (slate
  smoke). Nol panggilan API; `.env.local` tidak dibuka/dicetak (driver
  memuatnya via flag `--env-file` tsx — catatan lingkungan: build Node
  ini menolak `--env-file` di dalam `NODE_OPTIONS`, jadi flag tsx yang
  dipakai; semantik sama).
- Aturan adopsi pekerjaan ini terpenuhi: definisi saji = definisi
  tervalidasi (ekuivalensi §3a), OOS tidak menurun (§3b), regresi bersih
  (§4).
