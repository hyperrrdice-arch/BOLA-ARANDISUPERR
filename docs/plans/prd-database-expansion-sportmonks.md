# PRD — Ekspansi & Pendalaman Database football-agent via Sportmonks Pro

- **Status:** DISETUJUI 3 Nov 2026 dengan 6 keputusan di §10 — masuk fase Plan (`tasks/plan.md` + `tasks/todo.md`)
- **Tanggal:** 3 Nov 2026
- **Penulis:** Spark, atas permintaan Arandi
- **Sumber fakta:** audit database lokal 3 Nov 2026 (read-only) + probe live API Sportmonks 3 Nov 2026 (token Pro trial Arandi) + `ARCHITECTURE.md` (pipeline aktif Okt 2026)
- **Cakupan dokumen:** lapisan DATA saja (katalog, telemetri, odds, predictions, konteks). Tidak mengubah kontrak quant, planner, sindikat, atau view-model.

---

## Asumsi yang dipakai (koreksi sekarang atau asumsi ini berlaku)

1. Token Sportmonks Pro trial adalah sumber data utama pengganti TheStatsAPI (yang mati permanen 18 Okt 2026, `KEY_REVOKED`).
2. **Tanggal berakhirnya trial belum diketahui** — PRD ini dirancang dengan prinsip *perishable-first*: data yang hilang selamanya bila tidak ditangkap sebelum kickoff (odds & predictions pre-match per fixture) diprioritaskan di atas data historis yang bisa di-backfill kapan pun.
3. Semua DB lokal yang ada dipertahankan (tidak ada migrasi engine); ekspansi dilakukan dengan tabel baru dan kolom aditif, mengikuti aturan lifecycle yang sudah ada: master/dataset/vault/upcoming boleh di-rebuild, `analysis_snapshots.db` **append-only dan di luar scope tulis PRD ini**.
4. Angka hanya bertambah lewat jalur code deterministik (ingest script + mapper teruji), tidak ada penulisan manual/LLM ke database — sesuai aturan emas arsitektur.
5. Liga baru yang belum punya prior kalibrasi **tidak boleh** dilayani quant seolah terkalibrasi; status kalibrasinya eksplisit dan ter-flag (lihat modul `ratings-expansion`).

---

## 1. Kondisi saat ini (terukur, 3 Nov 2026)

| Aspek | Sekarang | Masalah |
|---|---|---|
| Katalog fixture | 420 fixture, 18 Okt – **29 Nov 2026**, hanya **7 kompetisi** (Serie A, Ligue 1, Premier League, LaLiga, Eredivisie, Bundesliga, UCL) | Horizon berhenti 29 Nov; musim terus berjalan |
| Kebersihan katalog | Nama kompetisi ganda: "LaLiga" (56) vs "La Liga" (13); "UEFA Champions League" (54) vs "Champions League" (7) | Duplikasi menyulitkan agregasi & mapping |
| Flag ketersediaan | `odds_available` baru 112/420 (27%); `xg_available` **0/420** | Mayoritas fixture miskin konteks |
| Telemetri (`team_match_logs`) | 2.583 baris; **mentok 27 Okt 2026**; sumber: 2.348 legacy TheStats (API mati), 160 Sportmonks, 75 master | Stale; jalur pengisi utama sudah mati. Skema kolom sebenarnya sudah sangat dalam (xG/npxG per babak, big chances, shot detail) — yang dangkal adalah isinya |
| Odds (`match_odds_history`) | 500 baris snapshot JSON (`payload_json` + `has_odds`) | Tipis; tidak ada ritme tangkapan terjadwal |
| Ratings terkalibrasi | **16 liga / 483 tim** (kode football-data: B1, D1, D2, E0, E1, F1, F2, G1, I1, I2, N1, P1, SC0, SP1, SP2, T1) dari `football_master.db` 28.922 match | Hanya liga yang punya CSV historis; liga lain tidak punya prior |
| Mapping ID Sportmonks | `sm_id_map` 165 baris vs 225 tim di dataset | Jembatan ID TheStats↔Sportmonks belum lengkap bahkan untuk cakupan sekarang |
| Predictions Sportmonks | **Belum disimpan sama sekali** | Padahal entitlement aktif (lihat §2) |
| Snapshot analisis | 21 snapshot (15 grounded penuh) — append-only, tidak bisa di-rebuild | Bukan target PRD; justru alasan ekspansi data harus hati-hati: kualitas analisis bergantung penuh pada data di bawahnya |

