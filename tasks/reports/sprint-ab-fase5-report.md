# Laporan Sprint A+B — Fase 5: Item 6 (available_at) + Item 11 (WAL) + Item 12 (Restore)

Basis: master `fb21f7f` · Branch: `sprint/a-b-lanjutan`.

## Item 6 — Instrumentasi available_at / ingested_at: SELESAI (kode)

- Modul baru `lib/feeds/ingest-freshness.ts`: `ensureIngestSchema`
  (ALTER TABLE matches ADD COLUMN available_at — aditif, idempoten;
  tabel baru `ingest_status`), `recordIngestAttempt`,
  `recordSuccessfulIngest`, `getIngestStatus`, `resultLagStats`
  (p50/p95 lag available_at − kickoff), `perTeamResultAge`.
- Importer `scripts/import-free-feed.ts`: skema dipastikan + attempt
  dicatat di awal run (non-dry-run), `insMatch` mengisi available_at =
  cap run untuk baris hasil BARU, keberhasilan dicatat di akhir run
  (source `football-data`, detail hitungan insert).
- Kejujuran data: baris historis tetap NULL — tidak ada backfill/rekaan;
  statistik lag mengembalikan null (bukan 0) selama belum ada baris
  ber-cap, dan menjadi terhitung nyata sejak ingest pertama sesudah
  kode ini merge + refresh berjalan. Jalur jembatan (anchor sm_/mt_)
  tidak diubah: hasil itu sudah ada di store sebelumnya.
- Uji: `tests/test-ingest-freshness.ts` **12/12** (skema idempoten,
  NULL historis, lag p50/p95 eksak pada fixture, status ingest, umur
  per tim), dirantai ke test:data.

## Item 11 — Evaluasi WAL PASSIVE: DEFERRED_WAITING_25NOV_DATA

Sesuai brief: data observasi siklus refresh penuh sesudah aktivasi
stabilisasi (dijadwalkan 25 Nov 07:00 WIB) BELUM ADA malam ini.
Tidak ada angka yang direka; status persis seperti yang diresepkan
brief: **DEFERRED_WAITING_25NOV_DATA**. Tidak ada perubahan mode jurnal
yang dilakukan.

## Item 12 — Uji restore backup: LOLOS

- Sumber: salinan lokal arsip terverifikasi `app-football-20261122-2152.tar.gz`
  — sha256 `079666590158234591dffa523dafd52f928afc7f3f0c0ec6bf2a24cef28ddd3e`,
  cocok dengan catatan backup.log (nilai yang sama terverifikasi di VPS).
- Staging terisolasi `~/workspace/restore-test-sprint/` (BUKAN direktori
  data produksi; dihapus sesudah bukti dicatat). Hanya 6 berkas .db
  diekstrak; DB produksi tidak disentuh sama sekali.
- Hasil: **integrity_check ok pada 6/6 DB**; hitungan baris konsisten
  dengan angka produksi yang dikenal (matches 71.503, teams 6.541,
  team_match_logs 90.749, picks 172.115, pick_outcomes 164.680,
  packages 8.742, sm_predictions 84.721, upcoming_fixtures 4.009);
  referensial bersih: pick_outcomes tanpa pick = 0; pick ber-package_id
  tanpa package = 0 (163.008 package_id NULL = korpus lab Fase A, sesuai
  desain). sha256 per DB tercatat di
  `tasks/sprint-ab/evidence/restore-test/restore-evidence.json`.
- `git status`: tidak ada berkas .db/.db-wal/.db-shm.

## Stop-gate Fase 5

tsc 0 · lint:gate LOLOS · test:data exit 0 (termasuk suite Item 6 12/12
dan Item 9 12/12) · test:api 42/42 · hash live (manifest 47c6a62c…,
calibrated_ratings 8630e4b2…, picks.db 5d354305…) identik dengan Fase 0.
