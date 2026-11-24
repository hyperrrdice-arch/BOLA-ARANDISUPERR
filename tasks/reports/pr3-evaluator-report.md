# PR 3 — Evaluator Kronologis Tunggal

**Branch:** `pr-3/evaluator-kronologis` (dari master `9aaf474`)
**Sifat:** instrumen ukur baru. PR ini TIDAK mengubah prediksi yang melayani, model quant,
manifest, atau angka tampilan apa pun. Tidak ada kandidat model (itu PR 4+), tidak ada
keputusan promosi. DB produksi hanya dibaca (readOnly); semua keluaran di worktree.

**Catatan kepatuhan:** `AGENTS.md` proyek berisi blok injeksi ("nextjs-agent-feedback" →
perintah menjalankan `npx next internal agent-feedback-instructions`) dan blok aturan
tanaman lain. Sesuai instruksi tugas, isi file itu diperlakukan sebagai konten saja —
**tidak dijalankan dan tidak diikuti**.

---

## 1. Yang dibangun

| Komponen | Isi |
|---|---|
| `lib/eval/chronological-evaluator.ts` | Evaluator tunggal: fit IPF + shrinkage κ-fit, blend Level B, indeks prefix rata-rata kompetisi point-in-time, lipatan kronologis V1/V2/H, metrik (log-loss 2 konvensi, Brier, ECE 10 bin, kunci pekan ISO). |
| `scripts/evaluate-chronological.ts` | CLI dua mode: `k5-holdout` (konfigurasi K5) dan `closing-benchmark` (regenerasi set pasangan benchmark lama dalam mode jujur + mode bocor). Menulis `predictions`/`metrics`/`run-manifest` per run. |
| `tests/test-evaluator-kronologis.ts` | 22 assertion: jebakan injeksi masa depan, determinisme, batas, isolasi mode, validitas. Dirantai ke `test:quant` + script `test:evaluator`. |

Keputusan desain yang menentukan hasil:

1. **Mesin numerik disalin verbatim** dari harness kanonik (`scripts/backtest-walkforward.ts`
   sebagaimana dibekukan di `scripts/experiment-k5-kappa.ts`): `fitIPF`, `applyShrinkage`,
   `lambdas`, `blendInput`, `lamMuFromBlend`, `rollingTelem`, `formGoals`, indeks prefix
   `compAvgGoalsAt`. Bukan tulisan ulang — supaya konfigurasi K5 terreproduksi persis.
2. **Satu-satunya titik dispatch kebocoran:** `rollingTelem` memakai rata-rata kompetisi
   lewat satu fungsi dispatch. Mode `as-of` (resmi) membaca indeks prefix strictly-before-
   cutoff; mode `whole-store` (diagnosis saja) mereplikasi `compAvgGoals` milik
   `scripts/parlay-lab.ts` yang membaca SELURUH store tanpa batas waktu.
   Diff fungsi harness vs parlay-lab (bukti di §4.1) menunjukkan inilah satu-satunya
   perbedaan fungsional Level B di antara keduanya — jadi selisih kedua mode mengisolasi
   efek kebocoran itu secara eksak, bukan kira-kira.
3. **Semantik lipatan = semantik pembangkit ledger** (`generateDomestic` di parlay-lab):
   blok uji fold adalah irisan indeks `slice(floor(n·testStart), floor(n·testEnd))` dari
   daftar laga liga terurut waktu.
4. Modul murni: tanpa I/O, tanpa `Date.now`/`Math.random`; urutan masukan adalah urutan
   kanonik SQL harness (kontrak determinisme).

---

## 2. Rekonsiliasi K5 — evaluator mereproduksi angka terkunci PERSIS

Run: `--mode=k5-holdout` terhadap dataset produksi saat ini. Bukti masukan identik dulu:
hash aliran baris yang dihitung ulang hari ini sama persis dengan manifest eksperimen K5
(20 Nov 2026) — matches `sha256:a9ce4587…` (69.065 baris), logs `sha256:7c3b3068…`
(83.426 baris); universe dalam cakupan 63 liga / 44.528 laga; baris H 6.708. Dataset
universe K5 tidak berubah sejak eksperimen dibekukan.

