# Parlay Lab — Pengukuran Kejujuran Probabilitas Model (Phase A)

Dihasilkan 2026-11-04T17:41:30.594Z oleh `npx tsx scripts/parlay-lab.ts`. Angka mentah lengkap: `tasks/parlay-lab-results.json`.

## Metode & disiplin anti-leakage

- **Model yang diukur = jalur saji produksi tervalidasi** (Level B `tasks/oos-results.json`, konfigurasi terpilih `winner kx2`): fit IPF half-life 365 hari + shrinkage log-space κfit=10 + rho=0, lalu blend telemetri/form James-Stein kappaScale=2. Fungsi harness `scripts/backtest-walkforward.ts` tidak diekspor, jadi dicerminkan ke skrip lab dengan atribusi (preseden yang sama seperti harness mencerminkan `fitLeague`); harness asli tidak diubah.
- **Probabilitas dari `calculateDixonColes`** lewat konvensi rasio harness (leagueAvgGoals=μ, homeAdvantage=λ/μ, attack/defense=1, rho=0, maxGoals=10), dibaca dari `score_matrix` presisi penuh — bukan field `prob_*` yang dibulatkan 4 desimal. Dari matriks yang sama dihitung 16 kandidat per match: 1X2 (3), double chance (3), O/U 1,5/2,5/3,5 (6), BTTS (2), tim kandang/tandang mencetak gol (2).
- **Domestik:** lipatan kronologis per liga identik harness — V1 train[0,55%)→test[55%,70%), V2 train[0,70%)→test[70%,85%), H train[0,85%)→test[85%,100%). Test match hanya memakai fit train lipatannya dan telemetri bertanggal strictly sebelum tanggal laga (cutoff di dalam `blendInput` cerminan).
- **Piala:** dicerminkan dari `scripts/backtest-cup-offsets.ts` — per kompetisi, per musim setelah musim pertama, fit domestik + offset δ hanya dari data bertanggal sebelum musim uji mulai; match dinilai hanya bila `predictMatch` jalur offset mengembalikan prediksi (kedua liga teridentifikasi δ-nya). Matriks kandidat dari panggilan Dixon-Coles yang sama seperti di dalam `predictMatch`.
- **market_prob** hanya untuk 1X2: closing line = tangkapan `match_odds_history` pre-kickoff terakhir, prioritas bookmaker Pinnacle lalu 1xBet, di-strip vig metode Shin (cerminan `closingLineProbs` harness).
- **sm_prob** hanya diisi dari `sm_predictions` yang `captured_utc < kickoff` (prediksi pra-laga asli). Lihat temuan di bagian Keterbatasan — hasil pemeriksaan: tidak ada yang lolos.
- **Outcome** di-resolve dari skor final lokal `dataset.matches`; tidak ada panggilan API di seluruh lab.

## Populasi & cakupan

### Domestik — 28 liga calibrated

Populasi ditentukan persis seperti gating produksi: `getLeagueGate(competitionIdToDiv(compId)).status === 'calibrated'` atas liga `sm:%` di dataset. Liga calibrated di bawah lantai 120 match selesai (stabilitas lipatan, sama seperti harness): tidak ada.

| Lipatan | Match uji |
|---|---:|
| V1 | 2.880 |
| V2 | 2.880 |
| H | 2.892 |
| **Total** | **8.652** |

Kandidat ditulis: 138.432 pick dicoba, 0 baris baru masuk ledger (sisanya dedupe idempoten — angka run terakhir; run pengisian pertama memasukkan seluruhnya, lihat total ledger di bagian resolusi). market_prob terisi pada 9 pick 1X2; sm_prob terisi 0. Match uji tanpa matriks (λ/μ tak valid): 0.

Liga populasi: sm:1034, sm:12, sm:181, sm:244, sm:262, sm:271, sm:301, sm:304, sm:325, sm:384, sm:387, sm:45, sm:453, sm:462, sm:486, sm:501, sm:564, sm:573, sm:591, sm:600, sm:663, sm:770, sm:779, sm:8, sm:830, sm:85, sm:902, sm:968.

### Piala — 17 kompetisi model offset

| Kompetisi | Graf | Status gerbang | Match uji | Ter-rate | Cakupan lab | Cakupan cup-oos.json | Selisih |
|---|---|---|---:|---:|---:|---:|---|
| sm:2 | europe | partial | 415 | 238 | 57,4% | 57,4% | sama |
| sm:5 | europe | partial | 383 | 264 | 68,9% | 68,9% | sama |
| sm:2286 | europe | uncalibrated | 647 | 188 | 29,1% | 29,1% | sama |
| sm:24 | europe | uncalibrated | 1.534 | 79 | 5,1% | 5,1% | sama |
| sm:27 | europe | partial | 141 | 136 | 96,5% | 96,5% | sama |
| sm:307 | europe | uncalibrated | 150 | 22 | 14,7% | 14,7% | sama |
| sm:468 | europe | uncalibrated | 212 | 16 | 7,5% | 7,5% | sama |
| sm:78 | europe | uncalibrated | 150 | 31 | 20,7% | 20,7% | sama |
| sm:570 | europe | uncalibrated | 154 | 29 | 18,8% | 18,8% | sama |
| sm:109 | europe | uncalibrated | 90 | 44 | 48,9% | 48,9% | sama |
| sm:390 | europe | partial | 56 | 43 | 76,8% | 76,8% | sama |
| sm:1122 | conmebol | uncalibrated | 288 | 114 | 39,6% | 39,6% | sama |
| sm:1116 | conmebol | uncalibrated | 290 | 132 | 45,5% | 45,5% | sama |
| sm:654 | conmebol | uncalibrated | 214 | 84 | 39,3% | 39,3% | sama |
| sm:1085 | afc | uncalibrated | 174 | 84 | 48,3% | 48,3% | sama |
| sm:1088 | afc | uncalibrated | 169 | 13 | 7,7% | 7,7% | sama |
| sm:950 | afc | uncalibrated | 37 | 19 | 51,3% | 51,3% | sama |

