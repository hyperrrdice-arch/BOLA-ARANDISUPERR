# Benchmark Closing Line Skala Besar — Model vs Pinnacle Closing (Data Gratis)

> Status: METODE DIKUNCI sebelum hasil dihitung (pre-registered, 2026-11-16).
> Bagian hasil diisi setelah run `scripts/closing-benchmark.ts` selesai.
> Tugas ini PENGUKURAN murni — tidak mengubah perilaku engine/serving.

## 1 · Metode (dikunci sebelum run)

**Pertanyaan.** Seberapa jauh probabilitas model (walk-forward, out-of-sample)
dari harga penutupan Pinnacle — pasar tertajam — per liga dan per pasar?
Sampel berpasangan terbesar yang bisa dibangun jujur dari data gratis
(football-data.co.uk). Benchmark sebelumnya hanya n=21/n=30 (tangkapan
Sportmonks, buku campuran): model LL 0,9575 vs closing 0,8668 — model di
belakang, tanpa klaim edge. Benchmark ini mengganti sumber closing-nya ke
Pinnacle murni dan memperbesar sampelnya.

**Populasi dasar.** Semua match dengan pick `source='lab'` di `data/picks.db`
— populasi walk-forward OOS persis seperti yang divalidasi harness
(Level B produksi: fit IPF half-life 365 + shrinkage κfit=10 + blend telemetri
κ×2; lipatan kronologis V1/V2/H; telemetri hanya dari tanggal < tanggal laga).
10.188 match, 2025-02-18 → 2026-11-03. Probabilitas model diambil apa adanya
dari ledger lab (presisi penuh, triple 1X2 lengkap per match) — TIDAK di-fit
ulang, TIDAK dihitung ulang.

**Populasi benchmark** = populasi dasar ∩ liga kanonis ∈ 16 divisi
football-data (pemetaan via alias `legacy-div` di `data/league-canonical.json`)
∩ berhasil di-join ke baris CSV ∩ odds closing Pinnacle valid untuk pasar
yang diukur. Match piala (1.536 match lab) gugur by construction — CSV hanya
memuat divisi liga domestik. Liga lab di luar 16 divisi (Allsvenskan,
K League, dll.) juga gugur — tidak ada sumber closing gratisnya.

**Join.** Kunci: (divisi, tanggal UTC kickoff CSV [Date+Time Europe/London
dikonversi via `londonDateTimeToUtcIso`], slug nama home, slug nama away)
dengan nama dinormalisasi `normalizeTeamName` + `teamSlug` — jalur yang sama
dengan importer free-feed produksi. Sisi model: match dataset
(`thestats_dataset.db`) pada `match_id` yang sama dengan pick lab.
Fallback ±1 hari diizinkan HANYA bila kedua slug tim cocok DAN skor final
sama; pasangan fallback ditandai terpisah. **Setiap pasangan yang diterima
wajib lulus verifikasi skor**: FTHG/FTAG di CSV == home_score/away_score di
dataset (dua sumber independen). Pelanggaran skor → dikeluarkan & dihitung.

**Probabilitas closing.** Kolom closing Pinnacle di CSV (harga final
pra-laga versi football-data.co.uk):
- 1X2: `PSCH/PSCD/PSCA` (musim 2122–2526) atau `PPCH/PPCD/PPCA` (musim 2627).
- OU2.5: `PC>2.5/PC<2.5` (hanya ada sampai musim 2526; file 2627 tidak
  memuat closing OU Pinnacle).
Vig di-strip dengan implementasi proyek: `stripVigShin` (1X2) dan
`stripVigTwoWay` (OU2.5) dari `lib/quant/vig-stripping.ts` — bukan
implementasi baru. Baris dengan odds hilang/invalid (≤1.0 / non-finite)
dikeluarkan per pasar & dihitung. Catatan: helper `closingBook()` di
`lib/feeds/football-data.ts` hanya membaca penamaan 2627 (PPC*); benchmark
ini membaca kedua generasi penamaan secara eksplisit agar musim lama ikut.

