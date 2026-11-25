# Laporan Paket Aktivasi A1–A5 — 25 November 2026

Keputusan pemilik tertulis 25 Nov 2026 ±19:37 WIB; dieksekusi berurutan,
satu fase selesai penuh sebelum fase berikutnya. A6 (R-04) TIDAK dikerjakan
(ditahan pemilik). Keadaan awal: master = origin/main `69de168`, situs live
build `xIA7e-YB403aM2Y99uQwk`. Keadaan akhir: master = origin/main `325b4bc`,
situs live build `3kQ9QLjiiuGg5F3n7fy2G`.

---

## FASE A1 — Merge jembatan /fixtures ke main — SELESAI

- Ancestry terverifikasi: `git merge-base` = `fcf4c5a` (branch berbasis fix
  adapter, belum memuat fix kembar). File kedua sisi **disjoint penuh**:
  - master sejak base: `lib/identity/link-matching.ts`,
    `scripts/build-fixture-links.ts`, `scripts/pick-slate.ts`, laporan +
    tes kembar.
  - branch sejak base: `lib/feeds/api-football.ts`,
    `scripts/capture-odds-apifootball.ts`, `tests/test-market-snapshot.ts`,
    laporan jembatan.
- Merge master ke branch di worktree fixbridge: commit `8615f43`, **tanpa
  konflik**.
- Validasi hasil merge (berurutan): `tsc` bersih · lint 91 errors = baseline
  persis (gate ≤ 92) · `test:data` hijau penuh, **T02 63/63** ·
  `test:quant` hijau penuh.
- Fast-forward checkout utama `69de168 → 8615f43`; push terverifikasi
  `origin/main = 8615f43`; branch `fix/apifootball-fixtures-bridge` dihapus
  remote + lokal; worktree dibuang. **Tanpa redeploy web** (perubahan CLI +
  tes saja). File dirty checkout utama (churn data refresh) tidak disentuh.

## FASE A2 — Aktivasi penuh — SELESAI (dengan satu temuan material)

### 1. Capture produksi pertama
Satu larian `scripts/capture-odds-apifootball.ts` dari checkout utama, env
dari `.env.local` (nilai token tidak pernah dicetak), menulis ke PRODUKSI
`data/market_snapshots.db`. Exit 0:

- tanggal 2026-11-25 (UTC), jendela "manual"; peta /fixtures 243 fixture
  (1/1 halaman); halaman odds 3/19 terambil (16 dilewati —
  `skipped-due-to-plan-cap` eksplisit, batas free plan);
- **4.207 quote terparse → 1.160 snapshot tersimpan** (verifikasi DB:
  1.160 baris, 7 fixture terjembatani, pasar 1X2 = 70, OU = 1.090);
- 0 entri odds tanpa pasangan /fixtures; 3.047 quote tak terjembatani
  (fixture di luar katalog repo — celah katalog yang sudah dikenal);
- 4 request terpakai; sisa kuota header 85 → total akun hari ini
  **15/100** (11 sebelum fase ini + 4).

### 2. Cron terdaftar (goal-owned, Asia/Jakarta)
| Job | Jadwal | Run pertama |
|---|---|---|
| `football-capture-apifootball-0900` | harian 09:00 WIB | Kam 26 Nov 09:00 |
| `football-capture-apifootball-1800` | harian 18:00 WIB | Kam 26 Nov 18:00 |
| `football-fix4-ticket` | harian 13:30 WIB (cutoff 14:00) | Kam 26 Nov 13:30 |

Capture: sukses rutin = diam; gagal/anomali (0 snapshot, sisa kuota < 10)
= satu pesan singkat. Fix-4: hasil tiket ATAU abstain + alasan selalu
dilaporkan ke chat pemilik.

### 3. Tiket resmi pertama — TIKET TERBIT (bukan abstain)
Keluaran generator persis (dibekukan append-only, tidak diubah):

```
FIX-4 2026-11-25: TIKET RESMI fx4_74f7455229fa1abb0164f623
(expected 0.6098, kandidat layak 14, baru dibekukan, cutoff 2026-11-25T07:00:00.000Z):
  1. fd_EC_20261125_boreham-wood_aldershot dc/1x published_prob=0.8910 kickoff=2026-11-25T19:00:00.000Z
  2. sm_19748115 dc/1x published_prob=0.8910 kickoff=2026-11-25T19:00:00.000Z
  3. sm_19728966 team_over05_away/yes published_prob=0.8814 kickoff=2026-11-25T19:45:00.000Z
  4. fd_EC_20261125_hartlepool_solihull team_over05_home/yes published_prob=0.8715 kickoff=2026-11-25T19:45:00.000Z
```

