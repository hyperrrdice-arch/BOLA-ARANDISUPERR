# Laporan K8 — Kinerja & Penerimaan Rilis (kartu terakhir)

- **Kartu:** K8 (PRD Peningkatan Aplikasi Bola, bab QA — daftar periksa
  penerimaan, anggaran performa, migrasi/peluncuran/rollback)
- **Branch:** `prd/k8-penerimaan-rilis` (bertumpuk di atas K7, belum merge)
- **SHA kandidat beku:** `5d94d4c` (tip `prd/k7-pilihan-rekam`);
  artefak rilis K8 masuk di `a5334a9`; laporan ini commit sesudahnya.
- **Tanggal:** 2026-11-20 · Node v24.22.1 · VM Hikari (1,5 CPU bersama,
  6 GB) — semua angka durasi/latensi adalah angka VM ini.
- **VONIS: SIAP RILIS.** Seluruh gerbang berdefinisi-lulus LULUS; tiga
  catatan terbuka ditulis apa adanya di §6 (anggaran performa usulan,
  uji kontrak HTTP endpoint, checklist pemilik menunggu deploy).
- **Tidak dijalankan di kartu ini (sesuai urutan pemilik):** merge ke
  master, migrasi database produksi, deploy, login server. Produksi
  dibuktikan tidak disentuh: sha256 keempat DB checkout utama VM
  **identik sebelum dan sesudah** seluruh pekerjaan K8
  (`k8-acceptance/prod-sha256-{before,after}.txt` di sandbox bukti).

## 1 · Regresi penuh kandidat beku

Dijalankan dua kali — dari kandidat `5d94d4c` dan dari tip final
`a5334a9` (sesudah artefak rilis masuk) — hasil identik:

| Perintah | Exit | Assertion |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | — |
| `npm run test:quant` | 0 | quant 22/22 + model 61/61 + experiment-stats 23/23 = 106 |
| `npm run test:data` | 0 | data 18/18 + identity 58/58 + publication 89/89 + tickets 69/69 = 234 |
| `npm run test:web` | 0 | web 12/12 + ui 66/66 + rekam 110/110 = 188 |
| `npm run test:e2e` | 0 | 7/7 |
| `npm run test:baseline:d01` | 0 | 12/12 |
| `npm run build` (env placeholder CI dari `.env.example`) | 0 | — |
| **Total** | | **547 assertion, semua lolos** |

`npm run lint`: exit 1 — **92 error + 5 warning**, jumlah error identik
dengan basis `b9b3871`; pemeriksaan per file membuktikan **nol** error di
file yang dibuat/diubah K1–K7 (seluruhnya di file warisan `app/api/*`,
`lib/agent/*`, skrip lama). Utang lama, bukan regresi; langkah lint CI
memang dipasang terlihat sejak K0.

Daftar periksa terisi item per item (D01–D09, Q01–Q04, U01–U08, gerbang
rilis) ada di `tasks/reports/k8-release-checklist.md` — semua baris
berdefinisi-lulus berstatus **LULUS** dengan penunjuk bukti per kartu.

## 2 · Bukti yang dirujuk (ringkas)

- D01–D04 → suite identity + laporan K1; D05–D08 → suite publication +
  laporan K2; D09 → suite tickets + laporan K3; Q01–Q04 → suite
  quant/model/tickets + laporan K4 (paritas Σ|Δp| = 0); eksperimen →
  laporan K5 (desain beku `14dfff5`, keputusan RETAIN); U01–U03 → suite
  ui + laporan K6 (overflow 9/9); U04–U08 → suite rekam + laporan K7
  (peramban 88 OK/0 gagal; spot-check halaman = SQL mentah).

## 3 · Rehearsal migrasi (salinan segar, berurutan seperti rencana deploy)

Sandbox `~/workspace/coding/k8-rehearsal/` — salinan konsisten
(`sqlite3 .backup`) dari DB **checkout utama VM** (bukan bacaan server
produksi), komposisi direktori data lengkap seperti produksi
(4 DB + `fixture-links.json` + `team-canonical.json`). Kode migrasi yang
dijalankan = kandidat K8; `git log` membuktikan `publication-migration.ts`
tidak berubah sejak K2.