Total piala: 5.104 match uji, 1.536 ter-rate (30,1%), 24.576 kandidat dicoba, 0 baris baru. Fraksi ter-rate ADALAH cakupan model offset — konsisten dengan `tasks/cup-oos.json` per konstruksi walk-forward yang sama (tidak ada selisih). n piala kecil dan terpool lintas kompetisi di semua tabel berikutnya.

Resolusi outcome: 163.008 dari 163.008 pick lab ter-resolve (100,0%) — tahap resolve in-process pada run penghasil laporan ini memeriksa 0 pick (semua sudah ter-resolve dari run pengisian pertama; run ulang penuh memverifikasi idempotensi: 0 baris baru, 0 outcome berubah). Resolver standalone `scripts/resolve-pick-outcomes.ts` dijalankan terpisah sebagai pembuktian silang dan melaporkan 0 pick baru ter-resolve (lihat catatan run di laporan agen).

## Tabel pita per market

Gap = hit-rate − rata-rata probabilitas. Positif = model kurang percaya diri (under-confident); negatif = overconfident. Pita di luar 55–100% bukan wilayah safe-bet dan tidak diukur di sini (sesuai definisi pita ledger).

### Domestik (populasi calibrated)

**Market 1x2**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 889 | 57,4% | 56,9% | -0,5 pp |
| 60–65 | 590 | 62,3% | 62,9% | +0,5 pp |
| 65–70 | 386 | 67,3% | 73,3% | +6,1 pp |
| 70–75 | 187 | 72,4% | 78,1% | +5,7 pp |
| 75–80 | 111 | 77,3% | 75,7% | -1,6 pp |
| 80–85 | 49 | 82,1% | 81,6% | -0,5 pp |
| 85+ | 13 | 87,8% | 84,6% | -3,2 pp |
| **Semua prob** | **25.956** | **33,3%** | **33,3%** | **0,0 pp** |

**Market btts**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 2.593 | 57,4% | 53,2% | -4,3 pp |
| 60–65 | 1.872 | 62,3% | 58,5% | -3,8 pp |
| 65–70 | 878 | 67,0% | 62,8% | -4,3 pp |
| 70–75 | 274 | 71,9% | 63,9% | -8,0 pp |
| 75–80 | 51 | 76,5% | 68,6% | -7,9 pp |
| 80–85 | 13 | 81,9% | 53,8% | -28,0 pp |
| 85+ | 2 | 85,8% | 50,0% | -35,8 pp |
| **Semua prob** | **17.304** | **50,0%** | **50,0%** | **0,0 pp** |

**Market dc**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 2.111 | 57,6% | 57,9% | +0,4 pp |
| 60–65 | 2.292 | 62,5% | 65,4% | +2,8 pp |
| 65–70 | 2.658 | 67,6% | 68,5% | +1,0 pp |
| 70–75 | 4.621 | 72,9% | 72,7% | -0,2 pp |
| 75–80 | 6.263 | 77,1% | 75,2% | -1,9 pp |
| 80–85 | 1.852 | 82,0% | 82,9% | +0,9 pp |
| 85+ | 908 | 88,3% | 89,1% | +0,8 pp |
| **Semua prob** | **25.956** | **66,7%** | **66,7%** | **0,0 pp** |

**Market ou15**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 209 | 57,8% | 58,4% | +0,6 pp |
| 60–65 | 398 | 62,6% | 68,6% | +5,9 pp |
| 65–70 | 793 | 67,7% | 67,5% | -0,2 pp |
| 70–75 | 1.472 | 72,8% | 73,4% | +0,7 pp |
| 75–80 | 2.168 | 77,6% | 75,0% | -2,5 pp |
| 80–85 | 2.155 | 82,4% | 78,5% | -3,9 pp |
| 85+ | 1.320 | 87,8% | 85,5% | -2,2 pp |
| **Semua prob** | **17.304** | **50,0%** | **50,0%** | **0,0 pp** |

**Market ou25**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 2.245 | 57,4% | 52,7% | -4,7 pp |
| 60–65 | 1.785 | 62,4% | 58,8% | -3,6 pp |
| 65–70 | 1.119 | 67,3% | 63,9% | -3,4 pp |
| 70–75 | 517 | 72,2% | 67,9% | -4,3 pp |
| 75–80 | 199 | 77,2% | 70,3% | -6,9 pp |
| 80–85 | 69 | 81,7% | 75,4% | -6,3 pp |
| 85+ | 20 | 88,1% | 70,0% | -18,1 pp |
| **Semua prob** | **17.304** | **50,0%** | **50,0%** | **0,0 pp** |

**Market ou35**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 1.147 | 57,7% | 64,2% | +6,5 pp |
| 60–65 | 1.440 | 62,6% | 68,8% | +6,2 pp |
| 65–70 | 1.644 | 67,5% | 70,4% | +2,9 pp |
| 70–75 | 1.499 | 72,4% | 74,9% | +2,4 pp |
| 75–80 | 1.002 | 77,3% | 75,3% | -2,0 pp |
| 80–85 | 623 | 82,2% | 78,2% | -4,0 pp |
| 85+ | 385 | 88,8% | 86,8% | -2,0 pp |
| **Semua prob** | **17.304** | **50,0%** | **50,0%** | **0,0 pp** |