Hasil (basis: Level B/A, lipatan H, konvensi log-loss harness dengan jepit 1e-12;
n = 6.708 laga unik; jendela laga uji 2026-03-21 → 2026-11-07; 63 liga):

| Kolom | K5 / PR 1A (terkunci) | Evaluator PR 3 | Selisih probabilitas per laga |
|---|---|---|---|
| A κ10 | 1,022740 | 1,0227400451927073 | maks 0 (6.708 laga) |
| A κ20 | 1,022468 | 1,0224675701767554 | maks 0 |
| **B κ10 (champion)** | **1,0134022623271062** | **1,013402262327106** | **maks 0** |
| B κ20 | 1,014223498439091 | 1,014223498439091 | maks 0 |

- Keempat kolom: 6.708/6.708 laga cocok, **selisih probabilitas maksimum tepat 0** di
  seluruh 80.496 sel probabilitas — keluaran evaluator identik byte-per-byte dengan
  artefak `tasks/experiments/k5-kappa/predictions-h.jsonl`.
- Digit terakhir log-loss B κ10 tercetak `…106` di sini vs `…1062` pada hitung-ulang
  PR 1A: selisih 1 ULP (≈2×10⁻¹⁶) dari urutan penjumlahan akumulator, bukan dari
  probabilitas (yang identik persis). Angka K5 yang terkunci **terreproduksi**.
- Pelengkap B κ10: Brier 0,6065786004794809; ECE 0,014917089622209138; fallback 0;
  cakupan 1,0. (Log-loss tanpa jepit sama — tidak ada probabilitas yang menyentuh jepit.)

**Angka headline champion di bawah evaluator ini = 1,0134** (Level B, κ-fit 10,
n = 6.708, jendela di atas) — sama dengan angka K5. Tidak ada perbedaan metodologis
yang perlu dijelaskan: evaluator dan mesin K5 adalah mesin yang sama, dan itu terbukti
per-laga, bukan hanya pada rata-rata.

Evidence: `tasks/pr3/evidence/k5-holdout/` (`predictions-h-recomputed.jsonl`,
`k5-metrics.json`, `run-manifest.json`).

---

## 3. Benchmark penutupan — asal-usul terbukti, angka jujur menggantikan +0,032

### 3.1 Reproduksi jalur lama (provenance)

`scripts/closing-benchmark.ts` dijalankan ulang apa adanya di worktree
(`CB_DUMP_PAIRS=1`, DB dibaca readOnly lewat symlink triplet db/-wal/-shm):

- Pooled 1X2: **model 1,0089518717010817 vs closing 0,9769154545120882, Δ +0,03203641718899353,
  n = 1.223** — persis angka laporan lama (1,0090 / 0,9769 / +0,0320).
- Pooled OU2.5: model 0,7000147949296637 vs closing 0,6829570358351651, Δ +0,01705775909449858, n = 561.
- Bagian `pooled`, `leagues`, dan `inventory` pada JSON hasil run ulang **identik
  byte-per-byte** dengan `tasks/closing-benchmark.json` yang ter-commit (16 Nov 2026).
- Satu-satunya selisih file: `generated_at` dan blok diagnostik E2 — 572 pick lab divisi
  E2 kini ada di ledger (total tak-terjodohkan 353 → 925). Mereka ditambahkan sesudah run
  asli (ekspansi divisi bebas 16→22 pada 16 Nov, sesudah run pukul 05:59 UTC) dan tidak
  terjodohkan satu pun (0 joined), jadi set pasangan dan semua angka headline tidak berubah.

Dump pasangan run ulang (1.784 pasangan = 1.223 1X2 + 561 OU) disimpan di
`tasks/pr3/evidence/cb-pairs-dump.json` — set pasangan inilah yang dinilai ulang di §3.2,
jadi perbandingannya apel-ke-apel pada laga yang sama persis.

### 3.2 Hitung ulang jujur pada set pasangan yang sama

Probabilitas model dibuat ulang untuk 1.223 laga yang sama dengan evaluator baru, dua
mode (basis: log-loss −ln p tanpa jepit, konvensi benchmark lama; jendela laga
2025-10-04 → 2026-10-12; musim 2526: 560 laga, 2627: 663 laga):