**Keadaan sebelum:** dataset 71.503 laga (semua finished), tabel identitas
belum ada; picks 170.813 baris, kolom/tabel publikasi belum ada;
`integrity_check` picks = ok; full `integrity_check` dataset salinan
backup = **ok** (810 dtk, latar).

| Tahap | Durasi | Hasil |
|---|---|---|
| Backup konsisten 4 DB | ±31 dtk | dataset 3 GB = 29 dtk darinya |
| K1 jalan 1 | 49 dtk | 71.503 → **70.420 fixture**, **71.832 alias**, **70.279 revisi**, **32 konflik** masuk antrean |
| K1 jalan 2 | 16 dtk | already_registered 70.420; 0 dibuat/ditaut/backfill/antre — **idempoten** |
| K2 jalan 1 | **762 dtk** | 170.813 baris: **7.805** basis `effective`, **163.008** `unknown_legacy`, **468** duplikat tertanda, UID ter-resolve 165.279 / tak ter-resolve 5.534; `integrity_check` (bawaan CLI) = ok |
| K2 jalan 2 | 4 dtk | processed 0, already_migrated 170.813 — **idempoten** |

Sesudah K1: baris `matches` tetap 71.503; antrean = 32 baris, semua
`conflicting_scores`, semua belum ter-resolve; `quick_check` dataset = ok.

**Perbandingan vs bukti K1/K2 + penjelasan selisih (tidak disamakan paksa):**
- K1: angka **identik persis** dengan bukti K1 (70.420 / 71.832 / 70.279 /
  32) — dataset checkout tidak berubah isinya sejak bukti K1. Durasi
  49 vs 34,4 dtk = beban VM berbeda.
- K2: total baris 170.813 vs 170.782 (**+31** — baris live-run baru dari
  refresh 12-jam sesudah bukti K2 dibuat). `unknown_legacy` **identik
  163.008**; `effective` 7.805 = 7.774 + **tepat 31** baris baru itu.
  Selisih nyata: UID ter-resolve 165.279 vs 164.202 (+1.077) dan duplikat
  tertanda 468 vs 0. Penyebab terverifikasi: sandbox bukti K2 hanya berisi
  3 file DB, sedangkan rehearsal ini meniru direktori data produksi
  lengkap (`fixture-links.json` + `team-canonical.json` ikut) → lebih
  banyak UID ter-resolve → grup duplikat (yang kuncinya fixture_uid) baru
  terdeteksi. Kode migrasi tidak berubah; arah selisih jinak (penandaan
  saja, tidak ada baris dihapus/diubah nilainya).
- Durasi K2 762 dtk diukur **di bawah beban** dua pemindaian integrity
  paralel — perlakukan sebagai batas atas; tetap tiang terpanjang rencana
  deploy (jendela ≥ 30 menit dicadangkan di catatan rilis).

## 4 · Latihan rollback (terukur, tingkat salinan)

Dari keadaan pasca-migrasi: pulihkan seluruh DB dari backup pra-migrasi
ke direktori baru + checkout artefak rilis sebelumnya (`b9b3871`) +
verifikasi. **Total ujung-ke-ujung 103 dtk** — restore ±1 dtk (cache
hangat; pembuatan backupnya sendiri 31 dtk), checkout 2 dtk, sisanya
verifikasi (`integrity_check` picks = ok di bawah beban). Keadaan
pra-migrasi terkonfirmasi pulih persis: picks 170.813 baris, kolom
`probability_basis` absen, tabel identitas absen, `matches` 71.503.
Komponen build ulang terukur sesi ini: `npm ci` 28 dtk, `npm run build`
59 dtk. Rencana rollback deploy lengkap (urutan, titik keputusan,
durasi terukur vs perkiraan VPS) ada di catatan rilis
`tasks/reports/k8-release-notes.md` §Rollback.

