# Desain Beku Eksperimen K5 — Kandidat κ-fit 20 vs Champion κ-fit 10

- **Kartu:** K5 (PRD Peningkatan Aplikasi Bola)
- **Branch:** `prd/k5-eksperimen-kappa`
- **SHA basis:** `4d6400a` (tip `prd/k4-model-paritas`)
- **Status dokumen:** BEKU. Dokumen ini di-commit sebagai commit tersendiri
  SEBELUM fit grid apa pun dijalankan. Urutan commit adalah buktinya.
  Perubahan desain sesudah hasil terlihat dilarang; bila desain ternyata
  tidak dapat dijalankan, kegagalannya dicatat apa adanya di laporan,
  bukan diganti diam-diam.
- **Sumber kebenaran desain:** `docs/plans/peningkatan-aplikasi-bola/
  02-model-quant.md` bab Q3 (eksperimen pertama) + Q4 (rumus dan
  keputusan promosi) dan kartu K5 di `05-kartu-muse.md`. Dokumen menang
  atas ringkasan brief bila berbeda.

## 1 · Rekonsiliasi grid brief dengan dokumen & mesin

Brief K5 menyebut grid κ {5, 10, 15, 20} × kfit {10, 20}. Di mesin
repo ini κ dan kfit BUKAN dua parameter bebas:

- `scripts/calibrate-ratings.ts` menulis `kappa: SHRINK_KAPPA` dan
  `kfit: SHRINK_KAPPA` — satu nilai, dua nama (manifest K4 pun
  menyimpan keduanya dari nilai yang sama).
- `lib/quant/fit.ts`: "κ di sini adalah 'kfit' pada penamaan harness
  lab" — shrinkage fit log-space `n/(n+κ)` di `fitLeagueRatings`.

Memvariasikan keduanya secara independen menuntut penulisan ulang
mesin (dilarang kartu ini). Maka grid dibekukan sebagai **satu sumbu
κ-fit ∈ {5, 10, 15, 20}** — memuat himpunan κ brief {5,10,15,20} dan
himpunan kfit brief {10,20}. Pasangan keputusan mengikuti dokumen:
**champion κ-fit 10** (default produksi, manifest aktif
`2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2`) vs **challenger
κ-fit 20** (Kandidat A bab Q3). Nilai 5 dan 15 adalah titik sapuan
konteks di jendela validasi; keduanya BUKAN kandidat promosi pada
eksperimen ini (dokumen: satu hipotesis).

## 2 · Konfigurasi beku (semua konfigurasi, tanpa kecuali)

| Aspek | Nilai |
|---|---|
| Sumbu eksperimen | κ-fit ∈ {5, 10, 15, 20} |
| Half-life decay | 365 hari |
| Kebijakan ρ | zero (ρ = 0) |
| Blend Level B | James-Stein, kappaScale = 2 (produksi, `js2`) |
| Universe | kompetisi `sm:%`, status finished, skor ada; liga berstatus registry `calibrated`/`partial` dengan ≥ 120 laga selesai (aturan cakupan harness walk-forward, `MIN_MATCHES=120`) |
| Data | `data/thestats_dataset.db` checkout utama, dibuka read-only; hash aliran baris masukan dicatat di manifest eksperimen |
| Fit | jalur bersama K4 (`fitIPF` harness ≡ `fitLeagueRatings` lib/quant/fit.ts; shrinkage diterapkan sebagai varian atas fit dasar, identik dengan `applyShrinkage` harness dan `shrinkKappa` lib) |

Tidak ada perubahan blend, prior, input, jam keputusan, atau kebijakan
pilihan antar-konfigurasi — hanya κ-fit yang berubah.

## 3 · Jendela (lipatan) — sama untuk semua konfigurasi

Lipatan kronologis per liga dari harness walk-forward (proporsional
terhadap riwayat tiap liga, baris identik lintas konfigurasi):

