# DB Audit Worklog — 2026-11-05 (resumable, per store)

Audit aturan: setiap angka di bawah berasal dari query yang dijalankan
pada sesi audit ini (sqlite3/Python read-only `mode=ro`), bukan dari
dokumen. Branch: `safe-bet-parlay`. Koordinator telemetri bekerja
paralel — store telemetri TIDAK diubah isinya oleh audit ini.

## ✅ football_master.db — selesai
- File: 9,822,208 bytes; journal_mode=wal; page_size 4096; page_count 2,398; freelist 0.
- 1 tabel: `matches` — 28,922 baris. Kolom: id PK, div/season/date/home_team/away_team/fthg/ftag/ftr NN, odds legacy (psh/psd/psa, b365*), max_over/under_2_5, h_xg/a_xg, created_at.
- Indeks: idx_matches_season, idx_matches_date, idx_matches_home_away, idx_matches_div_date, UNIQUE(div,date,home_team,away_team).
- FK: 0 didefinisikan. CHECK kw: 0. integrity_check: **ok**. foreign_key_check: 0 pelanggaran.
- Isi: hasil historis football-data.co.uk (era legacy, div E0/SP1 dkk).

## ✅ upcoming_fixtures.db — selesai
- File: 1,687,552 bytes; wal; page_count 412; freelist 1.
- `competition_catalog` 317 baris (competition_id PK; payload_json; fetched_utc NN).
- `sm_id_map` 3,420 baris (match_id PK; sm_fixture_id INTEGER NN + UNIQUE idx terpisah; home_norm/away_norm; kickoff_date; league; created_utc NN).
- `upcoming_fixtures` 3,770 baris (match_id PK; competition_id/name/country; utc_date NN; home/away team id+name; odds_available/xg_available flag; fetched_utc NN). Indeks: (competition_id,utc_date), (utc_date).
- FK: 0. integrity_check: **ok**. fk_check: 0.
- Prefix match_id (terukur sesi ini): sm_ 3,392 / mt_ 378.

## ✅ predictions.db — selesai
- File: 14,237,696 bytes; wal; page_count 3,476; freelist 0.
- `sm_predictions` 70,553 baris — PK komposit (fixture_sm_id, market, outcome).
- `sm_value_bets` 80 baris — PK komposit (fixture_sm_id, market, outcome, bookmaker, odds).
- `sm_predictability` 5,590 baris — PK komposit (league_id, market).
- Indeks bantu: idx_smp_fixture, idx_smvb_fixture. FK: 0. integrity_check: **ok**. fk_check: 0.
- Isolasi: tidak ada tabel odds di DB ini (jalur odds hidup di dataset) — konsisten dengan keputusan isolasi predictions.

## ✅ JSON: league-canonical.json — selesai
- 250 liga kanonik; 412 alias total: thestats 208, sportmonks 109, ratings-key 73, legacy-div 22 (208+109+73+22=412 ✓).
- canonical_id: prefix comp_* 141, sm:* 109.
- 57 liga punya `fits`; 47 liga punya cup_offset teridentifikasi (identified=true).
- Struktur per liga: canonical_id, name, country, aliases[{system,id,name_as_stored}], fits[], cup_offset{graph,delta,anchors,identified,fitted_at}.

## ✅ JSON: calibrated_ratings.json — selesai
- Header: totalLeagues=72, totalTeams=1,842 — jumlah tim terhitung ulang dari isi = 1,842 ✓ konsisten.
- `leagues` dikunci kode div legacy (mis. B1); entri: div, leagueName, country, seasonCount, totalMatches, leagueAvgGoals, homeAdvantage, rho, calibrationDate, teams{...}, canonicalId.
- Blok `canonical`: registry (string 26 char = path `data/league-canonical.json`), registryVersion=1, registryGeneratedAt, note, cupOffsets{fittedAt, graphs, competitions} — 3 graf benua.
- Status gerbang per liga TIDAK ada di file ini (hidup di registry `league_calibration` — lokasi dikonfirmasi di audit dataset).

## ✅ picks.db — selesai
- File: 46,211,072 bytes; wal; page_count 11,282; freelist 0.
- `picks` 163,491 baris (lab 163,008 / live-run 483). Kolom inti NN (match_id, market, selection, model_prob, source); market_prob/sm_prob/agreement_spread/gate_status/grade/package_id nullable.
- `pick_outcomes` 163,008 baris; FK pick_id→picks.id (1 FK); CHECK 1 (di SQL tabel); indeks: idx_picks_package, idx_picks_market_band, idx_picks_match, idx_picks_lab_unique UNIQUE(match_id,market,selection,source).
- integrity_check: **ok**; foreign_key_check: **0** pelanggaran (dijalankan terpisah, terverifikasi).
- Lintas store: package_id terisi 483/483 live-run, menggantung 0; lab package_id NULL semua (by design — lab mendahului store paket). Outcome: 163,008/163,008 pick lab ter-resolve; 483 live-run belum (fixture belum selesai).

## ✅ analysis_snapshots.db (store paket, MENGGANTIKAN skema lama) — selesai
- File: 733,184 bytes (menyusut dari 872,448 legacy — store baru); wal; freelist 0.
- `meta` 8 baris (key PK) — legacy_rows tercatat: analysis_snapshots=21; match_outcomes=81.
- `packages` 78 baris: legacy-import 70, manual 4, slate 4. UNIQUE(match_id,trigger,computed_utc); CHECK 1 (enum trigger); indeks match/kickoff/computed. computed range 2026-11-04T04:11Z → 18:18Z.
- integrity_check: **ok**; fk_check 0. 72 match_id distinct — 0 yatim terhadap upcoming_fixtures.