### ⚠ TEMUAN MATERIAL — generator Fix-4 tidak menyaring `duplicate_of`
- `lib/picks/fix4-policy.ts` + `lib/picks/fix4-tickets.ts` **tidak memuat
  satu pun rujukan ke `duplicate_of`** (grep: nol).
- Pilihan 1 adalah pick id 335450 dengan `duplicate_of = 335010` — dan
  335010 adalah pilihan 2 itu sendiri. Jadi tiket resmi pertama memuat
  **laga yang sama dua kali** (Boreham Wood–Aldershot versi fd_ + sm_,
  pasar/seleksi/prob identik). Pilihan 4 juga pick termarking
  (id 335464, `duplicate_of = 335061`).
- Akarnya: aturan "maks 1 pilihan per laga" ditegakkan per `match_id`,
  sedangkan dua record kembar membawa `match_id` berbeda; dan kelayakan
  Fix-4 tidak mengecualikan pick termarking (berbeda dengan
  `publishSlip`, yang menolaknya).
- Keputusan 25 Nov sudah beku append-only dan **tidak diubah**. Perbaikan
  generator (kelayakan Fix-4 mengecualikan `duplicate_of`, idealnya
  kembar tertaut dihitung satu fixture) berada **di luar cakupan A1–A5**
  (A3 = statistik saja) → menunggu keputusan pemilik. Sampai diperbaiki,
  cron Fix-4 harian 13:30 dapat menerbitkan tiket berpola sama.

## FASE A3 — Statistik akurasi: saring `duplicate_of` (opsi (a)) — SELESAI

Branch `fix/statistik-duplikat` (worktree terpisah), commit `325b4bc`,
fast-forward ke master + push (`origin/main = 325b4bc`), branch dihapus.

Perubahan (bedah terbatas pada agregasi akurasi utama):
- `lib/picks/cohort.ts` — predikat basis `p.duplicate_of IS NULL` di
  `hitungCohort`, mengalir ke semua hitungan (issued, voids, agregat
  settled/hits/misses/prob_slice, klasifikasi pending): termarking keluar
  dari **pembilang dan penyebut**. Jumlah pick termarking (`n_dup`) masuk
  tanda tangan cache cohort — penandaan adalah UPDATE di tempat, tanpa
  itu statistik pra-tanda bisa tersaji basi dari cache.
- `lib/web/data.ts` `ledgerStats()` — agregasi live disaring juga:
  `live_total`, `live_resolved`, `by_grade`, `live_by_grade_gate`,
  `by_market` (dengan penjaga `kolomAda`; DB lama tanpa kolom =
  perilaku lama persis).
- **Tidak diubah (dicatat, sesuai aturan bedah terbatas):** populasi lab
  (tidak pernah termarking), daftar `recent` di `ledgerStats` (daftar
  tampil, bukan statistik), `landingStats()` (penghitung volume saja —
  `live_picks` masih memuat 27 termarking; bukan rasio akurasi), statistik
  slip (mustahil terkontaminasi: `publishSlip` sudah menolak pick
  termarking sejak fix kembar). Status pick tidak diubah (bukan void);
  flag tetap tersimpan; resolver tetap menilai pick termarking.

Tes & validasi (semua berurutan):
- Tes baru `tests/test-cohort-duplikat.ts` (masuk rantai `test:data`):
  **21/21** — membuktikan (i) termarking keluar dari pembilang+penyebut,
  (ii) angka tak termarking tidak berubah, (iii) flag terbaca untuk audit
  + pending termarking tetap di daftar unresolved resolver,
  (iv) statistik berubah sesudah penandaan tanpa baris baru (cache segar).
- `tsc` bersih · lint 91 = baseline · `test:data` hijau penuh
  (publication 110/110, tickets 69/69, slip-stats-pr2 12/12, T02 63/63,
  fdorg 43/43, cohort-duplikat 21/21) · `test:quant` hijau penuh
  (test:model 62/62 di worktree bersih) · `test:web` hijau kecuali
  `test-beranda-pr1b` 35/36 — assertion yang gagal **terbukti identik di
  master murni `8615f43`** tanpa perubahan A3 (signature lama bergantung
  jam; bukan regresi).