| Lipatan | Latih | Uji |
|---|---|---|
| V1 | [0%, 55%) | [55%, 70%) |
| V2 | [0%, 70%) | [70%, 85%) |
| H | [0%, 85%) | [85%, 100%) |

- Sapuan {5, 10, 15, 20} dievaluasi pada **V1+V2** (validasi), Level A
  dan Level B.
- **H hanya dihitung untuk pasangan keputusan (10, 20)** — disiplin
  anti-tuning harness: konfigurasi non-pasangan tidak pernah menyentuh
  H, jadi tidak ada angka H untuk κ-fit 5/15.
- Keputusan diambil dari H. Tanggal absolut baris H dicatat di
  manifest eksperimen sesudah run (fakta data, bukan pilihan desain).

Pemisahan latih/uji mematuhi kontrak Q02: fit pada cutoff lipatan
hanya memakai baris final bertanggal ketat sebelum awal blok uji
liga tersebut; tidak ada baris ≥ cutoff di latih.

## 4 · Jalur evaluasi

- **Level A** — model rating murni: fit → λ/μ → `calculateDixonColes`
  → probabilitas 1X2 dari matriks skor presisi penuh (konvensi
  harness `probsFromLib`). Fit patologik (matriks ditolak lib) →
  prediksi uniform (1/3,1/3,1/3), terhitung terbuka sebagai fallback,
  laga TIDAK dibuang.
- **Level B** — replikasi jalur produksi `getShrunkMatchParameters`:
  prior fit + form/telemetri rolling point-in-time (hanya data <
  tanggal laga) + blend James-Stein kappaScale 2 (konvensi harness
  `blendInput`/`lamMuFromBlend`).
- **Permukaan keputusan utama = Level B di H** (kartu K5: blend
  disejajarkan dan hadir dalam perbandingan; bab Q1 mengutip angka
  Level B sebagai bukti relevan-produksi). Level A di H dilaporkan
  sebagai diagnostik sekunder. Bila keduanya berlawanan arah,
  keputusan tetap mengikuti Level B — ditetapkan di sini, sebelum
  hasil ada, agar tidak ada belanja level sesudah melihat angka.

## 5 · Metrik

- **Utama:** log-loss 1X2 per laga `−ln(p_hasil_aktual)` (p dijepit
  1e-12), dirata-rata berbobot satu per laga.
- **Sekunder:** Brier 1X2 (Σ_k (p_k − y_k)² per laga, dirata-rata);
  ECE (10 bin tetap lebar 0,1 per kelas, konvensi harness); slope
  kalibrasi; **cakupan** = 1 − (laga fallback uniform / total laga uji)
  per konfigurasi.
- **Konteks di H (bukan keputusan):** baseline frekuensi liga dari
  latih (proporsi hasil 1X2 per liga di blok latih H) dan baseline
  naive Poisson rata-rata liga (konvensi harness).
- **Panel terpisah (bukan keputusan):** closing line — tangkapan
  pre-kickoff terakhir per laga, Shin-stripped, model pasangan
  keputusan (Level A) dinilai pada subset berpasangan yang sama
  (konvensi benchmark harness).

## 6 · Ketidakpastian (bab Q4)

`Δ_m = LL_m(challenger) − LL_m(champion)` per laga H (Level B,
berpasangan pada baris identik). Bootstrap blok berpasangan: blok =
pekan ISO (UTC) dari tanggal laga, digabung lintas liga; semua laga
dan kedua model dalam satu blok tetap bersama; **5.000** resample;
PRNG mulberry32 dengan **seed tetap 20261120**. Dilaporkan: mean Δ,
batas atas satu sisi 95% (persentil ke-95), interval dua sisi 95%,
N laga unik, jumlah blok pekan.

## 7 · ATURAN KEPUTUSAN (dikutip dari bab Q4, mengikat)

Tepat SATU keputusan dicatat: `promote`, `retain`, atau
`inconclusive`.

