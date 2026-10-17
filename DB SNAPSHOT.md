# DB SNAPSHOT

Rencana penyimpanan permanen hasil analisis sebagai **data pribadi**, supaya setelah laga selesai statistik match itu bisa ditarik dan **dibandingkan dengan hasil analisisnya**.

> **Status: EKSEKUSI OLEH AGENT BACKEND — tahap per tahap, review user tiap selesai tahap.** Dokumen ini adalah kontraknya.

- Asal: sesi optimasi latensi (`PERF.md`, `tasks/plan-perf.md`, `tasks/plan-perf-2.md`)
- Keputusan user: database **baru khusus snapshot**, terpisah dari `data/thestats_dataset.db`
- Koreksi user (revisi terakhir): (1) **market key dibuat longgar** — jangan mengunci enum, supaya market baru di masa depan tidak butuh migrasi; (2) **cakupan evaluasi = semua market** di `value_bets_json`, termasuk EV negatif

---

## 1. Kenapa DB terpisah

Bukan preferensi, tapi beda sifat data:

1. **Beda kemampuan rebuild.** `thestats_dataset.db` = data referensi TheStatsAPI, bisa dibangun ulang dari API kapan saja (`scripts/sync-weekly-telemetry.ts`, `ingest-*`). Snapshot = keluaran pipeline kita, **tidak bisa di-rebuild** tanpa menjalankan ulang LLM 200–415s per match — dan hasilnya pun tidak identik karena model nondeterministik.
2. **Beda kebijakan retensi.** Ingestion boleh `DELETE`/refresh/`VACUUM` dataset-nya. Snapshot harus **append-only**. Satu file = operasi rumahan dataset berpotensi menyapu riwayat pribadi.
3. **Beda ukuran & nilai.** Snapshot ~27KB/analisis dan nilainya cair; dataset 5.7MB dan reproducible.

File: `data/analysis_snapshots.db` — masuk `.gitignore` (konsisten dengan `data/football_master.db*`).

---

## 2. Data yang sudah tersedia (hasil recon, bukan asumsi)

| Kebutuhan | Sumber yang sudah ada |
|---|---|
| Skor akhir, status laga, wasit | `thestats_dataset.db` → `matches` (`match_id`, `status`, `home_score`, `away_score`, `utc_date`) |
| Statistik pasca-laga per tim | `thestats_dataset.db` → `team_match_logs` — 60+ kolom: xG/npxG, first/second-half xG, tembakan on/off/blocked, tembakan dalam/luar kotak, hit woodwork, big chances, touches in penalty area, offsides, possession, passing (total/akurat/akurasi), crosses, long balls, final third entries, throw-ins, duels (ground/aerial), dribbles, tackles, interceptions, clearances, ball recoveries, corners, fouls, kartu kuning/merah, saves, goal kicks, goals prevented, high claims, formasi, starting XI, `raw_stats_json` |
| Penulis data itu | `scripts/sync-weekly-telemetry.ts` (endpoint `/football/matches/{id}/stats`, retry ketat, lookback harian) + `scripts/ingest-rich-telemetry-*.ts` |
| Fallback online kalau laga belum ter-ingest | `cachedStatsGet("/football/matches/{id}/stats")` — helper sudah ada |
| Payload analisis lengkap | `view_json` + `planner_trace_json` (sudah dipersist sekarang di `analysis_runs`) |

**Konsekuensi desain: pullback outcome = baca lokal dulu, online hanya fallback.** Nol fetch baru untuk kasus normal.

---

## 3. Design decisions