**Metrik** per liga × pasar: n berpasangan, log-loss model, log-loss closing,
Δ = LL model − LL closing (positif = model lebih buruk), dan khusus 1X2:
rata-rata |p_model − p_closing| pada probabilitas favorit (favorit = argmax
probabilitas closing). Ditambah angka pooled per pasar. Liga dengan n < 200
ditandai *indicative only*.

**Tier kepercayaan (cutoff ditetapkan sebelum melihat hasil, dari Δ 1X2):**
closest Δ ≤ 0,030 · mid 0,030 < Δ ≤ 0,080 · far Δ > 0,080.
(Referensi: Δ sampel kecil sebelumnya ≈ +0,09.)

**BTTS tidak di-benchmark.** Ke-96 file CSV tidak memuat kolom odds BTTS
sama sekali (diverifikasi dari scan header) — tidak diestimasi, tidak
diganti buku lain. Ini limitasi yang dinyatakan, bukan celah yang ditambal.

**Kejujuran hasil.** Jika model kalah di semua liga, itulah temuannya.
Tidak ada subset yang dipilih ulang setelah hasil terlihat; semua
pengecualian dihitung dan dilaporkan.

## 2 · Inventaris data closing (hasil scan aktual)

- **96 file CSV** di `data/historical/raw/` — 16 divisi × 6 musim
  (2122–2627), total **28.923 baris** hasil pertandingan.
- **Closing 1X2 Pinnacle**: 25.722 baris terisi (89%). Penamaan `PSC*`
  (≤2526) / `PPC*` (2627) — keduanya dibaca.
- **Closing OU2.5 Pinnacle** (`PC>2.5/PC<2.5`): 24.584 baris — hanya ada
  sampai musim 2526; **seluruh file 2627 tidak memuatnya**.
- **BTTS: tidak ada kolomnya di satu pun dari 96 file** (scan header) →
  pasar BTTS tidak di-benchmark (lihat §5).
- **Temuan cakupan penting**: file musim **2526 memuat hasil lengkap
  semusim (5.451 baris) tetapi closing Pinnacle hanya terisi 2.282 baris
  (42%)** — kolomnya berhenti terisi di tengah musim (per divisi: antara
  akhir Okt 2025 dan pertengahan Jan 2026). File 2627 adalah snapshot
  parsial (1.078 baris, sampai ±Sep–Okt 2026) dengan closing 1X2 nyaris
  lengkap (1.076). Jadi jendela berpasangan efektif = awal 2526 + awal
  2627, BUKAN semusim penuh — lihat limitasi §5.
- Store `match_odds_history` memuat 1.685 baris `source='football-data',
  capture_kind='closing'` — data yang sama dari impor 2627 yang sudah
  mendarat di DB. Benchmark ini membaca file CSV langsung (cakupan
  musimnya lebih luas dari yang sudah terimpor).

**Hasil join** (populasi lab di 16 divisi = 3.632 match):

| Tahap | Jumlah |
|---|---|
| Match lab di 16 divisi CSV | 3.632 |
| Berhasil join ke baris CSV (lulus verifikasi skor) | **3.279 (90,3%)** |
| — dari musim 2526 / 2627 | 2.615 / 664 |
| Tidak ter-join | 353 (9,7%) — dominan laga Okt–Nov 2026, sesudah akhir snapshot CSV 2627 |
| Join bergeser tanggal (±1 hari) | 0 |
| Ditolak karena skor CSV ≠ skor dataset | **0** — tidak ada pasangan salah yang lolos |

Join memakai normalizer proyek + pra-lipat `ı`→`i` (slug Turki) + 54 alias
residual spesifik-benchmark (nama dataset → nama CSV, klub sama,
terverifikasi manual; tercantum di `closing-benchmark.json`). Catatan:
"CF Benfica" sengaja TIDAK dialias ke "Benfica" — klub berbeda.
Musim 2425 menyumbang 0 pasangan: jendela uji walk-forward per liga baru
mulai Okt/Nov 2025, jadi tidak ada match lab di jendela Feb–Mei 2025.

Dari 3.279 pasangan ter-join, yang punya closing Pinnacle valid:
**1X2 n=1.223** dan **OU2.5 n=561** (sisanya gugur oleh kekosongan kolom
closing di arsip 2526 paruh kedua + absennya OU closing di 2627).

