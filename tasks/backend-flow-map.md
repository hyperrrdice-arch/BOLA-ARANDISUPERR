# Backend Flow Map — football-agent (pasca sprint ekspansi DB Sportmonks)

> Hasil Fase 1 overhaul backend (4 Nov 2026). Peta ini menggambarkan alur
> NYATA dari kode (bukan dokumen lama): file/fungsi persis di tiap hop,
> ruang ID di tiap store, dan titik-titik tempat asumsi data lama
> (TheStatsAPI, katalog 7 kompetisi, ratings 16 liga) masih duduk.
> File bertanda 🔒 = READ-ONLY atas perintah owner (loop planner +
> sindikat 5-LLM + wiring-nya) — tidak diubah dalam overhaul ini.

## 0. Store & ruang ID (fondasi semua hop)

| Store | Isi | Ruang ID |
|---|---|---|
| `data/upcoming_fixtures.db` | `upcoming_fixtures` 3.674 baris; `competition_catalog` 317; `sm_id_map` 3.360 | match `mt_*` (TheStats) / `sm_<fixtureId>` (SM); kompetisi `comp_*` / `sm:<leagueId>`; tim `tm_*` / angka mentah SM sebagai string |
| `data/thestats_dataset.db` (±1,5 GB) | `matches` 70.075 (68.862 `sm_` + 1.174 `mt_` + 39 lain); `team_match_logs` 85.443; `teams` 6.448; `match_odds_history` 3.912; `league_calibration` 125; `standings`/`expected_lineups`/`prematch_news`/`h2h_cache` | match `sm_<id>`/`mt_*`; log `smlog_<id>_h/_a` (SM) / `<match>_<team>` (legacy); tim: angka SM / `tm_*` |
| `data/predictions.db` | `sm_predictions` 70.050 nilai / 765 fixture; `sm_value_bets` 37; `sm_predictability` 5.590 | fixture SM numerik. **Terisolasi: tidak ada jalur ke odds/value-bet (aturan PRD).** |
| `data/football_master.db` | `matches` 28.922 (football-data CSV) | divisi `E0…T1` (16), tim nama CSV |
| `data/calibrated_ratings.json` | 44 liga / 1.118 tim: 16 legacy (key divisi CSV) + 28 SM (key `SM<leagueId>`) | tim dikunci oleh NAMA (hasil normalisasi) |
| `data/analysis_snapshots.db` | 21 snapshot | 🔒 APPEND-ONLY — tidak pernah ditulis overhaul ini |

Jembatan antar ruang ID:
- `sm_id_map` (upcoming DB): fixture SM → match `mt_` bila sudah ada di katalog lama (jembatan lama selalu menang).
- `lib/quant/team-normalizer.ts` (`normalizeTeamName` + kamus alias): nama tim lintas sumber → kunci ratings.
- `teams` (dataset): nama → team_id untuk telemetri. ⚠️ **Nama tidak unik**:
  9 grup nama persis dipakai >1 team_id (mis. `Al Ahli` ×2), dan 37 grup
  bertabrakan setelah normalisasi nama — ruang kunci yang benar-benar
  dipakai peta nama→ID (mis. Real Betis, SV Werder Bremen, Celta Vigo
  masing-masing ×2) — resolusi nama→ID tanpa konteks liga bisa mengambil
  tim yang salah. (Koreksi 4 Nov: draf awal dokumen ini menyebut "85
  nama, Inter Miami CF ×3" — angka dan contoh itu SALAH, tidak ada di
  tabel; angka di atas terukur ulang langsung dari `teams`.)

## 1. Alur katalog (daftar pertandingan)

```
GET /api/matches?hours=N
  → app/api/matches/route.ts
  → lib/db/upcoming-fixtures.ts :: getUpcomingInWindow(fromMs, hours, competitionId?)
  → upcoming_fixtures (offline-first; API TheStats MATI permanen sejak 18 Okt 2026)
```
Diisi oleh `scripts/sync-sportmonks-fixtures.ts` (katalog SM) dalam rantai
`scripts/daily-refresh.ts`. Tidak ada matematika di hop ini.

## 2. Alur analisis (inti) — per hop

