# TODO — Ekspansi Coverage Data TheStatsAPI (lihat tasks/plan-data-coverage.md)

**Konteks hidup-mati untuk yang mengeksekusi:** kuota 7.000 request TheStatsAPI kedaluwarsa **HARI INI** dan tidak ada request lagi sampai app menghasilkan uang (bisa berminggu-minggu). Artinya data yang tidak ditarik hari ini = tidak akan pernah ada. **Urutan task sudah diurutkan bertahan-hidup: katalog fixture & odds dulu, telemetri menyusul.** Disiplin: vault cache (jangan fetch 2×), upsert idempotent, transaksi per batch, DILARANG mengarang data (mapper `mapStatsToTelemetry` sudah return null saat skor absen — jangan dibypass).

**KOREKSI LIMIT (terbaca dari header API 2026-10-18, lebih jujur dari asumsi plan):** `x-ratelimit-limit=12` request per **MENIT** (bukan 120/menit), `x-monthly-quota-limit=10000` **bulanan** dengan sisa ±7.190 saat bakar dimulai (reset ±11 Nov). Semua script memakai `lib/stats-fetch.ts` (pacing 5s + jitter + AIMD) dan `lib/api-budget.ts` (counter yang sinkron ke header `x-monthly-quota-remaining`).

---

## Task 1: Inventaris + uji horizon fixture API (dry-run, request murah) ✅

**Description:** Hitung coverage aktual, lalu **temukan batas horizon fixture** — sampai kapan API memberi data fixture ke depan. Listing = 1 request per 100 fixture (murah): coba parameter window 60/90/180 hari di `sync-upcoming-fixtures.ts`, catat kapan API berhenti memberi baris. Konfirmasi juga ketersediaan musim 25/26 untuk stats historis.

**Acceptance criteria:**
- [x] **Tanggal batas fixture terkonfirmasi** — **2026-11-29** (UCL 2026-11-25). API HANYA memberi ~6 minggu ke depan (378 scheduled total: Okt 149 + Nov 229), BUKAN 90/180 hari
- [x] Laporan: 378 fixture available (vs 246 tersimpan → 132 perlu ditambah). Kandidat stats historis **2.391 match baru** (2.357 × 25/26 + 34 sisa 26/27 UCL) — per kompetisi: PL 380, LaLiga 380, Serie A 380, Bundesliga 308, Ligue 1 309, Eredivisie 321, UCL 279+34
- [x] Terkonfirmasi: API **PUNYA** musim 25/26 untuk 7 kompetisi (PL/LaLiga/Serie A penuh 380 match; BL/L1/ED mulai Agu 2025; UCL mulai Jul 2025)
- [x] Alokasi budget final ditulis (horizon pendek → porsi odds historis + telemetri diperbesar):
  - P1 katalog fixture + snapshot kompetisi: ~5 request (listing sudah di-cache vault `upc_list_*`)
  - P2 pre-pull odds 378 fixture + lineups 24 laga hari ini: ~400
  - P3 bulk stats 2.391 match: ~2.400–2.800 (termasuk retry)
  - P4 injuries 127 tim + squad + referee: ~250–350
  - P5 stats promosi malam ini: ~30
  - P6 (sisa) odds historis backtest: ~2.500–3.000
  - Cadangan retry: ~500

**Verification:**
- [x] Dry-run ingest: 0 request stats, hanya listing (51 request listing + retry 429)

**Dependencies:** None
**Files:** `scripts/coverage-inventory.ts` (baru)
**Scope:** S

---

## Task 2: Guard idempoten + penghitung budget ✅

**Description:** Pastikan semua script punya: (a) skip baris sudah ada, (b) dedupe vault (`raw_api_vault` dicek sebelum fetch), (c) counter sisa budget per batch, (d) stop bersih saat budget < 100. Plus guard: skor/status absen → skip (bukan 0-0), status bukan `finished` → skip untuk telemetri.

**Acceptance criteria:**
- [x] Run ulang pada data sama = **0 request API baru** — terbukti: run ke-2 `coverage-inventory` budget tetap 6949 (semua dari vault)
- [x] Log `sisa budget` akurat — `lib/api-budget.ts` persisten di `data/api-budget.json`, tiap percobaan HTTP (termasuk retry 429) dicatat
- [x] Nol kode baru yang mengimputasi angka default — mapper tak disentuh; `statsFetch` return `null` HANYA untuk 404 (data absen)

**Verification:**
- [x] `npx.cmd tsc --noEmit` bersih
- [x] Uji run-2× pada fixture contoh: run kedua 0 fetch (kunci vault `upc_list_*`/`hist_list_*` permanen)

**Dependencies:** Task 1
**Files:** `lib/stats-fetch.ts` (baru — pola fetch+vault+retry+budget untuk SEMUA script bakar), `lib/api-budget.ts` (baru)
**Scope:** S