1. **Satu mekanisme, bukan dua.** Tabel snapshot = superset dari `analysis_runs` yang sekarang (cache + riwayat). Cache dibaca dari tabel snapshot (`ORDER BY snapshot_id DESC LIMIT 1` dalam jendela TTL), lalu `analysis_runs` di `thestats_dataset.db` **dimigrasi dan dihapus** — bukan ditinggal jadi dua salinan `view_json` 27KB yang bisa saling menyimpang.
2. **Dua tabel + satu VIEW.** `analysis_snapshots` (append-only, hasil kita) dan `match_outcomes` (1 baris per match, data eksternal, boleh di-refresh). Perbandingannya **VIEW**, bukan tabel — derived data kalau disimpan jadi tabel hanya menambah risiko basi dan kerja rebuild tanpa manfaat.
3. **Market key longgar (koreksi user).** `recommended_market_key` disimpan sebagai `TEXT` **tanpa CHECK constraint dan tanpa enum tertutup**. Konvensi penamaan didokumentasikan (`1X2_HOME`, `1X2_DRAW`, `1X2_AWAY`, `BTTS_YES`, `BTTS_NO`, `O25`, `U25`, `AH_DNB_HOME`, `AH_DNB_AWAY`, …), tapi market di luar daftar itu **tetap disimpan apa adanya** (string ternormalisasi), bukan dipaksa jadi `NONE`. Pemetaan ke hasil aktual hidup di sisi VIEW (`CASE`), artinya menambah market baru = **ubah kode VIEW, bukan migrasi data**. Itu inti "longgar"-nya.
4. **Provenance wajib.** Tanpa kolom versi model/prompt, riwayat minggu lalu dan minggu depan kelihatan identik dan backtest-nya ambigu. Ini inti "ngetes hasil model".
5. **`lead_time_minutes` sebagai penjaga kebocoran.** Analisis harus pre-match. Snapshot yang diambil setelah kickoff (live) **tidak sah** untuk menilai akurasi → kolom ini disimpan dan VIEW memfilternya. Sejalan dengan audit leakage Track C di `docs/backtest0.1.md`.
6. **Payload lengkap tetap disimpan.** Kolom ringkas untuk query/agregasi cepat; `view_json` tetap sumber kebenaran supaya kolom ringan bisa dibangun ulang kalau kontrak berubah.
7. **Cakupan evaluasi = semua market (koreksi user).** Tidak cuma market yang direkomendasikan — semua isi `value_bets_json` ikut dinilai, termasuk yang EV negatif, supaya kalibrasi model bisa dinilai menyeluruh (bukan cuma "yang kita pilih").
8. **Jangan pernah `DELETE`.** Append-only. Backup = `VACUUM INTO` manual (upgrade path), bukan otomatis dulu.
9. **File DB di-gitignore.** Data pribadi + append-only + tumbuh terus. Yang di-commit cuma skema/kode + laporan agregat.

---

## 4. Skema (kontrak)

### Tabel `analysis_snapshots` (append-only)

| Kolom | Tipe | Catatan |
|---|---|---|
| `snapshot_id` | INTEGER PK AUTOINCREMENT | urutan = urutan analisis |
| `match_id` | TEXT NOT NULL | ID TheStatsAPI (`mt_*`), kunci yang sama dengan `matches` |
| `competition_id`, `competition_name` | TEXT | |
| `home_team`, `away_team` | TEXT | apa adanya (bukan hasil normalisasi) supaya bisa diaudit ulang |
| `kickoff_utc` | TEXT | urut waktu + agregasi harian |
| `captured_utc` | TEXT NOT NULL | kapan analisis selesai (= waktu insert) |
| `lead_time_minutes` | INTEGER | `kickoff − captured`; **negatif = live/pasca-kickoff** → dikecualikan dari evaluasi |
| `cache_key_hint` | TEXT NOT NULL DEFAULT '' | `competition_id_hint` apa adanya; bagian dari key cache |
| `verdict`, `confidence` | TEXT | keputusan |
| `recommended_market` | TEXT | teks manusia (display) |
| `recommended_market_key` | TEXT | **longgar** — konvensi penamaan, tanpa CHECK; di luar daftar tetap disimpan apa adanya |
| `recommended_odds`, `recommended_ev_pct`, `stake_pct` | REAL | di angka berapa keputusan diambil |
| `prob_home/draw/away` | REAL | probabilitas model saat itu |
| `fair_odds_home/draw/away` | REAL | |
| `lambda_home`, `mu_away`, `expected_total_goals` | REAL | input Dixon-Coles |
| `prob_btts`, `prob_over_2_5` | REAL | |
| `value_bets_json` | TEXT | **semua** market + EV + stake (sumber evaluasi menyeluruh) |
| `planner_model`, `syndicate_models`, `editorial_model` | TEXT | provenance |
| `app_version` | TEXT | versi app/commit saat snapshot |
| `is_grounded`, `is_fallback` | INTEGER | 0/1, dari audit integritas |
| `duration_ms` | INTEGER | durasi run (nyambung ke `perf-1` Task 1) |
| `view_json` | TEXT NOT NULL | AnalysisView lengkap — sumber kebenaran |
| `trace_json` | TEXT | plannerTrace + durasi per stage |