```
User klik match
→ GET /api/agent?match_id=…  (app/api/agent/route.tsx — shell HTTP: validasi + merge)
→ lib/agent/planner.ts :: runPlannerAnalysis()  🔒
   createRunState(matchId, competitionIdHint dari route)
   │
   ├─[tool] check_data_integrity
   │    lib/stats-fetcher-agent.ts :: fetchAndValidateMatchIntelligence(matchId, competitionIdHint)
   │      jalur offline: buildOfflineMatchRes(matchId)
   │        = getUpcomingByMatchId(matchId)            → baris fixture (nama tim, competition_name, competition_id)
   │        + getMatchOddsAnchor(matchId)              → baris TERBARU match_odds_history (payload apa adanya)
   │      lib/stats-validator.ts :: validateAndSanitizeMatchData(...)
   │        → VerifiedMatchIntelligence:
   │            pertandingan.kompetisi  = competition_name (STRING NAMA saja, tanpa negara/ID)
   │            pertandingan.tim_kandang/tim_tamu = nama tim mentah sumber
   │            form_split, h2h (getLocalRecentMatches/getLocalH2HMatches dari dataset.matches),
   │            market_odds{home_last,draw_last,away_last,total_goals_over_2_5}
   │              ← di-parse dari payload berbentuk TheStats (bookmaker.markets…)
   │              ← payload SM mentah (daftar `odds[]`) TIDAK ter-parse di sini;
   │                odds SM masuk lewat jalur wire (hop 2b), bukan validator.
   │
   ├─[tool] run_quant_package
   │    lib/agent/planner.ts :: buildQuantPackage(intel, today)  🔒 (pemanggil; yang dihitung di lib/quant/*)
   │      1) lib/db/team-telemetry.ts :: getTeamRollingTelemetry(namaTim, 6, today)
   │           resolveTeamId(nama) → teams (nama persis/short_name, LIMIT 1 — ⚠️ tabrakan nama)
   │           getPreMatchLogs(teamId, 6, cutoff) → team_match_logs (match_date < cutoff, anti-leakage)
   │             LEFT JOIN matches → competition_id per log (untuk pembobotan xG lintas kompetisi)
   │           agregat null-jujur: xG/npxg/shots/dll. hanya dari baris NOT NULL
   │      2) lib/quant/ratings-loader.ts :: getShrunkMatchParameters({leagueHint: pertandingan.kompetisi, …})
   │           resolveDivCode(hint) → divisi ratings (lihat §3 titik rawan #1)
   │           findTeamRating(data, div, normalizeTeamName(tim)) → α/β prior dari calibrated_ratings.json
   │             (+ fallback divisi-2 promosi ×0.85/×1.20, + fallback lintas-liga)
   │           blend James-Stein: w = n/(n+κ), κ = 8 (xG) / 14 (gol) / 16 (tanpa telemetri)
   │             live attack/defense dari telemetri rolling (xG bila ≥3 sampel xG, else gol)
   │           evaluateMatchupLuck (lib/quant/luck-regression.ts) → metadata konteks
   │      3) lib/quant/dixon-coles.ts :: calculateDixonColes(...)
   │           λ = leagueAvgGoals × att_home × def_away × homeAdvantage
   │           μ = leagueAvgGoals × att_away × def_home      (leagueAvgGoals = rata-rata gol AWAY liga)
   │           matriks Poisson 11×11 × faktor τ(rho) di (0,0),(0,1),(1,0),(1,1) → dinormalisasi Σ=1
   │           → prob 1X2, fair odds, O/U, BTTS, AH, clean sheet, xPts, top scorelines
   │      4) lib/quant/vig-stripping.ts :: stripVigShin(home_last, draw_last, away_last)
   │           → konsensus pasar tanpa vig (bisection z ∈ [0, 0.4]); odds invalid → throw → null jujur
   │      5) lib/quant/kelly.ts :: evaluateValueBet(prob_model, odds_pasar) per market ber-odds NYATA
   │           → evaluatePortfolioKelly(…, cap total 5.0%) — quarter-Kelly, cap per bet 4.0%
   │      6) konteks (DILARANG mengubah probabilitas): special-markets-engine, half-profile,
   │           momentum, luck-regression — ambang heuristik tulisan tangan, label saja.
   │
   ├─[tool] run_syndicate_debate → lib/syndicate-orchestrator.ts  🔒 (dorman; utuh)
   ├─[tool] run_editorial_analysis → lib/agent/llm.ts  🔒
   └─[tool] stop_with_verdict → AnalysisSchema (lib/agent/schemas.ts)  🔒
→ lib/view/analysis-view.ts :: mapPipelineToView()   ← BFF, pure, angka copy 1:1
     lib/quant/fallback-guard.ts :: applyFallbackGuard({calibration_metadata, value_bets, verdict})
       → verdict bisa di-SKIP-kan deterministik; data_quality + fallback_guard masuk view
     AnalysisViewSchema → JSON {match, ringkasan, kuantitatif, odds, debat, thinking, markets, …}
→ dashboard (di luar scope fase ini)
```

### 2b. Jalur wire Sportmonks (additive, di dalam planner 🔒 tapi datanya dari lib/odds/*)

`buildQuantPackageWithSportmonks` (planner) memanggil
`lib/odds/sportmonks-wire.ts` (`mergeSmDetailIntoIntel`, `pickSmQuotes`:
bookmaker utama id 35 = 1xBet, pembanding id 20 = Pinnacle) dan
`lib/odds/sportmonks-adapter.ts` (fetch + budget guard; **masa beku: jalur
render tidak memanggil API** — detail SM dibaca dari store lokal).
Predictions SM hanya masuk panel banding `sm_predictions` di view —
tidak pernah ke `value_bets` (terverifikasi konstruksi: tidak ada kode
yang menyalin prediksi ke jalur odds).

## 3. Titik asumsi lama yang masih duduk (temuan Fase 1)

