# Laporan Langkah 6 Redesain — Pemeriksaan Akhir (Brief §7 + §8 baris 6 + §9)

**Status: SELESAI — vonis SIAP MERGE menurut bukti di bawah.** Branch
`redesain/bola`, SHA akhir yang diperiksa **`0592cc4`** (tip langkah 5;
langkah 6 adalah verifikasi — tidak ada perubahan kode produk). Tanpa
merge, tanpa deploy, tanpa menyentuh DB produksi / VPS / κ / Fix-4.

Bukti render: folder pasangan laporan ini
(`tasks/reports/redesain-6-pemeriksaan-akhir/`) — tangkapan "sesudah"
378 px untuk lima halaman + beranda 1440 + kasus khusus. Tangkapan
"sebelum" dirujuk dari laporan langkah 1
(`tasks/reports/redesain-1-reproduksi/`, build basis `ef9b67c`).

Lingkungan ukur (apa adanya): VM Hikari (CPU bersama 1,5 / RAM ±6 GB,
tanpa GPU), Chromium headless `@sparticuz/chromium` + puppeteer-core,
server `next start` build produksi di localhost dengan data panggung
langkah 5 (`redesain5-stage-seed`) dan panggung Marseille jalur produksi
(lihat §3). Angka kinerja adalah angka LAB di lingkungan ini — bukan
pengukuran lapangan.

---

## 1. Perintah §8.6 — dua putaran, hasil identik

| Perintah | Putaran 1 | Putaran 2 (sesudah `rm -rf .next`) |
|---|---|---|
| `npm run lint` | exit 1 — 91 error, 8 warning (utang baseline; berkas baseline mencatat 92 error, satu error menyusut di `DataBall3D.tsx`) | exit 1 — sama |
| `npm run lint:gate` | **exit 0** — tidak ada error baru di luar baseline | **exit 0** |
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `npm run test:quant` | exit 0 — 138 (quant 22 + model 61 + artefak 32 + experiment-stats 23) | exit 0 — 138 |
| `npm run test:data` | exit 0 — 278 (data 18 + identity 58 + publication 110 + tickets 69 + resolver-score 23) | exit 0 — 278 |
| `npm run test:web` | exit 0 — 396 (web 12 + ui 74 + rekam 110 + detail-render 27 + fix6 25 + jadwal 35 + peta 50 + pilihan-rekam 63) | exit 0 — 396 |
| `npm run test:e2e` | exit 0 — 7 | exit 0 — 7 |
| `npm run test:baseline:d01` | exit 0 — 12 | exit 0 — 12 |
| `npm run build` | exit 0 | exit 0 |

**Total assertion daftar §8.6: 831 per putaran, hijau di kedua putaran
(1.662 total).** BUILD_ID berbeda antar putaran
(`AjsCh4nLgVEto3D00r0ct32` → `e8O36xbSdlJD5X8220k4k`) — ID acak Next,
bukan perbedaan isi.

Suite tambahan di luar daftar §8.6 (putaran 2, semua exit 0):
`test:api` 42/42, `test-redesain-keandalan` 44/44,
`test-redesain-repro` 32/32.

Catatan lint: exit 1 pada `npm run lint` adalah keadaan baseline yang
sudah tercatat sejak K8/Fix-6 (92 error warisan, kini 91) — gerbang
proyek adalah `lint:gate`, dan ia lolos di kedua putaran. Tidak ada
error lint yang lahir dari kode redesain.

## 2. Perjalanan inti di browser (build putaran 2, 378 px)

Probe `redesain6-probe.mjs` (67 cek) + `redesain6-probe2.mjs` (10 cek) +
`redesain6-probe3.mjs` (klik baris persis). Hasil akhir per kelompok:

**Pemeriksaan pemilik §8 — LULUS semua.**
- Beranda: sorotan terbaca dari layar — "Malam ini" (jam uji 05.03 WIB,
  sesuai jendela §3A), panel gelap **07.59 WIB · Indian Super League ·
  Bengaluru FC / Mumbai City · "Bengaluru FC mencetak gol" 76,1% ·
  Terbit 02.59 WIB** + tombol Baca analisis. Tangkapan
  `sesudah-beranda-378.png` cocok dengan lembar 1 PDF.
- Satu ketukan Baca analisis → detail laga yang sama; kejadian +
  peluang saat terbit + cap waktu terbit terbaca; tanpa pageerror.
- Pilihan: susun 2 pilihan → bilah "Lihat 2 pilihan" → **muat ulang →
  draf pulih** (2 Terpilih).
