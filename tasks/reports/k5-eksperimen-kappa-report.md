# Laporan K5 — Eksperimen κ Tersegel (Kandidat κ-fit 20 vs Champion κ-fit 10)

- **Kartu:** K5 (PRD Peningkatan Aplikasi Bola, bab Model Q3/Q4 + kartu K5)
- **Branch:** `prd/k5-eksperimen-kappa` (bertumpuk di atas K4, belum merge — merge menunggu K8)
- **SHA awal:** `4d6400a` (tip `prd/k4-model-paritas`)
- **SHA commit desain beku:** `14dfff5` — `docs(k5): bekukan desain eksperimen kappa-fit (pra-registrasi, sebelum run)`
- **Tanggal:** 2026-11-20
- **Status:** SELESAI di branch. Keputusan: **RETAIN** — champion κ-fit 10 dipertahankan; manifest aktif tidak berubah; tidak ada promosi. Produksi + deploy tidak dijalankan (menunggu K8).

## Ringkasan hasil

Desain eksperimen dibekukan dan di-commit (`14dfff5`) SEBELUM fit grid
apa pun berjalan — urutan commit adalah buktinya: desain `14dfff5` →
fungsi statistik murni `108d971` → runner `1c3b58f` → hasil `a031ebb`.
Grid κ-fit {5, 10, 15, 20} berjalan pada lipatan kronologis yang sama
untuk semua konfigurasi; pasangan keputusan (10 vs 20) dinilai pada
held-out H (6.708 laga berpasangan, 33 blok pekan). Menerapkan aturan
keputusan bab Q4 yang dikutip persis di desain beku menghasilkan
tepat satu keputusan: **RETAIN**. Di permukaan keputusan (Level B,
jalur produksi), challenger κ-fit 20 justru sedikit LEBIH BURUK
(Δ = +0,00082), jauh dari target manfaat −0,005, dan batas atas
bootstrap satu sisi 95% positif (+0,00159) — dua cek manfaat gagal;
cek perlindungan (cakupan, Brier) dan lantai sampel lolos.

## Rekonsiliasi desain (dokumen menang atas ringkasan brief)

Brief menyebut grid κ {5,10,15,20} × kfit {10,20}. Di mesin repo ini
κ dan kfit adalah SATU parameter: `scripts/calibrate-ratings.ts`
menulis `kappa` dan `kfit` dari nilai `SHRINK_KAPPA` yang sama, dan
`lib/quant/fit.ts` menyatakan "κ di sini adalah kfit". Grid dibekukan
sebagai satu sumbu **κ-fit ∈ {5, 10, 15, 20}** (memuat kedua himpunan
brief), dengan pasangan keputusan mengikuti dokumen (champion 10 vs
challenger 20); nilai 5/15 adalah titik sapuan validasi, bukan
kandidat promosi (dokumen: satu hipotesis). Seluruh penalaran ini
tertulis di `tasks/experiments/k5-kappa/DESIGN.md` §1 — sebelum run.

Konfigurasi beku semua konfigurasi: half-life 365, ρ zero, blend
James-Stein kappaScale 2, universe = liga registry
calibrated/partial dengan ≥120 laga selesai (aturan harness
walk-forward). Permukaan keputusan utama = Level B di H (ditetapkan
di desain §4 sebelum hasil ada); Level A diagnostik sekunder.

## Tabel hasil grid lengkap

### Sapuan validasi V1+V2 (n = 13.359, semua konfigurasi, baris identik)

| κ-fit | Level A LL | Level A Brier | Level B LL | Level B Brier |
|---|---|---|---|---|
| 5 | 1,0325 | 0,6178 | 1,0203 | 0,6111 |
| 10 (champion) | 1,0289 | 0,6162 | 1,0193 | 0,6105 |
| 15 | 1,0272 | 0,6157 | 1,0191 | 0,6105 |
| 20 (challenger) | 1,0268 | 0,6157 | 1,0194 | 0,6107 |

### Held-out H (n = 6.708, HANYA pasangan keputusan; rentang tanggal 2026-03-21…2026-11-07)

