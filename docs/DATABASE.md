# DATABASE.md — Kamus Data football-agent

> Ditulis 5 Nov 2026 dari audit basis data penuh (`tasks/db-audit-report.md`).
> **Setiap angka di dokumen ini dihasilkan query pada store langsung
> selama audit** (bukan disalin dari dokumen lama). Keadaan terukur:
> 5 Nov 2026, branch `safe-bet-parlay`. Ritme harian (cron) terus
> menambah baris — angka adalah potret audit, bukan konstanta.
> Kontrak yang bisa dicek mesin: `docs/DATA-INVARIANTS.md`.
> Keputusan di balik struktur: `docs/decisions/`.

## 0. Peta store

Semua store SQLite hidup di `data/` (gitignored, journal_mode **wal**
— terverifikasi di semua store), plus dua artefak JSON terpadu
(git-tracked). Pemisahan file **berdasarkan fungsi/siklus hidup**
(ADR-002), bukan sumber atau benua.

| Store | Ukuran audit | Isi satu kalimat |
|---|---|---|
| `thestats_dataset.db` | 1,534,394,368 B | Store kerja utama: hasil, telemetri, odds history, konteks, registry kalibrasi |
| `picks.db` | 46,211,072 B | Ledger pick (lab + live-run) + outcome — catatan validasi produk (ADR-005) |
| `thestats_raw_vault.db` | 18,780,160 B | Payload mentah API era TheStats — **beku sejak 18 Okt 2026** |
| `predictions.db` | 14,237,696 B | Predictions Sportmonks — **terisolasi dari jalur odds** (ADR-004) |
| `football_master.db` | 9,822,208 B | Hasil historis football-data.co.uk (era legacy) |
| `upcoming_fixtures.db` | 1,687,552 B | Katalog fixture berjalan + peta identitas `sm_id_map` |
| `analysis_snapshots.db` | 733,184 B | **Store paket kuant** (bukan lagi snapshot lama — ADR-003) |
| `archive/analysis_snapshots-legacy-2026-10.db` | 872,448 B | Arsip beku skema snapshot lama (21 snapshot + 81 outcome) |
| `league-canonical.json` | 132,284 B | Registry identitas liga kanonik (ADR-001) |
| `calibrated_ratings.json` | 506,712 B | Fit rating terkalibrasi + blok canonical + offset piala |

Integritas terverifikasi audit: `PRAGMA integrity_check` = **ok** di
kedelapan store; `foreign_key_check` = 0 pelanggaran di semua store
yang memeriksanya. (Dataset 1,5 GB adalah yang terakhir tertutup:
integrity_check-nya dua kali timeout di bawah beban tulis bersamaan
selama jendela utama, lalu rampung ok via proses latar — kronologi
di INV-18, `docs/DATA-INVARIANTS.md`.)

---

## 1. `football_master.db` — hasil legacy

Satu tabel. Sumber: football-data.co.uk (CSV historis).

### `matches` — 28,922 baris
| Kolom | Tipe | Catatan |
|---|---|---|
| id | INTEGER PK | |
| div, season, date | TEXT NN | kode div legacy (E0, SP1, …) |
| time | TEXT | nullable |
| home_team, away_team | TEXT NN | nama apa adanya dari CSV |
| fthg, ftag, ftr | INTEGER/TEXT NN | gol + hasil full-time |
| hthg, htag, htr, referee, hs, as_shots, hst, ast | | statistik legacy, nullable |
| psh, psd, psa, b365h/d/a, max_over_2_5, max_under_2_5 | REAL | odds legacy |
| h_xg, a_xg | REAL | xG bila tersedia |
| created_at | TEXT | |

- UNIQUE(div, date, home_team, away_team) + indeks season/date/home_away/div_date.
- FK: tidak ada. Retensi: statis (arsip historis; tidak ada penulis aktif dalam ritme harian).

## 2. `upcoming_fixtures.db` — katalog + identitas laga