- Rekam hasil: tab default **Sudah dinilai**; ringkasan dua kalimat
  dengan penyebut terbaca; filter 19 Nov → keadaan **0/74** terbaca
  ("Belum ada pilihan yang sudah dinilai" + "74 pilihan masih
  menunggu" + aksi "Lihat 74 yang menunggu").

**Regresi Marseille ujung-ke-ujung — LULUS di jalur produksi.**
Probe pertama memakai panggung reproduksi langkah 1 — yang memang
dibangun dengan `fixture-links.json` kosong + registry belum gabung
untuk membuktikan bug lama — dan di sana browser menampilkan 2 grup
(keadaan reproduksi, bukan jalur produksi). Panggung kemudian dibangun
ulang persis jalur produksi: registry gabung
(`registry-tim-gabung.json`) + `scripts/build-fixture-links.ts`
menghasilkan tautan `mt_022917440 → sm_19715544`. Di panggung itu:
daftar menampilkan **satu laga** ("8 pilihan · 1 laga" — 16 pick mentah
melebur), dan klik Tambah pada baris **"Minimal dua gol"** menghasilkan
panel **"1 pilihan dari 1 laga", gabungan 85,5%** — persis penerimaan
§7. Jalur yang sama terbukti di suite keandalan (44/44).

**Penemuan laga §7 — LULUS.**
Cari "koge" pada jendela default (hari ini) tidak menemukan Køge
karena laga Køge berada di jendela **Besok** (+29 jam dari seed) —
pencarian memang terikat himpunan filter aktif sesuai §3B.4. Sesudah
memilih Besok: **Køge BK ketemu** (lipatan aksen bekerja), tautan
detail membuka, tombol **Kembali memulihkan kueri + konteks jendela**
(URL memuat `mode=besok`, daftar kembali menampilkan Køge).

## 3. Layar & akses §7

| Item | Hasil |
|---|---|
| Gulir horizontal | **Nol** di 320 / 378 / 390 / 768 / 1440 px + mendatar 800×360, pada `/`, `/pertandingan`, `/pilihan`, `/bukti` |
| Target sentuh | Navigasi bawah 4 tujuan **52 px** tinggi; tombol Tambah **44×67 px** (sampel 5) — ≥44 px ✓ |
| Panel Pilihanmu | Fokus masuk ke Tutup saat dibuka; **Escape menutup + fokus kembali ke pemicu** ("Lihat 3 pilihan") |
| Keyboard | 10 pemberhentian Tab pertama di jadwal semua berfokus terlihat: outline **3 px solid** (token fokus) |
| Gerak minimum | `prefers-reduced-motion: reduce` aktif → durasi animasi/ transisi bilah terukur **1e-05s (0,01 ms)** — nilai pemutus gerak; perubahan seketika ✓ (ambang probe pertama terlalu sempit; nilai terukurnya dicatat apa adanya) |
| Teks 200% | Disimulasikan dengan zoom peramban 2× pada lebar CSS 378: beranda tanpa gulir horizontal ✓ |
| Kontras (token terukur) | Tinta/kertas **14,52:1**; sekunder #4E5B56/kertas **6,63:1**; kertas/panel gelap **13,82:1**; sekunder panel #C8D6C9/gelap **9,82:1** — semua ≥4,5:1 |
| Nama panjang / awalan sama | Køge BK vs Næstved BK tampil utuh di daftar & hasil cari ✓ |
| Skor dua digit | **BELUM DIJALANKAN di browser** — tidak ada fixture skor dua digit di data panggung; tata letak memakai angka tabular + baris bertumpuk (bukti), tetapi tidak diklaim lulus |
| Perangkat Android fisik | **BELUM DIJALANKAN** — tidak ada perangkat fisik di VM |
| Pembaca layar (AT nyata) | **BELUM DIJALANKAN** — tidak ada AT di VM; yang teruji: peran ARIA tab, aria-live, label, dan alur fokus keyboard di atas |

## 4. Kinerja & isi awal §7 + beban §9

- **HTML awal dari server:** beranda (39.411 byte) sudah memuat nama
  klub sorotan (Bengaluru) — tim + jam dirender server ✓. `/pilihan`
  HTML awal memuat **tepat 20 grup laga** (paginasi §3D) ✓.
  `/pertandingan` HTML awal memuat tautan detail ✓.
- **Chunk 3D:** berkas chunk Three.js/peta pada build ini
  `1fa7pm9g_s568.js` = **137.810 byte gzip (±134,6 KiB) ≤ 180 KiB** ✓.
  **0 request** chunk itu di kelima rute sebelum pembaca memilih 3D
  (beranda 27 request total, jadwal 29, pilihan 22, bukti 21 — tak
  satu pun chunk 3D; HTML awal kelima rute juga bersih). Di detail,
  chunk diminta **tepat 1× saat tombol 3D ditekan** ✓.
- **LCP/CLS lab** (median 3 run, cache dinonaktifkan, localhost VM):
  beranda LCP **1.128 ms** (run 1.080/1.128/1.428), CLS **0**;
  pilihan LCP **1.048 ms** (1.084/1.048/1.040), CLS **0**. Di bawah
  target lapangan §7 (LCP ≤2,5 dtk, CLS ≤0,1) — tetapi ini lab lokal
  tanpa jaringan nyata; **INP lapangan BELUM DIJALANKAN** (tidak ada
  data lapangan).
- **Siklus 3D §9:** 0 canvas sebelum dipilih → tepat 1 sesudah;
  render **diam** saat tak ada perubahan (dua tangkapan elemen canvas
  identik — pengukuran probe pertama memakai klip di luar viewport dan
  diulang dengan tangkapan elemen sesudah `scrollIntoView`); **Putar
  ke kanan mengubah tampilan**, lalu diam lagi; buka-tutup 5× → canvas
  kembali **0**; pindah laga saat impor chunk belum selesai → tidak
  ada canvas nyangkut, tanpa error; tab disembunyikan lalu kembali →
  canvas tetap 1, tanpa error; **WebGL diblokir → pesan "Tampilan 3D
  belum tersedia di sini" + tabel 2D tetap bisa dipakai**, 0 canvas.

## 5. Sebelum / sesudah

- Sebelum (basis `ef9b67c`, dari laporan langkah 1):
  `redesain-1-reproduksi/pilihan-gabungan-378.png` (Marseille terhitung
  dua, gabungan 73,2%), `detail-rostov-378.png`,
  `detail-barcelona-378.png`, `bukti-19nov-378.png` (200 baris "Belum
  mulai" mendahului hasil).
- Sesudah (build akhir, folder laporan ini): `sesudah-beranda-378.png`,
  `sesudah-beranda-1440.png`, `sesudah-jadwal-378.png`,
  `sesudah-detail-378.png`, `sesudah-pilihan-378.png`,
  `sesudah-bukti-378.png`, `sesudah-marseille-produksi-378.png`,
  `sesudah-3d-putar-378.png`, `sesudah-webgl-gagal-378.png`.
- Beranda sesudah cocok dengan lembar 1–2 PDF (panel gelap, jam jingga,
  nama rapat, tombol jingga); pilihan + bukti cocok dengan lembar 3–4.

## 6. Masalah tersisa (tidak ada yang lahir dari redesain)

1. **Utang lint baseline** — 91 error + 8 warning warisan (gerbang
   `lint:gate` menahan agar tidak bertambah). Bukan regresi redesain.
2. **6 entri curiga over-merge langkah 2** — tercatat di laporan
   langkah 2; menunggu peninjauan data/pemilik, di luar cakupan
   langkah 6.
3. **Epoch `sm_panel.batch_utc`** — 1.868 paket bernilai null sehingga
   Panel arsip mencetak tanggal epoch (temuan warisan ronde Fix-1);
   menunggu keputusan pemilik apakah masuk perbaikan.
4. **Fix-4 (slot/edisi tiket harian)** — menunggu keputusan kebijakan
   pemilik; bukan bagian redesain dan tidak diputuskan di sini.
5. **Sinkronisasi refresh** — status paritas di ARCHITECTURE.md masih
   "menunggu patch/SHA tersanitasi dari pemilik".
6. **Observasi kecil:** payload RSC beranda memuat kedua varian judul
   hari ("Malam ini" + "Pertandingan hari ini") — yang terlihat di
   378 px benar sesuai jendela jam; hanya bobot payload, bukan cacat
   tampil.

## 7. Vonis

**SIAP MERGE.** Daftar perintah §8.6 hijau dua putaran penuh (831
assertion/putaran), perjalanan pemilik §8 lulus ujung-ke-ujung di
browser pada build produksi, matriks layar/akses §7 lulus pada semua
item yang bisa dijalankan di VM (tiga item ditandai jujur BELUM
DIJALANKAN: Android fisik, AT nyata, skor dua digit di browser — plus
INP lapangan), dan anggaran §9 terpenuhi (chunk 134,6 KiB gzip, 0
request sebelum dipilih, siklus canvas bersih). Masalah tersisa
seluruhnya warisan/keputusan pemilik, bukan regresi langkah 1–5.
Merge, pembaruan GitHub, deploy terakhir, dan PDF hasil adalah urutan
berikutnya di tangan pemilik — tidak dikerjakan di langkah ini.
