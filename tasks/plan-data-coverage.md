# Implementation Plan: Ekspansi Coverage Data TheStatsAPI (Bakar 7.000 Request — API MATI SETELAH HARI INI)

## Overview

Kuota 7.000 request gratis TheStatsAPI **kedaluwarsa hari ini dan tidak ada request lagi sampai app menghasilkan uang** — periode kering bisa berminggu-minggu. Konsekuensi: selain memperdalam telemetri, kuota HARUS menstok semua data yang app butuhkan untuk tetap hidup tanpa API: **katalog fixture sejauh mungkin ke depan**, **odds untuk semua fixture itu**, snapshot kompetisi/injuries, lalu riwayat telemetri untuk kualitas analisis. Dikerjakan oleh agent database; dokumen ini self-contained.

## Audit: Apa yang Kurang (kondisi 18 Okt 2026, terukur)

| Aspek | Kondisi sekarang | Dampak saat API mati | Prioritas |
|---|---|---|---|
| **Katalog fixture** | 246 fixture, window **30 hari** saja | Setelah 30 hari katalog kosong → app tidak punya match untuk ditampilkan SAMA SEKALI | 🔴 **KRITIS** |
| **Odds fixture upcoming** | Tidak pernah disimpan; `/api/odds` tarik live | Kartu odds langsung mati (render jujur "tidak tersedia", tapi kosong) | 🔴 **KRITIS** |
| **Daftar kompetisi** | `/football/competitions` ditarik live, cache 1 hari | Cache expired → nama liga/katalog rusak | 🔴 Tinggi |
| **Riwayat telemetri** | 434 match, SEMUA 26/27 (7 Agu – 17 Okt) | Form/H2H lokal dangkal untuk selamanya | 🟡 Tinggi |
| **Kompetisi tercakup** | 7 vs 16 liga di ratings | 9 liga tanpa form/H2H lokal | 🟡 Tinggi |
| **Tim window penuh** | 110 tim ≥6 log, 17 tim <6 | Shrinkage tim tipis = prior doang | 🟡 Sedang |
| **Injuries** | Live per analisis, tidak persisten | Tidak ada data cedera sama sekali | 🟡 Sedang |
| **Odds historis** | Tidak disimpan (closing = proxy snapshot) | Backtest masa depan terbatas | 🟢 Rendah |
| **Log tanpa xG / tanggal 10-digit** | 2 log / semua log | Kecil | 🟢 Rendah |

## Alokasi Budget 7.000 Request (revisi)

| Prioritas | Aktivitas | Request | Output |
|---|---|---|---|
| 1 | **Perluas window upcoming fixture semaksimal API mengizinkan** (coba 60/90/180 hari; listing = 1 req/100 fixture) + snapshot kompetisi | ~50–150 | Katalog bertahan selama mungkin |
| 2 | **Pre-pull odds untuk SEMUA fixture upcoming** (1 req/fixture) + vault | ~300–600 | Kartu odds punya data anchor selama periode kering |
| 3 | Lineups 24 laga hari ini (satu-satunya kesempatan selamanya) + stats pasca-laga malam ini | ~50–150 | Lineup laga hari ini + promosi fixture |
| 4 | Bulk stats match historis (25/26 + sisa 26/27, 7 kompetisi, TANPA lineups historis) | ~3.800–4.800 | `team_match_logs` 434 → ribuan match |
| 5 | Injuries snapshot 127 tim + refresh squad kurang + referee laga hari ini | ~300–400 | Konteks offline |
| 6 | (Opsional sisa) odds historis window backtest | sisa | Closing odds asli |
| Cadangan | Retry/gagal | ~500 | — |

## Architecture Decisions & Guardrails (WAJIB)

