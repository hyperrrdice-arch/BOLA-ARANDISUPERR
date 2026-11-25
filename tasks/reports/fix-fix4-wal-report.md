# Laporan Fix Generator Fix-4 + Tindak Lanjut WAL — 25 November 2026 (malam)

Perintah pemilik 25 Nov 2026 ±20:01 WIB (tindak lanjut Laporan A1–A5).
Dieksekusi berurutan: Item 1 (fix generator Fix-4) → Item 2 (WAL).
A6 (R-04) TIDAK dikerjakan — masih ditahan pemilik sampai fix ini beres.

**Catatan kelanjutan:** pekerjaan ini adalah LANJUTAN dari worker yang
terpotong runtime swap (±20:06 WIB) sebelum commit apa pun. Worker itu
meninggalkan edit BELUM ter-commit di worktree `app-football-fix4dup`
(branch `fix/fix4-duplikat` @ `5a34128`): `lib/picks/fix4-policy.ts`,
`lib/picks/fix4-tickets.ts`, `tests/test-fix4.ts`. Run ini MEMBACA diff
itu baris demi baris dan menilainya terhadap syarat Item 1 sebelum
memakai­nya — hasil penilaian: **diff warisan BENAR dan LENGKAP, tidak
ada yang perlu dibuang atau dilengkapi**:

- filter `duplicate_of` ada di kueri kandidat (syarat a) ✓
- dedupe per fixture KANONIK juga SUDAH terpasang (syarat b) — bukan
  cuma filter: `loadFix4Identity()` membaca `data/fixture-links.json`
  lewat `SlateIdentity`/`parseSlateLinks` dari `lib/picks/slate-identity.ts`
  (mekanisme yang sama persis dengan `loadSlateIdentity` di pick-slate
  dan penjaga titik tulis resolver), dedupe memakai
  `identity.physicalKey(match_id)` (kanonik akar untuk kembar, id
  sendiri untuk yang tak tertaut) ✓
- tes regresi D5/D6 sudah tertulis sesuai kasus produksi (syarat c) ✓

Keadaan akhir: master = origin/main `6d783ab` (+ commit laporan ini);
situs live TIDAK berubah: build `3kQ9QLjiiuGg5F3n7fy2G`.

---

## ITEM 1 — Fix generator Fix-4 — SELESAI, merged sebelum deadline

Commit `2c5c646` di branch `fix/fix4-duplikat`, fast-forward ke master,
push terverifikasi (`origin/main = 2c5c646` saat merge; branch + worktree
dihapus). Merged 25 Nov malam — jauh sebelum batas Kamis 26 Nov 13:00
WIB, jadi cron `football-fix4-ticket` (13:30 WIB) **TIDAK dijeda**,
sesuai syarat pemilik.

### Perubahan (3 berkas, +114/−8)
- `lib/picks/fix4-tickets.ts`:
  - Kueri kandidat menambah `AND duplicate_of IS NULL` — predikat yang
    sama dengan `publishSlip` dan `cohort.ts` (A3). Kolom dijamin ada:
    `ensureFix4Schema` memanggil `ensurePublicationSchema`.
  - `loadFix4Identity(cwd)` baru (pola `loadSlateIdentity` pick-slate:
    berkas hilang/rusak → identitas kosong → perilaku warisan persis).
  - Dedupe kandidat memakai `identity.physicalKey(match_id)` sebagai
    kunci "satu laga": dua record kembar tertaut (fd_ vs sm_) adalah
    satu fixture fisik; fixture tanpa tautan memakai match_id-nya
    sendiri. Ranking deterministik TIDAK berubah
    (`published_prob DESC, match_id ASC, id ASC`).
- `lib/picks/fix4-policy.ts`: komentar konstanta diperbarui ke semantik
  baru (tanpa perubahan nilai).
- `tests/test-fix4.ts`: regresi D5 + D6 (di bawah).

