# Laporan Item 13 — Backup Harian Ledger Kritis ke Google Drive (RPO ≤ 24 Jam)

**Tanggal:** Kamis, 26 November 2026 (±03:50–03:55 WIB)
**Keputusan pemilik (26 Nov 2026, poin 4):** target RPO off-site ≤ 24 jam untuk ledger kritis — upload harian ke Google Drive khusus `picks.db` + `market_snapshots.db`; backup penuh tetap mingguan.
**Status: SELESAI & LIVE** — larian perdana manual terverifikasi di Drive; cron harian aktif mulai besok.

---

## 1. Yang dibangun

### Script baru: `scripts/backup-ledger-daily.ts`
Script kecil terpisah mengikuti pola `scripts/backup-sqlite-safe.ts` (script lama **tidak diubah sama sekali**):

- Daftar DB **tetap** (bukan pindai dinamis): hanya `picks.db` + `market_snapshots.db`. `thestats_dataset.db` (2,9 GB) sengaja tidak ikut.
- Snapshot konsisten per DB via `VACUUM INTO` (aman terhadap WAL & penulisan bersamaan), lalu `PRAGMA integrity_check` pada setiap snapshot — satu saja tidak `ok` ⇒ gagal keras (exit 1, arsip tidak dibuat).
- Nama arsip berbeda jelas dari mingguan: `bola-ledger-<timestamp UTC>.tar.gz` + file `.sha256` pasangan.
- Direktori lokal: subdirektori `ledger/` di bawah direktori snapshot yang sudah ada → `$HOME/workspace/backups/db-snapshots/ledger/` (env `LEDGER_BACKUP_DIR` untuk override). Subdirektori dipilih agar terpisah bersih dari arsip mingguan `bola-backup-*` di direktori induk; retensi mingguan di sana tidak pernah memindai subdirektori ini.
- Retensi lokal di dalam script: simpan 14 arsip `bola-ledger-*` terbaru (+ pasangan `.sha256`), sisanya dihapus (env `LEDGER_KEEP`, default 14).

### Cron baru: `football-backup-ledger-daily`
- Goal-owned: `goal:football-agent-sportmonks-database-expansion`; delivery ke chat WhatsApp utama Arandi.
- Jadwal: **harian 03:26:39 WIB** (diminta ±03:20, jendela 30 menit; tetap sebelum refresh 04:21 WIB). Larian pertama terjadwal: Jumat, 27 Nov 2026 03:26:39 WIB.
- Body cron menjalankan alur penuh: script → `sha256sum -c` → upload arsip + `.sha256` ke folder Drive "Backup Bola" → verifikasi `size` + `md5Checksum` Drive vs lokal → rotasi Drive khusus harian → laporan.
- Aturan laporan: sukses = SATU baris singkat (nama arsip + ukuran + "terverifikasi"); kegagalan di langkah mana pun WAJIB dilaporkan dengan langkah + errornya, tidak boleh diam.

## 2. Aturan rotasi (khusus arsip harian)

- **Drive:** simpan 14 arsip `bola-ledger-*.tar.gz` terbaru beserta pasangan `.sha256`-nya; yang lebih lama dipindah ke **trash** (`files update {"trashed":true}`) — tidak ada delete permanen.
- **Lokal:** pola yang sama, 14 arsip terbaru di `db-snapshots/ledger/`.
- Arsip mingguan `bola-backup-*` (batas 8) adalah wilayah cron `football-backup-gdrive` dan **tidak disentuh** oleh jalur harian — dibuktikan pada larian perdana: kedua pasang arsip mingguan di folder Drive tetap utuh.

## 3. Larian perdana manual (26 Nov 2026, 03:50 WIB) — terverifikasi

| Langkah | Hasil |
|---|---|
| Script | exit 0; snapshot `picks.db` 56.725.504 byte, `market_snapshots.db` 327.680 byte |
| Integrity | `integrity_check: ok untuk 2/2 snapshot` |
| Arsip | `bola-ledger-2026-11-25T20-50-27-071Z.tar.gz` — **11.153.499 byte** (±10,6 MiB) |
| SHA-256 arsip | `cc250c24d5c9bd5910b464d962b253dc3323edf77628d82eb3d36fcdabb6d9eb` |
| Verifikasi lokal | `sha256sum -c` → `OK` |
| Upload Drive | arsip + `.sha256` ter-upload ke folder "Backup Bola" |
| Verifikasi Drive | `size` **11.153.499 = lokal**; `md5Checksum` **`8e712ae533f7cca5fb918c276c2d29bf` = `md5sum` lokal** — identik byte-per-byte |
| Tautan Drive | https://drive.google.com/file/d/1BQ8VMmzIDL6ZVbnlqfaJiFX8T2osjbek/view?usp=drivesdk |
| **Durasi total** | **49 detik** |

### Bukti dataset 3 GB tidak ikut
Backup penuh mingguan: arsip 181.465.906 byte, durasi ±32 menit (integrity_check dataset 3 GB merangkak di IO host ini). Larian ledger harian: arsip 11.153.499 byte, **49 detik** — karena isinya hanya snapshot dua DB ledger (56,7 MB + 0,3 MB mentah).

## 4. Yang TIDAK diubah

- `scripts/backup-sqlite-safe.ts` — nol perubahan.
- Cron `football-backup-gdrive` (mingguan, Kamis ±02:54 WIB, 7 DB, rotasi Drive 8) — nol perubahan; terverifikasi via `cron.view` sebelum pekerjaan ini dimulai dan tidak disentuh sesudahnya.
- Tidak ada `.env.local`/token di dalam arsip ledger (arsip hanya berisi dua file DB snapshot).

## 5. Arti operasional

- Per hari ini, salinan off-site `picks.db` (ledger bukti target 5 Jan) + `market_snapshots.db` tidak pernah lebih tua dari ±24 jam di Google Drive, independen dari VM ini maupun VPS lama.
- Restore darurat ledger: unduh `bola-ledger-*.tar.gz` terbaru dari folder "Backup Bola" → ekstrak → letakkan kedua `.db` di `data/` (atau `DB_DIR`).