**Market team_over05_away**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 601 | 57,8% | 58,7% | +0,9 pp |
| 60–65 | 1.034 | 62,7% | 61,8% | -0,9 pp |
| 65–70 | 1.428 | 67,6% | 65,1% | -2,5 pp |
| 70–75 | 1.845 | 72,5% | 70,1% | -2,4 pp |
| 75–80 | 1.642 | 77,3% | 74,6% | -2,7 pp |
| 80–85 | 1.057 | 82,2% | 81,4% | -0,9 pp |
| 85+ | 489 | 87,9% | 88,1% | +0,2 pp |
| **Semua prob** | **8.652** | **71,0%** | **69,7%** | **-1,3 pp** |

**Market team_over05_home**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 226 | 57,7% | 56,6% | -1,1 pp |
| 60–65 | 449 | 62,7% | 64,4% | +1,6 pp |
| 65–70 | 793 | 67,7% | 69,9% | +2,2 pp |
| 70–75 | 1.326 | 72,7% | 73,2% | +0,5 pp |
| 75–80 | 1.784 | 77,6% | 76,1% | -1,5 pp |
| 80–85 | 1.973 | 82,5% | 81,5% | -0,9 pp |
| 85+ | 1.875 | 88,7% | 87,2% | -1,6 pp |
| **Semua prob** | **8.652** | **77,5%** | **77,0%** | **-0,5 pp** |

### Piala (terpool lintas kompetisi — n kecil, baca sebagai indikatif)

**Market 1x2**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 177 | 57,3% | 59,3% | +2,0 pp |
| 60–65 | 132 | 62,4% | 60,6% | -1,7 pp |
| 65–70 | 111 | 67,6% | 80,2% | +12,6 pp |
| 70–75 | 75 | 72,0% | 72,0% | -0,0 pp |
| 75–80 | 63 | 77,0% | 79,4% | +2,3 pp |
| 80–85 | 32 | 82,3% | 84,4% | +2,1 pp |
| 85+ | 24 | 90,8% | 83,3% | -7,5 pp |
| **Semua prob** | **4.608** | **33,3%** | **33,3%** | **0,0 pp** |

**Market btts**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 462 | 57,4% | 55,2% | -2,2 pp |
| 60–65 | 327 | 62,2% | 56,9% | -5,3 pp |
| 65–70 | 180 | 67,1% | 53,3% | -13,8 pp |
| 70–75 | 32 | 71,8% | 53,1% | -18,7 pp |
| 75–80 | 5 | 76,8% | 60,0% | -16,8 pp |
| 80–85 | 0 | — | — | — |
| 85+ | 0 | — | — | — |
| **Semua prob** | **3.072** | **50,0%** | **50,0%** | **0,0 pp** |

**Market dc**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 273 | 57,5% | 56,0% | -1,5 pp |
| 60–65 | 311 | 62,5% | 61,7% | -0,8 pp |
| 65–70 | 422 | 67,7% | 66,8% | -0,9 pp |
| 70–75 | 710 | 72,8% | 74,4% | +1,5 pp |
| 75–80 | 943 | 77,2% | 78,9% | +1,7 pp |
| 80–85 | 471 | 82,3% | 84,1% | +1,8 pp |
| 85+ | 416 | 89,5% | 87,3% | -2,3 pp |
| **Semua prob** | **4.608** | **66,7%** | **66,7%** | **0,0 pp** |

**Market ou15**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 84 | 57,9% | 69,0% | +11,1 pp |
| 60–65 | 121 | 62,7% | 66,1% | +3,4 pp |
| 65–70 | 154 | 67,8% | 61,0% | -6,8 pp |
| 70–75 | 225 | 72,6% | 69,8% | -2,8 pp |
| 75–80 | 315 | 77,6% | 77,8% | +0,2 pp |
| 80–85 | 352 | 82,5% | 79,0% | -3,5 pp |
| 85+ | 237 | 88,3% | 84,4% | -3,9 pp |
| **Semua prob** | **3.072** | **50,0%** | **50,0%** | **0,0 pp** |

**Market ou25**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 381 | 57,6% | 62,2% | +4,6 pp |
| 60–65 | 320 | 62,5% | 60,6% | -1,9 pp |
| 65–70 | 243 | 67,4% | 63,8% | -3,6 pp |
| 70–75 | 120 | 72,3% | 58,3% | -14,0 pp |
| 75–80 | 48 | 77,0% | 64,6% | -12,4 pp |
| 80–85 | 14 | 82,2% | 57,1% | -25,1 pp |
| 85+ | 6 | 90,5% | 83,3% | -7,2 pp |
| **Semua prob** | **3.072** | **50,0%** | **50,0%** | **0,0 pp** |

**Market ou35**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 188 | 57,7% | 59,0% | +1,4 pp |
| 60–65 | 235 | 62,5% | 63,8% | +1,3 pp |
| 65–70 | 245 | 67,5% | 69,4% | +1,9 pp |
| 70–75 | 212 | 72,5% | 65,6% | -6,9 pp |
| 75–80 | 199 | 77,3% | 76,4% | -1,0 pp |
| 80–85 | 156 | 82,5% | 80,1% | -2,4 pp |
| 85+ | 142 | 87,8% | 81,7% | -6,1 pp |
| **Semua prob** | **3.072** | **50,0%** | **50,0%** | **0,0 pp** |

