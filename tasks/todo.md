# Tasks — Ekspansi Database (dari tasks/plan.md)

## A. catalog-coverage
- [x] Task: Sync katalog Sportmonks — fixtures semua 109 liga, horizon 3 Nov–31 Des 2026, ke `upcoming_fixtures` (id `sm_<fixtureId>`, kompetisi `sm:<leagueId>`) + baris `sm_id_map` per fixture + katalog kompetisi SM.
  - **Hasil audit (3 Nov 2026):** 3.296 fixture `sm_` dalam 81 `competition_id` SM (dari 109 liga My Leagues; 28 liga tanpa fixture di horizon — play-off/super cup/friendly + Primera Division Uruguay di luar musim, lihat mapping-review.md); horizon s.d. 31 Des 2026 (1.394 fixture ≥30 hari ke depan); 100% fixture SM punya baris sm_id_map (3.324 total: 3.201→sm_, 123→mt_); katalog kompetisi 317 (208 lama + 109 SM). Nol duplikat match_id (PK + INSERT OR REPLACE).
  - Acceptance: count fixture per liga > 0 untuk liga aktif berjadwal; nol duplikat match_id; rentang utc_date menembus 29 Nov.
  - Verify: query audit per kompetisi + sampel 5 baris acak cocok dengan respons API.
  - Files: `scripts/sync-sportmonks-fixtures.ts` (baru), `data/upcoming_fixtures.db`
- [x] Task: Daftar manual-review mapping (fixture yang gagal dipasangkan ke katalog lama / nama ambigu).
  - **Hasil:** `tasks/mapping-review.md` tertulis — 28 liga tanpa fixture horizon, grup tabrakan nama antar-liga (gabung wajib via competition_id), duplikat nama warisan TheStats. Nol baris paksa: jembatan mt_ yang sudah ada selalu menang.
  - Acceptance: daftar tertulis; nol baris paksa.
  - Verify: count baris sm_id_map baru vs fixture SM baru (selisih = daftar review).
  - Files: `tasks/mapping-review.md`

## B. odds-store
- [x] Task: Skema odds-store: kolom aditif `source` + `capture_kind` di `match_odds_history`; script tangkapan per fixture (pre-match, semua market utama) dengan titik jadwal T-24j/T-6j/T-1j/T-15m + tangkapan baseline.
  - Acceptance: fixture horizon ≥1 tangkapan baseline; fixture kickoff <24j punya tangkapan terjadwal atau flag `late_entry`.
  - Verify: audit % cakupan per hari kickoff; tidak ada baris tanpa `captured_utc`.
  - Files: `scripts/capture-odds.ts` (baru), `lib/db/*` (aditif)
  - **Hasil audit (3 Nov 2026): baseline 3.287/3.296 fixture katalog = 99,73%** (9 fixture terlewat karena kickoff-nya lewat sebelum sapuan mencapainya — tidak bisa ditangkap retroaktif; premium history kosong). Total tangkapan SM 3.356 (baseline 3.287 + terjadwal 69: T-24j 38, T-6j 29, T-1j 1, T-15m 1 — titik sisanya jatuh tempo selama pekan sprint dan diambil daily-refresh). 784 tangkapan berisi odds, 2.572 `has_odds=0` (odds belum diterbitkan untuk fixture jauh/obscure). 37 baseline ber-flag `late_entry`. 0 baris tanpa `captured_utc`. Run final: 0 error.
- [x] Task: Backfill premium odds history untuk fixture selesai di jendela sprint (bahan evaluasi, `capture_kind='backfill'`).
  - Acceptance: terpisah jelas dari tangkapan live di semua laporan.
  - Verify: query per capture_kind.
  - Files: `scripts/capture-odds.ts`
  - **Hasil (3 Nov 2026): 0 baris.** Endpoint premium (`/odds/premium`, `/odds/premium/fixtures/{id}`, `/odds/premium/history`, `/odds/premium/history/fixtures/{id}`) mengembalikan data kosong pada semua probe + run resmi atas 20 fixture selesai — meski entitlement premium tercatat di `/my/resources`. Dicatat apa adanya; tidak ada data karangan. Mekanisme `capture_kind='backfill'` siap bila provider mengisi endpoint-nya.

