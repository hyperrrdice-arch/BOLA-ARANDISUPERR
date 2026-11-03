# Laporan Sprint Ekspansi Database Sportmonks

> Ditulis 3 Nov 2026 (hari pertama sprint; trial berakhir **10 Nov 2026**).
> Semua angka dari query audit atas DB, bukan perkiraan.

## Ringkasan per modul

| Modul | Status | Bukti kunci |
|---|---|---|
| A. catalog-coverage | ✅ Selesai | 3.296 fixture SM / 81 kompetisi, horizon s.d. 31 Des 2026, sm_id_map 3.324 (100%) |
| B. odds-store | ✅ Selesai | Baseline **99,7%** (3.287/3.296 horizon awal; 3.323 fixture pada audit final setelah horizon bergulir); terjadwal 89 tangkapan; premium backfill = 0 baris (endpoint kosong) |
| C. predictions-store | ✅ Selesai | 7-hari **609/609 = 100%**; 14-hari 761/830; 70.050 nilai probability; predictability 86/109; anti-kontaminasi bersih |
| D. telemetry-depth | ✅ Selesai | **68.862 hasil + 83.020 baris telemetri**, 103 kompetisi, MAX(match_date) 2026-11-03, 0 skor karangan |
| E. ratings-expansion | ✅ Selesai | Registry 109/109; **28 calibrated, 36 partial, 45 uncalibrated (semua piala)**; JSON 44 liga / 1.118 tim |
| F. context-intel | ✅ Selesai | Standings 69 liga; berita 18 fixture; lineup 302 fixture; H2H 604 pasangan (446+ berisi) |
| G. daily-rhythm | ✅ Entrypoint terverifikasi | `scripts/daily-refresh.ts` merangkai 6 langkah; idempotensi terbukti per komponen + run rantai (lihat §G) |

## A. catalog-coverage ✅

- Sync penuh 3 Nov–31 Des 2026 selesai (exit 0): **3.296 fixture `sm_`** dalam
  **81 `competition_id`** SM; katalog kompetisi 317 (208 lama + 109 SM).
- `sm_id_map` 3.324 baris (3.201 → `sm_`, 123 → `mt_`); **0 fixture SM tanpa
  jembatan**. Jembatan `mt_` yang lebih dulu ada selalu menang (nol paksa).
- 28 dari 109 liga My Leagues tidak punya fixture di horizon — hampir semua
  play-off/super cup/friendly musiman; satu-satunya liga reguler adalah
  Primera Division Uruguay (`sm:770`, di luar musim). Rincian di
  `tasks/mapping-review.md`, termasuk grup tabrakan nama antar-liga
  ("Premier League" ×6, "Serie A" ×3) → semua join wajib via `competition_id`.

## B. odds-store ✅

- Skema aditif aktif: `match_odds_history.source` + `capture_kind`; payload
  terfilter market utama (±600 baris odds per fixture UCL; payload mentah
  4.662 baris/2,28 MB tidak disimpan mentah).
- **Baseline: 3.287 dari 3.296 fixture katalog (99,73%).** 9 fixture terlewat
  karena kickoff-nya lewat sebelum sapuan mencapainya (tidak bisa ditangkap
  retroaktif; premium history kosong — lihat di bawah).
- Total tangkapan SM pada audit final: **3.412** (baseline atas 3.323
  fixture + terjadwal 89) — titik terjadwal terus jatuh tempo selama
  pekan sprint dan diambil run `capture-odds`/`daily-refresh` berikutnya
  (run ritme pertama menambah 49 tangkapan baru, 0 error; dua run
  verifikasi menambah tepat 2 + 5 tangkapan terjadwal baru).
- 784 tangkapan berisi odds; sisanya `has_odds=0` — odds belum diterbitkan
  SM untuk fixture jauh/obscure; tercatat jujur dan akan terisi di titik
  terjadwal yang lebih dekat ke kickoff. 37 baseline ber-flag `late_entry`.
  0 baris tanpa `captured_utc`.