1. **DILARANG mengarang data.** `mapStatsToTelemetry` sudah return `null` saat skor/status absen — jangan dibypass, jangan ada `?? 0` baru. Baris tanpa skor = skip + warning, bukan 0-0.
2. **Fixture `scheduled` TIDAK PERNAH masuk `team_match_logs`** (guard test `test-upcoming-guard.ts` menolaknya). Fixture upcoming masuk ke store `upcoming_fixtures` — tempatnya memang di sana.
3. **Vault cache = penghemat request.** Semua fetch lewat pola vault dengan dedupe `resource_id`. Cek vault/DB dulu sebelum hit API. Request yang sama tidak boleh ditarik 2×.
4. **Upsert idempotent + counter sisa budget** per batch; stop bersih saat budget < 100.
5. **Transaksi per batch** (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`) untuk multi-tulis.
6. **`data/analysis_snapshots.db` TIDAK BOLEH disentuh** (korpus pribadi pipeline lain).
7. **Data yang sudah tersimpan jangan ditimpa dengan yang lebih miskin** (pola COALESCE — refresh tanpa field X tidak menghapus field X).
8. Pre-pull odds bersifat **anchor/arsip**: catat `captured_utc` — jangan diklaim sebagai closing odds.

## Task List

### Phase 1: Persiapan (0 request API)
- [ ] Task 1: Inventaris + uji horizon fixture API (dry-run + listing murah)
- [ ] Task 2: Guard idempoten + penghitung budget

### Checkpoint: Sebelum bakar request
- [ ] Batas horizon fixture terkonfirmasi + alokasi final disepakati
- [ ] `npx.cmd tsc --noEmit` bersih

### Phase 2: Bertahan Hidup Tanpa API (PRIORITAS — lakukan SEBELUM bulk telemetri)
- [ ] Task 3: Katalog fixture maksimal + snapshot kompetisi
- [ ] Task 4: Pre-pull odds semua fixture upcoming + lineups laga hari ini

### Checkpoint: Aman periode kering
- [ ] `upcoming_fixtures` mencakup fixture sejauh yang API berikan (catat tanggal batasnya)
- [ ] Semua fixture punya baris odds anchor (atau dinyatakan: API tidak punya)
- [ ] Uji offline: dengan API dibuat gagal, `/api/matches` masih menyajikan katalog dari store

### Phase 3: Kualitas Analisis (spend utama)
- [ ] Task 5: Bulk stats match historis (telemetri 25/26 + sisa 26/27)
- [ ] Task 6: Tuntaskan tim tipis + backfill 2 log tanpa xG

### Checkpoint: Telemetri
- [ ] Semua tim terlacak ≥6 log finished · `test-upcoming-guard` + `test-stats-mapper` hijau

### Phase 4: Enrichment & Pelunasan
- [ ] Task 7: Snapshot injuries + squad kurang + referee
- [ ] Task 8: (Opsional sisa budget) odds historis backtest
- [ ] Task 9: (Opsional) presisi `match_date` ISO penuh

### Checkpoint: Final
- [ ] Seluruh runnable check hijau + laporan coverage final (termasuk TANGGAL BATAS katalog) ke ARCHITECTURE.md

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| API hanya punya fixture ≤30 hari ke depan | **Tinggi** | Task 1 konfirmasi dulu; kalau benar, katalog akan menipis — dokumentasikan tanggal batas + pastikan app degradasi jujur (bukan crash). Prioritaskan odds+lineups hari ini |
| Kuota habis di tengah | Med | Idempoten + checkpoint; urutan task sudah prioritas bertahan-hidup dulu |
| Payload API berubah bentuk | Tinggi | Mapper menolak field absen (null) — jangan dipaksa |
| Timpa data bagus dengan miskin | Med | COALESCE; jangan hapus kolom saat refresh |
| App butuh kode fallback store yang belum ada | Med | Task 4 memverifikasi jalur offline; kalau perlu ubah kode → laporkan ke lead reviewer (di luar scope agent DB) |

## Open Questions
- [ ] Seberapa jauh API mengizinkan fixture diambil? (Task 1 menentukan — 60/90/180 hari atau lebih)
- [ ] Odds pre-pull: tabel baru `match_odds_history` + vault, atau cukup vault? (rekomendasi: tabel kecil + vault)
- [ ] `/api/matches` saat API mati: apakah tier lokal store sudah aktif otomatis? (wajib dipastikan di Task 4)

## File yang Relevan
- `scripts/sync-upcoming-fixtures.ts` (window 30 hari — perluas), `scripts/sync-weekly-telemetry.ts`, `scripts/ingest-rich-telemetry-multileague.ts`, `scripts/fetch-missing-squads.ts`, `scripts/promote-upcoming-to-telemetry.ts`
- `lib/stats-log-mapper.ts`, `lib/db/thestats-dataset.ts`, `lib/db/upcoming-fixtures.ts`, `lib/db/thestats-vault.ts`, `lib/stats-cache.ts`
- Route terkait degradasi offline: `app/api/matches/route.ts`, `app/api/odds/route.ts`
- Guard test: `scripts/test-upcoming-guard.ts`, `scripts/test-stats-mapper.ts`
- API base + key: env `STATS_API_KEY` (baca `.env.local`)