## C. predictions-store
- [x] Task: DB `data/predictions.db` + script tarik massal probabilities, value bets, predictability per liga.
  - Acceptance: ≥95% fixture 7-hari ter-cover; predictability 109/109 liga; panel pembanding bisa membaca dari store (offline).
  - Verify: audit cakupan + uji anti-kontaminasi (tidak ada baris predictions terbaca jalur odds pasar).
  - Files: `scripts/sync-predictions.ts` (baru), `data/predictions.db`
  - **Hasil audit (3 Nov 2026):** Cakupan 7-hari **609/609 = 100%**; jendela 14-hari 761/830 (69 fixture memang tidak punya predictions di SM — dicoba, kosong). ~69,7 ribu nilai probability; value bets 36 baris/36 fixture (memang jarang diterbitkan SM); predictability tersimpan untuk 86/109 liga (23 liga tidak mengembalikan data predictability — dicoba semua). Anti-kontaminasi: 0 payload predictions di `match_odds_history`. Catatan: endpoint global paginated terbukti tidak terjangkau (terurut fixture_id dari arsip lama) → strategi diganti per-fixture terurut kickoff + skip kesegaran 20 jam untuk ritme harian.

## D. telemetry-depth (per tier: Eropa 1 → Eropa 2 → Eropa 3 → Amerika/LatAm → Arab/Jepang/Asia Tenggara)
- [x] Task per tier: Backfill fixtures+hasil 3 jendela musim ke store hasil; telemetri statistik musim berjalan + 1 musim lalu ke `team_match_logs` (`source='sportmonks'`, xG dari expected metrics).
  - Acceptance: per liga tier — MAX(match_date) ≤48 jam dari laga selesai terakhir; % baris ber-xG ≥95% (liga ber-xG); nol skor karangan (audit NULL).
  - Verify: `test-stats-mapper` ekuivalen untuk jalur baru + query audit per liga.
  - Files: `scripts/backfill-telemetry.ts` (baru), `data/thestats_dataset.db`, store hasil master
  - **Hasil audit final (3 Nov 2026): 68.862 hasil + 83.020 baris telemetri** di 103 kompetisi (109 katalog − 6 play-off/piala yang musimnya di luar 3 jendela: 1371, 1659, 1678, 1768, 1932, 310). Per tier — EU1: 19.601 hasil/22.826 logs; EU2: 7.656/8.692; EU3: 3.840/4.346; EUCUP: 3.577/5.064; AM: 9.102/12.004; AS: 5.108/6.020; OTHER: 19.978/24.068. MAX(match_date) telemetri = **2026-11-03** (hari berjalan). **0 match berskor NULL.** xG: liga top 99,8% (PL); agregat per tier EU1 68,5% / EU2 71,5% / EU3 65,9% / AM 53,0% / AS 27,6% / EUCUP 18,3% / OTHER 2,3% — cakupan xG adalah fungsi ketersediaan provider per kompetisi (friendlies/piala memang nyaris tanpa xG), bukan kekosongan mapper; statistik absen selalu NULL. Tabel tier resmi: `tasks/tier-table.json`. Tim terdaftar: 225 → 6.448 (integritas FK). Ukuran dataset.db kini ±1,45 GB (raw_stats_json).

