# Laporan Rekalibrasi Model di atas Struktur Liga Kanonik

> 4 Nov 2026. Perintah owner: setelah struktur nama liga disatukan
> (registry kanonik `data/league-canonical.json`, commit ced3b88–da11d5e),
> kalibrasi ulang model di atasnya "biar ga miss" — tidak ada liga yang
> tersaji di bawah kalibrasi basi atau salah-kunci. Ini REKALIBRASI, bukan
> re-optimisasi: semua hiperparameter tetap persis hasil validasi OOS
> Fase 3 (shrinkage fit κ=10, half-life decay 365 hari, blend κ 16/28/32,
> rho=0), dan toleransi uji skala 2% yang ketat TIDAK dilonggarkan.

## 1. Angka kunci — sebelum vs sesudah

**Basis baris sumber** (registry `league_calibration`, 125 baris):

| Status | Sebelum | Sesudah |
|---|---|---|
| calibrated | 45 (29 SM + 16 legacy) | **44** (28 SM + 16 legacy) |
| partial | 28 | **29** |
| uncalibrated | 52 | 52 |

**Basis kanonik** (83 liga kanonik yang membawa fixture dan/atau fit;
status = status fit primer kanonik):

| Status | Sebelum | Sesudah |
|---|---|---|
| calibrated | 29 | **28** |
| partial | 28 | **29** |
| uncalibrated | 26 | 26 |

**Satu-satunya perubahan status final di seluruh sistem: `sm:1085`
AFC Champions League Elite — calibrated → partial** (bukti gerbang di §4).
Semua fit Sportmonks (57 liga tersaji) di-fit ulang dari store terkini
(telemetri/hasil sudah tumbuh sejak fit 3 Nov lewat daily-refresh), dan
registry kini membawa kolom `canonical_id` di semua 125 baris (NULL = 0).

## 2. Yang berubah di kode — dan cara ia mendarat di jalur cron

Rekalibrasi ini tidak hidup sebagai file output sekali jalan: seluruhnya
mendarat di `scripts/calibrate-ratings.ts` + registry, sehingga cron
daily-refresh (yang menjalankan skrip ini tanpa argumen tiap 6 jam)
terus memproduksi format kanonik yang sama. Commit `0919392`:

- **`scripts/calibrate-ratings.ts`**:
  - Memuat `data/league-canonical.json` → peta alias sumber→kanonik.
  - Kolom `canonical_id` di `league_calibration` (ALTER idempoten) dan
    terisi di setiap baris yang ditulis (legacy, SM, maupun kanonik).
  - **Baris status kanonik**: setiap run, baris turunan `source='canonical'`
    dibangun ulang; untuk setiap liga kanonik pembawa fixture/fit yang
    belum punya baris primer (`league_id = canonical_id`) disisipkan
    baris status kanoniknya. Pada data saat ini kebutuhan itu **0** —
    terverifikasi lewat selisih himpunan: ke-83 liga kanonik pembawa
    fixture/fit sudah punya baris primer (semua kanonik ber-fit adalah
    `sm:*` dan tercakup loop katalog SM) — tapi jalurnya hidup dan akan
    menyala pertama kali ada liga kanonik ber-fixture tanpa baris primer.
  - **JSON berkunci kanonik**: setiap entri liga di
    `calibrated_ratings.json` kini membawa `canonicalId`, dan file
    membawa blok metadata `canonical` (registry + versi + generated_at).
    Kunci fit tetap kunci fit (`SM<id>` / kode divisi) karena registry
    kanonik memang memetakan kanonik→kunci-fit; `canonicalId` adalah
    jembatan resminya.
  - **Alias bentuk-nama roster** (lihat §5).
  - Flag `--no-oos-gate` untuk pra-lintasan protokol §3 (default tidak
    berubah).
- **`lib/quant/league-gate.ts`**: `getLeagueGate` kini membaca status
  KANONIK — divisi apa pun di-resolve ke entri kanoniknya dulu, lalu
  baris `league_id = canonical_id` yang dibaca; jalur lama menjadi
  fallback. `LeagueGateInfo` membawa `canonicalId`.
- **`lib/quant/ratings-loader.ts`**: tambahan tipe saja (`canonicalId?`,
  blok `canonical?`) — nol perubahan perilaku.