---

## Checkpoint: Sebelum bakar request ✅
- [x] Horizon fixture + alokasi final disepakati — batas **2026-11-29**, alokasi di Task 1
- [x] `npx.cmd tsc --noEmit` bersih

---

## Task 3: Katalog fixture maksimal + snapshot kompetisi (PRIORITAS 1) ✅

**Description:** Tarik SEMUA fixture sejauh yang API izinkan (bukan cuma 30 hari) ke `upcoming_fixtures.db`. Simpan juga snapshot `/football/competitions` (4 halaman) ke store lokal supaya katalog liga tetap hidup saat API mati. Periksa juga apakah fixture yang sudah ada perlu di-refresh (penundaan/perubahan jadwal).

**Acceptance criteria:**
- [x] `upcoming_fixtures` berisi fixture sampai batas API = **2026-11-29** (378 fixture; target ≥90 hari TIDAK mungkin — API hanya menyediakan ~6 minggu ke depan, dikonfirmasi Task 1)
- [x] Nama kompetisi dari store lokal: `competition_catalog` (208 kompetisi, 4 halaman) + `competition_name/country` di tiap baris fixture
- [x] Upsert idempotent: run ulang 378 → 378 tanpa duplikat, 0 request (vault)
- [x] Fixture `scheduled` TIDAK masuk `team_match_logs`

**Verification:**
- [x] `npx.cmd tsx scripts/test-upcoming-guard.ts` hijau (10/10)
- [x] `SELECT max(utc_date) FROM upcoming_fixtures` = **2026-11-29T19:45:00.000Z** (tercatat)

**Dependencies:** Task 2
**Files:** `scripts/sync-upcoming-fixtures.ts`, `lib/db/upcoming-fixtures.ts` (tabel `competition_catalog`)
**Scope:** M

---

## Task 4: Pre-pull odds semua fixture + lineups laga hari ini + bukti degradasi offline — ✅ SELESAI (sepenuhnya)

**Description:** (a) Tarik `/football/matches/{id}/odds` untuk **semua fixture di store** (1 req/fixture) → simpan ke tabel kecil `match_odds_history` + vault, lengkap dengan `captured_utc` (ini anchor harga, BUKAN closing). (b) Lineups untuk 24 fixture hari ini saat sudah rilis (H-1h) — **satu-satunya kesempatan selamanya**. (c) Verifikasi app bertahan saat API gagal: `/api/matches` harus menyajikan katalog dari store; kalau jalur fallback store-nya belum aktif → **laporkan ke lead reviewer** (perubahan kode di luar scope agent DB).

**Acceptance criteria:**
- [x] Semua 378 fixture punya baris odds anchor **atau** dinyatakan eksplisit kosong — **SELESAI**: 112 terisi (semua yang `odds_available=1`, cocok sempurna dengan flag), 266 dinyatakan kosong (flag API `odds_available=0`; terbukti akurat 100% — 100/100 percobaan fetch nyata juga kosong). `captured_utc` di semua baris
- [x] Lineups 24 laga hari ini — **20/24 tersimpan** (vault `lineups_{matchId}`); 4 laga terakhir gagal ditarik karena **API mati** (`403 KEY_REVOKED`), bukan karena retry kurang
- [x] Hasil uji offline tercatat (**natural experiment**: diuji saat API 403 semua): `/api/matches` → **200 OK** menyajikan katalog dari store tanpa satu pun call upstream; `/api/odds` → **tidak crash**, degradasi jujur (`is_available: false`, "Data belum tersedia"). ⚠️ Gap dilaporkan ke lead reviewer: `/api/odds` **tidak membaca** tabel `match_odds_history` (data anchor sudah ada, 112 fixture terisi) — perlu perubahan route di luar scope agent DB

**Verification:**
- [x] Spot-check 5 fixture: baris odds cocok dengan payload vault — `npx tsx scripts/test-odds-anchor.ts` → **8/8**
- [x] Simulasi API gagal → `/api/matches` & `/api/odds` tidak crash (dibuktikan live di port 3101 saat API 403)

**Dependencies:** Task 3
**Files:** `lib/db/thestats-dataset.ts` (tabel `match_odds_history`), `scripts/prepull-match-odds.ts`, `scripts/test-odds-anchor.ts`
**Scope:** M

---

## Checkpoint: Aman periode kering ✅
- [x] Katalog fixture mencakup horizon maksimal + tanggal batas tercatat (**2026-11-29**, sumber terpanjang yang API punya)
- [x] Odds anchor tersedia untuk semua fixture (112 terisi + 266 deklarasi eksplisit dari flag API)
- [x] Uji offline lulus **secara alami** (diuji saat API sudah `403 KEY_REVOKED`): `/api/matches` 200 dari store, `/api/odds` crash-free. Gap `/api/odds` belum membaca `match_odds_history` → dilaporkan ke lead reviewer

