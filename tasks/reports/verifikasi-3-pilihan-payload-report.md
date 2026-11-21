# Verifikasi Produksi — Temuan #3: Muatan Awal /pilihan

Branch: `fix/verifikasi-produksi` · Basis: tip temuan #2 (`18b27bc`)
Status: **SELESAI di branch — belum merge, belum deploy** (sesuai instruksi).

## 1. Temuan & akar masalah

Terukur pemilik di produksi (21 Nov 2026, 16.56 WIB): dokumen awal
`/pilihan` mengirim **2.718 rekaman pilihan + 388 matriks skor lengkap
(84.081 nilai)** — **989.837 byte ditransfer / 3.500.284 byte sesudah
dekompresi** — padahal tampilan awal hanya memperlihatkan 20 laga.

Akar: `app/(terminal)/pilihan/page.tsx` lama memanggil
`daftarPilihanPraLaga()`, lalu untuk SETIAP paket memanggil
`getPackageMatrix()` dan meneruskan seluruh hasilnya sebagai props ke
komponen klien. Matriks hanya benar-benar dibutuhkan untuk irisan
gabungan dua kejadian dalam satu laga — bukan untuk membuka daftar.

## 2. Perbaikan

### Modul umpan bersama — `lib/web/pilihan-umpan.ts`
Satu sumber kebenaran untuk halaman server maupun route API:
- `saringUmpan()` — semantik saringan persis perilaku lama (kelas
  A+B / A / semua → tanggal via `kunciTanggal` → teks lipatan aksen
  atas home/away/nama kompetisi), kini berjalan di server atas
  SELURUH umpan.
- `kelompokkanPilihan()` — kelompok per `fixtureUid` urutan umpan,
  dalam kelompok terurut probabilitas menurun.
- `halamanUmpan(umpan, filter, offsetLaga, batasLaga=20)` —
  `{ pilihan, totalPilihan, totalLaga }`; offset/batas dalam satuan
  KELOMPOK laga, kelompok tidak pernah terpotong.
- `pulihkanDariUmpan()` — jembatan draf: memetakan umpan ke bentuk
  `pulihkanDraf` (`lib/web/draf.ts`, tidak diubah) dan kembali,
  tanpa membocorkan field internal ke respons.

### Endpoint baru
| Route | Perilaku |
|---|---|
| `GET /api/pilihan?kelas&q&tanggal&offset&batas` | Satu halaman kelompok (baku 20) + total terfilter. Offset/batas dalam kelompok; batas dijepit 1–100. |
| `GET /api/pilihan/matriks?paket=1,2,3` | Batch matriks per id paket (duplikat melebur, maks 24 id). Paket tak dikenal / tanpa matriks → `null` per id, tidak pernah error. |
| `POST /api/pilihan/pulih` | Badan `{entri:[{pickUid, kunciSemantik}]}` (maks 12 entri = batas draf). Mengembalikan pilihan yang pulih (urutan draf) + jumlah `hilang`. Badan rusak → 400. |

### Klien — `ParlayBuilder.tsx` (bedah terarah, render/teks/matematika utuh)
- Props awal hanya halaman pertama + total; daftar berikutnya diambil
  per halaman dari server (tombol "Muat 20 laga lagi", saringan kelas/
  tanggal, pencarian debounce 300 ms). Respons basi dibuang (penjaga
  nomor urut); kegagalan muat mempertahankan daftar terakhir + catatan
  `role=alert`.
- Matriks **lazy**: status cache `packageId → matriks | null` +
  himpunan "sudah diminta" (tidak pernah diminta ulang). Permintaan
  hanya terbit untuk laga dengan ≥ 2 pilihan AKTIF terpilih, dibatch
  dalam satu panggilan; dipicu dari satu-satunya titik mutasi seleksi
  dan dari penyelesaian pemulihan draf. Pilihan tunggal tidak pernah
  memicu matriks (probabilitas tersimpan dipakai `combineSlip`).