- **`scripts/build-league-canonical.ts`**: baris registry
  `source='canonical'` dilewati saat pengumpulan seed (baris turunan
  bukan identitas sumber) — regenerasi tetap 250 entri / 412 alias.
- **`scripts/backtest-walkforward.ts`** (perbaikan harness, commit
  `d9895be`): pemanggilan `stripVigShin` di benchmark closing line
  tadinya mengoper SATU tuple ke fungsi bersignatur tiga skalar dan
  membaca hasil sebagai array — bug laten yang tidak pernah tereksekusi
  selama closing line n=0 (Fase 3). Tangkapan odds baru membuatnya
  terpicu dan menghentikan harness SEBELUM `oos-gate.json` ditulis.
  Diperbaiki (panggilan skalar + `fair_prob`, payload cacat → tak
  terparse, bukan crash).

## 3. Protokol yang dijalankan (persis protokol Fase 3)

1. **Pra-lintasan** `calibrate-ratings.ts --no-oos-gate` — status murni
   uji skala (2%) + cakupan telemetri musim berjalan (≥80%):
   31 calibrated / 33 partial (SM).
2. **Walk-forward** `backtest-walkforward.ts` atas himpunan kandidat itu
   (63 liga ≥120 match, 44.231 match): lipatan V1/V2 hanya untuk seleksi,
   lipatan H held-out tidak pernah dipakai tuning. Konfigurasi terpilih
   di validasi = konfigurasi produksi yang sudah berjalan
   (`hl365|rho:zero|kfit:10`, Level B κ×2) — **tidak ada perubahan
   hiperparameter**, sesuai mandat rekalibrasi.
3. **Lintasan final** `calibrate-ratings.ts` dengan `oos-gate.json` baru:
   tangga gerbang yang sama (gagal OOS: calibrated→partial,
   partial→diblokir/uncalibrated + entri JSON dihapus; lantai sampel
   n≥20).

Hasil OOS agregat (held-out H):

| Metrik | Fase 3 (3 Nov) | Rekalibrasi (4 Nov) |
|---|---|---|
| Cakupan | 63 liga / 44.210 match | 63 liga / 44.231 match |
| Level A baseline LL | 1,0503 (n=6.660) | 1,0509 (n=6.661) |
| Level A winner LL | 1,0298 | 1,0295 |
| Level A naive LL | 1,0737 | 1,0736 |
| Level B produksi (κ×1) LL | 1,0340 | 1,0345 |
| Level B terpilih (κ×2) LL | 1,0205 | 1,0202 |
| Closing line | **n=0 (belum terukur)** | **terukur pertama kali: 30 match** bertangkapan pre-kickoff; subset berpasangan n=21 — closing LL 0,8668 (n=30) vs model winner 0,9575 (n=21) |

Kualitas model stabil di data yang tumbuh; kesimpulan Fase 3 tidak
berubah: model mengalahkan baseline naive dan terkalibrasi baik secara
OOS, tapi **tetap kalah dari closing line** pada sampel pertama yang
kecil ini — tidak ada klaim edge.

## 4. Perubahan status per liga — bukti gerbang

Perubahan FINAL hanya satu, tapi re-fit mengubah status pra-gerbang di
9 liga; gerbang OOS menahan semuanya. Bukti lengkap untuk 10 liga yang
gagal gerbang OOS (n≥20 semuanya):

| Liga | Sebelum (final) | Pra-gerbang (skala/cakupan) | OOS held-out vs naive (n) | Final |
|---|---|---|---|---|
| sm:1085 AFC CL Elite | calibrated | calibrated (skala 1,0042, cak 1,00) | 1,0841 ≥ 1,0758 (43) ✗ | **partial — DEMOSI** |
| sm:9 Championship | partial | calibrated (skala **1,0001**, cak 1,00) | 1,1015 ≥ 1,0799 (192) ✗ | partial (tertahan gerbang) |
| sm:465 Liga Portugal 2 | partial | calibrated (skala 0,9921, cak 1,00) | 1,0757 ≥ 1,0646 (104) ✗ | partial (tertahan gerbang) |
| sm:14 League Two | uncalibrated | partial (1,0379) | 1,0790 ≥ 1,0785 (192) ✗ | uncalibrated (diblokir lagi) |
| sm:274 First Division DK | uncalibrated | partial (0,9578) | 1,5105 ≥ 1,1296 (70) ✗ | uncalibrated |
| sm:603 1. Lig TR | uncalibrated | partial (0,9595) | 1,1489 ≥ 1,1165 (135) ✗ | uncalibrated |
| sm:1073 V-League | uncalibrated | partial (1,0811) | 1,0923 ≥ 1,0589 (61) ✗ | uncalibrated |
| sm:1088 AFC CL Two | uncalibrated | partial (0,9577) | 1,1217 ≥ 1,0556 (43) ✗ | uncalibrated |
| sm:1356 A-League Men | uncalibrated | partial (0,9656) | 1,1634 ≥ 1,1257 (54) ✗ | uncalibrated |
| sm:860 Botola Pro | uncalibrated | partial (0,9788) | 1,1291 ≥ 1,1142 (79) ✗ | uncalibrated |

