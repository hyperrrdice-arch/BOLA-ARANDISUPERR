# TODO — Ekspansi Coverage Data TheStatsAPI (lihat tasks/plan-data-coverage.md)

**Konteks hidup-mati untuk yang mengeksekusi:** kuota 7.000 request TheStatsAPI kedaluwarsa **HARI INI** dan tidak ada request lagi sampai app menghasilkan uang (bisa berminggu-minggu). Artinya data yang tidak ditarik hari ini = tidak akan pernah ada. **Urutan task sudah diurutkan bertahan-hidup: katalog fixture & odds dulu, telemetri menyusul.** Disiplin: vault cache (jangan fetch 2×), upsert idempotent, transaksi per batch, DILARANG mengarang data (mapper `mapStatsToTelemetry` sudah return null saat skor absen — jangan dibypass).

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

## Task 3: Katalog fixture maksimal + snapshot kompetisi (PRIORITAS 1)

**Description:** Tarik SEMUA fixture sejauh yang API izinkan (bukan cuma 30 hari) ke `upcoming_fixtures.db`. Simpan juga snapshot `/football/competitions` (4 halaman) ke store lokal supaya katalog liga tetap hidup saat API mati. Periksa juga apakah fixture yang sudah ada perlu di-refresh (penundaan/perubahan jadwal).

**Acceptance criteria:**
- [ ] `upcoming_fixtures` berisi fixture sampai **tanggal batas yang dikonfirmasi Task 1** (target: ≥90 hari kalau API mengizinkan)
- [ ] Nama kompetisi bisa dilayani dari store lokal tanpa API
- [ ] Upsert idempotent: run ulang tidak menduplikasi fixture
- [ ] Fixture `scheduled` TIDAK masuk `team_match_logs`

**Verification:**
- [ ] `npx.cmd tsx scripts/test-upcoming-guard.ts` hijau
- [ ] Query: `SELECT max(utc_date) FROM upcoming_fixtures` — tanggalnya tercatat di laporan

**Dependencies:** Task 2
**Files:** `scripts/sync-upcoming-fixtures.ts`, `lib/db/upcoming-fixtures.ts`, tabel store kompetisi (baru di `lib/db/upcoming-fixtures.ts` atau `thestats-dataset.ts`)
**Scope:** M

---

## Task 4: Pre-pull odds semua fixture + lineups laga hari ini + bukti degradasi offline

**Description:** (a) Tarik `/football/matches/{id}/odds` untuk **semua fixture di store** (1 req/fixture) → simpan ke tabel kecil `match_odds_history` + vault, lengkap dengan `captured_utc` (ini anchor harga, BUKAN closing). (b) Lineups untuk 24 fixture hari ini saat sudah rilis (H-1h) — **satu-satunya kesempatan selamanya**. (c) Verifikasi app bertahan saat API gagal: `/api/matches` harus menyajikan katalog dari store; kalau jalur fallback store-nya belum aktif → **laporkan ke lead reviewer** (perubahan kode di luar scope agent DB).

**Acceptance criteria:**
- [ ] Semua fixture di store punya baris odds anchor (atau dinyatakan eksplisit: API tidak punya odds untuk itu)
- [ ] Lineups 24 laga hari ini tersimpan (untuk yang kickoff-nya masih memungkinkan)
- [ ] Hasil uji offline tercatat: API dibuat gagal → katalog masih tampil / error jujur tanpa crash

**Verification:**
- [ ] Spot-check 5 fixture: baris odds cocok dengan payload vault
- [ ] Simulasikan API gagal (mis. ubah base URL sementara) → `/api/matches` dan `/api/odds` tidak crash

**Dependencies:** Task 3
**Files:** `lib/db/thestats-dataset.ts` (tabel `match_odds_history`), script pre-pull baru/ekstensi sync-existing
**Scope:** M

---