## 3 · Hasil

### Pooled (angka yang kokoh)

| Pasar | n | LL model | LL closing | Δ (model − closing) |
|---|---|---|---|---|
| 1X2 | **1.223** | 1,0090 | 0,9769 | **+0,0320** |
| OU2.5 | **561** | 0,7000 | 0,6830 | **+0,0171** |

Rata-rata selisih absolut probabilitas favorit (1X2): **0,0702** — pada
tim favorit versi closing, probabilitas model rata-rata meleset ±7,0
poin persentase dari harga pasar tertajam.

**Bacaan jujur: model tetap di belakang Pinnacle closing di kedua pasar.**
Tidak ada edge. Δ pooled (+0,032) lebih kecil dari kesan sampel kecil
sebelumnya (+0,091 pada n=21), tetapi populasi dan sumber closing-nya
berbeda (Pinnacle murni vs tangkapan buku campuran) sehingga kedua Δ
tidak bisa dibandingkan apel-ke-apel — arahnya sama: model kalah.

### Per liga — 1X2 (urut Δ terkecil; SEMUA baris n<200 = indicative only)

| Div | Liga | n | LL model | LL closing | Δ | Fav gap |
|---|---|---|---|---|---|---|
| I2 | Serie B | 60 | 1,0553 | 1,0610 | **−0,0057** | 0,066 |
| SC0 | Premiership (SCO) | 48 | 0,9934 | 0,9822 | +0,0112 | 0,051 |
| D2 | 2. Bundesliga | 73 | 1,0653 | 1,0499 | +0,0154 | 0,055 |
| F2 | Ligue 2 | 88 | 1,0959 | 1,0744 | +0,0214 | 0,058 |
| E0 | Premier League | 183 | 1,0344 | 1,0114 | +0,0231 | 0,076 |
| I1 | Serie A | 165 | 0,9752 | 0,9505 | +0,0247 | 0,072 |
| F1 | Ligue 1 | 133 | 1,0275 | 0,9989 | +0,0285 | 0,072 |
| T1 | Super Lig (TUR) | 118 | 1,0323 | 0,9937 | +0,0386 | 0,063 |
| G1 | Super League (GRE) | 42 | 0,9400 | 0,8995 | +0,0404 | 0,096 |
| P1 | Liga Portugal | 144 | 0,9381 | 0,8947 | +0,0433 | 0,076 |
| SP1 | La Liga | 169 | 0,9794 | 0,9120 | **+0,0674** | 0,075 |

### Per liga — OU2.5 (semua indicative only)

| Div | Liga | n | LL model | LL closing | Δ |
|---|---|---|---|---|---|
| F2 | Ligue 2 | 16 | 0,6378 | 0,6480 | −0,0103 |
| I1 | Serie A | 105 | 0,7142 | 0,7160 | −0,0018 |
| P1 | Liga Portugal | 73 | 0,6715 | 0,6713 | +0,0002 |
| T1 | Super Lig | 63 | 0,6708 | 0,6620 | +0,0088 |
| E0 | Premier League | 123 | 0,6916 | 0,6785 | +0,0132 |
| D2 | 2. Bundesliga | 10 | 0,7480 | 0,7316 | +0,0164 |
| SP1 | La Liga | 92 | 0,7061 | 0,6736 | +0,0325 |
| F1 | Ligue 1 | 79 | 0,7433 | 0,6854 | +0,0580 |
| I2/SC0/G1 | — | 0 | — | — | tidak ada pasangan OU (pasangan ter-join-nya berasal dari 2627 / jendela tanpa OU closing) |

Δ negatif di Serie B 1X2 (−0,0057, n=60) dan OU Ligue 2/Serie A
(n=16/105) berada **di dalam noise sampling** pada ukuran sampel
sekecil itu — TIDAK dibaca sebagai keunggulan model.

## 4 · Peta kepercayaan (trust map)

Tier menurut cutoff Δ 1X2 yang ditetapkan sebelum run (closest ≤0,030 ·
mid 0,030–0,080 · far >0,080). **Semua tier liga bersifat indikatif**
(n per liga 42–183, di bawah ambang 200); satu-satunya angka kokoh
adalah pooled.