### `upcoming_fixtures` — 3,770 baris
| Kolom | Tipe | Catatan |
|---|---|---|
| match_id | TEXT PK | `sm_<fixtureId>` Sportmonks (3,392) atau `mt_<id>` TheStats (378) |
| competition_id / competition_name / competition_country | TEXT | id sumber: `sm:<leagueId>` (3,392 baris) / `comp_*` (378) |
| utc_date | TEXT NN | kickoff UTC |
| status | TEXT | audit: **semua 3,770 = 'scheduled'**, termasuk 270 fixture ber-kickoff lampau (rotasi horizon ritme yang membersihkan) |
| stage_name, venue, is_neutral | | |
| home_team_id/name, away_team_id/name | TEXT | id tim mentah sumber sebagai string |
| odds_available, xg_available | INTEGER | ⚠️ **flag era TheStats**: NULL untuk seluruh baris `sm_`; hanya terisi di 378 baris `mt_` (odds: 112 ya / 266 tidak; xg: 0 ya / 378 tidak). Ketersediaan odds SM yang sebenarnya ada di `match_odds_history`, BUKAN di flag ini |
| fetched_utc | TEXT NN | |

Indeks: (competition_id, utc_date), (utc_date). Rentang utc_date audit:
2026-10-18 → 2027-01-02.

### `competition_catalog` — 317 baris
competition_id PK (`comp_*` 208 + `sm:` 109), name, country,
payload_json, fetched_utc NN. Katalog kompetisi yang dikenal ritme.

### `sm_id_map` — 3,420 baris (jembatan identitas laga)
| Kolom | Catatan |
|---|---|
| match_id | TEXT PK — **3,297 baris berkunci `sm_`** (peta identitas diri fixture SM) + **123 baris berkunci `mt_`** (jembatan kembaran TheStats→SM) |
| sm_fixture_id | INTEGER NN, UNIQUE (indeks terpisah) |
| home_norm, away_norm | nama tim ternormalisasi untuk pencocokan kembaran |
| kickoff_date, league, created_utc NN | |

Terukur: 0 baris peta menunjuk match_id di luar katalog. Seluruh
3,420 sm_fixture_id ter-resolve: 3,392 di ruang fixture katalog
berjalan, 28 menunjuk laga yang sudah selesai di `dataset.matches`
(47 nilai ada di kedua ruang) — **0 menggantung**. Dari 378 fixture
`mt_` di katalog, 123 punya baris jembatan berkunci `mt_`. Dari 255
sisanya, **62 terverifikasi punya kembaran SM** (timestamp kickoff
identik + nama home/away ternormalisasi identik; 64–72 pada varian
pencocokan lebih longgar) — baris katalog ganda untuk laga yang
sama, tanpa jembatan (koreksi census audit, lihat laporan §3:
pengukuran awal yang menyatakan 0 ternyata cacat metode). Sisanya
mayoritas batch TheStats 2026-10-17 sebelum katalog SM berjalan.
Terukur melegakan: **0 pick dan 0 paket merujuk sisi `mt_`** dari
62 pasangan itu — belum ada duplikasi hilir; perbaikannya proposal
P-09 di laporan audit.

## 3. `thestats_dataset.db` — store kerja utama

10 tabel. Semua baris berlabel sumber bila kolomnya ada; statistik
absen = NULL, tidak pernah dikarang.

### `matches` — 70,114 baris (hasil laga selesai)
match_id PK (`sm_` 68,901 / `mt_` 1,174 / `mas*` 39), competition_id,
season, utc_date, status (**semua 'finished'** saat audit),
home/away_team_id, home/away_score, referee_name, updated_at.
Rentang utc_date 2024-01-01 → 2026-11-04. FK terdefinisi: 2.
Kolom kunci NULL: 0 di competition_id/utc_date/skor.

### `team_match_logs` — 85,521 baris (telemetri per tim per laga, 98 kolom)
log_id PK; match_id, team_id, opponent_id, venue, match_date, season,
result, goals_for/against, xg_for/against, npxg, xG per babak,
shots/blokir/dalam-luar kotak, …, `source`, `xg_source`, payload
turunan lain.
- source: **sportmonks 83,098** / NULL 2,348 (era TheStats — terukur audit: seluruhnya match_id `mt_*`) / 'master' 75.
- distinct match 42,762; distinct team 5,497; rentang match_date 2024-12-28 → 2026-11-04.
- **xg_for NULL di 49,076 baris (57,4%)** — cakupan xG memang parsial; jalur gol adalah fallback yang sah.
- FK terdefinisi: 3. Yatim terukur: match_id ∉ matches = 0; team_id ∉ teams = 0.