## Checkpoint: Aman periode kering
- [ ] Katalog fixture mencakup horizon maksimal + tanggal batas tercatat
- [ ] Odds anchor tersedia untuk semua fixture
- [ ] Uji offline lulus (atau gap-nya dilaporkan ke lead reviewer)

---

## Task 5: Bulk stats match historis (spend utama)

**Description:** Tarik `/football/matches/{id}/stats` untuk semua match finished yang belum ada di `team_match_logs` — sisa 26/27 dulu, lalu 25/26 kalau ada. **Tanpa lineups historis.** Simpan via `mapStatsToTelemetry` + upsert; payload mentah ke vault.

**Acceptance criteria:**
- [ ] `team_match_logs` ≥3.000 match total (atau maksimum budget)
- [ ] Nol 0-0 karangan (spot-check 20 baris acak vs vault)
- [ ] `matches` hanya berisi `finished`
- [ ] Budget task ini ≤ 4.800 request

**Verification:**
- [ ] `npx.cmd tsx scripts/test-stats-mapper.ts` + `test-upcoming-guard.ts` hijau
- [ ] `SELECT status, count(*) FROM matches GROUP BY status` = hanya finished

**Dependencies:** Task 4 (bertahan-hidup dulu, baru kualitas)
**Files:** `scripts/ingest-rich-telemetry-multileague.ts` / bulk script
**Scope:** M

---

## Task 6: Tuntaskan tim tipis + backfill xG

**Description:** Pastikan semua tim di `teams` punya ≥6 log finished. Backfill 2 log `xg_for IS NULL` dari vault/API.

**Acceptance criteria:**
- [ ] Tim dengan <6 log = 0
- [ ] Log tanpa xG = 0 (atau dinyatakan sumbernya memang kosong — TANPA imputasi)
- [ ] Tidak menimpa kolom terisi dengan NULL

**Verification:**
- [ ] `npx.cmd tsx scripts/verify-tier1-offline-quant.ts` 15/15
- [ ] `npx.cmd tsx scripts/verify-foundation-phase-a.ts` 47/47

**Dependencies:** Task 5
**Files:** `data/thestats_dataset.db`
**Scope:** S

---

## Checkpoint: Telemetri
- [ ] Semua tim terlacak ≥6 log · test guard hijau · sisa budget dicatat

---

## Task 7: Enrichment — injuries, squad, referee

**Description:** Snapshot `/football/teams/{id}/injuries-suspensions` untuk 127 tim terlacak (bertanggal). Refresh `/football/teams/{id}/players` untuk tim bersquad kurang. `/football/matches/{id}/referee` untuk 24 laga hari ini.

**Acceptance criteria:**
- [ ] Semua tim terlacak punya snapshot injuries bertanggal hari ini
- [ ] Data apa adanya dari API (kosong = kosong)

**Verification:**
- [ ] Spot-check 5 tim vs vault · `test-stats-mapper` hijau

**Dependencies:** Task 6
**Files:** `scripts/fetch-missing-squads.ts`, `lib/db/thestats-dataset.ts`
**Scope:** S

---

## Task 8: (Opsional sisa budget) Odds historis window backtest

**Description:** Kalau sisa ≥500, tarik `/football/matches/{id}/odds` untuk match window backtest ke `match_odds_history`. Budget kurang → dilewati rapi, jangan setengah-setengah.

**Acceptance criteria:**
- [ ] Baris tersimpan apa adanya dengan `captured_utc`
- [ ] Atau dilewati total dengan alasan tercatat

**Verification:** Spot-check 5 match vs vault

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

## Checkpoint: Final
- [ ] Semua runnable check hijau: `test-upcoming-guard`, `test-stats-mapper`, `verify-tier1` 15/15, `verify-foundation` 47/47
- [ ] Laporan coverage final ke `ARCHITECTURE.md`: jumlah baris before/after, request terpakai, dan **TANGGAL BATAS katalog fixture**
- [ ] `data/analysis_snapshots.db` tidak tersentuh; tidak ada file di luar scope berubah