## 5 · Pengukuran anggaran performa (protokol bab QA)

Harness sandbox (bukan kode aplikasi) di salinan rehearsal termigrasi,
metode hitung sesuai bab QA ("hitung seluruh store yang disentuh"):

- **Jadwal (`listSchedule`, sesudah store terbuka):** jendela 46 item →
  **387 eksekusi SQL** (16 ms); 62 item → **395** (442 ms); 84 item →
  **620** (741 ms). Usulan bab QA ≤ 8 → **tidak terpenuhi**; pola N+1 per
  item lintas store, struktural.
- **Baca statistik (`cohortStats`, 10 pemanasan + 100 run):** tanpa
  filter (170.813 baris) median **342,9 ms** / p95 **393,8 ms** → di luar
  usulan (≤100/≤150 ms). Terfilter: grade A **78,2 / 87,7 ms**; sumber
  `live-run` **28,8 / 39,5 ms** → di dalam usulan. Cross-check kebenaran:
  filter `live-run` memberi issued 7.805 / settled **1.321** — persis
  angka ledger live yang dikenal.
- Konteks: VM pengukuran 1,5 CPU bersama vs VPS produksi 6 vCPU/16 GB —
  latensi wajib diukur ulang sesudah deploy; jumlah eksekusi SQL tidak
  berubah oleh hardware.

## 6 · Catatan terbuka (tidak dihaluskan)

1. **Anggaran performa berstatus usulan** di bab QA tidak terpenuhi pada
   dua dari tiga pengukuran (§5). Bukan gerbang berdefinisi-lulus, tapi
   risiko rilis nyata: kartu optimasi lanjutan direkomendasikan
   (statement cache / kueri gabungan per item; indeks/agregasi untuk
   cohort tanpa filter).
2. **Uji kontrak HTTP empat endpoint** `app/api/{agent,betting,matches,odds}`
   tidak ada di suite mana pun; yang teruji adalah adapter di bawahnya
   (`test:web`). Route warisan basis, tidak diubah K1–K7.
3. **Checklist penerimaan pemilik** (4 item bab QA) belum dijalankan —
   memang menunggu hasil ter-deploy, sesuai urutan pemilik.
4. **32 konflik `identity_ambiguous`** menunggu peninjauan pemilik
   (semua `conflicting_scores`, belum ter-resolve; sistem tidak menebak).
5. **Refresh-sync:** perbaikan telemetri VPS belum masuk repo (menunggu
   patch/SHA tersanitasi pemilik); `ARCHITECTURE.md` §8/§10 belum
   disinkronkan. Mandiri dari rilis ini.
6. Full `integrity_check` dataset **kerja** pasca-K1 masih berjalan di
   latar saat laporan ini ditulis (VM bersama; salinan backupnya selesai
   = ok, `quick_check` pasca-K1 = ok, hitungan persis). Dicatat apa
   adanya, bukan diklaim selesai.

## 7 · File berubah & cara kembali

- Baru: `tasks/reports/k8-release-checklist.md`,
  `tasks/reports/k8-release-notes.md`, laporan ini. **Tidak ada perubahan
  kode aplikasi, skema, atau perilaku K1–K7 di kartu ini** (kartu
  penerimaan). Bukti mentah rehearsal/pengukuran tinggal di sandbox
  `~/workspace/coding/k8-rehearsal/` + `~/workspace/coding/k8-acceptance/`
  (di luar repo).
- Cara kembali: branch ini tidak di-merge; mengabaikannya mengembalikan
  keadaan persis ke tip K7. Rehearsal tidak menyentuh produksi (sha256
  identik, §pembuka).

## 8 · Belum terbukti / langkah berikut (di luar kartu ini)

Deploy hasil branch ke domain → migrasi produksi nyata (angka mengikuti
data live saat itu; cadangan jendela K2 ≥ 30 menit) → peninjauan pemilik
(checklist 4 item) → merge ke master → PDF rangkuman K1–K8. Ukur ulang
latensi di VPS pada minggu pertama; putuskan kartu optimasi performa.