### `teams` — 6,450 baris
team_id PK (string: **6,225 id numerik Sportmonks** + **225 id `tm_` TheStats**),
name, short_name, country, stadium, updated_at.
- **Seluruh 225 baris `tm_` ber-country NULL** (dan hanya mereka) — kohort legacy tanpa negara.
- 167 id tim numerik yang dirujuk `standings` TIDAK ada di tabel ini (lihat §3 `standings`).

### `match_odds_history` — 4,071 baris (tangkapan odds bertimestamp)
PK komposit (match_id, captured_utc); payload_json (tersaring ke
market utama), has_odds, source, capture_kind.
- Komposisi: legacy 500 (source NULL, capture_kind NULL) + Sportmonks 3,571 = baseline 3,383 + scheduled 188.
- has_odds: 1 → 1,090 baris; 0 → 2,981 baris (jujur kosong, tetap tercatat). payload_json NULL di 308 baris.
- distinct match 3,850 — **0 yatim**: 3,770 di katalog upcoming, 127 di `matches`, 47 di keduanya.
- Rentang captured_utc 2026-10-18 → 2026-11-04. **Premium history dari endpoint `/odds/premium*` = 0 baris** (endpoint kosong meski entitled — tercatat apa adanya).
- Inilah satu-satunya jalur odds kuant. Predictions TIDAK pernah masuk sini (ADR-004).

### `league_calibration` — 125 baris (REGISTRY status liga)
league_id PK, league_name, country, tier, **status**
(calibrated/partial/uncalibrated), n_matches, n_teams,
telemetry_coverage, scale_ratio, fitted_at, **source**, notes,
**canonical_id**.
- status × source terukur: calibrated 44 (sportmonks-fit 28 + legacy-csv-fit 16);
  partial 32 (sportmonks-fit 28 + cup-offset 4);
  uncalibrated 49 (sportmonks-fit 36 + cup-offset 13).
- canonical_id terisi 125/125. 17 baris source='cup-offset' (status piala dari gerbang OOS piala).
- Registry inilah yang dibaca gerbang (`lib/quant/league-gate.ts`) lewat canonical_id.

### Tabel konteks (payload per fixture/liga dari Sportmonks)
| Tabel | Baris | Kunci | Catatan |
|---|---|---|---|
| standings | 1,308 | (league_id, season_id, team_id) | 69 liga, semua league_id `sm:`; ⚠️ 225 baris merujuk 167 team_id yang tidak ada di `teams` |
| expected_lineups | 620 | (fixture_sm_id, side) | 310 fixture × 2 sisi |
| prematch_news | 18 | fixture_sm_id | indeks: tidak ada selain PK |
| h2h_cache | 610 | pair_key | payload H2H ter-cache |
| team_squads | 3,893 | player_id | FK 1; team_id yatim = 0 |


## 4. `predictions.db` — predictions Sportmonks (TERISOLASI)

Aturan keras (ADR-004): store ini **tidak punya tabel odds** dan tidak
ada jalur dari sini ke `match_odds_history`/jalur odds kuant. Isinya
hanya panel pembanding berlabel.

| Tabel | Baris | Kunci | Catatan |
|---|---|---|---|
| sm_predictions | 70,553 | PK (fixture_sm_id, market, outcome) | probability (**skala persen 0–100**, terukur 0,01–99,98), predictability, captured_utc NN, source NN (semua 'sportmonks'). 770 fixture distinct; tangkapan 2026-11-03 → 2026-11-04 (berjalan via ritme) |
| sm_value_bets | 80 | PK (fixture_sm_id, market, outcome, bookmaker, odds) | 72 fixture distinct — value bet versi SM sendiri, tetap data panel, bukan jalur odds |
| sm_predictability | 5,590 | PK (league_id, market) | skor predictability per liga per market |

Yatim terukur: dari 770 fixture_sm_id di sm_predictions, 768 masih ada
di katalog upcoming; **2 sudah rotasi keluar katalog** (prediksi
dipertahankan permanen per keputusan retensi — bukan yatim yang harus
dihapus).

## 5. `picks.db` — ledger pick (catatan validasi)

| Tabel | Baris | Catatan |
|---|---|---|
| picks | 163,491 | lab 163,008 + live-run 483 |
| pick_outcomes | 163,008 | FK pick_id → picks.id; CHECK pada kolom hit |