Indeks: `(match_id, cache_key_hint, snapshot_id DESC)` · `(kickoff_utc)` · `(match_id)`.

### Tabel `match_outcomes` (1 baris per match, boleh di-refresh)

`match_id` PK · `fetched_utc` · `status` · `home_goals` · `away_goals` · `ht_home_goals` · `ht_away_goals` · `ftr` · `xg_home/away` · `npxg_home/away` · `shots_home/away` · `sot_home/away` · `corners_home/away` · `cards_home/away` · `possession_home` · `closing_odds_home/draw/away` · `closing_over_2_5` · `closing_under_2_5` · `stats_json` (kolom `team_match_logs` dua tim, mentah) · `source` (`local_sqlite` / `online_api`) · `closing_source`.

### VIEW `v_snapshot_eval`

Join `analysis_snapshots × match_outcomes`, hanya `lead_time_minutes > 0` dan `status = 'finished'`.

Turunan per snapshot: `actual_result` (H/D/A) · `actual_btts` · `actual_over_2_5` · `hit_recommended` · `pl_result_pct` · `brier_1x2` · `log_loss_1x2` · `model_divergence` (prob model vs implied closing odds).

Turunan **per market** (semua market, bukan cuma yang direkomendasikan) diekspansi dari `value_bets_json` lewat `json_each`, dengan `CASE` yang memetakan `market_name`+`selection` → hasil aktual. Market yang belum ada pemetaannya → **`NULL` dan dilaporkan sebagai "belum dipetakan"**, bukan dihitung sebagai benar.

---

## 5. Task list

### Phase 1: Store
- [ ] **T1 — DB + helper.** `data/analysis_snapshots.db`, file baru `lib/db/analysis-snapshot.ts` dengan pola `lib/db/thestats-vault.ts` (path helper, `DatabaseSync`, `PRAGMA journal_mode = WAL` + `synchronous = NORMAL`, `CREATE TABLE IF NOT EXISTS`). Isi: skema 2 tabel + VIEW + indeks, `insertSnapshot()`, `getFreshSnapshot(matchId, hint, maxAgeMs)`, `getSnapshotMetrics()`, `upsertOutcome()`, `getOutcome(matchId)`. Tambah `data/analysis_snapshots.db*` ke `.gitignore`.
  - **Acceptance:** DB dibuat, WAL aktif, skema idempotent (dibuka dua kali tidak error) · insert+lookup round-trip, hint berbeda ≠ baris yang sama · file DB tidak muncul di `git status`
  - **Verify:** `npx tsx scripts/test-snapshot-db.ts` (assert-based, `match_id` sintetis ber-prefix lalu dibersihkan) · `npx tsc --noEmit`
- [ ] **T2a — Route menulis snapshot.** `app/api/agent/route.tsx` pindah dari `saveAnalysisRun`/`getFreshAnalysisRun` → `insertSnapshot`/`getFreshSnapshot`. Kolom ringkas diisi dari view-model yang sudah ada; provenance dari trace; `recommended_market_key` dari market yang benar-benar direkomendasikan; `trace_json` memuat plannerTrace + atribusi per stage (`loop_ms`, `tool_ms`, `planner_overhead_ms`, `step_timings` dari perf-1 Task 1). Penjaga `req.signal.aborted` dipasang SEBELUM `insertSnapshot` (bukan sesudah).
  - **Acceptance:** run nyata 1 match → 1 baris; kolom wajib (`match_id`, `captured_utc`, `kickoff_utc`, `lead_time_minutes`, `view_json`) tidak `NULL` · `lead_time_minutes` positif untuk analisis pre-match · `recommended_market_key` terisi konvensi (bukan kosong/dipaksa `NONE` kalau marketnya dikenal) · buka ulang match sama < 50ms · `?debug=1` tetap tidak menulis · run yang di-abort tetap tidak menulis · gagal tulis tidak menggagalkan response 200
  - **Verify:** run nyata via `/api/agent` · query kolom wajib · buka-tutup match: respons identik (SHA256)
