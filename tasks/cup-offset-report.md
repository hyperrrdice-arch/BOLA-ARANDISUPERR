# Laporan Fase Kalibrasi Piala — Model Offset Global

Tanggal: 2026-11-04 · Fase: kalibrasi piala (offset global per benua) · Status: SELESAI dengan catatan deployment (lihat §8)

Ringkasan satu kalimat: kompetisi piala kini dinilai dari fit domestik kedua
tim yang ditransformasi offset kekuatan liga δ (di-fit dari hasil lintas-liga
nyata, per graf benua), jalur pseudo-UCL lama pensiun, dan status tiap
kompetisi diputuskan oleh gerbang walk-forward yang sama ketatnya dengan
liga — hasil jujurnya: **4 kompetisi partial (UCL, UEL, Carabao Cup, Coppa
Italia), 13 uncalibrated, 0 calibrated** — tidak ada gerbang yang dilonggarkan.

---

## 1. Step-0 — audit data sebelum fitting

Store: `thestats_dataset.db.matches` — 70.106 laga selesai. Kompetisi piala
dalam scope yang disetujui owner (17) dan jumlah hasil tersimpan:

| Graf | Kompetisi | Hasil |
|---|---|---|
| Eropa kontinental | sm:2 Champions League | 684 (+155 jangkar ekstra comp_3498 ruang TheStats, hanya fit produksi) |
| | sm:5 Europa League | 639 |
| | sm:2286 Europa Conference League | 1.023 |
| Eropa domestik | sm:24 FA Cup | 1.920 |
| | sm:27 Carabao Cup | 219 |
| | sm:307 Coupe de France | 302 |
| | sm:468 Taça de Portugal | 334 |
| | sm:78 KNVB Beker | 234 |
| | sm:570 Copa del Rey | 253 |
| | sm:109 DFB Pokal | 143 |
| | sm:390 Coppa Italia | 93 |
| CONMEBOL | sm:1122 Copa Libertadores | 437 |
| | sm:1116 Copa Sudamericana | 438 |
| | sm:654 Copa do Brasil (domestik) | 324 |
| AFC | sm:1085 AFC Champions League Elite | 284 |
| | sm:1088 AFC Champions League Two | 284 |
| | sm:950 Kings Cup (domestik) | 63 |

Di luar scope secara desain (dicatat, tidak di-fit): friendlies sm:1082 (917)
+ klaster friendly lain (±16.111) — bukan kompetisi bermakna untuk offset;
sm:1452 Intercontinental Cup (10) — lintas benua, diparkir sebagai batas
graf yang diketahui; sm:1419 UEFA Women's Champions League (369) — hanya
3/369 laga yang kedua timnya ada di fit wanita → tetap uncalibrated by
design dan TIDAK diberi cup_model (guard tabrakan nama: resolusi nama
"Champions League" tidak boleh menyentuh entri wanita).

**CAF (enumerasi saja — TIDAK di-fit, menunggu keputusan owner):** sm:1107
CAF Champions League (378 hasil; saat ini ter-fit sebagai liga biasa dan
berstatus partial — perilaku lama, tidak diubah fase ini), sm:860 Botola Pro
(526), sm:830 Egyptian Premier League (625), sm:806 South African Premier
League (524). Graf CAF tidak dibangun.

Musim: Eropa/AFC berlabel "2024/2025"-style, CONMEBOL tahun kalender —
harness walk-forward memakai BATAS TANGGAL per musim kompetisi, bukan
perbandingan label.

## 2. Model yang diimplementasikan (persis desain yang disetujui)

- Satu graf offset per benua; δ per liga domestik kanonik (skala log), di-fit
  maximum-likelihood Poisson atas SEMUA laga lintas-liga di store
  (kompetisi kontinental graf + piala domestik lintas-divisi), att/def tim
  TERKUNCI ke fit domestik pasca-rekalibrasi (parameter shrunk yang
  dikonsumsi jalur kuant), decay half-life 365 hari, ridge L2 lemah 1,0.
- Per graf ikut di-fit: rata-rata gol global G + home advantage piala.
  Venue netral → HA = 1. Leg-2 diperlakukan laga biasa di v1, divalidasi
  terpisah (§4).
- Referensi per graf = liga paling terhubung jangkar, δ = 0.
- Penyajian: att\* = att × e^δ, def\* = def ÷ e^δ, basis = G graf, HA piala
  graf, rho = 0, lewat mesin Dixon-Coles yang ada. Formula penyajian =
  formula yang divalidasi walk-forward, persis.
