# ADR-003: Paket kuant hidup di file `analysis_snapshots.db` yang diganti isinya

## Status
Accepted

## Date
2026-11-05

## Context
Hasil run kuant butuh rumah persisten yang bisa dirujuk dashboard dan
ledger: satu baris per (fixture × versi komputasi), lengkap dengan
provenance. Calon rumah yang ada, `data/analysis_snapshots.db`,
berisi skema snapshot era app lama (21 snapshot + 81 outcome,
append-only, sebelumnya diperlakukan terkunci). Membuat file DB baru
yang paralel berarti dua store "hasil analisis" yang bisa drift —
penyakit satu-fakta-dua-rumah yang baru disembuhkan di identitas liga
(ADR-001). Pada 5 Nov 2026 owner mencabut status terkunci file itu
secara eksplisit: "hapus atau ganti aja gapapa, itu hasil app lama" —
app ini sedang dilanjutkan/diupgrade, bukan dibekukan.

## Decision
File `data/analysis_snapshots.db` **diganti isinya**: skema lama
diarsipkan utuh dan lossless ke
`archive/analysis_snapshots-legacy-2026-10.db` (21 + 81 baris,
sha256 tercatat di tabel `meta` store baru), lalu file dibangun ulang
sebagai store paket: tabel `meta` + `packages`
(UNIQUE(match_id, trigger, computed_utc); trigger ber-CHECK;
payload paket lengkap + provenance + cap waktu input). Nama dan path
file tidak berubah, jadi seluruh wiring app yang mengenal path ini
tetap sah. Tidak ada store paralel.

## Alternatives Considered
### DB baru `data/analysis_packages.db`, snapshots lama dibiarkan
- Pros: nol risiko menyentuh warisan.
- Cons: dua rumah untuk satu fakta; konsumen harus memilih; drift tak terhindarkan.
- Rejected: setelah owner mencabut kuncinya, alasan mempertahankannya hilang.

### Memperluas skema snapshot lama (tabel baru di file yang sama, skema lama dipertahankan)
- Pros: satu file, riwayat utuh.
- Cons: dua semantik bertabrakan dalam satu file; modul dorman `lib/db/analysis-snapshot.ts` bisa menulis baris lama di samping paket baru tanpa ada yang sadar.
- Rejected: penggantian bersih + arsip lossless memberi batas yang lebih tegas.

## Consequences
- Paket menjadi sumber rujukan tunggal: pick live-run merujuk `packages.id` (audit: 483/483 tertaut, 0 menggantung).
- Modul dorman `lib/db/analysis-snapshot.ts` BUKAN bagian dari keputusan ini dan tidak diubah: bila jalur planner lama dihidupkan, ia membuat ulang tabel lamanya dalam keadaan kosong di file yang sama (CREATE TABLE IF NOT EXISTS) tanpa mengganggu tabel paket — perilaku itu terdokumentasi di header `lib/picks/packages.ts` dan di `docs/DATABASE.md` §6, jadi kebangkitannya terlihat, bukan senyap.
- `docs/db-snapshot.md` berubah status menjadi dokumen historis (kontrak era lama) — diberi banner superseded yang menunjuk ke ADR ini + `docs/DATABASE.md`.
- Arsip legacy menjadi invarian beku (INV-16 di kontrak): 21/81 baris, tidak boleh berubah.