- **Backfill premium: 0 baris.** Semua endpoint premium (`/odds/premium*`
  termasuk history per-fixture) mengembalikan data kosong pada probe
  berulang + run resmi atas 20 fixture selesai, meski entitlement tercatat
  di `/my/resources`. Mekanisme `capture_kind='backfill'` siap pakai.
- Insiden: run pertama gugur `database is locked` → diperbaiki (WAL +
  busy_timeout 120 dtk + retry tulis per fixture + isolasi error per
  fixture); run final 0 error.

## C. predictions-store ✅

- `data/predictions.db` terpisah; **tidak ada** jalur dari predictions ke
  `match_odds_history` (audit: 0 payload bermarker predictions di tabel odds;
  500 baris legacy odds tidak tersentuh, `source` NULL seperti semula).
- Endpoint global paginated terbukti tidak terjangkau (terurut fixture_id
  menaik dari ±18,39 jt dengan ±3,5 fixture/halaman → katalog ±19,6 jt
  praktis tak tercapai) → diganti endpoint per-fixture terurut kickoff +
  skip kesegaran 20 jam untuk ritme harian:
  - **7 hari: 609/609 fixture ter-cover (100%)** — target PRD ≥95% terlampaui.
  - 14 hari: 761/830 (69 fixture memang tidak punya predictions di SM —
    dicoba, kosong); run ritme menaikkan cakupan 14-hari ke 765/835.
  - **70.050 nilai probability** tersimpan (semua market, termasuk
    Fulltime Result Probability); kolom `predictability` terisi dari skor
    liga bila tersedia.
- Value bets: 37 baris (SM memang jarang menerbitkannya).
- Predictability: 5.590 baris untuk **86/109 liga**; 23 liga tidak
  mengembalikan data predictability sama sekali (dicoba dua kali).
- Idempotensi terbukti: run kedua `--days=7` menyimpan **0 nilai baru**
  (609 dilewati karena masih segar).

## D. telemetry-depth ✅

- Store konsisten dengan pola lama: hasil → `dataset.matches` (`sm_<id>`,
  `sm:<leagueId>`, nama musim verbatim SM); telemetri → `team_match_logs`
  (`smlog_<id>_h/_a`, `source='sportmonks'`,
  `data_tier='sportmonks_backfill'`, xG dari `xGFixture` type 5304 — pola
  yang sama dengan sync SM 27 Okt di data lama).
- **Total: 68.862 hasil (3 jendela musim) + 83.020 baris telemetri** di
  **103 kompetisi**. 6 kompetisi tanpa hasil — semuanya play-off/piala yang
  musimnya di luar 3 jendela target (sm:1371, 1659, 1678, 1768, 1932, 310).
- Per tier (tabel resmi `tasks/tier-table.json`):
  EU1 31 liga — 19.601 hasil / 22.826 logs, xG 68,5%;
  EU2 9 — 7.656 / 8.692, xG 71,5%;
  EU3 3 — 3.840 / 4.346, xG 65,9%;
  EUCUP 24 — 3.577 / 5.064, xG 18,3%;
  AM 10 — 9.102 / 12.004, xG 53,0%;
  AS 13 — 5.108 / 6.020, xG 27,6%;
  OTHER 13 — 19.978 / 24.068, xG 2,3%.
- **MAX(match_date) telemetri = 2026-11-03** (hari berjalan; ≤48 jam dari
  laga selesai terakhir di semua tier).
- Kejujuran mapper terverifikasi: **0 match SM berskor NULL** (skor tidak
  valid = tidak disimpan, bukan 0-0); statistik yang tidak disediakan API
  tetap NULL; fixture yang sudah terwakili logs legacy via jembatan `mt_`
  dilewati. xG per liga top (Premier League) 99,8%; angka agregat lebih
  rendah murni karena ketersediaan xG provider per kompetisi (friendlies
  2,3%, piala 18,3%, banyak liga Asia ±28%) — bukan kekosongan mapper.