- Penyimpanan TERPADU (keputusan owner): δ + metadata graf sebagai field di
  artefak yang ada — `cup_offset`/`cup_model` di entri registry kanonik +
  blok `canonical.cupOffsets` di calibrated_ratings.json. TIDAK ada file
  per-benua baru.
- Jalur pseudo-UCL (divisi semu "UCL", parameter hardcoded avg 2.04/HA 1.12/
  rho −0.05 + penskalaan √Q koefisien UEFA tulisan tangan) **PENSIUN**:
  `findTeamRatingForUCL` + `UEFA_LEAGUE_COEFFICIENT` dihapus, muara 'UCL'
  dari fallback warisan ditolak eksplisit, `loader_special` hilang dari
  seluruh registry. Kompetisi piala yang gagal gerbang dilayani flagged /
  diblokir lewat jalur offset — tidak pernah diam-diam lewat pseudo.

## 3. Hasil fit produksi (semua jangkar, per 2026-11-04)

| Graf | Referensi | G (gol/tim) | HA piala | Jangkar ter-resolve | Liga teridentifikasi |
|---|---|---|---|---|---|
| Eropa | sm:8 Premier League | 1,259 | 1,289 | 1.857 | 33 |
| CONMEBOL | sm:648 Brasileirão Série A | 0,847 | 1,416 | 512 | 6 |
| AFC | sm:944 Saudi Pro League | 1,171 | 1,240 | 226 | 8 |

δ terkuat → terlemah (log; + = lebih kuat dari referensi):

- **Eropa** (ref EPL = 0): La Liga −0,09 · Bundesliga −0,16 · Ligue 1 −0,19 ·
  Serie A −0,24 · Pro League Belgia −0,32 · Liga Portugal −0,33 ·
  Eredivisie −0,49 · Championship −0,56 · Chance Liga −0,58 · Premiership
  Skotlandia −0,70 … terlemah: Veikkausliiga −0,86 · Ligat ha'Al −0,88 ·
  First League Bulgaria −0,95 · National League (tier-5 Inggris) −1,00.
  Urutan waras secara sepakbola; divisi dua menempel di bawah divisi
  utamanya (La Liga 2 −0,25, Ligue 2 −0,38, 2. Bundesliga −0,54, Serie B
  −0,62, Eerste Divisie −0,78).
- **CONMEBOL** (ref Série A Brasil = 0): Argentina −0,08 · Uruguay −0,25 ·
  Chile −0,25 · Série B Brasil −0,28 · Kolombia −0,30.
- **AFC** (ref Saudi Pro League = 0): J1 League Jepang **+0,09** (satu-satunya
  liga di atas referensinya) · K League 1 −0,18 · UAE Pro League −0,21 ·
  Qatar Stars League −0,30 · Indian Super League −0,34 (TIPIS: 2 jangkar) ·
  China Super League −0,38 · Persian Gulf Pro League −0,41.

## 4. Walk-forward OOS per kompetisi → status yang diraih

Protokol: fit domestik + δ hanya dari data sebelum musim uji (fit domestik
di-fit ulang per lipatan — tanpa kebocoran parameter produksi); naive =
base rate kandang/tandang kompetisi itu sendiri, dinilai pada laga yang
sama-sama ter-rate (paired). Gerbang pradaftar di header
`scripts/backtest-cup-offsets.ts` SEBELUM hasil dilihat, tidak diubah
setelahnya: calibrated = n≥100 ∧ cakupan ≥0,80 ∧ LL<naive ∧ slope∈[0,70;1,30];
partial = n≥30 ∧ cakupan ≥0,50 ∧ LL<naive.