- Pemulihan draf kini lewat server: entri localStorage dikirim ke
  `/api/pilihan/pulih`; yang pulih diterapkan + draf ditulis ulang
  tanpa yang hilang; matriks yang perlu diambil lazy. Penjaga: respons
  pulih yang terlambat TIDAK menimpa seleksi yang dibangun manual di
  tab yang sama; kegagalan jaringan membiarkan localStorage utuh
  (dicoba lagi kunjungan berikutnya).
- Kegagalan satu paket (route mengembalikan `null` atau fetch gagal →
  dicatat `null`) mengalir ke jalur lama `combineSlip`: gabungan
  "tidak tersedia" + alasan "matriks skor tidak tersedia untuk irisan
  satu laga" → UI menampilkan **"Peluang gabungan belum tersedia"**.
  Selama matriks masih dalam perjalanan, panel menampilkan pesan yang
  sama secara sesaat sampai respons tiba (keputusan sadar: tidak ada
  angka karangan di antaranya).

## 3. Temuan samping (terukur, diperbaiki): gzip ganda `lib/http-json`

Saat probe browser pertama, `fetch().json()` ke route baru melempar
SyntaxError. Pengukuran lapis demi lapis di server panggung
(`next start`, Next 16.4.6 — perintah yang sama dengan produksi):

- Respons JSON ≥ 1 KB dari `jsonResponse` tiba sebagai
  **gzip(gzip(JSON))** dengan SATU header `Content-Encoding: gzip` —
  gzip manual helper dikompresi lagi oleh server. Klien standar
  (browser, undici) membuka satu lapis lalu gagal parse.
- Respons < 1 KB (JSON polos dari helper yang sama) tiba dengan
  tepat satu lapis gzip dari server — bukti server memang
  mengompresi route handler, sehingga premis lama helper
  ("route handler TIDAK dikompresi server") tidak lagi berlaku.

Perbaikan (`87183d9`): `jsonResponse` tidak lagi meng-gzip manual;
body selalu JSON polos, kompresi satu lapis oleh server. Tanda tangan
dan header `Vary: Accept-Encoding` dipertahankan. Sesudah perbaikan,
route baru terukur tepat 1 lapis dan parse normal. Route lama memakai
helper yang sama — payload ≥ 1 KB mereka diduga terdampak sama dan
ikut terperbaiki, tetapi di panggung ini hanya route baru yang
terukur ujung-ke-ujung (tabel seed panggung tidak mengisi tabel yang
dibaca route lama).

## 4. Pengukuran sebelum/sesudah (fixture yang sama)

Panggung skala deterministik (`tests/helpers/verifikasi3-stage-seed.ts`,
seed 20261121): 390 laga, 2.751 pilihan, 370 paket bermatriks 15×15
(83.061 nilai) — seorde produksi (2.718 / 388 / 84.081).

| Ukuran | Sebelum | Sesudah | Faktor |
|---|---:|---:|---:|
| Props JSON halaman (mentah) | 3.028.757 B | 47.883 B | 63× |
| Props JSON halaman (gzip) | 824.464 B | 2.616 B | 315× |
| Dokumen HTTP /pilihan (mentah) | 3.304.092 B | 137.682 B | 24× |
| Dokumen HTTP /pilihan (gzip, transfer) | 836.932 B | 14.183 B | 59× |
| Matriks terkirim saat buka daftar | 370 | **0** | — |
| Nilai matriks terkirim | 83.061 | **0** | — |
| Pilihan terserialisasi di dokumen awal | 2.751 | halaman pertama (20 kelompok) | — |

Angka gzip props sesudah sangat kecil karena data sintetik panggung
sangat berulang; angka dokumen HTTP adalah angka utama yang sebanding
dengan pengukuran produksi pemilik (3.500.284 / 989.837).

## 5. Bukti perilaku

**Suite beku baru** `tests/test-verifikasi-pilihan-payload.ts` —
**41/41**: halaman awal tepat 20 kelompok + total terfilter dengan nol
matriks (rakitan lama pada fixture sama membawa 30 matriks / 500
nilai); Køge di kelompok ke-26 ditemukan pencarian server (termasuk
lipatan aksen); route matriks hanya mengembalikan paket yang diminta
(null untuk tanpa-matriks/asing); matematika lewat jalur lazy persis
**52,9%** (dua kejadian satu laga dari matriks bersama) dan **46,1%**
(+ satu lintas laga); matriks null → tidak tersedia + alasan; pulih
server cocok `pick_uid` + kunci semantik, asing terhitung hilang,
badan rusak → 400.

