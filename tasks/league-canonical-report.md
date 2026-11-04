# Laporan Verifikasi — Unifikasi Identitas Liga (Struktur Kanonik)

> 4 Nov 2026. Menjawab temuan E2E run #1: fixture Sportmonks Premier
> League dilayani ratings LEGACY E0 hanya karena string nama, karena
> identitas `sm:<id>` hilang di batas intel. Perintah owner: jangan tambal
> prioritas — satukan struktur nama liga dari semua sumber jadi SATU
> struktur kanonik dulu. Laporan ini adalah buktinya.

## 1. Struktur kanonik

Satu entri per liga dunia-nyata di `data/league-canonical.json`
(dibangun `scripts/build-league-canonical.ts`, offline dari store lokal):
**identitas = `canonical_id`** (`sm:<leagueId>` bila liga ada di
Sportmonks — sumber live; selain itu kode divisi legacy; selain itu id
TheStats `comp_*` sebagai satu-satunya identitas yang bertahan), dan
**referensi = `name` + `country`** (negara kolom terpisah; nama polos
sendirian tidak pernah jadi kunci). Setiap entri memuat `aliases` —
semua identitas sumber yang menunjuk liga yang sama
(`sportmonks` / `thestats` / `legacy-div` / `ratings-key`, lengkap dengan
`name_as_stored` versi masing-masing store) — dan `fits`: fit ratings
yang ada per sistem beserta status kalibrasinya (status diambil dari
registry `league_calibration`, sumber kebenaran; konflik registry-vs-JSON
= 0 pada build ini).