| Konfigurasi | Level A LL | Level A Brier | Level A ECE | Level B LL | Level B Brier | Level B ECE | Cakupan |
|---|---|---|---|---|---|---|---|
| κ-fit 10 (champion) | 1,0227 | 0,6125 | 0,0077 | **1,0134** | **0,6066** | 0,0149 | 1,0000 |
| κ-fit 20 (challenger) | 1,0225 | 0,6128 | 0,0111 | **1,0142** | **0,6071** | 0,0161 | 1,0000 |
| naive Poisson (konteks) | 1,0711 | 0,6480 | — | — | — | — | — |
| frekuensi liga (konteks) | 1,0702 | 0,6479 | — | — | — | — | — |

Audit segmen per liga (Level B, H): challenger lebih baik di 22
liga, champion lebih baik di 40 liga, 1 sama — tidak ada regresi
segmen material ke either arah; tabel penuh di `summary.json`
(`heldout.per_league_levelB`).

### Ketidakpastian (bootstrap blok pekan ISO, 5.000 resample, seed 20261120)

| Permukaan | mean Δ (challenger − champion) | UB satu sisi 95% | CI dua sisi 95% | N laga | Blok |
|---|---|---|---|---|---|
| Level B (utama) | **+0,000821** | **+0,001594** | [−0,000140, +0,001735] | 6.708 | 33 |
| Level A (sekunder) | −0,000272 | +0,000749 | [−0,001465, +0,000999] | 6.708 | 33 |

### Panel closing (TERPISAH — tidak masuk keputusan, sesuai desain §5)

232 laga berodds pre-kickoff; subset berpasangan dalam cakupan
model n = 145: closing LL 0,9720 (n=187 termasuk luar cakupan);
model κ-fit 10 LL 1,0278; κ-fit 20 LL 1,0192 pada subset yang sama.
Sampel kecil — dilaporkan apa adanya.

## Aturan keputusan — dikutip persis dan diterapkan langkah demi langkah

Aturan (bab Model Q4, dibekukan di DESIGN.md §7): PROMOTE hanya bila
SEMUA terpenuhi pada H Level B — (1) mean Δ ≤ −0,005; (2) batas atas
bootstrap satu sisi 95% < 0; (3) penurunan cakupan ≤ 2 poin
persentase; (4) kenaikan Brier ≤ 0,002; (5) lantai sampel N ≥ 1.000
laga dan ≥ 20 blok pekan. Lantai gagal → `inconclusive`; lantai lolos
+ ada cek gagal → `retain`.

| # | Cek | Ambang | Teramati (presisi penuh) | Hasil |
|---|---|---|---|---|
| 5 | Lantai sampel | N ≥ 1.000 & blok ≥ 20 | N = 6.708, blok = 33 | LOLOS |
| 1 | Mean Δ | ≤ −0,005 | +0,0008212361119898341 | **GAGAL** |
| 2 | UB bootstrap 95% | < 0 | +0,0015937300459903205 | **GAGAL** |
| 3 | Penurunan cakupan | ≤ 0,02 | 0 (kedua konfigurasi cakupan 1,0000; nol fallback uniform) | LOLOS |
| 4 | Kenaikan Brier | ≤ 0,002 | +0,0005589467427687955 | LOLOS |

**Keputusan akhir (tepat satu): RETAIN.** Champion κ-fit 10 tetap
menjadi konfigurasi produksi. Karena keputusan bukan PROMOTE,
mekanisme gerbang K4 tidak dijalankan dan manifest aktif branch
(`data/model-manifest.json`) tidak berubah — terverifikasi dari
status git (file tidak termodifikasi di branch ini).

Catatan kejujuran angka: margin historis Fase 3 (Level A κ-fit
10→20 sebesar 0,0026, pra-PRD) TIDAK tereproduksi pada run tersegel
ini — Δ Level A sekarang hanya −0,0003 dan Δ Level B berbalik tanda
(+0,0008). Dataset telah bertumbuh sejak run lama (69.065 laga
selesai sm:% vs ±54 ribu), sehingga baris H tidak identik. Inilah
gunanya pra-registrasi: kesimpulan lama tidak dibawa sebagai hasil,
dan ambang −0,005 + bootstrap yang lebih ketat dari perbandingan
historis memutuskan berdasarkan bukti run ini.