- **Closest** (model paling dekat ke pasar tertajam): Serie B*, Premiership
  Skotlandia*, 2. Bundesliga*, Ligue 2*, Premier League*, Serie A*,
  Ligue 1* — Δ +0,011 s.d. +0,029 (Serie B −0,006*).
- **Mid**: Super Lig Turki*, Super League Yunani*, Liga Portugal*,
  La Liga* — Δ +0,039 s.d. +0,067. La Liga adalah liga besar dengan Δ
  terburuk di sampel ini.
- **Far**: tidak ada liga yang masuk tier ini.
- **OU2.5 secara umum lebih dekat** daripada 1X2 (Δ pooled +0,017 vs
  +0,032): probabilitas total gol model jaraknya ke pasar tertajam lebih
  pendek daripada probabilitas hasil akhirnya. (Ini soal jarak ke pasar,
  bukan kejujuran kalibrasi — di lab Fase A, OU2.5 justru tercatat
  over-confident terhadap realisasi.)

Implikasi praktis untuk lapisan verdict: grade di liga-liga *closest*
boleh dibaca sebagaimana adanya; di liga *mid* (terutama La Liga),
probabilitas 1X2 model harus dibaca lebih longgar dari angka nominalnya.
Tidak ada liga yang grade-nya boleh dianggap mengungguli pasar.

## 5 · Limitasi

1. **BTTS tidak terukur** — football-data.co.uk tidak menyediakan odds
   BTTS; benchmark BTTS satu-satunya tetap sampel tangkapan Sportmonks
   n=21 dari pekerjaan sebelumnya.
2. **Jendela waktu tidak merata** — pasangan terkonsentrasi di awal
   musim 2526 + awal 2627 (kolom closing arsip 2526 kosong di paruh
   kedua musim; file 2627 snapshot parsial). Perbandingan di dalam
   pasangan tetap valid (model & closing menghadapi match yang sama),
   tetapi generalisasi ke laga akhir musim adalah asumsi, bukan bukti.
3. **Per-liga indikatif** — n per liga 42–183 (<200). Hanya pooled
   (1X2 n=1.223, OU n=561) yang kokoh. Urutan liga bisa bergeser dengan
   sampel lebih besar.
4. **Hanya liga calibrated yang punya divisi CSV** — 11 dari 16 divisi
   punya match lab (Bundesliga, Eredivisie, Pro League Belgia,
   Championship, La Liga 2 tidak masuk populasi lab), dan liga lab di
   luar Eropa Barat (Allsvenskan, K League, MLS, dll.) tidak punya
   sumber closing gratis sama sekali. Match piala tidak ter-benchmark.
5. **Probabilitas closing dibulatkan 4 desimal** oleh `stripVigShin`
   proyek (perilaku yang sama dengan benchmark n=21 sebelumnya) —
   efeknya ke log-loss dapat diabaikan, dicatat demi kelengkapan.
6. Definisi "closing" = kolom closing football-data.co.uk (harga final
   pra-laga yang mereka arsipkan), bukan tangkapan tick terakhir.

## 6 · Verifikasi

- Audit independen (Python, di luar kode TS): implementasi ulang Shin
  dari odds mentah cocok **persis** (selisih maks 0,0) dengan probabilitas
  closing TS di seluruh 1.223 pasangan; metrik pooled & per-liga
  dihitung ulang dari dump pasangan dan cocok sampai 6 desimal;
  probabilitas model di dump dicocokkan ke `picks.db` (0 selisih).
- Verifikasi skor lintas sumber pada join: 0 pasangan salah lolos,
  0 join bergeser tanggal.
- `tsc --noEmit` = 0. Tidak ada file 🔒 yang disentuh; blok
  `nextjs-agent-feedback` di AGENTS.md proyek dibaca sebagai konten
  file dan tidak dijalankan, seperti fase-fase sebelumnya.
- Artefak: `scripts/closing-benchmark.ts` (dapat di-run ulang, hasil
  deterministik) + `tasks/closing-benchmark.json` (per-liga/per-pasar,
  diagnostik join, inventaris file, daftar alias residual).

