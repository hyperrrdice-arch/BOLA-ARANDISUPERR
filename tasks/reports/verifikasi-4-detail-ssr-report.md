# Verifikasi Produksi — Temuan #4: Detail laga hanya menampilkan fallback saat JavaScript mati

- **Branch:** `fix/verifikasi-produksi` (lanjutan temuan #3, tip dasar `3876415`). **Tidak di-merge, tidak di-deploy, produksi/VPS tidak disentuh.**
- **Sumber temuan:** `Verifikasi-Produksi-Bola-untuk-Muse.md` bagian 4 (pemilik, produksi 21 Nov 2026, build `mb8qnWesaTQ9cIg5djR8j`).
- **Status: SELESAI di branch** — semua instruksi implementasi pemilik terpenuhi dan dibuktikan dengan cara uji pemilik sendiri (Chromium, JS mati, teks terlihat); menunggu keputusan pemilik untuk merge/deploy.

## 1. Akar masalah

Halaman detail membungkus SELURUH isinya dalam satu batas
`<Suspense fallback={<PageLoading label="Memuat analisis laga…" />}>`,
dan isi di baliknya menangguhkan (`params`, `searchParams`, dan
`connection()` di `AnalisisContent`). Di bawah `cacheComponents`,
subpohon yang menangguhkan di balik batas seperti itu dirender
sebagai *lubang dinamis*: dokumen awal memuat shell + fallback,
lalu isi asli dikirim belakangan di dalam segmen `<div hidden>`
disertai skrip penukar bawaan React/Next yang memindahkannya ke
tempat fallback. **Yang dilukis browser adalah fallback-nya; isi
asli hanya menjadi terlihat bila skrip penukar berjalan.** Dengan
JavaScript mati — atau skrip gagal berjalan — penukaran tidak
pernah terjadi: HTTP tetap 200 dan potongan isi memang ada di
HTML mentah (itu sebabnya pencarian string "lolos"), tetapi teks
yang terlihat pembaca hanya "Memuat analisis laga…" selamanya.
Nama tim, kickoff, ringkasan prediksi, dan tabel skor 2D semuanya
terkunci di segmen tersembunyi itu, termasuk tabel 2D PetaSkor
yang render servernya sendiri sebenarnya sehat.

## 2. Reproduksi (cara pemilik, sebelum perbaikan)

Suite beku baru dijalankan terhadap kode yang belum diubah, di
server `next start` atas data sandbox Marseille temuan #2:

- JS mati, kedua URL (`mt_022917440`, `sm_19715544`): HTTP 200,
  teks terlihat (simpul teks berkotak layout, DOMSnapshot) persis
  hanya chrome navigasi + **"Memuat analisis laga…"** — 23 asersi
  merah, persis temuan pemilik.
- JS aktif pada kode yang sama: semua hijau (isi tampil, canvas
  0→1→0, nol permintaan chunk 3D sebelum dipilih) — baseline
  regresi yang bersih untuk dibandingkan sesudah perbaikan.

## 3. Perbaikan (di akar batas Suspense, sesuai instruksi pemilik)

Satu berkas: `app/(terminal)/pertandingan/[matchId]/page.tsx`.

1. **Batas Suspense dicabut.** Komponen halaman kini `async` dan
   merender isi langsung tanpa perantara fallback. Render menunggu
   data — semua bacaan halaman ini sinkron dan lokal (SQLite +
   berkas registri), jadi menunggu adalah harga yang benar dan
   kecil — lalu isi ditulis **sebaris sebagai HTML biasa** dalam
   respons, bukan segmen tersembunyi yang menunggu penukar.
2. **`export const instant = false`.** Percobaan pertama tanpa
   penanda ini ditolak build oleh penjaga cacheComponents
   ("uncached or runtime data … accessed outside of `<Suspense>`
   prevents the route from being prerendered"). Next menawarkan
   tiga jalan keluar resmi; yang sesuai desain ini adalah
   menandai rute sebagai *blocking*: dirender penuh di server pada
   setiap permintaan, tanpa shell prerender + fallback. Dengan
   penanda itu build lolos dan kontraknya eksplisit di kode.
3. Komentar kontrak ditambahkan di kepala berkas + di penanda
   rute, supaya batas ini tidak dipasang lagi tanpa sadar.

Yang TIDAK berubah: seluruh logika render dan data halaman
(termasuk pengelompokan kejadian unik temuan #2 — daftar prediksi
tetap merender `kejadianResmi`), komponen `PetaSkor` (tabel 2D
tetap jalur dasar ter-render server; tombol 3D tetap `import()`
lazy dari handler klik), dan halaman lain. `PageLoading` tetap
dipakai halaman lain; hanya pemakaiannya di halaman ini yang
dicabut (impor dibersihkan).

**Catatan lingkup:** pola batas yang sama masih dipakai `/pilihan`,
`/jadwal`, dan `/bukti` — halaman-halaman itu tidak termasuk
temuan #4 dan tidak diubah di sini (bedah terbatas); bila pemilik
mau, perlakuan yang sama bisa diterapkan sebagai tindak lanjut
terpisah per halaman.

## 4. Bukti sesudah perbaikan (suite beku, cara pemilik)

Suite baru `tests/test-verifikasi-detail-ssr.ts` (+ probe
`tests/helpers/verifikasi4-probe.mjs`) — **37/37 hijau**. Suite
menjalankan build sendiri, merakit panggung `next start` dengan
data sandbox Marseille, dan menilai **teks terlihat dari pohon
layout** (bukan pencarian string HTML mentah):

- **JS mati, URL `mt_`:** HTTP 200; fallback **tidak terlihat**;
  terbaca: "Olympique de Marseille" / "Le Mans", kickoff
  "Senin, 23 November · 02.45 WIB", "Prediksi sebelum laga",
  **"9 pilihan resmi"**, **"Dua sumber berbeda angka"**, "85,5%"
  (OU1.5 terbit), "Kemungkinan skor", keterangan tabel
  "Baris: gol Olympique de Marseille", "Peta menampilkan skor
  0–4 …", skor teratas "2–1 · 7,5%".
- **JS mati, URL `sm_`:** sama, dengan ejaan nama paketnya sendiri
  ("Olympique Marseille") — kedua tautan lama membuka laga yang
  sama dan kini sama-sama terbaca tanpa skrip.
- **JS aktif (tidak regresi):** HTTP 200; "9 pilihan resmi" +
  "Dua sumber berbeda angka" tetap tampil (konsistensi temuan
  #2 di permukaan ter-render); tabel 2D tampil sejak awal;
  canvas **0** sebelum 3D dipilih dan **nol permintaan** chunk
  3D; memilih 3D memicu permintaan chunk baru dan canvas **0→1**;
  kembali ke 2D → canvas **0**; tanpa pageerror. Kontrak §9 utuh.

## 5. Regresi penuh (keadaan akhir branch)

| Suite | Hasil |
|---|---|
| test:quant | 138/138 |
| test:data | 278/278 |
| test:web | 395/396 — hanya **U02** (bawaan master, lihat catatan) |
| test:api | 42/42 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| redesain-keandalan | 67/67 |
| redesain-repro | 32/32 |
| verifikasi-genclerbirligi (temuan #1) | 39/39 |
| verifikasi-marseille-detail (temuan #2) | 36/36 |
| verifikasi-pilihan-payload (temuan #3) | 41/41 |
| verifikasi-detail-ssr (temuan #4, baru) | **37/37** |
| `tsc --noEmit` | bersih |
| `npm run build` | bersih (rute detail terdaftar; build juga dijalankan di dalam suite #4) |
| `npm run lint:gate` | LOLOS — 91 error ≤ baseline 92, tanpa error baru |

**Catatan U02:** satu-satunya kegagalan test:web tetap
`test-ui` "U02: status asing tetap unknown" — gagal identik di
master murni `a7bc8cb` dan di semua branch temuan sebelumnya;
tidak diperbaiki di sini (di luar lingkup) dan terkonfirmasi
**tidak bertambah** (tetap tepat satu).

## 6. Sisa risiko & catatan

- **Produksi belum berubah** sampai pemilik memutuskan merge +
  deploy. Sesudah deploy, semua halaman detail (bukan hanya
  Marseille) terbaca penuh dengan skrip mati.
- **Konsekuensi yang disadari:** halaman detail tidak lagi
  menayangkan shell seketika — respons menunggu rakitan data
  lokal selesai (orde milidetik di SQLite lokal; gerbang
  `connection()` tetap menjamin data per-permintaan, tidak ada
  cache halaman yang basi). Navigasi antar-halaman ke detail
  menjadi navigasi blocking, sesuai penanda `instant = false`.
- Uji Android fisik, pembaca layar nyata, dan INP lapangan tetap
  terbuka seperti dicatat pemilik — di luar jangkauan VM ini.

## 7. Commit di branch ini (temuan #4)

1. `8f5835b` — test(verifikasi): suite beku temuan #4 (reproduksi; 23 asersi merah pra-perbaikan).
2. `e6da05b` — fix(detail): render isi sebaris di HTML — cabut batas Suspense + `instant = false`.
3. `f3870c3` — test(verifikasi): matangkan suite #4 (teks terlihat per elemen induk; nama per paket) — 37/37.
4. Commit laporan ini.