**Market team_over05_away**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 172 | 57,7% | 55,8% | -1,9 pp |
| 60–65 | 187 | 62,6% | 58,8% | -3,8 pp |
| 65–70 | 225 | 67,6% | 64,9% | -2,7 pp |
| 70–75 | 222 | 72,6% | 73,4% | +0,8 pp |
| 75–80 | 183 | 77,5% | 71,6% | -5,9 pp |
| 80–85 | 146 | 82,1% | 77,4% | -4,7 pp |
| 85+ | 131 | 89,1% | 87,8% | -1,4 pp |
| **Semua prob** | **1.536** | **67,6%** | **66,7%** | **-0,9 pp** |

**Market team_over05_home**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 61 | 57,7% | 65,6% | +7,9 pp |
| 60–65 | 115 | 62,5% | 61,7% | -0,8 pp |
| 65–70 | 169 | 67,6% | 63,9% | -3,7 pp |
| 70–75 | 183 | 72,5% | 72,7% | +0,1 pp |
| 75–80 | 270 | 77,5% | 72,6% | -4,9 pp |
| 80–85 | 287 | 82,4% | 82,9% | +0,5 pp |
| 85+ | 387 | 89,9% | 85,8% | -4,1 pp |
| **Semua prob** | **1.536** | **76,8%** | **75,5%** | **-1,3 pp** |

## Potongan headline (domestik)

**1X2 — sisi favorit (prob tertinggi per match)**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 889 | 57,4% | 56,9% | -0,5 pp |
| 60–65 | 590 | 62,3% | 62,9% | +0,5 pp |
| 65–70 | 386 | 67,3% | 73,3% | +6,1 pp |
| 70–75 | 187 | 72,4% | 78,1% | +5,7 pp |
| 75–80 | 111 | 77,3% | 75,7% | -1,6 pp |
| 80–85 | 49 | 82,1% | 81,6% | -0,5 pp |
| 85+ | 13 | 87,8% | 84,6% | -3,2 pp |
| **Semua prob** | **8.652** | **49,7%** | **48,8%** | **-0,9 pp** |

**Double chance — seleksi terbaik per match**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 0 | — | — | — |
| 60–65 | 0 | — | — | — |
| 65–70 | 134 | 69,0% | 62,7% | -6,3 pp |
| 70–75 | 2.239 | 73,3% | 71,6% | -1,8 pp |
| 75–80 | 4.383 | 77,1% | 73,7% | -3,4 pp |
| 80–85 | 1.162 | 82,1% | 82,2% | +0,1 pp |
| 85+ | 734 | 88,5% | 90,5% | +1,9 pp |
| **Semua prob** | **8.652** | **77,6%** | **75,6%** | **-2,1 pp** |

**Over/Under 1,5 — over**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 184 | 57,9% | 60,3% | +2,5 pp |
| 60–65 | 387 | 62,7% | 69,5% | +6,9 pp |
| 65–70 | 791 | 67,7% | 67,6% | -0,1 pp |
| 70–75 | 1.472 | 72,8% | 73,4% | +0,7 pp |
| 75–80 | 2.167 | 77,6% | 75,1% | -2,5 pp |
| 80–85 | 2.155 | 82,4% | 78,5% | -3,9 pp |
| 85+ | 1.320 | 87,8% | 85,5% | -2,2 pp |
| **Semua prob** | **8.652** | **76,9%** | **75,7%** | **-1,3 pp** |

**Over/Under 2,5 — over**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 1.523 | 57,5% | 52,3% | -5,1 pp |
| 60–65 | 1.324 | 62,4% | 59,3% | -3,1 pp |
| 65–70 | 840 | 67,3% | 64,0% | -3,3 pp |
| 70–75 | 407 | 72,2% | 66,8% | -5,4 pp |
| 75–80 | 129 | 77,1% | 72,9% | -4,3 pp |
| 80–85 | 37 | 81,7% | 78,4% | -3,3 pp |
| 85+ | 9 | 89,3% | 66,7% | -22,6 pp |
| **Semua prob** | **8.652** | **54,1%** | **52,7%** | **-1,5 pp** |

**Over/Under 2,5 — under**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 722 | 57,4% | 53,6% | -3,8 pp |
| 60–65 | 461 | 62,2% | 57,3% | -4,9 pp |
| 65–70 | 279 | 67,2% | 63,4% | -3,8 pp |
| 70–75 | 110 | 72,4% | 71,8% | -0,5 pp |
| 75–80 | 70 | 77,3% | 65,7% | -11,6 pp |
| 80–85 | 32 | 81,7% | 71,9% | -9,9 pp |
| 85+ | 11 | 87,1% | 72,7% | -14,4 pp |
| **Semua prob** | **8.652** | **45,9%** | **47,3%** | **+1,5 pp** |

**BTTS — yes**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 1.959 | 57,5% | 53,5% | -4,0 pp |
| 60–65 | 1.565 | 62,3% | 58,9% | -3,4 pp |
| 65–70 | 730 | 67,0% | 63,7% | -3,3 pp |
| 70–75 | 214 | 71,8% | 65,9% | -5,9 pp |
| 75–80 | 39 | 76,4% | 69,2% | -7,1 pp |
| 80–85 | 10 | 82,1% | 60,0% | -22,1 pp |
| 85+ | 1 | 86,0% | 100,0% | +14,0 pp |
| **Semua prob** | **8.652** | **54,8%** | **54,0%** | **-0,8 pp** |