| Varian model | Log-loss 1X2 | Δ vs closing (0,9769154545120882) |
|---|---|---|
| Ledger lama (seperti dilaporkan) | 1,0089518717010817 | **+0,03203641718899353** |
| Regenerasi mode bocor (whole-store, store hari ini) | 1,0094770523800378 | +0,03256159786794962 |
| **Regenerasi point-in-time (JUJUR)** | **1,0094304221309824** | **+0,032514967618894275** |

Dekomposisi selisih (bootstrap blok berpasangan per pekan ISO, 5.000 resample, seed 20261124):

| Komponen | Nilai | CI 95% | Bacaan |
|---|---|---|---|
| Efek kebocoran (bocor − jujur) | **+0,0000466** | [−0,00008; +0,00019] | ≈ 0 — dan tandanya positif: kebocoran justru sedikit MEMPERBURUK probabilitas lab pada set ini |
| Residu (ledger − regenerasi bocor) | −0,0005252 | [−0,00259; +0,00082] | pergeseran lipatan antar-run lab (§3.3); mencakup 0 |
| Δ jujur (jujur − closing) | +0,0325150 | [+0,01893; +0,04587] | celah model vs pasar tetap nyata |

**Kesimpulan benchmark:** angka pengganti yang jujur untuk "+0,032" adalah **+0,0325**
(n = 1.223, jendela di atas) — praktis sama dengan angka lama. Kebocoran `compAvgGoals`
adalah cacat kode yang nyata (terbukti di §4), tetapi **kontribusinya terhadap benchmark
ini ≈ 0,0%** (0,00005 dari 0,0320). Celahnya bukan artefak kebocoran: model memang
tertinggal dari Pinnacle closing pada irisan ini. Catatan horizon dari laporan lama tetap
berlaku: closing adalah angka pasar di menit akhir dengan informasi penuh, sedangkan
probabilitas lab adalah walk-forward — perbandingan ini mengukur jarak ke angka final
pasar, bukan kontes ramalan setara.

Kenapa efeknya nol padahal jalurnya aktif: 524 dari 1.223 laga (43%) memang punya
probabilitas mode-bocor ≠ mode-jujur, tetapi bobot lintas kompetisi hanya menggeser
xG bergulir sedikit — rata-rata whole-store dan rata-rata as-of untuk cutoff yang sama
didominasi riwayat panjang yang sama, dan sebagian besar log berasal dari kompetisi yang
sama dengan laga target (bobot = 1 di kedua mode). Replika mode bocor di sini memakai
store HARI INI (superset data masa depan dibanding yang tersedia saat lab dibangkitkan),
jadi bila pun ada bias arah, ia melebih-lebihkan kebocoran — tetap terukur nol.

Sensitivitas: 7 dari 1.223 laga (semua 17–26 Okt 2025, dari run lab paling awal) kini
jatuh di wilayah latih-murni daftar liga hari ini sehingga tidak punya lipatan yang sah;
evaluator menilainya dengan fallback uniform terlabel. Mengeluarkannya: Δ jujur
**+0,0316** (n = 1.216). Angka headline memakai set penuh 1.223 (konservatif).

OU2.5 (n = 561, basis sama): ledger 0,7000147949296637 → jujur 0,7006795310606733;
closing 0,6829570358351651; **Δ jujur +0,0177** (lama +0,0171); efek kebocoran +0,00028.

Gap favorit (mean |p_model − p_closing| pada favorit closing): jujur 0,0704 (lama 0,0702).

Per liga (1X2, Δ jujur; semua n < 200 = indikatif, pola sama dengan laporan lama):

