# Rencana Rollback R-04 (ditulis SEBELUM promosi dijalankan)

Promosi R-04 hanya memindahkan pointer manifest aktif ke kandidat baru
(artefak `ratings-910a9efe3103ffde…`). Artefak champion lama
(`ratings-8a790aeaa4e54fdd…`) immutable dan tetap di store — rollback
tidak membutuhkan pembangunan ulang apa pun.

## Backup (sudah diambil sebelum apply)

`~/workspace/backups/pre-r04-20261126/` berisi:
- `model-manifest.json` — manifest aktif champion (ratingsHash `sha256:8a790aeaa4e54fdd`)
- `model-manifest.candidate.json` — kandidat pra-R-04
- `calibrated_ratings.json` — file kerja pra-R-04 (sha256 `be93286a1f55836e…`)
- `league_calibration.sql` — dump tabel registry pra-R-04
- `git-head.txt` — HEAD pra-R-04 (`bfd095d…`)

## Langkah rollback

1. Kembalikan pointer aktif:
   `cp ~/workspace/backups/pre-r04-20261126/model-manifest.json data/model-manifest.json`
2. (Bila ingin file kerja + registry juga persis seperti pra-R-04:)
   `cp ~/workspace/backups/pre-r04-20261126/calibrated_ratings.json data/calibrated_ratings.json`
   dan `sqlite3 data/thestats_dataset.db < ~/workspace/backups/pre-r04-20261126/league_calibration.sql`
   (dump memuat DROP/CREATE tabel league_calibration versi pra-R-04).
   Catatan: langkah ini opsional — tanpa langkah 2, run calibrate
   berikutnya menimpa file kerja/registry dari kode; yang menentukan
   saji hanyalah pointer langkah 1.
3. Kembalikan kode jalur fit: `git revert <commit R-04>` (atau checkout
   `scripts/calibrate-ratings.ts` dari `bfd095d`). Tanpa ini, kandidat
   berikutnya akan kembali memuat fit warisan segar — pointer champion
   tetap yang lama, jadi saji tidak berubah, tapi konsistensi
   kode↔artefak menuntut revert ini juga.
4. Verifikasi rollback: `loadServingModel` melaporkan ratingsHash
   `sha256:8a790aeaa4e54fdd`, dan prediksi fixture fd_ Bundesliga
   (hint `D1`) menunjukkan `macroPriorDate` kembali ke `2026-10-11`.

## Yang TIDAK perlu di-rollback

- Paket/pick yang terbit sesudah promosi tidak ditulis ulang oleh
  promosi itu sendiri; promosi hanya mengubah bobot untuk komputasi
  berikutnya (slate refresh terjadwal). Bila rollback dilakukan sebelum
  refresh terjadwal berikutnya, tidak ada output produksi yang sempat
  memakai bobot baru.
- Artefak kandidat R-04 boleh tetap di store (immutable, tak dirujuk
  pointer mana pun sesudah rollback).
