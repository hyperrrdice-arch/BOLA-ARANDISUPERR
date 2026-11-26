# Protokol Kohor Prospektif ML1-B — dokumen pendamping manifest

Manifest mesin: `tasks/ml1/cohort-protocol.proposal.json` (JSON berversi +
`protocol_sha256` + `cohort_id` yang diturunkan persis dari hash manifest).
Status manifest saat ini: **PROPOSED_PENDING_OWNER_APPROVAL**. Nilai produksi
(T0/T1, cutoff grading akhir, tanggal tinjauan formal, marker champion primer
terverifikasi, SHA manifest kandidat) masih `null` — diisi sesudah preflight
dan sebelum koleksi pertama, atas persetujuan pemilik. Tidak ada koleksi yang
dijalankan tahap ini dan tidak ada cron yang dijadwalkan.

## Ringkasan kunci protokol (usulan default brief §3)

- Unit primer: satu fixture fisik per `fixture_uid` + horizon
  `slate_pre_match`; satu pasangan 1X2 (paket champion aktual vs ML1-B).
- Horizon keputusan: prediksi eligible pertama pada run rutin dengan
  `0 < lead <= 72 jam` dari instant UTC aktual, diterapkan **sebelum**
  dedupe permanen/insert (`maxLeadMs` di jalur PIT B) agar row terlalu dini
  tidak mengunci peluang layak. Bucket laporan: <12 jam, 12–<36 jam, 36–72 jam.
- Cadence: 1 batch harian ±17:30 WIB sesudah refresh terverifikasi, tanpa
  `--limit` sesudah preflight; run terlewat dicatat di funnel.
- Jendela: 12 pekan ISO UTC penuh, kickoff di [T0, T1), keputusan >= T0,
  cutoff grading akhir T1 + 7 hari, minimum 8 blok ISO berisi laga graded.
- Kompetitif primer: daftar canonical competition ID di manifest (liga
  domestik reguler; titik awal divisi football-data yang didukung, ID
  terverifikasi di `data/league-canonical.json`). Di luar daftar =
  `unknown`. Terpisah dari `league_calibration`; field `slice` lama tidak
  dipakai.
- Model: satu kandidat (manifest SHA + feature code version + runner
  dikunci). Marker champion primer dari paket yang benar-benar aktif di
  awal studi — baseline repo `sha256:910a9efe3103ffde`, wajib diverifikasi
  aktual saat preflight. Marker berubah = strata terpisah; marker hilang =
  diagnostik.
- Gerbang: >= 500 fixture kompetitif graded, Δ log-loss 1X2 rata-rata
  <= −0,005, batas atas bootstrap blok pekan satu sisi 95% < 0 (5.000
  resample, seed 20261124). Status: COLLECTING / INCONCLUSIVE /
  RETAIN_CHAMPION / READY_TO_REVIEW. Hasil studi tidak mengubah model saji.

## Perlakuan yang ditetapkan di muka

- **Reschedule**: prediksi tetap terikat UID + kickoff saat issue; kickoff
  kanonik berubah → grading pending `kickoff_evidence_conflict` sampai bukti
  konsisten; tidak ada penerbitan ulang, lead tidak dihitung ulang.
- **Perubahan versi** (kandidat/fitur/runner/marker): strata terpisah;
  strata primer beku ke versi manifest.
- **Koreksi hasil**: grading append-only — koreksi menambah edisi grading
  baru; forecast dan laporan beku lama tetap reproducible dari cutoff-nya.
- **Rerun**: tidak menggandakan fixture, tidak mengganti prediksi lama;
  edisi pertama yang tercatat disimpan.
- **Amandemen protokol**: versi protokol baru + cohort_id baru.

## Lokasi, pertumbuhan, backup/restore (§2D)

- DB shadow kohor: `<DB_DIR>/ml1_prospective_pit_b.db` (tabel predictions,
  feature_snapshots, cohort_gradings, cohort_reports).
- Direktori proyeksi: `<DB_DIR>/pitb-projections/` — satu file
  `pitb-projection-<sha256>.jsonl.gz` per batch (nama = hash isi JSONL).
  Ukuran per batch terukur di preflight (fixture kecil ±1 KB; salinan
  representatif di laporan PR). Estimasi pertumbuhan: 1 batch/hari × 12
  pekan = ±84 file selama studi, ditambah DB shadow yang tumbuh per baris
  prediksi + grading.
- Backup: DB shadow dibackup dengan jalur snapshot SQLite aman yang sudah
  ada (`scripts/backup-sqlite-safe.ts` / VACUUM INTO) **ditambah** salinan
  direktori proyeksi sebagai satu set — DB tanpa proyeksi tidak bisa
  diverifikasi/replay, proyeksi tanpa DB kehilangan manifest tercatatnya.
  Restore = kembalikan pasangan (DB + direktori) dari set yang sama, lalu
  jalankan `scripts/ml1-cohort.ts verify` sebelum grading dilanjutkan.
- Arsip yatim: file proyeksi yang tidak direferensikan baris
  `feature_snapshots` mana pun dihitung saat preflight
  (`countOrphanProjections`). Kebijakan pembersihan: proyeksi yang masih
  direferensikan TIDAK pernah dihapus; file yatim hanya boleh dibersihkan
  sesudah studi ditutup dan atas persetujuan pemilik — tahap ini hanya
  melaporkan hitungannya.

## Funnel pelaporan

Tahap: terjadwal dalam cakupan (denominator dari `canonical_fixtures` pada
snapshot, kickoff dalam jendela) → eligible → tersimpan → dinilai; laga
tanpa paket terhitung sebagai gap. Dilaporkan terpisah: pending, void,
invalid, identitas meragukan, evidence hilang/rusak, gagal inferensi/skip
saat issue, batch terlewat; distribusi lead time; coverage per liga,
marker, dan versi fitur.