**Probe browser** `tools/pwshot/verifikasi3-probe.mjs` terhadap build
produksi + panggung:
- Mode `skala` — **20/20**: buka daftar = 20 kelompok, **0 permintaan
  matriks, 0 permintaan daftar** (props server), total tampil = total
  API (2.197 pilihan · 390 laga); muat lagi → 40 kelompok dari server;
  pencarian "koge" menemukan Køge (laga ke-300); 1 pilihan = 76,1%
  tanpa matriks; 2 pilihan satu laga memicu **tepat 1** permintaan
  matriks berkelompok → 52,9%; tambah lintas laga → 46,1% tanpa
  permintaan baru; lepas-pasang memakai cache (tetap 1 permintaan);
  muat ulang → draf pulih 3 pilihan / 46,1%; matriks dipaksa 500 →
  "Peluang gabungan belum tersedia", nol pageerror; matriks ditahan
  2,5 dtk → tidak crash, tidak mengarang angka, 52,9% muncul
  sesudahnya.
- Mode `langkah5` (padanan probe 45/45 langkah 5 pada panggung
  redesain-5) — **12/12**: total terfilter 37 pilihan · 25 laga,
  paginasi 20 → 25, pencarian menemukan laga di luar 20 pertama,
  regresi panel 52,9% → 46,1%, draf persisten sesudah muat ulang,
  hapus persisten, batas 12 + pesan persis "Maksimal 12 pilihan. Hapus
  satu untuk menambah yang lain.", Kosongkan mengosongkan draf.

## 6. Regresi penuh (keadaan akhir branch)

| Suite | Hasil |
|---|---|
| test:quant (4 berkas) | 138/138 |
| test:data (5 berkas) | 278/278 |
| test:web — test-web | 12/12 |
| test:web — test-ui | 73/74 — hanya **U02** (kegagalan bawaan master, identik di `a7bc8cb`; tidak disentuh, tidak bertambah) |
| test:web — rekam / detail-render / fix6 | 110/110 · 27/27 · 25/25 |
| test:web — redesain jadwal / peta / pilihan-rekam | 35/35 · 50/50 · 41/41 |
| redesain-keandalan (4 sub-suite) | 67/67 |
| redesain-repro (3 sub-suite) | 32/32 |
| test:api (kontrak) | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| verifikasi #1 Gençlerbirliği | 39/39 |
| verifikasi #2 Marseille detail | 36/36 |
| verifikasi #3 (baru) | 41/41 |
| tsc --noEmit | bersih |
| npm run build | bersih (route /api/pilihan, /matriks, /pulih terdaftar dinamis) |
| lint:gate | LOLOS — 91 error ≤ baseline 92, tanpa error baru |

## 7. Commit

| SHA | Isi |
|---|---|
| `a0b7d6b` | test: panggung skala + pengukur muatan (pengukuran SEBELUM) |
| `02c902b` | feat: modul umpan bersama + API halaman/matriks/pulih |
| `5fc28d8` | feat: muatan awal ringkas + matriks lazy + pulih server di klien |
| `d12207a` | test: suite beku temuan #3 (41/41) |
| `87183d9` | fix(http-json): hentikan gzip manual (gzip ganda terukur) |
| (laporan ini) | docs: laporan verifikasi-3 |

## 8. Sisa risiko / catatan

- Rantai produksi (Caddy + tunnel) tidak diukur ulang di sini —
  tidak ada deploy sesuai instruksi; verifikasi transport dilakukan
  pada `next start` lokal yang identik perintahnya dengan produksi.
- Selama matriks lazy dalam perjalanan, panel menampilkan
  "Peluang gabungan belum tersedia" secara sesaat. Ini disengaja
  (tidak ada angka karangan); bila pemilik ingin penanda "memuat"
  khusus, itu perubahan teks terpisah.
- Temuan #4 (detail tanpa JavaScript) belum dikerjakan — di luar
  tugas ini, menunggu giliran sesuai urutan pemilik.