| Kompetisi | Uji | Ter-rate | Cak. | LL model | LL naive | Slope | Leg-2 (n, LL vs naive) | Status |
|---|---|---|---|---|---|---|---|---|
| sm:2 UCL | 415 | 238 | 0,57 | 0,9825 | 1,0399 | 1,121 | 36 · 1,0011 vs 1,0303 | **partial** |
| sm:5 UEL | 383 | 264 | 0,69 | 0,9912 | 1,0455 | 1,022 | 45 · 0,9494 vs 0,9957 | **partial** |
| sm:2286 UECL | 647 | 188 | 0,29 | 0,9956 | 1,0788 | 0,890 | 57 · 0,8780 vs 1,0317 | uncalibrated (cakupan) |
| sm:24 FA Cup | 1.534 | 79 | 0,05 | 0,8511 | 0,9689 | 1,182 | — | uncalibrated (cakupan) |
| sm:27 Carabao Cup | 141 | 136 | 0,96 | 0,8074 | 0,9741 | 1,470 | 2 · — | **partial** (slope di luar band) |
| sm:307 Coupe de France | 150 | 22 | 0,15 | 0,9625 | 1,1028 | 1,096 | — | uncalibrated (cakupan) |
| sm:468 Taça de Portugal | 212 | 16 | 0,08 | 0,9548 | 1,0043 | 1,176 | — | uncalibrated (cakupan) |
| sm:78 KNVB Beker | 150 | 31 | 0,21 | 1,0957 | 0,9418 | 0,504 | — | uncalibrated (**kalah dari naive**) |
| sm:570 Copa del Rey | 154 | 29 | 0,19 | 1,0107 | 1,0353 | 0,965 | — | uncalibrated (cakupan) |
| sm:109 DFB Pokal | 90 | 44 | 0,49 | 0,7724 | 0,9632 | 2,278 | — | uncalibrated (cakupan 0,49 < 0,50 — near-miss, aturan tetap aturan) |
| sm:390 Coppa Italia | 56 | 43 | 0,77 | 0,7042 | 0,7584 | 1,557 | — | **partial** |
| sm:1122 Libertadores | 288 | 114 | 0,40 | 1,0885 | 1,0690 | 0,564 | 53 · 1,0160 vs 1,0144 | uncalibrated (**kalah dari naive**) |
| sm:1116 Sudamericana | 290 | 132 | 0,46 | 1,1012 | 1,0771 | 0,463 | 60 · 1,0875 vs 1,0850 | uncalibrated (**kalah dari naive**) |
| sm:654 Copa do Brasil | 214 | 84 | 0,39 | 0,9744 | 1,0818 | 1,015 | 36 · 0,9312 vs 1,0416 | uncalibrated (cakupan) |
| sm:1085 ACL Elite | 174 | 84 | 0,48 | 1,0109 | 1,0501 | 0,760 | 1 · — | uncalibrated (cakupan 0,48 < 0,50) |
| sm:1088 ACL Two | 169 | 13 | 0,08 | 0,8422 | 1,1112 | 1,396 | — | uncalibrated (cakupan) |
| sm:950 Kings Cup | 37 | 19 | 0,51 | 0,6587 | 0,9402 | 3,153 | — | uncalibrated (n<30) |

Catatan diagnosis (bukti, bukan tebakan):

- **Cakupan UCL/UEL/UECL** ditentukan babak kualifikasi: tim-tim dari liga
  di luar katalog 109 liga Sportmonks tidak punya fit domestik — batas
  struktural store, bukan bug resolver (diagnosis fold 2026/2027: 99 dari
  106 slot tim tak-ter-rate = "tidak ada liga domestik di store").
- **CONMEBOL kalah dari naive dengan slope ≈ 0,5** = overconfidence:
  ekstrem att/def domestik diterapkan lintas-liga hampir tanpa redaman,
  jangkar latih tipis (±335/lipatan). Urutan δ-nya sendiri waras dan kode
  yang sama sehat di Eropa → bukan bug tanda/arah. Parameter
  kompresi/temperatur lintas-liga adalah VARIAN model di luar desain yang
  disetujui — tidak di-tune di data held-out; jadi keputusan owner (§9).
- **Leg-2**: di UCL/UEL/UECL subset leg-2 model tetap mengalahkan naive —
  perlakuan leg-2 sebagai laga biasa tidak terbukti merusak di v1.
- **sm:1085 berubah partial → uncalibrated**: di bawah perlakuan lama
  (di-fit sebagai liga) ia partial; gerbang piala (cakupan atas seluruh
  babak termasuk kualifikasi = 0,48) membuatnya terblokir. Konsekuensi
  penyajian nyata — lihat keputusan owner §9.

## 5. Konektivitas per graf (fit produksi)

- **Eropa**: 33 liga teridentifikasi. Lubang bernama: **sm:486 Russia
  Premier League** — klub Rusia dibekukan dari kompetisi UEFA sejak 2022,
  jadi nol laga lintas-liga di store: lubang nyata yang bisa dijelaskan,
  ekspektasi "tidak ada yang bolong" gugur khusus kasus ini. **sm:211
  Challenger Pro League** (tier-2 Belgia) — piala Belgia tidak ada di store
  SM (hanya ruang TheStats) → nol jangkar. **sm:14 League Two, sm:274 Danish
  1. Division, sm:603 Turkish 1. Lig** — punya baris registry tapi TIDAK
  punya entri fit di calibrated_ratings.json sama sekali (tidak ada yang
  bisa ditransformasi; 186 laga piala melibatkan tim League Two tapi timnya
  tak ber-fit). Tipis: sm:465 Liga Portugal 2 (29 jangkar), sm:292
  Veikkausliiga (34), sm:304 Ligue 2 (36).