1. **Resolusi liga dari NAMA** (`ratings-loader.resolveDivCode`): hint yang
   tiba dari planner hanya `pertandingan.kompetisi` (nama polos). Peta
   `LEAGUE_ALIAS_TO_DIV` mendahulukan divisi legacy; nama bertabrakan antar
   liga ("Premier League" ×6, "Serie A" ×3, "Super League" ×banyak,
   "Primera Division" ×banyak) selalu jatuh ke divisi legacy yang sama —
   mis. Premier League Ukraina akan memakai ratings E0 Inggris. Kode
   `sm:<leagueId>` tidak dikenali sama sekali oleh resolver lama.
2. **Konstanta kompetisi telemetri** (`team-telemetry.ts`):
   `DIV_TO_COMPETITION_ID` + `COMPETITION_AVG_GOALS` hanya 7 entri `comp_*`.
   Untuk semua liga SM: target rata-rata gol diam-diam default **1.48** dan
   bobot normalisasi xG lintas kompetisi selalu 1.0 (karena
   `COMPETITION_AVG_GOALS[sm:*]` undefined → fallback ke target itu sendiri).
3. **Resolusi tim dari nama tanpa konteks** (`ratings-loader.getTheStatsTeamId`,
   `team-telemetry.resolveTeamId`, `luck-regression`): `LIMIT 1`/last-wins
   atas nama-nama tim yang bertabrakan (9 grup nama persis, 37 grup
   ternormalisasi) → telemetri tim lain bisa terbaca sebagai milik tim ini.
4. **Ratings partial tidak tersaji & tanpa alasan**: liga `partial` (36)
   tidak ada di JSON → loader jatuh ke `defaultFallback` generik
   (isCalibrated=false) tanpa membedakan "liga partial terukur" vs "liga
   tak dikenal"; view tidak punya field gerbang kalibrasi sama sekali.
5. **Kasus khusus UCL hardcoded** (`ratings-loader`): liga pseudo
   (leagueAvgGoals 2.04, rho −0.05, homeAdvantage 1.12, tanpa tim) +
   `UEFA_LEAGUE_COEFFICIENT` sqrt-scaling hanya untuk 11 divisi legacy;
   kompetisi piala SM (termasuk sm:2) memang `uncalibrated` by design di registry.
6. ~~**`xg_source` tertulis sebagai string `'NULL'`**~~ — KLAIM AWAL
   SALAH (artefak tampilan: nilai SQL NULL tercetak sebagai teks "NULL").
   Verifikasi Fase 1 dengan `typeof()` + `quote()`: `xg_source` adalah
   SQL NULL asli pada 2.423 baris legacy/master dan teks `'sportmonks'`
   pada 83.020 baris SM. UPDATE normalisasi yang direncanakan dijalankan
   dan mencocokkan **0 baris** — tidak ada bug penulisan; tidak ada
   perubahan data. Dicatat agar tidak "diperbaiki" lagi di masa depan.
7. **Parser odds validator berbentuk TheStats**: payload odds SM mentah
   tidak menghasilkan `market_odds` 1X2 di validator (lihat hop 2) —
   konsekuensi: untuk fixture SM murni, jalur value-bet 1X2 di
   `buildQuantPackage` bergantung pada merge wire SM, bukan anchor lokal.

## 4. Perbaikan konsumsi yang diterapkan Fase 1 (ringkasan; detail di laporan)

- `resolveDivCode` mengenali hint `sm:<leagueId>`/`SM<leagueId>` + resolusi
  nama sadar-tim (kandidat divisi disaring oleh keanggotaan kedua tim).
- Modul gerbang `lib/quant/league-gate.ts`: status registry
  `league_calibration` dibaca loader — calibrated = normal; partial =
  tersaji + flag eksplisit sampai view (`calibration_gate`); uncalibrated =
  diblokir dengan alasan eksplisit. Fit partial kini ditulis
  `scripts/calibrate-ratings.ts` ke JSON berlabel `calibrationStatus:'partial'`.
- Telemetri: peta rata-rata gol kompetisi dihitung dari `dataset.matches`
  (terukur, semua ruang ID), menggantikan default 1.48 yang diam-diam.
- Resolusi nama tim: kandidat ganda dipilih yang punya log di kompetisi
  target (jalur loader, `getTheStatsTeamId` sadar-divisi); resolver bersama
  `resolveTeamId` (dipakai planner-telemetri, momentum, half-profile, dan
  kini juga luck-regression — salinan privatnya dihapus) dibuat
  deterministik: log terbanyak menang, seri → team_id terkecil.
- `xg_source`: terverifikasi BUKAN bug (lihat §3 #6) — tidak ada
  perubahan data; UPDATE normalisasi mencocokkan 0 baris.

## 5. Yang TIDAK berubah

- 🔒 `lib/agent/planner.ts`, `lib/agent/llm.ts`, `lib/agent/schemas.ts`,
  `lib/agent/coverage.ts`, `lib/syndicate-orchestrator.ts`,
  `lib/llm/*` — byte-identik (verifikasi hash di laporan akhir).
- `analysis_snapshots.db` — nol tulis/hapus.
- Tidak ada panggilan API Sportmonks di fase ini.