**BTTS — no**

| Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---:|---:|---:|---:|
| 55–60 | 634 | 57,2% | 52,2% | -5,0 pp |
| 60–65 | 307 | 62,1% | 56,4% | -5,8 pp |
| 65–70 | 148 | 67,0% | 58,1% | -8,9 pp |
| 70–75 | 60 | 72,1% | 56,7% | -15,5 pp |
| 75–80 | 12 | 77,1% | 66,7% | -10,4 pp |
| 80–85 | 3 | 81,0% | 33,3% | -47,6 pp |
| 85+ | 1 | 85,6% | 0,0% | -85,6 pp |
| **Semua prob** | **8.652** | **45,2%** | **46,0%** | **+0,8 pp** |

## Temuan overconfidence

Sel pita dengan gap ≤ −3,0 pp dan n≥100 (probabilitas yang dinyatakan model lebih tinggi dari frekuensi kejadian sebenarnya), terburuk dulu:

| Cakupan | Pita | n | Rata-rata prob | Hit-rate | Gap |
|---|---|---:|---:|---:|---:|
| domestik · btts/no | 65–70 | 148 | 67,0% | 58,1% | -8,9 pp |
| domestik · btts (pooled) | 70–75 | 274 | 71,9% | 63,9% | -8,0 pp |
| domestik · ou25 (pooled) | 75–80 | 199 | 77,2% | 70,3% | -6,9 pp |
| domestik · Double chance — seleksi terbaik per match | 65–70 | 134 | 69,0% | 62,7% | -6,3 pp |
| domestik · btts/yes | 70–75 | 214 | 71,8% | 65,9% | -5,9 pp |
| domestik · ou35/over | 55–60 | 105 | 57,2% | 51,4% | -5,8 pp |
| domestik · btts/no | 60–65 | 307 | 62,1% | 56,4% | -5,8 pp |
| domestik · dc/12 | 65–70 | 305 | 68,3% | 62,9% | -5,4 pp |
| domestik · ou25/over | 70–75 | 407 | 72,2% | 66,8% | -5,4 pp |
| domestik · ou25/over | 55–60 | 1.523 | 57,5% | 52,3% | -5,1 pp |
| domestik · btts/no | 55–60 | 634 | 57,2% | 52,2% | -5,0 pp |
| domestik · ou25/under | 60–65 | 461 | 62,2% | 57,3% | -4,9 pp |
| domestik · ou25 (pooled) | 55–60 | 2.245 | 57,4% | 52,7% | -4,7 pp |
| domestik · dc/12 | 85+ | 178 | 87,1% | 82,6% | -4,5 pp |
| domestik · ou25 (pooled) | 70–75 | 517 | 72,2% | 67,9% | -4,3 pp |
| domestik · btts (pooled) | 65–70 | 878 | 67,0% | 62,8% | -4,3 pp |
| domestik · ou25/over | 75–80 | 129 | 77,1% | 72,9% | -4,3 pp |
| domestik · btts (pooled) | 55–60 | 2.593 | 57,4% | 53,2% | -4,3 pp |
| domestik · ou35 (pooled) | 80–85 | 623 | 82,2% | 78,2% | -4,0 pp |
| domestik · btts/yes | 55–60 | 1.959 | 57,5% | 53,5% | -4,0 pp |
| domestik · ou35/under | 80–85 | 621 | 82,2% | 78,3% | -4,0 pp |
| domestik · ou15 (pooled) | 80–85 | 2.155 | 82,4% | 78,5% | -3,9 pp |
| domestik · ou15/over | 80–85 | 2.155 | 82,4% | 78,5% | -3,9 pp |
| domestik · ou25/under | 65–70 | 279 | 67,2% | 63,4% | -3,8 pp |
| domestik · btts (pooled) | 60–65 | 1.872 | 62,3% | 58,5% | -3,8 pp |
| domestik · ou25/under | 55–60 | 722 | 57,4% | 53,6% | -3,8 pp |
| domestik · ou25 (pooled) | 60–65 | 1.785 | 62,4% | 58,8% | -3,6 pp |
| domestik · btts/yes | 60–65 | 1.565 | 62,3% | 58,9% | -3,4 pp |
| domestik · ou25 (pooled) | 65–70 | 1.119 | 67,3% | 63,9% | -3,4 pp |
| domestik · Double chance — seleksi terbaik per match | 75–80 | 4.383 | 77,1% | 73,7% | -3,4 pp |

(dan 3 sel lain — daftar lengkap di JSON, kunci `overconfidenceFindings`.)

## Survival parlay (domestik)

Leg = kandidat mana pun dengan model_prob ≥ ambang T. Per match hanya leg terbaiknya (prob tertinggi) yang dipakai di kedua metode.

**Metode utama — perakitan kronologis:** leg dikelompokkan per tanggal kickoff (UTC); tanggal dengan ≥5 match berkaki memenuhi syarat membentuk parlay ukuran 2–5 dari 5 match pertama secara kronologis (satu parlay per ukuran per tanggal, awalan bersarang/nested). Survival empiris = fraksi parlay yang semua leg-nya hit; prediksi = rata-rata hasil kali probabilitas model leg-legnya (asumsi independensi).