### Tes regresi (kasus produksi persis)
- **D5** — reproduksi tiket pertama: pick fd_ (dc/1x, 0,891) dimarking
  `duplicate_of` → pick sm_ kembarnya (seleksi + prob identik). Hasil:
  pick termarking TIDAK PERNAH jadi kandidat; pasangan menyumbang tepat
  1 kandidat (sisi sm_); tiket terbit memuat sm_ dan bukan fd_.
- **D6** — dua pick TAK termarking dari dua match_id kembar TERTAUT
  (fixture-links): tepat 1 kandidat, wakilnya yang probabilitasnya
  tertinggi (fd_ 0,90 > sm_ 0,88); tiket hanya memuat satu sisi.

### Validasi (semua BERURUTAN)
- `test-fix4` **46/46** (termasuk D5/D6) · `tsc` bersih · lint gate
  LOLOS (91 error = baseline, tanpa error baru).
- `test:data` hijau penuh (publication 110/110, tickets 69/69, T02
  63/63, fdorg 43/43, cohort-duplikat 21/21, fix4 46/46, …).
- `test:quant` hijau penuh.
- L01 (`test:lanjut`): pilihan-edisi **25/25**, slate-kembar **96/96**,
  slate-kembar-tak-tertaut **127/127** hijau. DUA suite panggung
  (`pilihan-edisi-browser`, `pilihan-matriks-ulang`) gagal 1/3 pada
  assertion build-di-dalam-suite ("Could not find a production build in
  the '.next' directory") — **terbukti signature lingkungan, BUKAN
  regresi**: suite yang sama dijalankan di worktree master MURNI
  `5a34128` (tanpa perubahan Fix-4) gagal IDENTIK (1/3, assertion dan
  error yang sama). Build di dalam suite bergantung pada sandbox /tmp +
  cache paket yang tersapu runtime swap; perubahan ini tidak disentuh
  web sama sekali (lihat redeploy di bawah).

### Dry-run atas salinan produksi (Item 1e)
CLI `generate-fix4-ticket.ts` tidak punya mode dry-run (langsung
memanggil `generateFix4Ticket`), jadi dry-run dilakukan lewat
`selectFix4Candidates` atas SALINAN `picks.db` produksi (sqlite
`.backup` ke /tmp) dengan identitas dari `fixture-links.json` LIVE —
tanpa membekukan tiket kedua:

- **2026-11-25** (tanggal tiket cacat): kandidat layak **14 → 11** —
  3 pick termarking tersingkir. Boreham Wood–Aldershot tinggal
  sm_ 335010 (dc/1x 0,891); Hartlepool tinggal sm_ 335061
  (team_over05_home 0,8715) menggantikan fd_ 335464. Ringkas:
  termarking-lolos = 0, fixture-fisik-ganda = 0. Tiket yang AKAN terbit
  dengan kode baru: 335010, 335053, 335061, 335031 — tanpa duplikat.
- **2026-11-26** (besok): baru 1 kandidat layak dari slate yang ada
  (sm_19728143 Doncaster team_over05_away 0,8814; kembar fd_-nya benar
  absen). Tiket besok bergantung pada slate hasil refresh 04:21 WIB;
  bila kandidat tetap < 4, generator WAJIB ABSTAIN sesuai aturan.

### Tiket beku tidak diubah (Item 1d) + redeploy
- Record `fx4_74f7455229fa1abb0164f623` (baris tiket + 4 pilihan +
  baris keputusan 2026-11-25) di-hash sebelum dan sesudah SELURUH
  pekerjaan malam ini: sha256 `32de55568537ad9b0…` — **identik**.
- **Tanpa redeploy web**: grep membuktikan `fix4-tickets`/`fix4-policy`
  tidak diimpor `app/`, `lib/web/`, atau `components/` — satu-satunya
  pemakai adalah CLI `scripts/generate-fix4-ticket.ts`, yang dijalankan
  cron dari checkout utama (sudah memuat fix hasil merge).

---

## ITEM 2 — WAL `thestats_dataset.db` — SELESAI

### 2(a) PASSIVE berkala di ujung rantai free-refresh — merged
Commit `6d783ab`, branch `fix/wal-checkpoint-refresh`, FF ke master,
push terverifikasi, branch + worktree dihapus.

- Skrip baru `scripts/wal-checkpoint.ts`: membuka
  `data/thestats_dataset.db`, menjalankan
  `PRAGMA wal_checkpoint(PASSIVE)`, mencatat triplet
  (busy, log, checkpointed) satu baris ke log. **Kontrak anti-gagal:**
  semua kegagalan (DB tidak ada, terkunci, error) dicatat dan proses
  tetap exit 0 — langkah ini tidak pernah menggagalkan refresh.
- `scripts/free-refresh.ts`: langkah 9 `wal-checkpoint` ditambah di
  ujung rantai (sesudah `resolve-pick-outcomes`) + dokumentasi header.
- Validasi: tsc bersih · lint gate LOLOS · `test:data` hijau penuh ·
  jalur gagal teruji di worktree (DB absen → "DILEWATI", exit 0) ·
  jalur sukses teruji di PRODUKSI sesudah merge:
  `[wal-checkpoint] thestats_dataset.db PASSIVE: busy=0 log=0
  checkpointed=0`, exit 0. Berlaku mulai refresh terjadwal berikutnya
  (26 Nov 04:21 WIB).

### 2(b) TRUNCATE satu kali — ruang 1,44 GB kembali
Prasyarat dicek: tidak ada proses refresh/capture/generator berjalan;
dijalankan ±20:24 WIB (jendela sepi; jadwal berikutnya refresh 04:21).

| | Sebelum | Sesudah |
|---|---|---|
| `thestats_dataset.db` | 3.041.361.920 B | 3.041.361.920 B (tetap) |
| `thestats_dataset.db-wal` | **1.444.121.832 B** | **0 B** |
| `thestats_dataset.db-shm` | 32.768 B | 32.768 B |

- `PRAGMA wal_checkpoint(TRUNCATE)` → **busy=0, log=0, checkpointed=0**.
  log/checkpointed 0 karena saat dijalankan memang tidak ada frame
  menggantung (PASSIVE evaluasi A4 sudah mem-flush 561 frame; penutupan
  koneksi terakhir sesudahnya mereset hitungan frame) — yang dipotong
  adalah alokasi berkasnya, dan pemotongan itu yang mengembalikan
  1,44 GB. busy=0: tidak ada writer/reader yang terblokir.
- `PRAGMA integrity_check` = **ok** (berjalan ±15 menit, murni
  IO-bound di host ini; terverifikasi prosesnya aktif membaca halaman,
  bukan menggantung).
- Situs publik sesudahnya: `/` 200, `/bukti` 200; WAL tetap 0 byte
  sesudah seluruh verifikasi.
- Tidak ada config SQLite permanen yang diubah (sesuai perintah).

---

## Ringkasan akhir

| Item | Hasil | Bukti kunci |
|---|---|---|
| 1 Fix-4 | ✅ merged `2c5c646` | fix4 46/46 (D5/D6); dry-run produksi 14→11 kandidat, 0 termarking, 0 fixture ganda; tiket beku identik (sha256 sama); cron 13:30 TIDAK dijeda (merged sebelum deadline) |
| 2a WAL berkala | ✅ merged `6d783ab` | langkah 9 free-refresh; exit-0 anti-gagal teruji dua jalur |
| 2b WAL TRUNCATE | ✅ beres | WAL 1.444.121.832 → 0 B; busy=0; integrity_check ok; situs 200/200 |

Catatan jujur: dua suite panggung L01 gagal di assertion build-di-dalam
-suite — terbukti identik di master murni (signature lingkungan malam
ini, kemungkinan warisan runtime swap yang menyapu sandbox/cache /tmp),
bukan akibat perubahan ini; seluruh suite non-build hijau.
A6/R-04 tetap ditahan sesuai perintah pemilik.