- **CONMEBOL**: 6 liga teridentifikasi = seluruh liga ber-fit JSON di graf;
  0 lubang di antara yang ber-fit; 512 jangkar. (Liga Paraguay/Ekuador/
  Peru/Venezuela/Bolivia hanya ada di ruang TheStats tanpa fit SM.)
- **AFC**: 8 teridentifikasi dari 226 jangkar — graf paling tipis. sm:1007
  Indian Super League teridentifikasi hanya dari **2 jangkar** (δ-nya
  rapuh; tercatat apa adanya). sm:1356 A-League dan sm:1073 V-League tidak
  teridentifikasi (timnya jarang/tidak muncul ter-resolve di laga ACL).

## 6. Fixture penerimaan UCL (end-to-end jalur kuant)

Driver `scripts/run-one-cup-analysis.ts` (seleksi programatik: fixture sm:2
mendatang pertama yang ter-rate jalur offset dengan kedua liga domestik
calibrated — terpilih pada kandidat pertama). Paket lengkap:
`tasks/e2e-cup-package.json`.

- **Fenerbahçe vs Liverpool** — `sm_19872622`, Champions League.
- Input offset (tercatat persis di `shrunkParams.metadata.cupOffset` paket
  planner): kandang Fenerbahçe dari fit **SM600** (Süper Lig, calibrated),
  δ = **−0,4792**; tamu Liverpool dari fit **SM8** (Premier League,
  calibrated, liga referensi), δ = **0**. Basis G graf Eropa 1,2588,
  HA piala 1,289, venue tidak netral. Kandidat nama per tim = 2 (fit SM +
  kembaran legacy dari entri kanonik yang sama) — dipilih deterministik,
  tercatat di metadata.
- Parameter hasil transformasi: att/def 1,000/1,306 (kandang),
  1,268/0,869 (tamu) → λ = 1,41, μ = 2,085.
- **Probabilitas: Kandang 25,82% / Seri 21,10% / Tamu 53,08%.**
  Status kompetisi di metadata paket: partial (flag gerbang terbawa, tidak
  disembunyikan). vig_stripping null (tidak ada odds pasar lokal valid →
  model-only, sesuai desain).
- Invariansi domestik: Everton vs Coventry di-run ulang setelah semua
  perubahan — **47,22 / 25,27 / 27,52 (λ/μ 1,552/1,123), identik** dengan
  run pasca-rekalibrasi; paket quant-nya byte-identik di bagian Dixon-Coles.

## 7. Pendaratan di jalur cron

- `scripts/fit-global-offsets.ts` BARU: fit produksi + tulis registry
  kanonik + blok `canonical.cupOffsets` + baris `league_calibration`
  (source='cup-offset', status dari tasks/cup-oos.json).
- `scripts/daily-refresh.ts`: langkah `cup-offsets` disisipkan TEPAT setelah
  `calibrate` (calibrate menulis ulang blok canonical dan entri liga ACL
  tiap siklus; langkah offset menanam ulang blok cupOffsets, menghapus lagi
  entri SM1085/SM1088, dan menetapkan status baris piala — idempoten).
- `scripts/build-league-canonical.ts`: tidak lagi menulis hardcoded
  `loader_special: "UCL"`; bidang `cup_model`/`cup_offset` dari registry
  sebelumnya dipertahankan saat regenerasi.
- `lib/quant/league-identity.ts`: entri `cup_model` didahulukan di resolusi
  (sebelum fit liga maupun jalur khusus lama); helper
  `getCanonicalCupModel`/`getCanonicalCupOffset`.
- `lib/quant/global-offsets.ts` BARU: penyajian runtime (resolusi tim ke
  liga domestik teridentifikasi di graf yang sama; kandidat ganda dipilih
  deterministik: status fit lebih baik → matchesCount terbesar; jumlah
  kandidat dicatat di metadata).
- `lib/quant/ratings-loader.ts`: cabang piala di `getShrunkMatchParameters`
  (gerbang uncalibrated → blokir teranotasi; tim tak ter-resolve → fallback
  teranotasi), opsi `isNeutralVenue`, metadata `cupOffset` lengkap (graf,
  kedua liga + δ, fit asal, G, HA, netral), pseudo-UCL dihapus.
- `scripts/verify-consumption.ts`: fixture piala dihitung lewat jalur
  offset (ter-rate penuh / terblokir gerbang / tim tak ter-resolve),
  label div `CUP:<graf>`.