| T | Ukuran | Tanggal parlay | Survival empiris | Prediksi (produk) | Gap |
|---|---:|---:|---:|---:|---:|
| 65,0% | 2 | 277 | 66,4% | 69,8% | -3,4 pp |
| 65,0% | 3 | 277 | 57,8% | 58,5% | -0,8 pp |
| 65,0% | 4 | 277 | 50,2% | 49,2% | +1,0 pp |
| 65,0% | 5 | 277 | 40,1% | 41,1% | -1,1 pp |
| 70,0% | 2 | 277 | 66,4% | 69,8% | -3,4 pp |
| 70,0% | 3 | 277 | 57,8% | 58,5% | -0,8 pp |
| 70,0% | 4 | 277 | 50,2% | 49,2% | +1,0 pp |
| 70,0% | 5 | 277 | 40,1% | 41,1% | -1,1 pp |
| 75,0% | 2 | 274 | 66,8% | 70,3% | -3,5 pp |
| 75,0% | 3 | 274 | 57,3% | 59,1% | -1,8 pp |
| 75,0% | 4 | 274 | 50,0% | 49,8% | +0,2 pp |
| 75,0% | 5 | 274 | 40,2% | 41,6% | -1,5 pp |

Semesta leg per ambang: T=65,0% → 8.652 match; T=70,0% → 8.652 match; T=75,0% → 8.449 match. Baris T=65% dan T=70% identik karena SETIAP match uji domestik punya leg terbaik ≥70% (leg double-chance dan tim-mencetak-gol mendominasi probabilitas tertinggi per match) — pada semesta leg-terbaik, ambang 65% tidak menyaring apa pun; penyaringan baru terasa di T=75%.

**Cross-check — bootstrap:** 10.000 sampel per (T, ukuran); leg ditarik acak dari seluruh pool leg ≥T dengan penolakan match_id ganda dalam satu sampel (seed tetap 20261105, dapat direproduksi).

| T | Ukuran | Sampel | Survival empiris | Prediksi (produk) | Gap | Δ empiris vs perakitan |
|---|---:|---:|---:|---:|---:|---:|
| 65,0% | 2 | 10.000 | 67,1% | 69,3% | -2,2 pp | +0,7 pp |
| 65,0% | 3 | 10.000 | 55,1% | 57,6% | -2,4 pp | -2,6 pp |
| 65,0% | 4 | 10.000 | 44,7% | 47,9% | -3,1 pp | -5,5 pp |
| 65,0% | 5 | 10.000 | 37,5% | 39,9% | -2,3 pp | -2,5 pp |
| 70,0% | 2 | 10.000 | 67,5% | 69,2% | -1,7 pp | +1,1 pp |
| 70,0% | 3 | 10.000 | 54,9% | 57,6% | -2,7 pp | -2,9 pp |
| 70,0% | 4 | 10.000 | 45,2% | 48,0% | -2,8 pp | -5,0 pp |
| 70,0% | 5 | 10.000 | 36,7% | 39,9% | -3,2 pp | -3,4 pp |
| 75,0% | 2 | 10.000 | 68,0% | 69,5% | -1,5 pp | +1,2 pp |
| 75,0% | 3 | 10.000 | 54,7% | 58,1% | -3,3 pp | -2,6 pp |
| 75,0% | 4 | 10.000 | 45,1% | 48,5% | -3,4 pp | -4,9 pp |
| 75,0% | 5 | 10.000 | 36,4% | 40,5% | -4,1 pp | -3,8 pp |

**Kedua metode tidak sepenuhnya sepakat** (selisih empiris terbesar 5,5 pp): pada ukuran 2 keduanya praktis sama, tapi pada ukuran 3–5 bootstrap sistematis LEBIH RENDAH dari perakitan kronologis. Perakitan hanya memakai tanggal padat (≥5 match berkaki) dan 5 leg kronologis pertama per tanggal — subset yang ternyata sedikit lebih kuat dari rata-rata semesta leg. Perlakukan survival sebagai rentang: bootstrap = batas bawah konservatif, perakitan = estimasi untuk tanggal padat. Soal independensi: gap empiris-vs-produk pada bootstrap selalu negatif (-4,1 pp s.d. -1,5 pp) — produk independensi melebih-lebihkan survival leg acak; pada perakitan gap-nya dekat nol (-3,5 pp s.d. +1,0 pp).

Kesepakatan pasar (1X2 domestik, model_prob ≥65%, market_prob tersedia, n=1): spread ≤0,05: n=1, hit-rate 100,0%, gap +22,5 pp; spread 0,05–0,10: n=0, hit-rate —, gap —; spread >0,10: n=0, hit-rate —, gap —.

## Usulan grade (untuk Phase B)

Definisi: grade adalah janji lantai hit-rate — **A ≥ 80,0%, B ≥ 70,0%, C ≥ 60,0%** — dan wilayah grade lolos bila hit-rate empiris wilayahnya ≥ lantai − 0,02 (toleransi). Aturan keras: sel (market, pita) dengan n<200 itu **tipis** dan tidak bisa menopang grade A (mentok B); market yang pita tingginya overconfident (gap < −3,0 pp, n≥100) ambang A-nya dinaikkan di atas pita itu atau A ditahan, dinyatakan eksplisit per market. Basis bukti: tabel pita domestik di atas (populasi calibrated) + split per seleksi di JSON.

**Satu set ambang global TIDAK dapat dipertahankan** — pemeriksaan lantai per wilayah gagal untuk set global mana pun yang diuji (0,75/0,80/0,85 untuk A), jadi usulan di bawah per market. Detail kegagalan global ada di JSON (`grades.global = null`, mode `per-market`).