---

## Task 5: Bulk stats match historis (spend utama) — ⚠️ SEBAGIAN (API mati di tengah jalan)

**Description:** Tarik `/football/matches/{id}/stats` untuk semua match finished yang belum ada di `team_match_logs` — sisa 26/27 dulu, lalu 25/26 kalau ada. **Tanpa lineups historis.** Simpan via `mapStatsToTelemetry` + upsert; payload mentah ke vault.

**Acceptance criteria:**
- [x] `team_match_logs` **434 → 1.174 match** (log 868 → 2.348 baris, tim 127 → 195; musim 25/26 = 706 match, 26/27 = 468). Kandidat tervalidasi 2.391; yang tertulis **740**, sisa **±1.650 tidak sempat** — API mati (`403 KEY_REVOKED`) tepat saat bulk berjalan. Pacing terverifikasi: **0× HTTP 429, 0 gagal fetch** sejak koreksi ke limit nyata 12 req/menit
- [x] Nol 0-0 karangan — `npx tsx scripts/test-bulk-rows.ts` → **24/24** (skor log cocok listing vault, result konsisten, xG = payload, `matches` hanya `finished`)
- [x] `matches` hanya berisi `finished` — 1.174/1.174 finished, `PRAGMA integrity_check` = ok
- [x] Budget task ini ≤ 4.800 request — terpakai ±1.100 request (bulk + odds + probes)

**Verification:**
- [x] `npx.cmd tsx scripts/test-stats-mapper.ts` (19/19) + `test-upcoming-guard.ts` (10/10) hijau
- [x] `SELECT status, count(*) FROM matches GROUP BY status` = hanya finished

**Dependencies:** Task 4 (bertahan-hidup dulu, baru kualitas)
**Files:** `scripts/bulk-stats-history.ts` (baru; listing kandidat dari vault `hist_list_*` → 0 request listing)
**Scope:** M

> ℹ️ Script ini idempoten & aman dijalankan lagi kapan saja begitu kunci API valid
> kembali: ia hanya mengambil match yang belum punya log.

---

## Task 6: Tuntaskan tim tipis + backfill xG — ⛔ TERBLOKIR (API mati, skrip siap)

**Description:** Pastikan semua tim di `teams` punya ≥6 log finished. Backfill 2 log `xg_for IS NULL` dari vault/API.

**Acceptance criteria:**
- [ ] ⛔ **Terblokir API mati** — target `0` tidak tercapai: **51 tim <6 log** (naik dari 17, karena Task 5 ikut menarik 68 tim baru dari liga di luar 7kompetisi — masing-masing baru punya 1-2 log). Skrip `scripts/backfill-thin-teams.ts` sudah siap & idempoten (listing `?team_id=X&status=finished` + stats sampai 6 log/tim) — tinggal dijalankan begitu kunci API valid lagi
- [ ] ⛔ Log tanpa xG = **226 dari 2.348** (dari 2 dari 868). 224 di antaranya berasal dari match 25/26 yang payload stats-nya memang tidak menyertakan `expected_goals` → **dinyatakan apa adanya, TANPA imputasi**; 2 log lama (`mt_150888447`) juga tidak dapat di-refresh karena API mati
- [x] Tidak menimpa kolom terisi dengan NULL — dicek: 2.122 log punya xG real, tidak ada yang jadi 0 palsu; `upsertTeamMatchLog` hanya ditulis untuk match yang pemetaannya utuh

**Verification:**
- [ ] `npx.cmd tsx scripts/verify-tier1-offline-quant.ts` 15/15
- [ ] `npx.cmd tsx scripts/verify-foundation-phase-a.ts` 47/47

**Dependencies:** Task 5
**Files:** `data/thestats_dataset.db`
**Scope:** S

---

## Checkpoint: Telemetri ⚠️ SEBAGIAN
- [ ] Semua tim terlacak ≥6 log — **51 tim masih di bawah** (butuh listing per tim → API mati). Sisa budget tercatat ±6.400 (counter sinkron header). Test guard hijau ✅. Detail di Task 6

---

## Task 7: Enrichment — injuries, squad, referee — ⛔ TERBLOKIR (API mati, skrip siap)

**Description:** Snapshot `/football/teams/{id}/injuries-suspensions` untuk 127 tim terlacak (bertanggal). Refresh `/football/teams/{id}/players` untuk tim bersquad kurang. `/football/matches/{id}/referee` untuk 24 laga hari ini.