### `picks`
id PK; created_utc NN; match_id NN; competition_canonical_id;
kickoff_utc; market NN; selection NN; model_prob NN (klaim model);
market_prob (prob pasar ter-strip, nullable); sm_prob (prob panel SM,
nullable); agreement_spread (rentang antar sumber, dihitung modul
ledger, nullable); gate_status; grade; source NN (`lab`/`live-run`);
notes; **package_id** (FK lunak ke store paket — tidak dideklarasikan
sebagai FK DDL karena lintas file).
- Indeks: idx_picks_match, idx_picks_market_band (market, model_prob),
  idx_picks_package, idx_picks_lab_unique UNIQUE(match_id, market, selection, source).
- Terukur: live-run 483/483 ber-package_id valid (0 menggantung);
  lab 163,008/163,008 package_id NULL **by design** (lab mendahului store paket).

### `pick_outcomes`
pick_id PK (= FK), resolved_utc NN, home_goals NN, away_goals NN,
hit NN (0/1). Terukur: 163,008 baris = seluruh pick lab ter-resolve;
483 live-run belum ter-resolve saat audit (fixture belum selesai —
resolver berjalan di ritme slate).

## 6. `analysis_snapshots.db` — STORE PAKET KUANT (nama file warisan)

⚠️ **Nama file menyesatkan secara historis.** Sejak keputusan owner
5 Nov 2026 (ADR-003), file ini BUKAN store snapshot lama: skema lama
diarsipkan utuh ke `archive/analysis_snapshots-legacy-2026-10.db` dan
file ini dibangun ulang sebagai store paket. Modul lama
`lib/db/analysis-snapshot.ts` adalah jalur dorman — bila dihidupkan,
ia membuat ulang tabel lamanya dalam keadaan kosong di file yang sama
tanpa mengganggu tabel paket (terdokumentasi di header
`lib/picks/packages.ts`).

| Tabel | Baris | Catatan |
|---|---|---|
| meta | 8 | key PK → value; mencatat schema_version=1, arsip legacy + sha256-nya, legacy_rows (21/81) |
| packages | 78 | satu baris per (fixture × versi komputasi) |

### `packages`
id PK; match_id NN; competition_canonical_id; kickoff_utc;
computed_utc NN; **trigger** NN ber-CHECK ∈
{baseline, t-24h, t-6h, t-1h, t-15m, slate, manual, legacy-import};
fit_source; gate_status; cup_delta (δ kandang jalur piala);
ratings_marker (sha256 isi calibrated_ratings.json saat komputasi);
odds_captured_utc; bookmakers_json; predictions_batch_utc; lambda;
mu; rho; payload_json NN (paket lengkap: probabilitas semua pasar dari
matriks, top skor, merge pasar, panel SM); provenance_json.
- UNIQUE(match_id, trigger, computed_utc) — versi tercatat tidak ditimpa; komputasi baru = baris versi baru.
- Terukur audit: trigger legacy-import 70 / manual 4 / slate 4; 72 match_id distinct, 0 di luar katalog.

## 7. `thestats_raw_vault.db` — payload mentah (BEKU)

`raw_api_vault` 1,991 baris: resource_id PK, endpoint NN,
payload_json NN, created_at. Endpoint: stats 1,122 / lineups 454 /
injuries 127 / players 127 / odds 112 / matches 45 / competitions 4.
created_at hanya 2026-10-16 → 2026-10-18 — vault berhenti menulis
saat TheStats mati; retensi "90 hari bergulir" di dokumen lama adalah
niat PRD era itu, **bukan** perilaku aktual. Perlakukan sebagai arsip
legacy statis.

## 8. `archive/analysis_snapshots-legacy-2026-10.db` — arsip beku

Skema snapshot lama persis kontrak `docs/db-snapshot.md` (dokumen itu
kini historis — lihat banner di kepalanya): `analysis_snapshots`
21 baris, `match_outcomes` 81 baris, VIEW `v_snapshot_eval` +
`v_snapshot_eval_market`. Jangan tulis. Hash + jumlah baris tercatat
di `meta` store paket dan di kontrak invarian (INV-17).

## 9. Artefak JSON terpadu