Penggabungan: join eksak atas (nama ternormalisasi + negara). Nama
ternormalisasi membuang awalan negara/konfederasi ("English Premier
League" → inti "premier league") sehingga nama legacy berprefix negara
bertemu nama polos Sportmonks. Yang tidak tertangkap join itu TIDAK
ditebak: diputuskan tangan di `FORCE_MERGE` berkomentar di generator
(14 pasangan), atau tetap entri sendiri.

### Angka registry

| Metrik | Nilai |
|---|---|
| Entri kanonik | **250** |
| Identitas sumber terpetakan | **412 / 412 (100%)** — sportmonks 109, thestats 208, legacy-div 22 (16 divisi + 6 `master_<DIV>`), ratings-key 73 |
| Entri ber-fit ratings | 57 (persis kunci `calibrated_ratings.json` yang terdistribusi ke entri kanonik) |
| Entri tanpa negara | 31 — semua `comp_*` TheStats yang negaranya memang NULL di katalog sumber; tetap entri kanonik sendiri (terpetakan, bukan hilang) |
| Tak terpetakan | **0** — setiap identitas yang membawa fixture, ratings, atau baris kalibrasi menunjuk tepat satu entri kanonik |

### Gabungan lintas sistem (16 liga legacy ↔ Sportmonks)

Semua 16 divisi legacy bergabung dengan padanan Sportmonks-nya; kedua fit
tercatat per entri (status registry):

| Kanonik | Fit legacy | Fit Sportmonks |
|---|---|---|
| sm:8 Premier League (England) | E0 calibrated | SM8 calibrated |
| sm:9 Championship (England) | E1 calibrated | SM9 **partial** |
| sm:564 La Liga (Spain) | SP1 calibrated | SM564 calibrated |
| sm:567 La Liga 2 (Spain) | SP2 calibrated | SM567 **partial** |
| sm:384 Serie A (Italy) | I1 calibrated | SM384 calibrated |
| sm:387 Serie B (Italy) | I2 calibrated | SM387 calibrated |
| sm:82 Bundesliga (Germany) | D1 calibrated | SM82 **partial** |
| sm:85 2. Bundesliga (Germany) | D2 calibrated | SM85 calibrated |
| sm:301 Ligue 1 (France) | F1 calibrated | SM301 calibrated |
| sm:304 Ligue 2 (France) | F2 calibrated | SM304 calibrated |
| sm:72 Eredivisie (Netherlands) | N1 calibrated | SM72 **partial** |
| sm:462 Liga Portugal (Portugal) | P1 calibrated | SM462 calibrated |
| sm:208 Pro League (Belgium) | B1 calibrated | SM208 **partial** |
| sm:501 Premiership (Scotland) | SC0 calibrated | SM501 calibrated |
| sm:325 Super League (Greece) | G1 calibrated | SM325 calibrated |
| sm:600 Super Lig (Turkey) | T1 calibrated | SM600 calibrated |

13 bergabung lewat join ternormalisasi; 3 lewat override berkomentar
(SP2↔sm:567 "Segunda Division"="La Liga 2", P1↔sm:462 "Primeira
Liga"="Liga Portugal", B1↔sm:208 "First Division A"="Pro League").
Override lain (nama sponsor/ dagang TheStats → nama Sportmonks):
HNL Kroasia, Admiral Bundesliga Austria, Stoiximan Super League Yunani,
Enterprise National League Inggris, V-League 1 Vietnam, CFA Super League
Tiongkok, Liga Portugal Betclic, Trendyol 1.Lig Turki, Friendly
International, dan Liga MX Apertura+Clausura → sm:743 (TheStats memecah
per turnamen; Sportmonks satu liga).

Sengaja TIDAK digabung (kompetisi berbeda, tercatat dari diagnostik
generator): babak kualifikasi TheStats ("FA Cup, Qualification",
"FA Trophy, Qualification") vs piala utamanya; semua liga Play-offs vs
liga induknya; Serie C Girone A/B/C; liga wanita vs liga pria.

## 2. Resolusi yang melayani (lib/quant/league-identity.ts)

Modul kecil baru `lib/quant/league-identity.ts` (satu-satunya tempat
logika identitas; loader tidak lagi menyebar peta alias) dipakai
`ratings-loader.ts` lewat `resolveMatchLeague()` (hasil penuh: entri
kanonik + div + sistem fit + jalur + catatan alasan) — `resolveDivForMatch`
lama menjadi pembungkus tipisnya, dan `getShrunkMatchParameters`
mencatat jejaknya di `metadata.leagueResolution` + memakai `canonical_id`
sebagai `divCode` untuk liga yang dikenal tapi tak ber-fit, supaya
gerbang kalibrasi tetap bicara eksplisit (bukan "UNKNOWN" generik).

Urutan resolusi:
1. **ID sumber** (`sm:` / `SM` / `comp_` / `master_` / kode divisi) → entri → fit.
2. **Baris fixture tersimpan** — pemulihan ID dari store (lihat kompromi 🔒 di bawah).
3. **Nama + negara** bila negara diberikan.
4. **Nama polos** hanya bila tepat satu entri cocok; bila beberapa,
   disaring keanggotaan kedua tim di fit kandidat; tetap ambigu →
   **null eksplisit** dengan catatan (tidak ada lagi peminjaman divisi
   legacy diam-diam). String yang sama sekali tak dikenal registry jatuh
   ke jalur warisan lama (alias + saringan tim) sebagai jaring pengaman
   untuk singkatan feed eksternal (mis. "epl") — tercatat `via:
   legacy-fallback`.

**Aturan fit yang melayani:** fit yang sistemnya sama dengan sumber
fixture (fixture `sm:` → fit Sportmonks; fixture legacy/TheStats → fit
legacy); entri ber-fit tunggal → fit itu; sumber tak diketahui + dua fit
→ fit yang memuat kedua tim, seri → fit Sportmonks (sumber live).
Pilihan selalu tertulis di `note` resolusi.

### Kompromi titik sisip karena 🔒

`VerifiedMatchIntelligence.pertandingan` hanya membawa string nama —
membawa `competition_id` menembusnya butuh edit skema/planner 🔒.
Jalur non-🔒 yang dipakai: **pemulihan dari baris fixture tersimpan**.
Nama tim di intel berasal dari baris fixture itu sendiri, jadi loader
mencari baris `upcoming_fixtures` dengan pasangan nama kandang/tamu
persis + nama kompetisi yang cocok ke entri kanonik yang sama, lalu
memakai `competition_id` baris itu. Konsekuensi terukur: 80 pasangan
pertandingan terdaftar sebagai **kembaran mt_/sm_** (pertandingan sama,
kickoff identik, dijembatani `sm_id_map`) — untuk kembaran, ID `sm:`
yang menang (Sportmonks katalog live; baris mt_ hanya jembatan
identitas), jadi kedua baris kembar dilayani fit yang sama. Perilaku
per-baris yang murni setia-sumber untuk kembaran hanya bisa dicapai
bila `match_id` diteruskan ke loader — itu pekerjaan 🔒, dicatat sebagai
keputusan owner di §5.

**Pengecualian UCL (dipertahankan sadar):** entri sm:2 membawa
`loader_special: "UCL"` — parameter pseudo hardcoded + penskalaan
koefisien UEFA yang sudah melayani jalur nama sejak era legacy tetap
melayani (108 fixture UCL tidak berubah). Registry menandai sm:2
*uncalibrated by design*; konflik ini dicatat apa adanya di §5.

## 3. Sebelum vs sesudah (3.770 fixture upcoming, jalur produksi nama-saja)

Baseline ditangkap SEBELUM perubahan (per fixture: div hasil
`resolveDivForMatch` persis seperti yang dipakai verify-consumption dan
rantai planner), lalu ditangkap ulang sesudahnya pada himpunan fixture
yang identik (3.770 = 3.770, tanpa selisih himpunan).

**803 fixture (21,3%) berubah fit yang melayani.** Semuanya satu arah
pola: fixture `sm:` di 16 liga tergabung kini dilayani fit Sportmonks-nya;
fixture `comp_` tanpa kembaran SM tetap di fit legacy.

| Perubahan | Jumlah | Rincian kompetisi |
|---|---|---|
| E0 → SM8 | 127 | sm:8 ×99 + kembaran comp_3039 ×28 |
| E1 → SM9 | 100 | sm:9 ×100 |
| I1 → SM384 | 92 | sm:384 ×65 + kembaran comp_5840 ×27 |
| I2 → SM387 | 81 | sm:387 ×81 |
| SP1 → SM564 | 65 | sm:564 ×49 + kembaran comp_8814 ×16 |
| SP2 → SM567 | 56 | sm:567 ×56 |
| D1 → SM82 | 55 | sm:82 ×48 + kembaran comp_4643 ×7 |
| F1 → SM301 | 49 | sm:301 ×46 + kembaran comp_0256 ×3 |
| F2 → SM304 | 45 | sm:304 ×45 |
| D2 → SM85 | 27 | sm:85 ×27 |
| SM72 → N1 | 24 | comp_3809 ×24 (tanpa kembaran; bukti keanggotaan tim hanya di N1) |
| N1 → SM72 | 24 | sm:72 ×21 + comp_3809 ×3 |
| T1 → SM600 | 22 | sm:600 ×22 |
| G1 → SM325 | 17 | sm:325 ×17 |
| B1 → SM208 | 14 | sm:208 ×14 |
| null → SM651 / SM301 | 5 | sm:651 ×4, sm:301 ×1 (saringan tim kanonik menemukan fit yang luput dari mesin lama) |

Tidak berubah: UCL 108 = 108; Premier League Ukraina sm:609 (SM609) 41 =
41; fixture tanpa divisi 757 → 752.

Agregat `scripts/verify-consumption.ts`: kompetisi ter-cover penuh
48/88 → **49/88**; kedua-tim-ketemu 2.889 → 2.871 (−18) dan
nol-tim-ketemu 17 → 32. Penurunan kecil ini terukur sebabnya: **roster
fit Sportmonks lebih ramping dari fit legacy** (SM9 34 tim vs E1 44;
SM567 33 vs SP2 42; SM564 26 vs SP1 29; SM82 23 vs D1 27) — fit legacy
mengakumulasi klub lintas banyak musim. Tim yang absen dari fit SM tetap
tertangani fallback lintas-liga loader + blend telemetri; ini harga
jujur dari penyajian setia-sumber, dicatat sebagai bahan keputusan §5.

### Bukti Everton (wajib flip)

`sm_19722110` Everton vs Coventry City: **E0 → SM8** ✓, lewat jalur
`fixture-row`, tercatat di paket run ulang:
`leagueResolution = { canonicalId: "sm:8", fitSystem: "sportmonks",
via: "fixture-row", note: "Fit sportmonks (SM8, status calibrated)
melayani karena sumber fixture = sportmonks." }`

## 4. Run ulang E2E — Everton vs Coventry City

`scripts/run-one-analysis.ts` dijalankan ulang offline penuh (env
NineRouter dummy hanya agar graf modul 🔒 termuat; tanpa STATS_API_KEY /
SPORTMONKS_API_TOKEN → nol panggilan API; nol tulis snapshot). Paket
baru: `tasks/e2e-run-1-package.json`; paket run #1 dipertahankan sebagai
`tasks/e2e-run-1-package.pre-canonical.json`.

| | Run #1 (fit E0) | Run #2 (fit SM8) |
|---|---|---|
| λ / μ | 1,570 / 1,005 | 1,552 / 1,123 |
| **Home** | **49,15%** | **47,22%** |
| **Draw** | **27,93%** | **25,27%** |
| **Away** | **22,92%** | **27,52%** |
| Value Draw @4,16 | EV +16,2%, stake 1,3% | EV +5,1%, stake 0,4% |
| Value Coventry @4,93 | EV +13,0%, stake 0,8% | EV +35,7%, stake 2,3% |
| Value Everton @1,75 | EV −14,0% | EV −17,4% |

Arahnya persis seperti yang diramalkan review run #1: fit SM8 menilai
serangan Coventry lebih baik + pertahanannya lebih buruk (μ naik),
probabilitas tandang naik ~4,6 poin, kasus Draw melemah, kasus Coventry
menguat. Angka run #1 memang artefak routing — sekarang inputnya berasal
dari fit yang se-sumber dengan fixture-nya. (Verdict adalah lapisan
parent; laporan ini hanya menyerahkan angka barunya.)

## 5. Yang masih ambigu — keputusan owner (tidak diselesaikan sepihak)

1. **UCL pseudo vs registry.** Jalur pseudo-UCL (parameter hardcoded +
   penskalaan koefisien) kini tetap melayani fixture Champions League
   Sportmonks, padahal registry menandai sm:2 *uncalibrated by design*.
   Dipertahankan agar perilaku produksi tidak berubah diam-diam.
   Putuskan: gerbangi sm:2 seperti liga uncalibrated lain, atau
   formalasikan pseudo-UCL sebagai fit khusus yang sah?
2. **Kembaran mt_/sm_.** 80 pasangan pertandingan ada di dua katalog;
   keduanya dilayani fit SM (aturan kembaran). Kesetiaan per-baris
   (baris mt_ → fit legacy) hanya mungkin bila `match_id` diteruskan
   menembus batas intel — butuh edit 🔒 planner/skema. Putuskan apakah
   perlu, atau aturan kembaran ini memang yang diinginkan.
3. **Default sumber-tak-dikenal.** Bila sumber fixture tak bisa
   dipulihkan dan kedua fit memuat kedua tim, fit Sportmonks
   didahulukan (kasus nyata: 3 fixture comp_3809 berbalik N1 → SM72).
   Alternatifnya: dahulukan legacy seperti perilaku pra-kanonik.
4. **Roster fit SM lebih ramping** (−18 fixture kedua-tim-ketemu).
   Opsi: perluas jendela fit Sportmonks, atau terima (fallback
   lintas-liga + telemetri menutupinya) — keputusan metodologi fit,
   bukan identitas.
5. **31 identitas TheStats tanpa negara** di katalog sumber (NULL) —
   termasuk beberapa piala kontinental. Mereka entri kanonik sendiri
   sampai ada sumber yang memberi negaranya; tidak ada yang bisa
   digabung secara bertanggung jawab dari data yang ada.

## 6. Kepatuhan & commit

- `tsc --noEmit` = **0 error** di setiap checkpoint.
- File 🔒 byte-identik (sha256 dicocokkan sebelum vs sesudah):
  `lib/agent/planner.ts`, `lib/agent/llm.ts`, `lib/agent/schemas.ts`,
  `lib/agent/coverage.ts`, `lib/syndicate-orchestrator.ts`,
  `lib/llm/models.ts`, `lib/llm/voice-guide.ts`.
- `data/analysis_snapshots.db` tidak disentuh (mtime 3 Nov, sebelum
  pekerjaan ini; tidak ada langkah yang membukanya).
- Nol panggilan API Sportmonks; `.env.local` tidak pernah dibuka.
- Commit: `ced3b88` (registry + generator) → `05ddba7` (league-identity +
  rewiring loader) → commit laporan ini (report + driver E2E + kedua
  paket run). `git status` bersih sesudahnya.

### Efisiensi kode (disiplin anti-slop)

- Satu modul identitas kecil (league-identity.ts) menggantikan peta
  alias yang tersebar; loader kehilangan logika tebak-nama untuk liga
  yang dikenal registry — mesin warisan menyusut jadi satu fungsi
  jaring-pengaman bernama eksplisit (`legacyResolveDivForMatch`).
- Generator memakai ulang pola yang sudah ada di repo (node:sqlite
  read-only, cache per proses) — tanpa dependensi baru.
- Tidak ada file baru selain tiga deliverable (registry JSON, generator,
  modul identity) + laporan/paket verifikasi ini.