- Klasifikasi tier diperbaiki selama sprint: kata piala multibahasa
  (Beker/Pokal/Coupe/Coppa/Copa/Taça/Kupa) terklasifikasi piala.
- Tim terdaftar demi integritas FK: 225 → **6.448**. Ukuran
  `thestats_dataset.db` kini ±1,45 GB (didominasi raw_stats_json).
- Endpoint fixtures per-musim yang benar:
  `/fixtures?filters=fixtureSeasons:{id}` (`/fixtures/seasons/{id}` = 404);
  server membatasi 25 baris/halaman di beberapa endpoint walau
  `per_page=100`.

## E. ratings-expansion ✅

- Fit IPF attack/defense dengan time-decay (half-life 365 hari),
  parameterisasi identik `lib/quant/ratings-loader.ts`
  (λ_home = leagueAvgGoals × att × def × homeAdvantage; leagueAvgGoals =
  rata-rata gol away).
- Registry `league_calibration`: 125 baris = **109/109 liga SM berstatus
  eksplisit** + 16 legacy (`legacy-csv-fit`).
  - **Calibrated (28):** semua lolos uji skala (rasio 0,983–1,020) DAN
    cakupan telemetri musim berjalan 1,00 — antara lain La Liga, Serie A,
    Premier League, Ligue 1, Liga Portugal, Ekstraklasa, Superliga DK,
    Super Lig, Allsvenskan, 1. HNL, Premiership, Women's Super League,
    MLS, Serie A/B Brazil, Primera Division AR/CL, K League 1, J1 League,
    Eerste Divisie, Serie B IT, Ligue 2, 2. Bundesliga, Liga Portugal 2,
    League One, Premiership (ZA).
  - **Partial (36):** fit sah tetapi rasio skala di luar toleransi ketat
    2% (Bundesliga 1,079; Eredivisie 1,037; League Two 1,038; Championship
    0,978; …). Catatan metodologi: uji skala tak-terbobot vs fit terbobot
    waktu — gerbang sengaja ketat; status jujur, bukan disembunyikan.
  - **Uncalibrated (45):** seluruhnya kompetisi piala/lintas-negara yang
    memang dikecualikan dari fit per-liga (di luar parameterisasi).
- `calibrated_ratings.json`: **44 liga / 1.118 tim** — 16 liga legacy
  terverifikasi tidak berubah (mis. E0: 29 tim, leagueAvgGoals 1,328,
  totalMatches 1.960) + 28 liga SM calibrated (key `SM<leagueId>`,
  `source: 'sportmonks-fit'`, `calibrationStatus`, `fitMethod`). Liga
  partial TIDAK masuk JSON (JSON = himpunan yang boleh disajikan tanpa
  flag).

## F. context-intel ✅

Tabel baru di `thestats_dataset.db`, semua payload berlabel SM + `fetched_utc`:
- `standings`: **69 liga** (1.308 baris khas-PK; run terakhir meng-upsert
  1.434 baris termasuk tahap grup). 40 liga lain: piala tanpa tabel /
  klasemen musim berjalan belum diterbitkan SM.
- `prematch_news`: **18 fixture** punya berita (dari 821 item global; feed
  SM memang jarang).
- `expected_lineups`: **302 fixture** ≤7 hari (naik dari 267 pada pass
  pertama — lineup terbit makin dekat ke kickoff; sisanya memang belum
  menerbitkan susunan pemain).
- `h2h_cache`: **604 pasangan**; ±446 berisi riwayat pertemuan, sisanya
  tersimpan `[]` (memang belum pernah bertemu / data kosong).
- Baca offline terverifikasi secara konstruksi: semua jalur baca adalah
  query SQLite lokal; API hanya dipakai saat sync.

## G. daily-rhythm ✅