| Market | Grade A (ambang, n, hit-rate) | Grade B | Grade C | Catatan |
|---|---|---|---|---|
| 1x2 | ≥70,0% · n=360 · hit 78,1% · TIPIS (mentok B) | ≥60,0% · n=1.336 · hit 70,0% | DITAHAN — Wilayah [0,55, 0.6) tidak mencapai lantai C 0.6 − 0.02 dengan n≥50 (n wilayah=889, hit-rate 0.5692). | Pita 70–75 tipis (n=187 < 200). Pita 75–80 tipis (n=111 < 200). Pita 80–85 tipis (n=49 < 200). |
| btts | DITAHAN — Pita tinggi overconfident (gap < −0,03): 70–75 gap -0.08 (n=274) — menaikkan ambang A di atas pita itu menyisakan wilayah terlalu tipis, jadi A ditahan. | DITAHAN — Wilayah [0,60, 1.01) tidak mencapai lantai B 0.7 − 0.02 dengan n≥100 (n wilayah=3090, hit-rate 0.6032). | ≥60,0% · n=3.090 · hit 60,3% | Pita 75–80 tipis (n=51 < 200). Pita 80–85 tipis (n=13 < 200). Pita 85+ tipis (n=2 < 200). |
| dc | ≥75,0% · n=9.023 · hit 78,2% | ≥60,0% · n=9.571 · hit 69,8% | DITAHAN — Wilayah [0,55, 0.6) tidak mencapai lantai C 0.6 − 0.02 dengan n≥50 (n wilayah=2111, hit-rate 0.5793). | Seleksi '12' pita 85+ overconfident: gap -0.0454 (n=178) — jangan nilai seleksi ini setara pooled market-nya di pita itu. |
| ou15 | ≥85,0% · n=1.320 · hit 85,5% | ≥60,0% · n=6.986 · hit 74,6% | ≥55,0% · n=209 · hit 58,4% | Seleksi 'over' pita 80–85 overconfident: gap -0.0391 (n=2155) — jangan nilai seleksi ini setara pooled market-nya di pita itu. |
| ou25 | DITAHAN — Pita tinggi overconfident (gap < −0,03): 70–75 gap -0.0434 (n=517); 75–80 gap -0.0686 (n=199) — menaikkan ambang A di atas pita itu menyisakan wilayah terlalu tipis, jadi A ditahan. | ≥70,0% · n=805 · hit 69,2% | ≥60,0% · n=2.904 · hit 60,7% | Pita 75–80 tipis (n=199 < 200). Pita 80–85 tipis (n=69 < 200). Pita 85+ tipis (n=20 < 200). |
| ou35 | ≥85,0% · n=385 · hit 86,8% | ≥60,0% · n=6.208 · hit 72,7% | ≥55,0% · n=1.147 · hit 64,2% | Seleksi 'under' pita 80–85 overconfident: gap -0.0396 (n=621) — jangan nilai seleksi ini setara pooled market-nya di pita itu. |
| team_over05_away | ≥75,0% · n=3.188 · hit 78,9% | ≥70,0% · n=1.845 · hit 70,1% | ≥55,0% · n=3.063 · hit 62,7% | — |
| team_over05_home | ≥70,0% · n=6.958 · hit 80,1% | ≥65,0% · n=793 · hit 69,9% | ≥55,0% · n=675 · hit 61,8% | — |