**Acceptance criteria:**
- [ ] ⛔ Snapshot injuries **bertanggal hari ini** tidak tercapai — API mati. Yang tersedia: vault `injuries_*` 127 tim & `players_*` 127 tim dari sync sebelumnya (**bertanggal, tapi tidak bisa di-refresh**). Skrip `scripts/enrich-injuries-referee.ts` sudah siap & idempoten (per-item failure tidak mematikan antrian)
- [x] Data apa adanya dari API (kosong = kosong) — pola Pertahankan: 404 tidak ditulis sebagai apa-apa

**Verification:**
- [ ] Spot-check 5 tim vs vault · `test-stats-mapper` hijau → spot-check **[terblokir]**, `test-stats-mapper` ✅ 19/19

**Dependencies:** Task 6
**Files:** `scripts/enrich-injuries-referee.ts` (baru), `lib/db/thestats-dataset.ts`
**Scope:** S

---

## Task 8: (Opsional sisa budget) Odds historis window backtest — ⛔ TERBLOKIR (API mati)

**Description:** Kalau sisa ≥500, tarik `/football/matches/{id}/odds` untuk match window backtest ke `match_odds_history`. Budget kurang → dilewati rapi, jangan setengah-setengah.

**Acceptance criteria:**
- [ ] ⛔ **Tidak dijalankan** — sisa budget saat API mati masih ±6.400 (melewati ambang 500 dengan jauh), jadi **alasannya murni akses, bukan budget**. Jalur `--historical` sudah diimplementasikan di `scripts/prepull-match-odds.ts` (dilewati TOTAL dengan pesan bila sisa < headroom 500) + idempoten per match

**Verification:** Spot-check 5 match vs vault → [terblokir]

**Dependencies:** Task 7
**Scope:** S

---

## Task 9: (Opsional) Presisi `match_date` ISO penuh ✅

**Description:** `team_match_logs.match_date` = tanggal 10-digit → urutan laga satu hari hilang. Simpan ISO penuh di baris baru + backfill dari `matches.utc_date` (bukan neok).

**Acceptance criteria:**
- [x] Baris baru ISO penuh (mapper `lib/stats-log-mapper.ts` menyimpan `m.utc_date` utuh); backfill 868 baris dari `matches.utc_date` (`scripts/backfill-match-date-iso.ts`, idempoten, sumber nyata)
- [x] Cutoff tetap anti-leakage (terbukti `test-upcoming-guard` 10/10) — semua pembanding cutoff memotong cutoff ke 10-digit, jadi "match hari T" tetap terkecuali; catatan: varian `match_date <= ?` di `run-clean-track-c.ts` jadi ikut mengecualikan hari T (lebih konservatif, arah aman)

**Verification:** `npx.cmd tsx scripts/test-upcoming-guard.ts` hijau · `npx.cmd tsc --noEmit` bersih · `verify-tier1` 15/15 · `verify-foundation` 47/47

**Dependencies:** Task 6
**Files:** `lib/stats-log-mapper.ts`, `scripts/backfill-match-date-iso.ts`
**Scope:** S

---

## Checkpoint: Final ✅
- [x] Semua runnable check hijau: `test-upcoming-guard` **10/10**, `test-stats-mapper` **19/19**, `test-odds-anchor` **8/8**, `test-bulk-rows` **24/24**, `test-snapshot-db` **48/48**, `verify-tier1` **15/15**, `verify-foundation` **47/47**, `tsc` bersih
- [x] Laporan coverage final ke `ARCHITECTURE.md` §9.3: jumlah baris before/after, request terpakai, dan **TANGGAL BATAS katalog fixture = 2026-11-29**
- [x] `data/analysis_snapshots.db` tidak tersentuh (48/48 check snapshot hijau); tidak ada file di luar scope berubah (file agent reviewer/perf tidak disentuh — gap `/api/odds` dilaporkan, bukan dikerjakan)

### Ringkasan hasil (before → after)

| Artefak | Sebelum (18 Okt pagi) | Sesudah | Cara |
|---|---|---|---|
| `upcoming_fixtures` | 246 (30 hari) | **378 (s/d 2026-11-29)** | Task 3, vault listing |
| `competition_catalog` | — | **208** | Task 3, 4 halaman |
| `match_odds_history` | — | **378 baris** (112 terisi + 266 deklarasi kosong) | Task 4, flag `odds_available` |
| `matches` (dataset) | 434 | **1.174** finished | Task 5, bulk stats |
| `team_match_logs` | 868 | **2.348** | Task 5 |
| `teams` | 127 | **195** | Task 5 (tim liga lain ikut masuk) |
| Vault payloads | ~600 | **1.991** (1.122 stats, 454 lineups, 127 injuries, 127 players, 112 odds) | semua task |
| Lineup 18 Okt | 0 | **20/24** | Task 4 |

**Request terpakai: ±1.150 dari kuota (±6.400 tidak terpakai — API mati mendahului rencana).**
**Tidak ada data karangan**: 24/24 check anti-fabrication lulus, mapper tidak pernah dipaksa bypass.