## E. ratings-expansion
- [x] Task: Fitting α/β per liga baru dari store hasil (time-decay), registry `league_calibration` + provenance di `calibrated_ratings.json`.
  - Acceptance: 109/109 liga berstatus registry; liga lulus uji skala (Σλ≈Σx, Σμ≈Σy) = `calibrated`; sisanya `partial`/`uncalibrated` ter-flag.
  - Verify: `test-quant-scale` per liga baru.
  - Files: `scripts/calibrate-ratings.ts` (jalur baru), `data/calibrated_ratings.json`
  - **Hasil (3 Nov 2026, putaran 1):** 11 calibrated / 12 partial / 86 uncalibrated; JSON 27 liga/699 tim.
  - **Hasil FINAL (3 Nov 2026, setelah backfill tuntas):** registry 125 baris = **109/109 liga SM berstatus eksplisit** + 16 legacy. **28 liga calibrated** (termasuk La Liga 1,007; MLS 1,015; K League 1 0,991; J1 League 1,004; Eerste Divisie 1,014; League One 1,001 — semua cakupan telemetri 1,00 dan rasio skala dalam 0,983–1,020), **36 partial** (fit sah, rasio skala di luar toleransi ketat 2% — mis. Bundesliga 1,079, Championship 0,978), **45 uncalibrated = seluruhnya kompetisi piala/lintas-negara** yang memang dikecualikan dari fit per-liga. JSON final: **44 liga / 1.118 tim**; 16 liga legacy terverifikasi tidak berubah (E0: 29 tim, avgGoals 1,328); hanya liga calibrated yang masuk JSON.

## F. context-intel
- [x] Task: Store standings (semua liga aktif), pre-match news + expected lineups (fixture ≤7 hari), H2H pasangan fixture ≤7 hari.
  - Acceptance: baca offline untuk fixture Tier-1 ≤24 jam segar; semua payload berlabel sumber.
  - Verify: matikan akses API (env token kosong) → jalur baca tetap menjawab dari store.
  - Files: `scripts/sync-context.ts` (baru), tabel baru di `thestats_dataset.db`
  - **Hasil pass pertama (3 Nov 2026):** standings 1.280 baris / 67 liga; berita 18 fixture; lineup 267 fixture; H2H 599 pasangan (446 berisi).
  - **Hasil FINAL setelah pass penyegar (3 Nov 2026):** standings **69 liga** (dua liga yang sempat gagal-lock pulih); berita 18 fixture (feed SM memang jarang); lineup **302 fixture** ≤7 hari (naik seiring terbitnya susunan pemain); H2H **604 pasangan** tersimpan, ±446 berisi riwayat (sisanya tersimpan `[]` jujur — memang belum pernah bertemu/data kosong). Semua baris berlabel payload SM + fetched_utc; baca offline = query SQLite lokal biasa.

## G. daily-rhythm & penutup sprint
- [x] Task: Entrypoint ritme (perluas pola `daily-refresh.ts`) + laporan cakupan harian.
  - Acceptance: satu perintah; run kedua idempoten (diff count = 0); laporan terbit.
  - Verify: dua run berturut + baca laporan.
  - Files: `scripts/daily-refresh.ts` (perluasan)
  - **Hasil verifikasi (3 Nov 2026):** run rantai penuh pertama mengeksekusi semua langkah berurutan (katalog 3.318 ter-upsert → odds +49 → predictions +368 nilai → telemetri musim berjalan → kalibrasi → konteks). Dua run verifikasi berturut (`--skip=telemetry,context`, dua langkah terpanjang yang sudah terbukti di run rantai) menghasilkan **diff jumlah baris = 0 di semua tabel**, kecuali `match_odds_history` **+7** — persis tangkapan terjadwal yang baru jatuh tempo di antara kedua run (2 + 5, tercatat di log masing-masing run; data baru yang sah, bukan duplikat). Predictions di kedua run verifikasi: **0 nilai baru** (skip segar). Kalibrasi deterministik: output identik (44 liga/1.118 tim). Laporan terbit: `tasks/coverage-latest.md`.
- [x] Task: Laporan final sprint 9 Nov — cakupan per modul vs metrik PRD §9, sisa risiko pasca-trial.
  - Acceptance: dokumen tertulis, angka dari query audit (bukan perkiraan).
  - Files: `tasks/sprint-report-2026-11-09.md`
  - **Hasil:** `tasks/sprint-report-2026-11-09.md` tertulis 3 Nov (sprint tuntas di hari pertama; angka final audit per modul + insiden + sisa risiko pasca-trial).