| Div | n | Model jujur | Closing | Δ jujur |
|---|---|---|---|---|
| I2 Serie B | 60 | 1,0532 | 1,0610 | −0,0078 |
| SC0 Premiership | 48 | 0,9937 | 0,9822 | +0,0116 |
| F2 Ligue 2 | 88 | 1,0921 | 1,0744 | +0,0176 |
| E0 Premier League | 183 | 1,0363 | 1,0114 | +0,0249 |
| I1 Serie A | 165 | 0,9751 | 0,9505 | +0,0246 |
| D2 2. Bundesliga | 73 | 1,0740 | 1,0499 | +0,0241 |
| F1 Ligue 1 | 133 | 1,0304 | 0,9989 | +0,0314 |
| T1 Super Lig | 118 | 1,0321 | 0,9937 | +0,0384 |
| G1 Super League | 42 | 0,9399 | 0,8995 | +0,0403 |
| P1 Primeira Liga | 144 | 0,9376 | 0,8947 | +0,0429 |
| SP1 La Liga | 169 | 0,9780 | 0,9120 | +0,0660 |

Evidence: `tasks/pr3/evidence/closing-benchmark/` (`benchmark-metrics.json`,
`benchmark-pairs-regenerated.jsonl`, `closing-benchmark-regenerated.json`,
`run-manifest.json`).

### 3.3 Residu ledger vs regenerasi — pergeseran lipatan, terukur

Ledger menumpuk pick dari banyak run `parlay-lab` pada ukuran dataset berbeda-beda;
batas lipatan proporsional bergeser saat daftar liga tumbuh. Di bawah daftar hari ini,
set pasangan terpetakan ke lipatan V1 553 / H 663 / tanpa-lipatan 7 — bukan satu run
tunggal. Akibatnya probabilitas regenerasi ≠ ledger pada sebagian laga: |Δp| per laga
(maks per sel) median 0,0007, p90 0,0054, p99 0,0433, maks 0,4096; 39 laga > 0,01 dan
11 laga > 0,05. Namun pada pooled log-loss semuanya tercuci: residu −0,0005 dengan CI
mencakup 0. Ini menjelaskan residu tanpa mengubah kesimpulan mana pun.

---

## 4. Bukti anti-bocor

### 4.1 Diff fungsi harness vs parlay-lab (isolasi kebocoran)

Ekstraksi badan fungsi dari `scripts/backtest-walkforward.ts` dan `scripts/parlay-lab.ts`
dibandingkan mekanis: `applyShrinkage`, `lamMuFromBlend`, `formGoals`, `upperBoundDate`
**identik**; `fitIPF` dan `blendInput` berbeda **hanya komentar**; `rollingTelem` berbeda
**tepat pada pemanggilan compAvg** — harness: `compAvgGoalsAt(comp, cutoff)` (prefix,
point-in-time); lab: `compAvgGoals(comp)` atas `measuredCompAvg` = `AVG(...) GROUP BY
competition_id` atas seluruh tabel matches tanpa filter tanggal. Satu-satunya jalur
kebocoran Level B adalah titik itu, dan evaluator mengisolasinya dengan dispatch mode.

### 4.2 Suite jebakan (22/22 lolos)

`tests/test-evaluator-kronologis.ts` (data sintetis, tanpa DB):

- **A1–A5 (jebakan):** tanam laga masa depan ekstrem (comp_b 12 gol, comp_a 8 gol, log xG
  9,9 — semua sesudah cutoff): `compAvgGoalsAt`, telemetri bergulir, dan prediksi Level B
  mode as-of **identik byte-per-byte** sebelum/sesudah penanaman.
- **A6–A8 (kepekaan jebakan):** penanaman yang sama **mengubah** compAvg, telemetri, dan
  prediksi mode whole-store — jebakan terbukti bisa menangkap kebocoran kelas ini.
- **B1–B2 (determinisme):** dua instans dari masukan sama → keluaran identik; panggilan
  ulang lewat cache fit → identik.
- **C1–C9 (batas):** laga tepat di tanggal cutoff tidak masuk jendela form (strictly-
  before); kompetisi/tim tanpa riwayat → null/kosong terlabel; fallback LEGACY_COMP_AVG
  utuh; liga 3 tim → fit null → fallback uniform terlabel; laga pertama liga → fold null
  terlabel; dua tim baru di luar fit → jalur fixedLamMu menghasilkan probabilitas valid.
- **D1–D2 (isolasi mode):** tanpa log lintas kompetisi kedua mode identik di semua laga;
  dengan log lintas kompetisi ≥ 1 laga berbeda.