- [ ] **T2b — Pensiunkan `analysis_runs`.** Migrasi 2 baris lama (Brentford, Valencia) dari `analysis_runs` → `analysis_snapshots` (`view_json` dipindah utuh; kolom ringkas boleh NULL), hapus `saveAnalysisRun`/`getFreshAnalysisRun`/`getAnalysisRunMetrics` dari `lib/db/thestats-dataset.ts`, ganti `scripts/test-analysis-cache.ts` dengan test berbasis snapshot, lalu `DROP TABLE analysis_runs`. Selama transisi TIDAK ADA dual-write — alihkan sekali, bukan dua salinan.
  - **Acceptance:** `analysis_runs` hilang dari `thestats_dataset.db`, 2 baris lamanya ada di snapshot · `npx tsc --noEmit` + `npm run build` hijau tanpa referensi fungsi lama
  - **Verify:** `SELECT count(*) FROM analysis_snapshots` ≥ 2 · grep `saveAnalysisRun` → nol hasil di kode produk · jalankan `scripts/test-snapshot-db.ts`
  - **Files:** `app/api/agent/route.tsx`, `lib/db/thestats-dataset.ts`, `lib/db/analysis-snapshot.ts`, `scripts/test-snapshot-db.ts`, `scripts/test-analysis-cache.ts`

#### ✅ Checkpoint A
- [ ] 1 baris snapshot lengkap dari run nyata · cache hit < 50ms · tsc + build + semua test hijau
- [ ] **Review kontrak kolom dengan user sebelum lanjut** — enum/key sudah longgar, tapi nama kolom dikunci di sini

### Phase 2: Outcome & perbandingan
- [ ] **T3 — Pullback outcome.** `scripts/sync-match-outcomes.ts`: ambil `match_id` dari snapshot yang `kickoff_utc` sudah lewat dan belum ada di `match_outcomes`, isi dari sumber **lokal dulu** (`matches` + `team_match_logs` dua tim, join per `match_id`); fallback online hanya kalau lokal kosong, `source` dicatat. Idempotent. Odds penutup 1X2/O/U 2.5 diambil dari snapshot terakhir match itu (`closing_source` dicatat).
  - **Acceptance:** laga yang sudah selesai (contoh: Valencia vs Athletic Club, kickoff 17 Okt 19:00 UTC) dapat baris `source = 'local_sqlite'` · dijalankan dua kali → jumlah baris tidak bertambah · laga belum selesai tidak ditulis atau `status != 'finished'` · liga belum ter-ingest jatuh ke `online_api` dan `source`-nya tercatat
  - **Verify:** jalankan dua kali · `SELECT match_id, status, home_goals, away_goals, ftr, source FROM match_outcomes`
- [ ] **T4 — Report perbandingan.** `scripts/snapshot-report.ts` dari VIEW `v_snapshot_eval`: jumlah snapshot per versi model/commit · hit rate **per market (semua market, termasuk EV negatif)** · EV diklaim vs hasil nyata · Brier + log-loss 1X2 vs implied closing odds · `model_divergence` · daftar snapshot belum punya outcome + umurnya · market yang belum dipetakan.
  - **Acceptance:** snapshot live/pasca-kickoff tidak dihitung · market tanpa data hasil dilaporkan "belum tersedia", bukan dihitung benar · statistik dipisah per versi model/commit · aman dijalankan saat snapshot masih sedikit (nol pembagian)
  - **Verify:** `npx tsx scripts/snapshot-report.ts` · jalankan lagi setelah match kedua → angka berubah wajar

#### ✅ Checkpoint B
- [ ] Minimal 1 baris evaluasi nyata: prediksi vs skor aktual vs harga pasar
- [ ] Report bersifat read-only, aman diulang