- `scripts/run-one-cup-analysis.ts` BARU: driver penerimaan UCL (seleksi
  programatik → intel offline → buildQuantPackage planner 🔒).

## 8. Verifikasi

- `npx tsc --noEmit` = **0 error** di setiap checkpoint commit.
- File 🔒: `sha256sum -c tasks/backend-readonly-hashes.txt` = **8/8 OK**
  (planner/llm/schemas/coverage/syndicate-orchestrator/lib/llm/* tidak
  disentuh; integrasi penyajian seluruhnya lewat modul non-🔒).
- `analysis_snapshots.db`: mtime + ukuran **tidak berubah**
  (2026-11-03 11:30:09 UTC, 872.448 byte — sama dengan baseline fase).
- Nol panggilan API Sportmonks (semua fit dari store offline); `.env.local`
  tidak pernah dibuka (env dummy dipakai hanya agar modul planner bisa
  di-import headless, sesuai workaround yang sudah dikenal).
- `scripts/verify-consumption.ts` (3.770 fixture upcoming):
  - kedua tim ketemu **2.954 → 2.982 (+28)**; satu sisi 15; nol 19;
    div-gagal 752 → 366 (kompetisi piala kini ter-resolve ke jalur offset,
    bukan gagal resolusi); kompetisi ter-cover penuh tetap **58/88**.
  - Jalur offset: **142 fixture ter-rate penuh, 359 terblokir gerbang
    uncalibrated, 29 tim tak ter-resolve**. UCL 48/54 ter-rate, UEL 43/54
    (keduanya partial ber-flag); UECL 0/72 dan ACL Elite 0/36 terblokir
    sesuai status yang mereka raih.
- Baris registry: 17/17 kompetisi tertulis source='cup-offset' dengan
  status OOS-nya (4 partial, 13 uncalibrated) — terverifikasi baca-ulang.
- **Catatan deployment (lock DB)**: saat fit produksi pertama dijalankan,
  langkah telemetry dari run cron yang sedang berjalan memegang kunci
  tulis `thestats_dataset.db` dalam keadaan thrashing memori (state D,
  ±1,5 jam; WAL tidak bertumbuh) sehingga tulis baris registry tertunda.
  Loop retry detached menjalankan ulang `fit-global-offsets.ts` (idempoten)
  tiap ±2 menit dan **mendarat pada percobaan ke-5** begitu kunci lepas
  sesaat. Run cron yang sama masih berjalan saat laporan ini ditulis dan
  langkah calibrate-nya (kode rantai LAMA, sebelum fase ini) akan menulis
  ulang baris piala + JSON saat tiba gilirannya; run cron BERIKUTNYA sudah
  memuat langkah cup-offsets dan memulihkan keadaan ini secara desain —
  konvergensi dijamin oleh rantai, bukan oleh intervensi manual.
- Commit fase ini: `3e9cb02` (modul inti + harness OOS), `3de596c`
  (penyajian runtime + pensiun pseudo-UCL + fit produksi + rantai cron),
  commit artefak + laporan ini (lihat `git log`).

## 9. Keputusan owner yang DIBIARKAN terbuka (tidak diputuskan fase ini)

1. **Scope CAF** — graf keempat (CAF Champions League + liga-liga CAF di
   store) belum dibangun; sm:1107 masih diperlakukan sebagai liga (partial).
2. **Definisi cakupan gerbang piala** — cakupan saat ini diukur atas SELURUH
   laga historis kompetisi termasuk babak kualifikasi melawan tim tanpa
   fit. Bila diukur atas populasi fixture yang benar-benar dilayani
   (babak utama), UECL dan ACL Elite kemungkinan lolos partial. Mengubah
   definisi = mengubah gerbang pradaftar → keputusan owner, bukan
   pelonggaran diam-diam.
3. **Varian kompresi lintas-liga untuk CONMEBOL** (temperatur pada att/def
   atau pada δ) — butuh protokol validasinya sendiri; tidak di-tune di
   held-out fase ini.
4. **sm:1085 ACL Elite partial → uncalibrated** — menerima konsekuensi
   gerbang piala (ke-36 fixture upcoming-nya kini terblokir di jalur
   offset: fallback teranotasi tanpa angka, bukan lagi probabilitas dari
   fit liga lamanya), atau memperlakukan ACL sebagai pengecualian.
5. Dari fase sebelumnya yang masih terparkir: diskon promosi, klaim EV
   special markets, aturan twin mt_/sm_, default sumber-unknown, 31
   identitas TheStats tanpa negara, jembatan akronim Belanda.