### `league-canonical.json` — registry identitas liga (ADR-001)
250 liga kanonik; 412 alias: sportmonks 109, thestats 208,
ratings-key 73, legacy-div 22. canonical_id berawalan `sm:` (109)
atau `comp_*` (141). Per liga: canonical_id, name, country,
aliases[{system, id, name_as_stored}], fits[], cup_offset{graph,
delta, anchors, identified, fitted_at} — 57 liga ber-fits, 47 liga
ber-cup_offset teridentifikasi. Produsen: `scripts/build-league-canonical.ts`
(+ `fit-global-offsets.ts` menanam field piala). **Jangan edit tangan.**

### `calibrated_ratings.json` — fit rating
Header totalLeagues=72 / totalTeams=1,842 (terhitung ulang dari isi =
1,842 ✓). `leagues` dikunci 16 kode div legacy + 56 kunci `SM*`; entri:
div, leagueName, country, seasonCount, totalMatches, leagueAvgGoals,
homeAdvantage, rho, calibrationDate, teams{…}, **canonicalId**.
Blok `canonical`: registry (path registry kanonik), registryVersion,
registryGeneratedAt, note, cupOffsets{fittedAt, graphs(3 benua),
competitions}.
- Status gerbang per liga TIDAK hidup di file ini — baca dari registry
  `league_calibration` via canonicalId. Terukur audit untuk 72 entri:
  calibrated 39 / partial 33 (SM-key: 28/28; legacy-div: 11/5); 0 canonicalId tak terdaftar.

## 10. Ruang identitas (ringkasan)

| Entitas | Ruang ID | Jembatan |
|---|---|---|
| Fixture | `sm_<fixtureId>` / `mt_<id>` | `sm_id_map` (123 jembatan `mt_`; 3,297 baris identitas `sm_`) |
| Kompetisi | `sm:<leagueId>` / `comp_*` / div legacy / kunci rating `SM*` | `league-canonical.json` (satu canonical_id per liga) |
| Tim | id numerik Sportmonks sebagai string (6,225) / `tm_*` TheStats (225) / nama di master & rating | ⚠️ **belum ada registry kanonik tim** — resolusi nama→id sadar konteks (lihat laporan audit §identitas untuk sensus + proposal) |
| Pick | picks.id | package_id → packages.id (lintas file, ditegakkan kode) |

## 11. Retensi (terukur vs niat)

| Store | Perilaku aktual terukur |
|---|---|
| upcoming_fixtures | katalog bergulir ritme harian; fixture lampau bertahan sampai rotasi horizon (270 lampau saat audit) |
| match_odds_history | tangkapan dipertahankan (rentang sejak 2026-10-18); payload tersaring market utama |
| predictions | permanen per keputusan owner (nilai + predictability tidak dihapus) |
| picks + outcomes | permanen (catatan validasi) |
| packages | berversi, versi lama tidak ditimpa |
| raw vault | beku (tidak ada penulis sejak 18 Okt 2026) |
| master | statis |
| archive legacy | beku, jangan tulis |

## 12. Provenance — penulis & pembaca per store

Dipetakan audit dari grep atas `lib/`, `scripts/`, `app/` (recon
read-only, termasuk file 🔒). "Penulis" = kode yang menjalankan
INSERT/UPDATE/DELETE/CREATE pada tabel itu hari ini.