Catatan kejujuran metodologi:
- **sm:1085** memang item pengawasan Fase 3 ("calibrated di margin
  tipis"). Di data yang tumbuh, buktinya berbalik — demosi ini adalah
  gerbang bekerja sebagaimana mestinya, bukan regresi fit (skala dan
  cakupannya lolos sempurna).
- **Championship (sm:9)** sekarang LULUS uji skala (1,0001; Fase 3:
  0,978) berkat re-fit di data yang lebih besar — fit-nya membaik —
  tapi bukti held-out-nya tetap di bawah naive, jadi statusnya tetap
  partial. Menaikkannya butuh bukti OOS, bukan toleransi yang
  dilonggarkan.
- Tidak ada promosi final kali ini; tidak ada liga calibrated lain yang
  bergerak.

## 5. Roster: akar masalahnya bentuk nama, bukan data hilang

Diagnostik sebelum perbaikan membuktikan roster fit sebenarnya lengkap
di data — yang gagal adalah PENCARIAN nama: fixture memakai bentuk nama
feed ("AFC Bournemouth", "FC Barcelona", "Paris", "St. Johnstone",
"Bodø / Glimt", "Racing Club", …) sementara kunci roster memakai bentuk
nama store ("Bournemouth", "Barcelona", "Paris FC", "St Johnstone",
"Bodø/Glimt", "Racing", …). 34 pasangan (tim, divisi) gagal lookup
roster primer.

Perbaikan di dalam `calibrate-ratings.ts` (jadi ikut terbit ulang di
setiap run cron): untuk setiap entri liga di JSON, ditambahkan kunci
alias bentuk-nama-fixture yang menunjuk objek tim terfit yang sama,
dicocokkan lewat jembatan konservatif (normalisasi + buang imbuhan
generik AFC/FC/SC/AC/CF dan akhiran FC/SC/CF/Club + samakan tanda baca).
Parameter fit tidak berubah sama sekali — audit diff JSON: 0 baris
parameter terhapus, tepat 26 baris alias tertambah. Nama placeholder
playoff ("1st ranked"…"8th ranked" di sm:743/sm:651) sengaja TIDAK
di-alias — itu slot TBD katalog, bukan tim.

Hasil `scripts/verify-consumption.ts` (3.770 fixture):

| Metrik | Sebelum kanonik | Sesudah kanonik | Sesudah rekalibrasi |
|---|---|---|---|
| Kedua tim ketemu | 2.889 | 2.871 (−18) | **2.954** |
| Satu sisi | — | 115 | 42 |
| Nol | 17 | 32 | 22 |
| Kompetisi ter-cover penuh | 48/88 | 49/88 | **58/88** |
| Tanpa divisi | — | 752 | 752 |

Kehilangan −18 dari langkah kanonik **pulih sepenuhnya dan terlampaui
+65** di atas baseline pra-kanonik. Residu yang tersisa itu jujur:
fixture piala/tanpa-fit (0/N by design), slot placeholder playoff
Liga MX/Serie B Brazil, jalur pseudo-UCL (tim dari liga tanpa fit
kalibrasi memang tidak ditemukan di pencarian lintas-liga), dan sisa
bentuk akronim Belanda di comp_3809 (32/50) — "PEC Zwolle" tidak
terjembatani karena `pec` tidak masuk himpunan imbuhan konservatif
(keputusan sadar: himpunan tidak diperluas sepihak; lihat §8).

## 6. Miss list — liga kanonik ber-fixture tapi TIDAK calibrated (54)

Setiap liga kanonik pembawa fixture kini punya status eksplisit; 54 di
antaranya tidak calibrated, dengan alasan per liga:

**Piala/lintas-negara by design — tidak difit per-liga (19):**
sm:2 Champions League (108 fx; tetap dilayani jalur pseudo-UCL loader,
lihat §8), sm:5 Europa League (54), sm:2286 Europa Conference League
(72), sm:307 Coupe de France (91), sm:24 FA Cup (40), sm:1082 Friendly
International (36), sm:1419 UEFA Women's CL (27), sm:468 Taça de
Portugal (24), sm:78 KNVB Beker (16), sm:570 Copa del Rey (11),
sm:109 DFB Pokal (8), sm:950 Kings Cup (8), sm:2451 Club Friendlies (6),
sm:390 Coppa Italia (5), sm:27 Carabao Cup (4), sm:1452 FIFA
Intercontinental Cup (3), sm:654 Copa do Brasil (3), sm:1116 Copa
Sudamericana (1), sm:1122 Copa Libertadores (1).

**Diblokir gerbang OOS — fit tidak mengalahkan naive secara held-out (7):**
sm:14 League Two (112 fx; 1,0790 vs 1,0785, n=192), sm:603 1. Lig (60;
1,1489 vs 1,1165), sm:1073 V-League (49; 1,0923 vs 1,0589), sm:1088 AFC
CL Two (48; 1,1217 vs 1,0556), sm:1356 A-League Men (40; 1,1634 vs
1,1257), sm:860 Botola Pro (9; 1,1291 vs 1,1142), sm:274 First Division
DK (24; 1,5105 vs 1,1296).

**Partial karena demosi/tertahan gerbang OOS (3):**
sm:1085 AFC CL Elite (36 fx), sm:9 Championship (144), sm:465 Liga
Portugal 2 (63) — bukti di §4.

**Partial karena gagal uji skala 2% (cakupan 100%, OOS lolos) (25):**
sm:82 Bundesliga (skala 1,0571; 101 fx), sm:567 La Liga 2 (1,0416; 77),
sm:72 Eredivisie (1,0418; 104), sm:17 Enterprise National League
(1,0290; 120), sm:648 Serie A Brazil (1,0287; 49), sm:636 Liga
Profesional Argentina (1,0283; 15), sm:211 Challenger Pro League
(1,0322; 44), sm:372 Ligat ha'Al (1,0241; 56), sm:444 Eliteserien
(1,0344; 40), sm:474 Superliga Rumania (1,0245; 48), sm:609 Premier
League Ukraina (1,0395; 41), sm:651 Serie B Brazil (1,0217; 24),
sm:672 Liga BetPlay (1,0337; 24), sm:74 Eerste Divisie (1,0209; 70),
sm:743 Liga MX (1,0223; 31), sm:806 Premier League Afrika Selatan
(1,0383; 32), sm:938 Stars League Qatar (1,0317; 18), sm:944 Pro League
Saudi (1,0234; 57), sm:959 UAE Pro League (0,9686; 42), sm:989 Super
League China (1,0241; 8), sm:1007 Indian Super League (0,9586; 40),
sm:208 Pro League Belgia (1,0235; 55), sm:229 First League Bulgaria
(1,0261; 28), sm:292 Veikkausliiga (0,9773; 3), sm:1107 CAF Champions
League (0,6025; 24 — kompetisi kontinental yang ter-fit sebagai liga
karena regex piala tidak menangkap namanya; perilaku lama, ditandai
di §8).

Liga-liga partial tetap tersaji HANYA dengan flag eksplisit lewat
gerbang; yang uncalibrated tidak tersaji sama sekali.

## 7. Everton vs Coventry — run #3 di keadaan final

`scripts/run-one-analysis.ts` dijalankan ulang offline penuh (nol API,
nol tulis snapshot). Paket run #2 dipertahankan sebagai
`tasks/e2e-run-1-package.canonical.json`; paket baru menimpa
`tasks/e2e-run-1-package.json`.

| | Run #2 (pasca-kanonik) | Run #3 (pasca-rekalibrasi) |
|---|---|---|
| Fit yang melayani | SM8 (kanonik sm:8, via fixture-row) | SM8 (sama, tercatat identik) |
| Status gerbang | calibrated | calibrated |
| λ / μ | 1,552 / 1,123 | 1,552 / 1,123 |
| Home / Draw / Away | 47,22% / 25,27% / 27,52% | **47,22% / 25,27% / 27,52%** |
| EV: Everton / Draw / Coventry / Over 2.5 | −17,4% / +5,1% / +35,7% / −9,5% | identik |

Angka tidak bergeser — dan itu hasil yang benar untuk dilaporkan apa
adanya: jendela data Premier League nyaris tidak berubah dalam sehari
dan fit-nya deterministik atas store yang sama. Yang berubah dari
rekalibrasi adalah SISTEM di sekeliling angka ini: statusnya kini
dibaca dari baris kanonik, fit-nya terbit dari jalur kanonik, dan
gerbangnya baru saja diuji ulang.

## 8. Konsekuensi gerbang kanonik + keputusan owner yang tertunda

Konsekuensi yang disadari dari "gerbang membaca status kanonik": untuk
5 liga dual-fit yang fit SM-nya partial sementara fit legacy-nya
calibrated — sm:9 Championship (E1), sm:82 Bundesliga (D1), sm:567 La
Liga 2 (SP2), sm:72 Eredivisie (N1), sm:208 Pro League Belgia (B1) —
lookup gerbang lewat divisi legacy kini melaporkan status kanonik
**partial** (status fit primer liga itu), bukan lagi 'calibrated'
warisan. Penyajian fit legacy-nya sendiri tidak diblokir (partial =
tersaji dengan flag), tapi flag-nya kini jujur di tingkat liga.

Menunggu keputusan owner (tidak diselesaikan sepihak):
1. **sm:1085 AFC CL Elite turun ke partial** — terima sebagai status
   berjalan (rekomendasi laporan ini: terima; bukti held-out-nya
   memang berbalik), dan perlakuan kompetisi kontinental secara umum
   akan digantikan model offset global piala yang sudah diputuskan
   arahnya — rekalibrasi ini sengaja tidak mendahului model itu.
2. **Jalur pseudo-UCL vs sm:2 uncalibrated by design** — tetap seperti
   keputusan yang diparkir sejak langkah kanonik (pseudo tetap
   melayani 108 fixture UCL); model offset piala akan menjawabnya.
3. **sm:1107 CAF Champions League ter-fit sebagai liga** (skala
   0,6025, partial) karena deteksi piala berbasis nama tidak
   menangkapnya — klasifikasikan sebagai piala by-design, atau
   biarkan? Perilaku tidak diubah di rekalibrasi ini.
4. **Jembatan akronim Belanda** (PEC/ADO/NEC, sisa comp_3809 32/50):
   perluas himpunan imbuhan jembatan nama, atau terima?
5. Item parkir lama yang tidak disentuh rekalibrasi ini: aturan
   kembaran mt_/sm_, default sumber-tak-dikenal condong SM, 31
   identitas TheStats tanpa negara.

## 9. Kepatuhan & commit

- `tsc --noEmit` = 0 error di setiap checkpoint.
- File 🔒 byte-identik: `sha256sum -c tasks/backend-readonly-hashes.txt`
  = 8/8 OK (planner, llm, schemas, coverage, syndicate-orchestrator,
  lib/llm/models, lib/llm/voice-guide, lib/db/analysis-snapshot).
- `data/analysis_snapshots.db` tidak disentuh (mtime tidak berubah,
  21 baris utuh; tidak ada langkah yang membukanya untuk menulis).
- Nol panggilan API Sportmonks; `.env.local` tidak pernah dibuka.
- Commit: `0919392` (kode kanonik di calibrate + gerbang + generator)
  → `d9895be` (re-fit + gerbang OOS baru + perbaikan harness) →
  `437ca65` (regenerasi registry kanonik) → commit laporan ini
  (laporan + paket E2E run #2/#3). `git status` bersih sesudahnya.

### Efisiensi kode

- Rekalibrasi menumpang jalur yang sudah ada: satu flag, satu kolom,
  satu blok turunan, satu blok metadata, satu fungsi jembatan lokal di
  skrip kalibrasi — tanpa dependensi baru, tanpa modul baru.
- Satu-satunya perubahan lib adalah gerbang membaca kanonik (fungsi
  yang sudah ada di league-identity dipakai ulang) + tipe tambahan.
- Perbaikan harness closing-line: 6 baris efektif menggantikan
  pemanggilan yang salah signatur.