## 2. Kapasitas baru (terverifikasi probe, 3 Nov 2026)

- Token Pro trial **valid**: rate limit **3.000 request/jam**, dan limit berlaku **per entity bucket** (Fixture, Odd, Prediction, League masing-masing punya jatah sendiri).
- **My Leagues: 109 liga/kompetisi aktif di 51 negara** — ±15× dari 7 kompetisi yang dipakai sekarang.
- Entitlement relevan yang **aktif** (dari `/v3/my/resources`, 196 resource): All Predictions + Predictions by Fixture + **Value Bets** + **Predictability by League** + Live Predictions; **Premium Odds** (pre-match per fixture/bookmaker/market + **Premium Odds History**); **Fixtures Head To Head**; **Expected Metrics (xG) by Fixture & by Player**; Standings; **Pre-match News**; **Expected & Predicted Lineups**; Shotdata; Match Facts; Team Rankings.

**Kesimpulan kapasitas:** kuota bukan bottleneck untuk rancangan ini (lihat hitungan §6). Bottleneck sebenarnya adalah (a) masa trial yang tidak diketahui ujungnya, dan (b) pekerjaan mapping ID & kalibrasi untuk liga baru.

## 3. Tujuan & non-tujuan

**Tujuan**
1. Katalog fixture mencakup **seluruh 109 liga** My Leagues dengan horizon bergulir minimal 30 hari ke depan, nama kompetisi bersih (satu nama kanonis per kompetisi).
2. Telemetri tidak lagi stale: `team_match_logs` terisi sampai ≤48 jam dari pertandingan terakhir yang selesai, untuk semua liga Tier-1 (lihat keputusan terbuka #2), dengan kolom statistik & xG terisi dari Sportmonks.
3. Odds pre-match tertangkap **terjadwal** (bukan insidental) untuk setiap fixture katalog, dengan riwayat tangkapan yang bisa diaudit.
4. Predictions Sportmonks (probabilities, value bets, predictability) tersimpan berlabel sumber sebagai **sinyal pembanding** — siap dipakai evaluasi, tanpa mencemari jalur odds pasar.
5. Konteks per fixture diperdalam: H2H, standings, pre-match news, expected lineups tersedia on-demand dari store lokal (offline-first), bukan dari panggilan API di jalur render.
6. Liga-liga baru punya jalur kalibrasi yang jujur: terkalibrasi dari data, atau ter-flag belum terkalibrasi dengan degradasi eksplisit di quant.

**Non-tujuan**
- Mengubah formula quant (Dixon-Coles, shrinkage, Kelly), kontrak planner/sindikat, atau view-model.
- Menulis apa pun ke `analysis_snapshots.db` selain jalur produksi yang sudah ada.
- Menjadikan predictions Sportmonks sebagai "odds pasar" (melanggar guardrail #7 arsitektur).
- Menarik data per-fixture secara massal untuk hal yang hanya dibutuhkan saat analisis (lineups detail, xG per pemain) — itu tetap on-demand per analisis.

## 4. Capability map

| Module id | Tanggung jawab | Bergantung pada |
|---|---|---|
| `catalog-coverage` | Katalog 109 liga, horizon bergulir, nama kanonis, mapping ID massal | — |
| `telemetry-depth` | Backfill + penyegaran `team_match_logs` dari Sportmonks (statistik & xG), anti-leakage terjaga | `catalog-coverage` |
| `ratings-expansion` | Prior & kalibrasi untuk liga di luar 16 liga master; flag status kalibrasi | `telemetry-depth` |
| `odds-store` | Tangkapan odds pre-match terjadwal + backfill premium odds history | `catalog-coverage` |
| `predictions-store` | Simpan probabilities, value bets, predictability — berlabel sumber, ter-gate predictability | `catalog-coverage` |
| `context-intel` | H2H, standings, pre-match news, expected lineups sebagai store lokal | `catalog-coverage` |
| `daily-rhythm` | Orkestrasi sync harian, budget guard per entity, laporan cakupan & kesehatan data | semua modul di atas |

**Urutan bangun:** `catalog-coverage` → `telemetry-depth` → `ratings-expansion`; `odds-store`, `predictions-store`, `context-intel` paralel setelah katalog; `daily-rhythm` terakhir. Di dalam urutan itu, tangkapan odds & predictions untuk fixture terdekat **didahulukan dari semua backfill historis** (prinsip perishable-first, Asumsi #2).

## 5. Rancangan per modul

### 5.1 `catalog-coverage`
- **Scope:** sinkronisasi fixture seluruh 109 liga dari endpoint fixtures by date-range; horizon bergulir 30 hari; dedup nama kompetisi ke nama kanonis Sportmonks (`competition_catalog` diperluas dari 208 menjadi seluruh liga aktif + alias mapping untuk nama lama seperti "La Liga"); `sm_id_map` diperluas sampai mencakup semua tim di liga aktif.
- **Desain data:** tetap di `upcoming_fixtures.db` (disposable, sesuai lifecycle). Tambah kolom aditif `sm_league_id`, `sm_home_id`, `sm_away_id` bila belum terwakili mapping; tabel baru `competition_aliases(competition_id, alias, source)`.
- **Kriteria sukses:** (a) query katalog mengembalikan fixture ≥30 hari ke depan untuk 109/109 liga aktif; (b) nol nama kompetisi ganda untuk kompetisi yang sama; (c) cakupan `sm_id_map` = 100% tim di fixture horizon; (d) runnable check bergaya `test-upcoming-guard.ts` lulus (fixture `scheduled` tidak bocor ke telemetri).

### 5.2 `telemetry-depth`
- **Scope:** isi `team_match_logs` dari Sportmonks untuk pertandingan selesai: statistik tim (kolom yang sudah ada di skema) + expected metrics untuk `xg_for/xg_against` dan turunannya; label `source='sportmonks'`, `xg_source` terisi eksplisit. Backfill historis musim berjalan (2026/27) untuk liga Tier-1 dulu, lalu Tier-2. Penyegaran berjalan ≤48 jam.
- **Aturan keras:** mapper anti-karangan tetap berlaku (statistik absen → `null` + sample mengecil, bukan 0); cutoff anti-leakage (hanya match `finished` dengan tanggal valid yang masuk); baris legacy TheStats **tidak ditimpa** — baris Sportmonks untuk match yang sama hanya masuk bila match belum terwakili, dengan prioritas sumber terdokumentasi.
- **Kriteria sukses:** (a) `MAX(match_date)` di `team_match_logs` ≤48 jam dari match selesai terakhir di setiap liga Tier-1; (b) % baris baru dengan xG terisi ≥95% untuk liga yang entitlement xG-nya aktif; (c) test mapper (`test-stats-mapper.ts`) dan test snapshot DB tetap hijau; (d) nol baris dengan skor karangan (audit query: skor NULL tidak pernah tersimpan sebagai 0-0 finished).

### 5.3 `ratings-expansion`
- **Scope:** untuk liga di luar 16 liga master: fitting prior α/β dari data historis Sportmonks itu sendiri (fixtures + skor beberapa musim bila tersedia), masuk ke jalur kalibrasi yang sama (`calibrate-ratings.ts`) dengan `source='sportmonks-fit'`; liga yang data historisnya belum cukup mendapat `is_calibrated=false` di registry liga dan quant wajib degradasi jujur (probabilitas dari prior liga yang lebih lebar/shrinkage κ lebih besar, ditandai di output).
- **Desain data:** registry baru `league_calibration(league_id, status, n_matches, fitted_at, source)`; `calibrated_ratings.json` diperluas dengan provenance per liga.
- **Kriteria sukses:** (a) setiap liga di katalog punya baris registry dengan status eksplisit; (b) untuk liga berstatus terkalibrasi, uji kontrak skala (`test-quant-scale.ts`: Σλ≈Σx, Σμ≈Σy per liga) lulus; (c) analisis untuk liga `is_calibrated=false` menampilkan penanda degradasi (tidak pernah diam-diam).

### 5.4 `odds-store`
- **Scope:** tangkapan odds pre-match (semua bookmaker & market utama, termasuk premium) per fixture katalog pada jadwal **T-24j, T-6j, T-1j** (jadwal final = keputusan terbuka #4), disimpan sebagai snapshot bertanda waktu; backfill satu kali dari Premium Odds History untuk fixture yang sudah lewat **hanya** sebagai bahan evaluasi, ter-flag `is_backfill=true` dan tidak pernah dicampur dengan tangkapan live dalam laporan.
- **Desain data:** pertahankan pola `match_odds_history(match_id, captured_utc, payload_json, has_odds)` di `thestats_dataset.db`; tambah kolom aditif `source` dan `capture_kind` (`scheduled`/`manual`/`backfill`); indeks per `(match_id, captured_utc)`.
- **Kriteria sukses:** (a) ≥95% fixture yang kickoff dalam 24 jam terakhir punya ≥1 tangkapan `scheduled`; (b) fixture tanpa odds pasar tercatat `has_odds=0` secara eksplisit (jujur kosong, bukan hilang); (c) konsumsi bucket Odd per hari dalam pagu §6.

### 5.5 `predictions-store`
- **Scope:** tarik massal (endpoint global, paginated — bukan per-fixture) probabilities & value bets Sportmonks untuk semua fixture katalog; simpan predictability per liga sebagai gate kualitas; perbarui mengikuti ritme yang sama dengan odds.
- **Desain data:** DB baru `data/predictions.db` (lifecycle: rebuildable, terpisah dari dataset utama karena sumber & ritme berbeda): `sm_predictions(fixture_sm_id, market, outcome, probability, predictability, captured_utc, source='sportmonks')`, `sm_value_bets(fixture_sm_id, market, bookmaker, odds, fair_odds, value_pct, captured_utc)`, `sm_predictability(league_id, market, score, updated_utc)`.
- **Aturan keras:** predictions **tidak pernah** masuk `match_odds_history` dan tidak pernah menjadi input `evaluateValueBet` sebagai odds pasar. Jalur sahnya: sinyal pembanding di lapisan view/evaluasi (mis. dislokasi model-kita vs prediksi Sportmonks), dan bahan backtest terpisah.
- **Kriteria sukses:** (a) ≥95% fixture horizon 7 hari punya baris predictions; (b) uji anti-kontaminasi: tidak ada baris predictions yang terbaca oleh jalur odds pasar (test baru bergaya `test-value-bets.ts`); (c) predictability tersimpan untuk 100% liga aktif.

### 5.6 `context-intel`
- **Scope:** store lokal untuk H2H (per pasangan tim, di-refresh saat salah satu tim akan bertanding), standings per liga/musim (refresh harian), pre-match news (per fixture, T-24j), expected/predicted lineups (per fixture, T-24j dan T-3j). Menggantikan panggilan API di jalur render.
- **Desain data:** tabel di `thestats_dataset.db`: `h2h_cache(pair_key, payload_json, fetched_utc)`, `standings(league_id, season_id, team_id, position, points, payload_json, fetched_utc)`, `prematch_news(fixture_sm_id, payload_json, fetched_utc)`, `expected_lineups(fixture_sm_id, side, payload_json, fetched_utc)`. Semua berlabel sumber di payload merge (melanjutkan pola `sportmonks-wire.ts`).
- **Kriteria sukses:** (a) analisis untuk fixture Tier-1 membaca H2H/news/lineup dari store dengan `fetched_utc` ≤24 jam, nol panggilan API di jalur render; (b) payload tanpa sumber terlabel = test gagal.

### 5.7 `daily-rhythm`
- **Scope:** satu entrypoint ritme harian (memperluas pola `daily-refresh.ts` yang sudah ada): katalog → telemetri → odds terjadwal → predictions → konteks → laporan. Budget guard membaca header `x-ratelimit`/`rate_limit` response (pola `api-budget.ts`) dan **berhenti sopan** per entity saat sisa di bawah ambang; semua sync idempoten dan aman diulang; mode `--check` untuk semua jalur (konsisten dengan konvensi script yang ada).
- **Kriteria sukses:** (a) satu perintah menjalankan seluruh ritme dan menghasilkan laporan cakupan (liga aktif, freshness telemetri, % fixture ber-odds, % ber-predictions, sisa kuota per entity); (b) run kedua berturut-turut tidak mengubah data (idempoten, dibuktikan diff count); (c) kegagalan satu entity tidak menghentikan entity lain (degradasi terstruktur, pola adapter yang sudah ada).

## 6. Anggaran kuota (3.000 req/jam per entity — terverifikasi)

Estimasi dengan rumus eksplisit; angka fixture/hari memakai baseline terukur katalog sekarang (420 fixture / 42 hari / 7 kompetisi ≈ 10 per hari) dan diekstrapolasi hati-hati untuk 109 liga (musim Eropa penuh ≈ 100–250 fixture/hari global):

| Operasi | Rumus | Estimasi/hari | Bucket |
|---|---|---|---|
| Sync katalog | hari × halaman (100 fixture/halaman) | ±5–15 | Fixture |
| Telemetri harian | match selesai/hari ÷ 100 per halaman (include statistics) | ±2–5 | Fixture |
| Tangkapan odds | fixture 48 jam ke depan × 3 jadwal tangkapan | ±300–750 | Odd |
| Predictions massal | halaman global probabilities + value bets | ±20–60 | Prediction |
| Konteks (news/lineup/H2H/standings) | fixture 24 jam ke depan × ±3 + standings 109 | ±400–800 | Fixture/misc |
| **Total ritme harian** | | **±750–1.650** | tersebar per entity |

Satu-satunya operasi besar adalah **backfill historis satu kali** (telemetri musim berjalan + fitting ratings): ±40 ribu fixture/musim untuk 109 liga ≈ 400–600 request per musim dengan include statistics per halaman — tetap jauh di bawah pagu harian. **Kesimpulan: pagu 3.000/jam tidak mengikat di rancangan ini; yang mengikat adalah masa trial (data perishable) dan kualitas mapping/kalibrasi.**

## 7. Boundaries

**Always**
- Semua penulisan DB lewat script ingest + mapper teruji; setiap modul punya runnable check bergaya `scripts/test-*.ts` yang sudah ada.
- Setiap baris baru membawa label sumber; field absen = `null`, tidak pernah 0 karangan.
- Cutoff anti-leakage untuk setiap data historis yang masuk telemetri/ratings.
- Baca sisa kuota dari response API sebelum batch besar; berhenti sopan di bawah ambang.

**Ask first (keputusan Arandi sebelum implementasi modul terkait)**
- Perubahan skema pada `thestats_dataset.db` di luar kolom/tabel aditif.
- Liga mana pun yang akan **dilayani analisis** sebelum status kalibrasinya jelas.
- Menambah dependensi atau mengganti pola adapter/wire yang ada.

**Never**
- Menulis/menghapus apa pun di `analysis_snapshots.db` di luar jalur produksi existing (append-only, tidak bisa di-rebuild).
- Memakai predictions Sportmonks sebagai odds pasar di jalur value bet mana pun.
- Memanggil API di jalur render dashboard.
- Menyimpan token API di repo, file proyek, atau log.

## 8. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Trial berakhir sebelum backfill selesai | Katalog & konteks berhenti segar | Perishable-first: odds & predictions fixture terdekat ditangkap sejak hari pertama; backfill historis diurutkan dari liga Tier-1; tanggal akhir trial = keputusan terbuka #1 |
| Liga baru tanpa prior → prob ngawur yang tampak meyakinkan | Keputusan taruhan buruk | Registry kalibrasi + flag degradasi eksplisit (modul `ratings-expansion`); liga belum terkalibrasi tidak dilayani diam-diam |
| Mapping ID tim/liga salah pasang | Telemetri nyasar ke tim lain | Verifikasi mapping dua arah (nama + negara + jumlah fixture) sebelum baris pertama ditulis; test ekuivalensi seperti pola `deriveMarketKey` |
| Predictions diperlakukan sebagai kebenaran | Value bet semu | Aturan keras §5.5 + gate predictability per liga + uji anti-kontaminasi |
| Pertumbuhan storage | Disk & lambatnya query | Estimasi: payload odds/predictions ±50–200 KB/fixture → ±10–40 MB/hari ritme penuh; retensi & vacuum = keputusan terbuka #5 |
| Duplikasi nama/skema dari dua sumber (TheStats legacy vs Sportmonks) | Agregasi ganda | Nama kanonis + tabel alias (modul `catalog-coverage`); baris legacy tidak ditimpa |

## 9. Metrik keberhasilan keseluruhan (30 hari sejak implementasi)

- Cakupan katalog: 109/109 liga aktif, horizon ≥30 hari, nol nama ganda.
- Freshness telemetri Tier-1: lag ≤48 jam, ≥95% baris baru ber-xG (untuk liga ber-xG).
- Odds: ≥95% fixture kickoff punya ≥1 tangkapan terjadwal; predictions: ≥95% fixture 7-hari ter-cover.
- Kalibrasi: 100% liga punya status registry; liga Tier-1 berstatus terkalibrasi dengan uji skala lulus.
- Kuota: nol insiden 429 yang menghentikan ritme; laporan harian terbit 30/30 hari.

## 10. Keputusan (ditutup 3 Nov 2026)

1. **Tanggal akhir trial: 10 Nov 2026** (keputusan Arandi). Konsekuensi: eksekusi berbentuk **sprint 7 hari** (3–10 Nov) dengan prinsip perishable-first yang diperkeras — semua yang hanya bisa diambil selama trial (tangkapan odds/predictions pre-match, backfill historis, fitting data) harus selesai sebelum 10 Nov; sesudah itu app hidup dari store lokal. Rencana hari-per-hari: `tasks/plan.md`.
2. **Tiering liga** (keputusan Arandi): **Eropa dulu — kasta 1, lalu 2, lalu 3** — kemudian **Amerika & Amerika Latin**, terakhir **Asia: Arab (Saudi dkk.), Jepang, Asia Tenggara**. Tier menentukan urutan backfill telemetri + fitting kalibrasi; katalog & tangkapan odds/predictions berlaku untuk semua 109 liga sejak hari pertama (murah & perishable).
3. **Kedalaman backfill** (keputusan Spark, mandat Arandi: "buat model kita biar ga halusinasi"):
   - **Hasil & fixtures (bahan fitting ratings): 3 jendela musim** — 2 musim penuh terakhir + musim berjalan, dengan *time-decay* saat fitting (musim terbaru berbobot terbesar). Alasan anti-halusinasi: sampel per tim di bawah ±1 musim membuat shrinkage James-Stein bekerja dengan prior yang bising — λ hasil fitting berisik lalu dinarasikan planner seolah pasti. Dua musim penuh memberi ±60–76 laga per tim (liga 20 tim) sebagai fondasi prior; musim ketiga (berjalan) menangkap bentuk terkini. Lebih dari 3 musim ditolak: churn promosi/degradasi & pergantian skuad membuat data lama menggambarkan tim yang berbeda, dan biaya trial-time-nya lebih mahal dari manfaatnya.
   - **Telemetri statistik (`team_match_logs`): musim berjalan + 1 musim penuh terakhir.** Statistik granular (xG, shot detail) di luar itu nilai marginalnya kecil dibanding ukuran & waktu tarik; yang dijaga ketat adalah kelengkapan musim berjalan (bahan konteks analisis) dan musim lalu (pembanding & validasi).
   - **Kalender non-Eropa menyesuaikan:** liga musim kalender (MLS, Brasil, J-League, dll.) memakai jendela musim 2026 + 2025 (+2024 untuk hasil bila tersedia), bukan label musim Eropa.
   - **Gate anti-halusinasi per liga:** liga baru hanya dilayani analisis penuh setelah (a) fitting lulus uji kontrak skala per liga, dan (b) cakupan telemetri musim berjalannya ≥80% laga selesai. Sebelum itu status registry-nya `uncalibrated`/`partial` dan output wajib ter-flag degradasi (lihat §5.3).
4. **Jadwal tangkapan odds** (keputusan Spark): **T-24j, T-6j, T-1j, dan T-15m.** T-15m dipertahankan sebagai proksi *closing line* — justru titik perbandingan terpenting model ini (§12 arsitektur: model dievaluasi melawan closing line). Biaya tambahan ±1 tangkapan/fixture, tidak material terhadap pagu per-entity. Fixture yang baru masuk katalog saat sudah <24 jam dari kickoff ditangkap pada titik jadwal berikutnya yang masih tersedia + ditandai `late_entry`.
5. **Retensi** (keputusan Spark): **payload mentah 90 hari bergulir; ringkasan terstruktur permanen.** Payload odds mentah per tangkapan adalah komponen storage terbesar (±50–200 KB/fixture/tangkapan); sesudah 90 hari nilai debug-nya habis. Yang permanen: baris ringkas per fixture×market×bookmaker×titik-tangkapan (termasuk closing proksi T-15m) — kecil, dan itulah bahan evaluasi jangka panjang. **Predictions disimpan permanen penuh** (ukurannya kecil dan ia adalah dataset pembanding untuk evaluasi model). Pembersihan payload mentah >90 hari dijalankan `daily-rhythm` dan tercatat di laporan.
6. **Predictions = panel pembanding di dashboard** (keputusan Arandi): ditampilkan sebagai panel pembanding yang **terlabel jelas** ("Prediksi Sportmonks — pembanding, bukan odds pasar"), berdampingan dengan output quant kita untuk menonjolkan dislokasi antar-model. Aturan keras §5.5 tetap berlaku penuh: tidak masuk jalur value bet, tidak masuk `match_odds_history`.

---

## Lampiran — angka rujukan

- Audit DB 3 Nov 2026 (read-only, semua `quick_check: ok`): master 28.922 match (2021-07-23 s/d 2026-10-14); dataset `team_match_logs` 2.583 (maks 2026-10-27), `teams` 225, `match_odds_history` 500, `team_squads` 3.893; vault `raw_api_vault` 1.991; upcoming 420 fixture (112 `odds_available`, 0 `xg_available`), `competition_catalog` 208, `sm_id_map` 165; snapshots 21 (15 grounded).
- Probe Sportmonks 3 Nov 2026: `/v3/my/resources` 196 entitlement; rate limit 3.000/jam per entity (sisa 2.999 pasca-probe); `/v3/my/leagues` 109 liga, 51 negara; endpoint predictions probabilities, predictions value-bets, odds pre-match semuanya 200 dengan data live.