- `scripts/daily-refresh.ts` merangkai: katalog (horizon bergulir 60 hari)
  → odds jatuh tempo → predictions (≤14 hari, skip segar 20 jam) →
  telemetri musim berjalan (`--current-only`) → kalibrasi → konteks →
  laporan `tasks/coverage-latest.md`.
- Run rantai penuh pertama (3 Nov malam) mengeksekusi semua langkah
  berurutan: katalog 3.318 fixture ter-upsert (horizon bergeser ke
  1 Jan 2027), odds +49 tangkapan baru 0 error, predictions +368 nilai
  baru (765/835 ter-cover), telemetri musim berjalan (104 liga), lalu
  kalibrasi, konteks, laporan.
- Idempotensi terverifikasi dua lapis: (1) per komponen — predictions
  run-2 = 0 nilai baru; odds run final = 3.271 fixture
  dilewati-sudah-lengkap; semua penulis berbasis upsert/INSERT OR
  REPLACE berbasis PK; backfill punya fast-path lewati untuk musim
  selesai yang datanya lengkap. (2) Dua run entrypoint berturut
  (`--skip=telemetry,context` — dua langkah terpanjang, sudah terbukti
  di run rantai): **diff jumlah baris = 0 di semua tabel**, kecuali
  `match_odds_history` +7, persis tangkapan terjadwal yang baru jatuh
  tempo di antara kedua run (2 + 5, tercatat di log run) — data baru
  yang sah, bukan duplikat. Kalibrasi deterministik (output identik:
  44 liga / 1.118 tim di kedua run).
- Perbaikan yang ikut masuk: `scripts/sync-sportmonks-fixtures.ts` kini
  punya retry jaringan yang sama dengan skrip sprint (sebelumnya satu
  koneksi putus menggagalkan seluruh run katalog).

## Insiden & adaptasi selama sprint (jujur)

1. **VM restart empat kali** (3 Nov ±12:49, ±14:03, ±14:49, ±15:09 UTC) —
   semua proses latar mati tiap kali; nol korupsi (quick_check ok di semua
   DB); pekerjaan hilang minimal berkat transaksi per liga-musim & upsert
   di semua jalur. Log dipindah dari /tmp ke `~/workspace/.sprint-logs/`.
2. **Koneksi API menurun** setelah tarikan paralel berat: respons terputus
   di tengah (IncompleteRead/RemoteDisconnected) dalam jendela
   menit–puluhan menit. Mitigasi: timeout 60 dtk + retry berjenjang di
   `scripts/sm-fetch.ts` (terbukti memulihkan diri berkali-kali), isolasi
   error per item di semua skrip, sequencing ulang (perishable didahulukan,
   paralel dikurangi), dan fast-path skip di backfill.
3. **Endpoint yang tidak sesuai dugaan** (semua terverifikasi probe):
   `/fixtures/seasons/{id}` 404 → filter `fixtureSeasons`; endpoint global
   predictions tak terjangkau → per-fixture; endpoint premium kosong meski
   entitlement ada → dicatat 0; `per_page` dibatasi server di 25 pada
   beberapa endpoint.
4. `analysis_snapshots.db` tidak pernah ditulis/dihapus selama sprint.

## Sisa & risiko pasca-trial (untuk 4–10 Nov)

- Titik odds terjadwal (T-24j/T-6j/T-1j/T-15m) terus jatuh tempo — diambil
  `daily-refresh` harian; tanpa run, tangkapan titik terlewat tidak bisa
  direkonstruksi (odds pre-match hilang setelah kickoff).
- Predictions membusuk setelah ±20 jam — segarkan harian via ritme.
- Lineup makin lengkap ≤24 jam sebelum kickoff — pass konteks harian
  menaikkannya.
- Setelah trial berakhir (10 Nov), semua jalur tulis berhenti di batas
  data 3–10 Nov; store lokal tetap utuh dan bisa dibaca offline.
- Liga `partial` (36) bisa naik ke `calibrated` bila toleransi uji skala
  ditinjau (keputusan metodologi untuk Arandi — bukan diubah sepihak).
