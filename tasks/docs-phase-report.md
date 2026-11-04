# Laporan Fase Dokumentasi — ARCHITECTURE.md + STRUCTURE.md final

Tanggal: 2026-11-04 · Fase: dokumentasi (terakhir, sesuai perintah owner:
dokumen ditulis PALING AKHIR dari keadaan final sistem) · Sifat: docs
only — tidak ada perubahan code/data di fase ini.

## 1. Deliverable

- **`ARCHITECTURE.md`** ditulis ulang penuh (801 baris): tujuan +
  aturan emas & dua jalur debat (sindikat 🔒 dorman / Spark aktif);
  pipeline; lapisan data (6 store + 2 artefak JSON terpadu, diagram
  mermaid); identitas liga kanonik; model domestik (fit, blend, tiga
  gerbang, status, bukti OOS, benchmark closing); model piala offset
  global (tiga graf, gerbang pradaftar, status 0/4/13 + taksonomi
  alasan, konektivitas + lubang bernama, pensiun pseudo-UCL); jalur
  operasional + driver E2E + caveat kesegaran harga; ritme harian;
  guardrails; keputusan owner terbuka; lampiran peta bukti.
- **`STRUCTURE.md`** ditulis ulang penuh: pohon teranotasi repo saat
  ini, skrip per peran (15 file), artefak tergenerasi + produsen +
  status tracked/ignored, zona 🔒 eksplisit, keputusan penempatan,
  peta bukti per fase di `tasks/`.
- Bahasa mengikuti dokumen lama: Indonesia dengan istilah teknis
  Inggris. Bagian lama yang masih benar dipertahankan substansinya
  (aturan emas, bentuk pipeline planner/BFF, kontrak snapshot,
  guardrail value-bet-odds-nyata); angka lama yang sudah tidak berlaku
  (snapshot ~130, ratings 16 liga, telemetri 2.583 baris, katalog 420)
  diganti angka terukur saat ini.

## 2. Pemeriksaan konvergensi (diminta eksplisit di brief fase ini)

Konteks (laporan fase piala §8): run cron rantai-LAMA yang sedang
berjalan diperkirakan menulis ulang baris piala + blok JSON sekali,
lalu run rantai-BARU berikutnya memulihkannya.

Temuan (4 Nov 2026, ±12:2x UTC):

1. **`git log 7b28b11..HEAD` kosong** — belum ada commit
   `daily-refresh:` sesudah `7b28b11`; HEAD = `7b28b11` (12:20:11 UTC)
   sebelum fase ini mulai.
2. **Artefak ter-commit SUDAH memuat hasil fase piala**, terverifikasi
   byte-level: `data/calibrated_ratings.json` di disk identik dengan
   blob HEAD (md5 sama) dan memuat blok `canonical.cupOffsets`
   (fittedAt 2026-11-04T12:17:04Z; 3 graf — europe ref sm:8 G 1,2588
   HA 1,289; conmebol ref sm:648 G 0,8468 HA 1,4164; afc ref sm:944
   G 1,1714 HA 1,2401; 17 kompetisi); entri liga SM1085/SM1088 absen
   dari JSON (dihapus sesuai desain). `data/league-canonical.json`
   identik dengan HEAD: 17 entri `cup_model` (4 partial / 13
   uncalibrated) dan 47 liga ber-δ teridentifikasi (33/6/8).
3. **Registry live konsisten**: `league_calibration` = 125 baris,
   `canonical_id` terisi 125/125, dan tepat **17 baris
   `source='cup-offset'`** (4 partial + 13 uncalibrated).
4. **Siklus rewrite-restore BELUM terjadi**: proses daily-refresh
   rantai-lama (mulai 10:08 UTC) masih berada di langkah
   `backfill-telemetry --current-only` (sejak 10:52 UTC) — belum tiba
   di langkah calibrate yang akan menulis ulang. Status cron:
   `football-daily-refresh-trial` enabled, interval 6 jam, run terakhir
   sukses 16:29 WIB, satu run in-flight, berikutnya 23:07 WIB.

Kesimpulan: keadaan ter-commit saat ini **konvergen dan benar**;
penulisan-ulang sekali oleh run lama + pemulihan oleh run baru masih
tertunda sesuai desain rantai — bukan kegagalan. Tidak ada intervensi
yang dilakukan fase ini (tidak menjalankan refresh, tidak membunuh
proses).

## 3. Angka yang konflik antar sumber — dan yang dipilih

| Topik | Konflik | Dipakai di dokumen |
|---|---|---|
| Status registry | `coverage-latest.md` (dibangkitkan run ritme 09:27 UTC, SEBELUM rekalibrasi): 45/28/52 basis sumber | Query langsung registry saat penulisan: calibrated 44, partial 32 (28 liga + 4 piala), uncalibrated 49 (36 + 13); basis kanonik dari laporan rekalibrasi (28/29/26 atas 83 liga) — kedua basis dilabeli eksplisit di ARCH §5.3 |
| Isi `calibrated_ratings.json` | Laporan sprint 44 liga/1.118 tim → overhaul 73/1.872 → keadaan kini 72/1.842 | 72 liga / 1.842 tim (baca langsung; SM1085 terhapus di fase piala menjelaskan selisih dari 73) |
| Telemetri & matches | Flow map (Fase 1): team_match_logs 85.443, matches 70.075 | Baca langsung kini: 85.505 dan 70.106 (tumbuh lewat ritme harian; 70.106 cocok dengan laporan fase piala) |
| OOS Level A/B | Fase 3: 1,0298 / 1,0205 | Rekalibrasi (terbaru, protokol sama): **1,0295 / 1,0202** |
| Cakupan konsumsi | Pasca-kanonik 2.871 kedua-tim-ketemu | Pasca-piala (terbaru): **2.982**, kompetisi penuh 58/88 |

## 4. Kepatuhan & commit

- Hanya tiga file ditulis fase ini: `ARCHITECTURE.md`, `STRUCTURE.md`,
  laporan ini. Nol perubahan code/data; file 🔒 tidak disentuh;
  `.env.local` tidak dibuka; nol panggilan API.
- Commit: `ad6d03e` (ARCHITECTURE.md) → commit STRUCTURE.md → commit
  laporan ini. `git status` bersih untuk file-file fase ini (file
  tracked lain bisa berubah sewaktu-waktu oleh run cron yang sedang
  berjalan — di luar kendali dan di luar scope fase ini).