| Store / tabel | Penulis (aktif) | Pembaca utama |
|---|---|---|
| master.matches | — (tidak ada; store statis) | `lib/db/sqlite-master.ts` → harness backtest |
| upcoming.upcoming_fixtures | `scripts/sync-sportmonks-fixtures.ts` (insert + DELETE fixture uji SM) | `lib/db/upcoming-fixtures.ts` → route matches, wire odds, pick-slate, driver run-one-* |
| upcoming.competition_catalog | sync yang sama (INSERT OR REPLACE) | ⚠️ **tidak ditemukan pembaca produksi** — ditulis tiap sync, hanya dibaca query penemuan manual |
| upcoming.sm_id_map | sync yang sama (INSERT OR REPLACE) | `lib/db/upcoming-fixtures.ts` (getSmIdMap) → stats-fetcher-agent, resolver |
| dataset.matches | `scripts/backfill-telemetry.ts` | `scripts/resolve-pick-outcomes.ts` (skor untuk outcome pick), harness backtest |
| dataset.team_match_logs | backfill-telemetry + langkah finalizer di `scripts/daily-refresh.ts` (INSERT OR IGNORE) | `lib/quant/ratings-loader.ts`, `lib/db/team-telemetry.ts` (satu instance koneksi bersama via `lib/db/thestats-dataset.ts`) |
| dataset.teams | ⚠️ fungsi repo `upsertTeam` (`lib/db/thestats-dataset.ts:393`) **tanpa satu pun pemanggil di repo** — tabel tidak dirawat kode aktif | ratings-loader, cup-offset-fit, team-telemetry, backfill-telemetry |
| dataset.match_odds_history | `scripts/capture-odds.ts` | jalur wire/loader (odds lokal untuk paket), skrip backtest |
| dataset.league_calibration | `scripts/calibrate-ratings.ts` — baris utama via **INSERT OR REPLACE** berkunci league_id (fit SM ditulis source 'sportmonks-fit'); langkah turunan source='canonical' membangun ulang baris status untuk liga kanonik ber-fixture/fit **yang belum punya baris utama** — terukur saat ini **0 baris** karena semua target sudah punya baris utama (DELETE pembangun-ulangnya karenanya no-op by design) + `scripts/fit-global-offsets.ts` (17 baris cup-offset) | `lib/quant/league-gate.ts` |
| dataset.standings / expected_lineups / prematch_news / h2h_cache | `scripts/sync-context.ts` | stats-fetcher-agent (intel offline); standings juga dibaca sync-context sendiri |
| dataset.team_squads | fungsi repo upsert di modul dataset — **tanpa pemanggil aktif yang ditemukan** | `lib/db/team-telemetry.ts` (getTeamSquad → konteks skuad/cedera) |
| predictions.* (3 tabel) | `scripts/sync-predictions.ts` (sm_predictions append per batch dengan skip kesegaran 20 jam; sm_value_bets + sm_predictability di-refresh dengan delete terlingkup) | `lib/odds/sportmonks-wire.ts` (panel berlabel), pick-slate (sm_prob), backfill-packages |
| picks.picks / pick_outcomes | **satu-satunya penulis: `lib/picks/ledger.ts`** (recordPick/recordOutcome); resolver `scripts/resolve-pick-outcomes.ts` menulis outcome lewat modul itu | ledger (hitRateByBand, listUnresolved) |
| packages (snapshots file) | `lib/picks/packages.ts` (writePackage, ON CONFLICT DO NOTHING) ← pick-slate + backfill-packages | packages.ts (latestPackageFor/listPackages) |
| vault.raw_api_vault | `lib/db/thestats-vault.ts` (upsertVault ← stats-fetch) — **dorman** sejak API TheStats mati | modul yang sama (cache fallback jalur intel lama) |
| league-canonical.json | `scripts/build-league-canonical.ts` (tulis ulang penuh) + fit-global-offsets (field piala) | `lib/quant/league-identity.ts`, league-gate, calibrate-ratings |
| calibrated_ratings.json | `scripts/calibrate-ratings.ts` (tulis ulang penuh) + fit-global-offsets (blok cupOffsets) | `lib/quant/ratings-loader.ts` |
| arsip legacy | tidak ada (beku; hanya dirujuk komentar + skrip migrasi) | tidak ada |

Temuan provenance yang penting untuk agen berikutnya:
1. **`teams` tidak dirawat** — penulisnya yatim (fungsi tanpa pemanggil). Inilah akar struktural INV-13: baris tim yang dirujuk standings tidak akan pernah muncul sendiri. Perbaikannya = proposal P-03, bukan edit diam-diam.
2. **`team_squads` setengah yatim** — dibaca jalur telemetri, penulisnya tanpa pemanggil aktif; isinya membeku pada keadaan terakhir kali jalur lama menulisnya.
3. **`competition_catalog` tulis-saja** — 317 baris ditulis ulang tiap sync tanpa pembaca produksi; kandidat penghapusan/penyederhanaan (proposal P-06, jangan hapus tanpa ACC owner).
4. **Koneksi dataset tunggal** — ratings-loader dan team-telemetry berbagi satu instance koneksi (globalThis) dari `lib/db/thestats-dataset.ts`; jangan buka koneksi kedua untuk store ini dari jalur saji.