- **Bukti atas data produksi** (`ledgerStats`, sebelum vs sesudah kode):
  `live_total` 10.013 → **9.986 (−27 persis)**; per grade A −11, B −10,
  C −6; `live_resolved` 3.067 tetap; hits per grade tetap (905/1009/374)
  — benar, karena ke-27 pick termarking adalah laga malam ini yang belum
  dinilai. Sesudah dinilai pun statistik hanya menghitung sisi sm_.

Redeploy (kedua fungsi dipakai web saat request):
- Backup build lama: `~/workspace/backups/predeploy-a3-20261125/next-old`
  (build `xIA7e-YB403aM2Y99uQwk`).
- Cron `bola-vm-watchdog` di-pause + timer liveness dihentikan selama
  jendela build; build exit 0 → BUILD_ID baru `3kQ9QLjiiuGg5F3n7fy2G`;
  service di-restart.
- Verifikasi ISI (bukan status saja): lokal `/` 200, `/bukti` 200 dan
  menampilkan **"9.986"** (bukan 10.013) + headline "2.288 dari 3.067
  pilihan tepat (74,6%) di 340 laga" (2.288 = 905+1009+374 ✓ konsisten
  dengan filter baru); publik `/` dan `/bukti` 200.
- Cron watchdog diaktifkan lagi; timer liveness jalan lagi.

## FASE A4 — Evaluasi WAL PASSIVE — SELESAI (tanpa mengubah config)

DB pemilik WAL besar terverifikasi: `data/thestats_dataset.db`

- DB: 3.041.361.920 byte · WAL: **1.444.121.832 byte** · shm: 32.768 byte
  · `journal_mode = wal`.
- `PRAGMA wal_checkpoint(PASSIVE)` → **busy = 0, log = 561,
  checkpointed = 561**: seluruh 561 frame ter-flush ke DB utama, tanpa
  blokir writer, tanpa error.
- Ukuran WAL sesudah: **tetap 1.444.121.832 byte** (delta 0) — perilaku
  baku SQLite: PASSIVE menyalin frame dan mengulang penulisan dari awal
  berkas, tidak memotong berkas.
- Tafsir angka: frame aktif hanya 561 × 4 KiB ≈ **2,3 MB**. Jadi 1,44 GB
  adalah alokasi *high-water mark* historis (ledakan tulis masa lalu,
  kemungkinan build telemetri), bukan pertumbuhan aktif; auto-checkpoint
  bawaan terbukti bekerja (hanya 561 frame menggantung).
- **Rekomendasi (berbasis angka di atas saja):**
  1. Checkpoint PASSIVE berkala (mis. di ujung rantai free-refresh) aman
     dan layak ditambahkan: terbukti busy=0, semua frame ter-flush.
  2. Mengembalikan ruang disk 1,44 GB butuh checkpoint **TRUNCATE/
     RESTART satu kali pada jendela sepi** (tanpa reader/writer aktif) —
     keputusan pemilik tersendiri; TIDAK dilakukan di fase ini.
  3. Tidak ada urgensi pertumbuhan: WAL aktif ~2,3 MB.
- Tidak ada config, cron, atau kode yang diubah di fase ini.

## FASE A5 — Hapus branch nyasar — SELESAI

- `git push origin --delete master` berhasil.
- Verifikasi `git ls-remote --heads origin`: `master` tidak ada lagi;
  `main` tetap @ `325b4bc` sebagai satu-satunya branch utama. Branch lain
  tidak disentuh.

---

## Ringkasan akhir

| Fase | Hasil | Bukti kunci |
|---|---|---|
| A1 | ✅ merged | `origin/main` via `8615f43`; T02 63/63 |
| A2 | ✅ aktif | 1.160 snapshot produksi; 3 cron; tiket `fx4_74f7455229fa1abb0164f623` — **dengan temuan generator tak menyaring `duplicate_of`** |
| A3 | ✅ merged + live | commit `325b4bc`; live_total −27 persis; build live `3kQ9QLjiiuGg5F3n7fy2G` |
| A4 | ✅ dievaluasi | PASSIVE busy=0, log=561, checkpointed=561; rekomendasi tertulis, config utuh |
| A5 | ✅ terhapus | `origin/master` hilang; `main` @ `325b4bc` |

Satu-satunya tindak lanjut yang menunggu keputusan pemilik dari paket ini:
**perbaikan kelayakan Fix-4 supaya pick `duplicate_of` tidak masuk tiket**
(temuan A2) — di luar cakupan A1–A5 dan tidak dikerjakan di sini.
A6/R-04 tetap ditahan sesuai instruksi.