- **1x2** — A: Wilayah ≥0.7 lolos lantai (hit-rate 0.7806, n wilayah=360) TAPI semua sel pita di wilayahnya tipis (70–75=187, 75–80=111, 80–85=49, 85+=13; semua < 200) — aturan sel tipis: A tidak diberikan, pick wilayah ini mentok grade B. B: Hit-rate wilayah [0.6, 1.01): 0.6999 ≥ lantai 0.7 − 0.02 (n=1336). C: Wilayah [0,55, 0.6) tidak mencapai lantai C 0.6 − 0.02 dengan n≥50 (n wilayah=889, hit-rate 0.5692). Caveat: Pita 70–75 tipis (n=187 < 200). Pita 75–80 tipis (n=111 < 200). Pita 80–85 tipis (n=49 < 200). Pita 85+ tipis (n=13 < 200).
- **btts** — A: Pita tinggi overconfident (gap < −0,03): 70–75 gap -0.08 (n=274) — menaikkan ambang A di atas pita itu menyisakan wilayah terlalu tipis, jadi A ditahan. B: Wilayah [0,60, 1.01) tidak mencapai lantai B 0.7 − 0.02 dengan n≥100 (n wilayah=3090, hit-rate 0.6032). C: Hit-rate wilayah [0.6, 1.01): 0.6032 ≥ lantai 0.6 − 0.02 (n=3090). Caveat: Pita 75–80 tipis (n=51 < 200). Pita 80–85 tipis (n=13 < 200). Pita 85+ tipis (n=2 < 200).
- **dc** — A: Hit-rate wilayah ≥0.75: 0.7817 ≥ lantai 0.8 − 0.02, ditopang sel pita tebal (n≥200) di wilayahnya; tanpa pita overconfident di atasnya. B: Hit-rate wilayah [0.6, 0.75): 0.6979 ≥ lantai 0.7 − 0.02 (n=9571). C: Wilayah [0,55, 0.6) tidak mencapai lantai C 0.6 − 0.02 dengan n≥50 (n wilayah=2111, hit-rate 0.5793). Caveat: Seleksi '12' pita 85+ overconfident: gap -0.0454 (n=178) — jangan nilai seleksi ini setara pooled market-nya di pita itu.
- **ou15** — A: Hit-rate wilayah ≥0.85: 0.8553 ≥ lantai 0.8 − 0.02, ditopang sel pita tebal (n≥200) di wilayahnya; tanpa pita overconfident di atasnya. B: Hit-rate wilayah [0.6, 0.85): 0.7455 ≥ lantai 0.7 − 0.02 (n=6986). C: Hit-rate wilayah [0.55, 0.6): 0.5837 ≥ lantai 0.6 − 0.02 (n=209). Caveat: Seleksi 'over' pita 80–85 overconfident: gap -0.0391 (n=2155) — jangan nilai seleksi ini setara pooled market-nya di pita itu.
- **ou25** — A: Pita tinggi overconfident (gap < −0,03): 70–75 gap -0.0434 (n=517); 75–80 gap -0.0686 (n=199) — menaikkan ambang A di atas pita itu menyisakan wilayah terlalu tipis, jadi A ditahan. B: Hit-rate wilayah [0.7, 1.01): 0.6919 ≥ lantai 0.7 − 0.02 (n=805). C: Hit-rate wilayah [0.6, 0.7): 0.6074 ≥ lantai 0.6 − 0.02 (n=2904). Caveat: Pita 75–80 tipis (n=199 < 200). Pita 80–85 tipis (n=69 < 200). Pita 85+ tipis (n=20 < 200). Seleksi 'over' pita 75–80 overconfident: gap -0.0428 (n=129) — jangan nilai seleksi ini setara pooled market-nya di pita itu.
- **ou35** — A: Hit-rate wilayah ≥0.85: 0.8675 ≥ lantai 0.8 − 0.02, ditopang sel pita tebal (n≥200) di wilayahnya; tanpa pita overconfident di atasnya. B: Hit-rate wilayah [0.6, 0.85): 0.7266 ≥ lantai 0.7 − 0.02 (n=6208). C: Hit-rate wilayah [0.55, 0.6): 0.6417 ≥ lantai 0.6 − 0.02 (n=1147). Caveat: Seleksi 'under' pita 80–85 overconfident: gap -0.0396 (n=621) — jangan nilai seleksi ini setara pooled market-nya di pita itu.
- **team_over05_away** — A: Hit-rate wilayah ≥0.75: 0.7892 ≥ lantai 0.8 − 0.02, ditopang sel pita tebal (n≥200) di wilayahnya; tanpa pita overconfident di atasnya. B: Hit-rate wilayah [0.7, 0.75): 0.7014 ≥ lantai 0.7 − 0.02 (n=1845). C: Hit-rate wilayah [0.55, 0.7): 0.6272 ≥ lantai 0.6 − 0.02 (n=3063).
- **team_over05_home** — A: Hit-rate wilayah ≥0.7: 0.8007 ≥ lantai 0.8 − 0.02, ditopang sel pita tebal (n≥200) di wilayahnya; tanpa pita overconfident di atasnya. B: Hit-rate wilayah [0.65, 0.7): 0.6986 ≥ lantai 0.7 − 0.02 (n=793). C: Hit-rate wilayah [0.55, 0.65): 0.6178 ≥ lantai 0.6 − 0.02 (n=675).

Opsi spread kesepakatan tidak diusulkan sebagai gerbang: subset 1X2 bermarket_prob pada prob tinggi terlalu kecil (bucket spread >0,10: n=0) untuk menopang aturan.

## Keterbatasan

- **sm_prob absen untuk riwayat.** `predictions.db` hanya mencakup fixture mendatang; 35 fixture yang tumpang tindih dengan match finished di dataset semuanya ditangkap SETELAH kickoff (refresh harian menangkap ulang fixture yang sudah bermain), jadi mengisinya akan jadi kebocoran pasca-laga. Filter `captured_utc < kickoff` menghasilkan 0 baris — sm_prob null di semua pick lab, dan kolom kesepakatan tiga-sumber belum bisa diukur dari lab ini.
- **market_prob hanya untuk 1X2 dan hanya era tangkapan odds** (tangkapan mulai 2026-10-18; subset match uji yang punya closing line kecil dan condong ke match terbaru). Angka kesepakatan pasar di atas berasal dari subset kecil itu.
- **Status-at-pick-time = status kanonik saat ini.** Populasi domestik disaring dengan status calibrated registry *sekarang* (basis kanonik pasca-rekalibrasi), bukan status historis pada tanggal laga — lab mengukur model tervalidasi saat ini secara walk-forward, bukan rekonstruksi keputusan historis.
- **n piala kecil** dan terpool lintas 17 kompetisi dengan status gerbang berbeda-beda (partial/uncalibrated); tabel pita piala indikatif, bukan basis grade. Grade diusulkan HANYA dari populasi domestik calibrated.
- **Survival mengasumsikan leg terbaik per match** dan, pada angka prediksi, independensi antar-leg. Gap empiris-vs-produk di tabel adalah ukuran seberapa jauh asumsi itu meleset (korelasi tanggal/liga yang sama tidak dimodelkan).
- Lipatan memakai fraksi kronologis per liga (bukan batas musim), persis seperti harness validasi — musim yang terpotong di tengah ikut terdistribusi ke train/test sesuai urutan tanggal.

## Reproduksi

```bash
npx tsx scripts/parlay-lab.ts            # generate → resolve → analyze (idempoten)
npx tsx scripts/parlay-lab.ts --skip-cups
npx tsx scripts/resolve-pick-outcomes.ts # pembuktian silang: harus melaporkan resolved: 0 setelah lab
```