## Determinisme & paritas jalur fit (Q02)

- Konfigurasi champion (κ-fit 10) di-fit dua kali dari nol pada
  himpunan latih H yang sama untuk 63 liga cakupan: hash serialisasi
  parameter **identik** (sha256 sama persis, dicatat di
  `summary.json`/`experiment-manifest.json`).
- Cek silang jalur fit bersama K4 (`lib/quant/fit.ts`) vs mesin
  harness pada masukan yang sama: selisih parameter maksimum **0**.
- Hitung ulang independen dari artefak ter-commit
  (`predictions-h.jsonl`, skrip Python terpisah): mean Δ Level B
  = +0,0008212361119898 — cocok dengan `decision.json`.

## File berubah

- Baru: `tasks/experiments/k5-kappa/DESIGN.md` (beku, commit
  pertama), `lib/quant/experiment-stats.ts` (bootstrap blok + aturan
  keputusan murni), `tests/test-experiment-stats.ts` (23 assertion),
  `scripts/experiment-k5-kappa.ts` (runner; mesin evaluasi disalin
  verbatim dari `scripts/backtest-walkforward.ts`), artefak hasil di
  `tasks/experiments/k5-kappa/` (`experiment-manifest.json`,
  `summary.json`, `decision.json`, `predictions-h.jsonl`, `run.log`).
- Diubah: `package.json` (`test:quant` merantai suite statistik
  eksperimen).
- Tidak disentuh: file read-only, mesin rating (fit bersama K4
  dipakai apa adanya), manifest aktif, skema K2/K3, database
  produksi (dataset dibuka read-only dari checkout utama; tidak ada
  penulisan ke sana — keluaran hanya di worktree K5), app live.

## Perintah verifikasi + hasil

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | quant 22/22 · model 61/61 · **experiment-stats 23/23** |
| `npm run test:data` | 0 | data 18/18 · identity 58/58 · publication 89/89 · tickets 69/69 |
| `npm run test:web` | 0 | 12/12 |
| `npm run test:e2e` | 0 | 7/7 |
| `npm run test:baseline:d01` | 0 | 12/12 (D01 tetap hijau) |
| `npm run build` (env placeholder .env.example) | 0 | build bersih |
| `test:quant` jalan kedua | 0 | hasil identik |
| `eslint` 3 file K5 | 0 | bersih |
| Runner eksperimen (1×, dataset read-only) | 0 | runtime internal 18,8 dtk; wall ±13,5 mnt didominasi baca dingin page-cache dataset 3 GB |

## Cara kembali (rollback)

Branch belum merge: membuang `prd/k5-eksperimen-kappa` membatalkan
K5 sepenuhnya. Keputusan RETAIN berarti tidak ada perubahan perilaku
produksi sama sekali — konfigurasi champion, manifest aktif, dan
jalur fit persis seperti di tip K4.

## Belum terbukti / terbuka

- **Produksi + deploy menunggu K8** (keputusan pemilik: merge
  sekali di kartu terakhir). Keputusan RETAIN K5 membuat rilis K8
  tidak membawa perubahan konfigurasi model.
- **Bukti konfirmasi prospektif (shadow) belum terkumpul** — sesuai
  bab Q3, data prospektif adalah bukti konfirmasi utama berikutnya;
  eksperimen κ berikutnya (mis. hipotesis shrinkage bertingkat per
  jumlah laga, saran bab Q4) memerlukan holdout baru dan desain beku
  baru, bukan pembukaan ulang angka ini.
- Panel closing berbasis subset kecil (n = 145 berpasangan) —
  indikatif saja, tidak pernah masuk keputusan.
- **32 konflik skor antrean identitas K1 masih terbuka** — menunggu
  peninjauan pemilik; tidak disentuh kartu ini.