## ✅ thestats_raw_vault.db — selesai
- File: 18,780,160 bytes; wal. `raw_api_vault` 1,991 baris (resource_id PK; endpoint NN; payload_json NN; created_at).
- Endpoint: stats 1,122; lineups 454; injuries 127; players 127; odds 112; matches 45; competitions 4 (=1,991 ✓).
- created_at HANYA 2026-10-16 → 2026-10-18: vault BEKU sejak TheStats mati — klaim retensi "90 hari bergulir" di ARCH §3.2 = niat PRD, bukan perilaku aktual. integrity: **ok**.

## ✅ archive/analysis_snapshots-legacy-2026-10.db — selesai
- 872,448 bytes. `analysis_snapshots` 21 baris (skema lama persis kontrak docs/db-snapshot.md) + `match_outcomes` 81 baris + VIEW v_snapshot_eval & v_snapshot_eval_market. integrity: **ok**.

## ✅ thestats_dataset.db (1,53 GB) — selesai kecuali integrity_check (berjalan di background)
- File 1,534,394,368 bytes = page_count 374,608 × 4096 ✓; freelist 2 (tidak ada bloat); wal.
- 10 tabel: matches 70,114 (semua status 'finished'; id: sm_ 68,901 / mt_ 1,174 / mas* 39; rentang 2024-01-01 → 2026-11-04); team_match_logs 85,521 (98 kolom; source: sportmonks 83,098 / NULL 2,348 / 'master' 75; distinct match 42,762; distinct team 5,497; xg_for NULL 49,076 = 57,4%); teams 6,450 (225 baris id tm_ legacy, country NULL 225); match_odds_history 4,071 (legacy NULL/NULL 500; baseline sportmonks 3,383; scheduled 188; has_odds=1: 1,090 / =0: 2,981; payload_json NULL 308; distinct match 3,850; tangkapan 2026-10-18 → 2026-11-04); league_calibration 125 (registry — status×source: calibrated 44 [SM 28 + legacy 16], partial 32 [SM 28 + cup-offset 4], uncalibrated 49 [SM 36 + cup-offset 13]; canonical_id 125/125; baris cup-offset 17); standings 1,308 (69 liga, semua league_id sm:); expected_lineups 620 (310 fixture × 2 sisi); prematch_news 18; h2h_cache 610; team_squads 3,893.
- FK terdefinisi: matches 2, team_match_logs 3, team_squads 1; sisanya 0 (konvensi proyek: referensi ditegakkan di kode, bukan DDL).
- Yatim terukur: tml→matches 0; tml→teams 0; matches→teams 0; squads→teams 0; **standings→teams: 225 baris / 167 team_id distinct tidak ada di teams** (id numerik SM kecil, mis. '14','15','828'); odds→(upcoming ∪ matches): 0 yatim dari 3,850 id (3,770 di upcoming, 127 di matches, 47 di keduanya).
- predictions→upcoming: 770 fixture SM di predictions, 768 masih di katalog, **2 tidak lagi di katalog** (kemungkinan rotasi horizon).
- upcoming: 270 fixture ber-utc_date lampau masih berstatus 'scheduled' (katalog menyimpan laga baru-selesai sampai rotasi horizon).
- Flags upcoming: odds_available/xg_available NULL untuk seluruh 3,392 baris sm_ (hanya terisi di 378 baris mt_ warisan: odds 112 ya/266 tidak; xg 0 ya/378 tidak) — flag era TheStats, BUKAN indikator ketersediaan SM (itu di match_odds_history).
- Registry↔JSON: 72 liga calibrated_ratings → status registry via canonicalId: calibrated 39 / partial 33 / tidak ditemukan 0. (Basis berbeda dari klaim ARCH §3.4 "28/28/16" — lihat daftar drift.)

## ⏳ dataset integrity_check — background (proc terpisah)
## ⏳ Worker: provenance map (tasks/audit-sections/provenance.md)
## ⏳ Worker: identity census (tasks/audit-sections/identity-census.md)

## Penutup audit (5 Nov 2026)
- Invarian: 18 — 14 PASS · 1 FAIL (INV-13) · 2 catatan desain (INV-15, INV-17) · INV-18 dataset UNVERIFIED (integrity_check tak rampung di bawah beban tulis bersamaan; 2 percobaan timeout). Penutup = proposal P-08.
- Census identitas terverifikasi (query langsung koordinator): kembaran katalog tak terjembatani 0; duplikat hasil 50 grup intra-ruang, 0 lintas ruang; tabrakan ejaan tim 107 grup lintas sumber / 7 di dalam teams; nama→multi-id di teams 9 persis / 12 ternormalisasi. Tiga angka draf pekerja (audit-sections) terbukti salah dan dikoreksi — draf mentah TIDAK di-commit; rincian di laporan §8.
- Deliverables: docs/DATABASE.md, docs/DATA-INVARIANTS.md, docs/AGENT-HANDOVER.md, docs/decisions/ADR-001..005, tasks/db-audit-report.md; koreksi drift di ARCHITECTURE.md + STRUCTURE.md; banner superseded docs/db-snapshot.md.
- Nol mutasi store, nol kode diubah, nol indeks ditambah (ditimbang & ditolak eksplisit). File 🔒 hanya dibaca/di-grep. .env.local tidak dibuka. Nol panggilan API.
- Addendum pasca-laporan: koreksi provenance pekerja terverifikasi — distribusi source cocok angka audit; F-13 (baris registry source='canonical' = 0 by design; mekanisme penulis = INSERT OR REPLACE, bukan tulis-ulang) dicatat di laporan + DATABASE.md §3/§12 diperbaiki.