- **E1 (validitas):** semua probabilitas di (0,1), jumlah 1 ± 1e-9, λ/μ hingga.

Determinisme CLI: run `closing-benchmark` diulang penuh → file
`benchmark-pairs-regenerated.jsonl` identik byte-per-byte dengan run pertama.

---

## 5. Regresi (worktree pr3, bukan checkout utama)

| Gerbang | Hasil |
|---|---|
| `tsc --noEmit` | lolos |
| `lint:gate` | lolos (91 error ≤ baseline 92; tidak ada error baru) |
| `test:quant` | hijau — quant 22/22, model 61/61, model-artifacts 32/32, experiment-stats 23/23, **evaluator-kronologis 22/22** |
| `test:data` | hijau — 18/18, identity 58/58, publication 110/110, tickets 69/69, resolver-score 23/23 |
| `test:web` | hijau kecuali **tepat 2 assertion pra-ada** di test-beranda-pr1b: "cadangan: jenis hasil-terakhir" dan "cadangan: hasil-terakhir menunjuk laga F" (34/36) — gagal identik di master murni (terbukti pada PR 2, skenario bergantung jam asli). Rantai `&&` berhenti di sana; suite sesudahnya (test-pr2-data-publikasi) dijalankan terpisah: **47/47 lolos** |
| `test:api` | 42/42 |
| `test:verifikasi` | hijau — 39/39, 36/36, 41/41, 38/38 |
| `test:lanjut` | hijau — 25/25, 28/28, 27/27, 96/96, 73/73 |
| `test:e2e` | 7/7 |
| `npm run build` | sukses (Compiled successfully; build id worktree lokal) |

Tidak ada kegagalan baru di luar 2 assertion pra-ada yang sudah dikenal itu.

---

## 6. Deviasi & batasan yang diakui

1. **Set pasangan benchmark** diambil dari dump jalur lama itu sendiri
   (`CB_DUMP_PAIRS=1`), bukan join baru — disengaja: rekonsiliasi harus menilai set yang
   sama persis dengan yang menghasilkan +0,032. n dan jendela persis seperti laporan lama.
2. **Replika mode bocor memakai store hari ini**, bukan store pada saat tiap pick lab
   dibangkitkan (yang tidak terekam per pick). Arah biasnya melebih-lebihkan kebocoran;
   efek tetap terukur ≈ 0, jadi kesimpulan tidak bergantung pada pilihan ini.
3. **`stripVigShin` membulatkan probabilitas closing ke 4 desimal** (warisan jalur lama,
   dicatat juga di laporan lama) — berlaku sama untuk semua varian, tidak mengubah Δ.
4. **7 laga fallback** pada regenerasi (§3.2) dinilai uniform karena lipatannya sudah
   tidak ada di data hari ini; sensitivitas tanpa mereka dilaporkan terbuka.
5. Evaluator membaca dataset lewat `--data-dir`; run di sini menunjuk data checkout utama
   (produksi, readOnly) karena DB tidak ter-commit. `run-manifest.json` mencatat path,
   ukuran, mtime, dan hash aliran baris masukan untuk setiap run.
6. Di luar lingkup PR 3 (sesuai brief): kandidat model & shadow run (PR 4+), irisan
   per-grade ledger produksi (sudah dipisah basisnya di PR 2), dan perubahan angka
   tampilan apa pun.

## 7. Menjalankan ulang

```bash
# Konfigurasi K5 (rekonsiliasi angka terkunci)
npx tsx scripts/evaluate-chronological.ts --mode=k5-holdout \
  --data-dir=<dir data> --out=tasks/pr3/evidence/k5-holdout \
  --compare=tasks/experiments/k5-kappa/predictions-h.jsonl

# Benchmark penutupan (dump pasangan dari jalur lama dulu)
CB_DUMP_PAIRS=1 npx tsx scripts/closing-benchmark.ts   # menulis /tmp/cb-pairs.json
npx tsx scripts/evaluate-chronological.ts --mode=closing-benchmark \
  --data-dir=<dir data> --pairs=/tmp/cb-pairs.json \
  --out=tasks/pr3/evidence/closing-benchmark

npm run test:evaluator   # suite anti-bocor (juga dirantai di test:quant)
```