**PROMOTE** challenger κ-fit 20 hanya bila SEMUA terpenuhi pada H
Level B:

1. mean Δ ≤ **−0,005** (target manfaat terdaftar);
2. batas atas bootstrap satu sisi 95% dari Δ **< 0**;
3. penurunan cakupan ≤ **2 poin persentase** (cakupan champion −
   cakupan challenger ≤ 0,02);
4. kenaikan Brier ≤ **0,002** (Brier challenger − Brier champion
   ≤ 0,002) pada irisan utama H;
5. lantai sampel: N_H ≥ **1.000** laga DAN ≥ **20** blok pekan
   terwakili.

- Bila (5) gagal → **INCONCLUSIVE**: champion dipertahankan, data
  shadow/prospektif yang masih dibutuhkan didaftar di laporan.
- Bila (5) terpenuhi dan salah satu (1)–(4) gagal → **RETAIN**:
  champion κ-fit 10 dipertahankan.
- Sapuan κ-fit 5/15 tidak dapat memicu promosi dalam eksperimen ini,
  sebagus apa pun angkanya; angka mereka hanya konteks untuk
  hipotesis eksperimen berikutnya.

## 8 · Determinisme

Konfigurasi champion (κ-fit 10) di-fit dua kali pada himpunan latih
lipatan H yang sama; serialisasi parameter (attack/defense per liga)
di-hash (sha256) — kedua hash harus identik dan dicatat di manifest
eksperimen.

## 9 · Artefak keluaran (area eksperimen, terpisah dari picks.db live)

Di `tasks/experiments/k5-kappa/`:

- `DESIGN.md` — dokumen ini (beku, commit pertama).
- `experiment-manifest.json` — gema desain + checksum masukan
  (sha256 aliran baris matches + logs yang dipakai, jumlah baris,
  jumlah liga cakupan, rentang tanggal H) + SHA kode runner + seed.
- `predictions-h.jsonl` — baris berpasangan per laga H: identitas
  laga, liga, tanggal, blok pekan, hasil aktual, probabilitas Level A
  dan Level B untuk κ-fit 10 & 20, penanda fallback.
- `summary.json` — semua tabel agregat (sapuan V1+V2 Level A/B;
  pasangan di H Level A/B; baseline; panel closing; bootstrap).
- `decision.json` — penerapan aturan §7 langkah demi langkah oleh
  fungsi keputusan murni yang sama dengan yang diuji suite.
- `run.log` — keluaran runner.

## 10 · Mekanisme promosi bila keputusan PROMOTE

Mengikuti gerbang K4 (`lib/quant/promotion-gate.ts` +
`scripts/promote-model.ts`): manifest kandidat pemenang dibangun
dengan konfigurasi challenger di direktori data sandbox, dilewatkan
ke gerbang, hasilnya dicatat; manifest aktif branch hanya berubah
lewat jalur gerbang itu. Aktivasi produksi nyata (refit produksi +
deploy) tetap menunggu rilis K8 — app live tidak berubah oleh K5.

## 11 · Peringatan yang dinyatakan di muka

- Blok H memakai desain lipatan yang sama dengan gerbang Fase 3
  (pra-PRD); agregat lamanya pernah dibuka (margin Level A κ-fit
  10→20 sebesar 0,0026 adalah riwayat tercatat di repo ini). K5
  menjalankan ulang secara tersegel di bawah aturan beku ini dengan
  ambang lebih ketat (−0,005 + bootstrap) daripada perbandingan
  historis itu, dan dataset telah bertumbuh sejak run lama
  (69.065 laga selesai sm:% saat desain ini dibekukan), sehingga
  baris H tidak identik dengan run lama. Kesimpulan lama TIDAK
  dibawa sebagai hasil.
- Bukti konfirmasi utama berikutnya tetap data shadow prospektif
  (bab Q3); keputusan K5 berlaku pada lingkup yang diuji (liga
  domestik tersaji registry calibrated/partial).