### Phase 3: Guard & dokumentasi
- [ ] **T5 — Guard integritas + dokumentasi.** Filter `lead_time_minutes > 0` + `status = 'finished'` di VIEW; snapshot live ditandai eksplisit di report. Dokumentasikan di `ARCHITECTURE.md` §9 (Data Layer: file DB baru, aturan append-only, peringatan tak-bisa-di-rebuild) dan §11 (Roadmap: "Riwayat analisis" → selesai, ganti jadi "evaluasi outcome berjalan").
  - **Acceptance:** `ARCHITECTURE.md` menyebut file DB + aturan append-only · report menandai snapshot live · nol `DELETE`/`DROP` di jalur snapshot (kecuali cleanup test ber-prefix)
  - **Verify:** `npx tsc --noEmit` + `npm run build` · grep `DELETE FROM analysis_snapshots` di kode produk → nol hasil

#### ✅ Checkpoint Final
- [ ] Snapshot permanen dari ≥2 match · outcome terisi · report bisa dijalankan berulang
- [ ] tsc + build + semua test hijau

---

## 6. Risks & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Snapshot DB hilang/rusak → data tak tergantikan (butuh run LLM ulang) | **Tinggi** | Append-only, nol `DELETE` di jalur snapshot, disarankan backup bulanan (`VACUUM INTO`). Peringatan ditulis di `ARCHITECTURE.md` |
| Data leakage: snapshot diambil saat live/pasca-kickoff lalu dipakai menilai akurasi | **Tinggi** | `lead_time_minutes` disimpan; VIEW hanya `> 0`. Snapshot live tetap disimpan (jujur) tapi ditandai |
| Dua DB menulis riwayat yang sama selama migrasi | Sedang | Migrasi sekali: salin baris → alihkan route → hapus fungsi/tabel lama. Test lama diganti test baru |
| Key market meleset dari market yang benar-benar direkomendasikan | Sedang | Key diambil dari market yang direkomendasikan, konvensi penamaan dokumentasi, tanpa CHECK sehingga market tak dikenal tetap tersimpan utuh; tidak ada key → tidak dihitung, bukan dianggap benar |
| Laga tak ter-cover ingestion → outcome nggak pernah datang | Sedang | Report menampilkan "belum ada outcome + umur", jangan dianggap benar. Fallback online tersedia |
| Kontrak kolom ikut berubah tiap kali view-model berubah | Rendah | `view_json` tetap sumber kebenaran; kolom ringkas boleh `NULL`, bukan diisi angka karangan |

---

## 7. Open questions (closed — default diterima user, 18 Okt 2026)

1. **Daftar konvensi key market** — ✅ `1X2_HOME/DRAW/AWAY`, `BTTS_YES/NO`, `O25/U25`, `AH_DNB_HOME/AWAY`. Key longgar: market di luar daftar tetap tersimpan dan bisa dipetakan belakangan tanpa migrasi. Tidak memblokir.
2. **Closing line** — ✅ Pakai odds terakhir yang tersimpan di snapshot (harga terakhir pre-match). `closing_source` mencatat asalnya.
3. **Backup & retensi** — ✅ Append-only + backup manual dulu (`VACUUM INTO` saat dibutuhkan), otomatisasi mingguan nanti kalau korpus tumbuh.
4. **Pullback** — ✅ CLI manual idempotent (`scripts/sync-match-outcomes.ts`), dijalankan bareng `sync:weekly`. Endpoint/UI tombol: belum.
5. **Kelola `NULL` di report** — ✅ Market belum dipetakan ditampilkan sebagai baris "belum dipetakan" terpisah, tidak disembunyikan, tidak dihitung benar.

---

## 8. Catatan

- Dokumen ini menggantikan `tasks/plan-snapshot-db.md` + `tasks/todo-snapshot-db.md` (dihapus supaya tidak ada dua sumber kebenaran).
- `duration_ms` di snapshot memakai instrumentasi dari `tasks/plan-perf.md` Task 1; cache lookup memakai hasil Task 2 yang sekarang pindah ke DB baru.
- Recon memastikan `team_match_logs` sudah memuat 60+ kolom statistik, jadi `match_outcomes` tidak butuh fetch baru untuk kasus normal.
