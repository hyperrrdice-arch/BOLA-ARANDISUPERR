# Laporan Langkah 5 Redesain — Pilihan (§3D) + Rekam Hasil (§3E) + Gerak §9

**Status: SELESAI (A).** Branch `redesain/bola` dari tip `e1dbfb3` (langkah 1–4
tidak diubah keputusannya). Dua commit: Pilihan, lalu Rekam + suite + laporan.
Tanpa merge, tanpa deploy, tanpa menyentuh DB produksi / κ / Fix-4.

Bukti render: folder pasangan laporan ini — `pilihan-378.png`,
`pilihanmu-378.png`, `bukti-378.png`, `bukti-074-378.png` (378 px, build
produksi di data panggung `tests/helpers/redesain5-stage-seed.ts`).

---

## A. Pilihan (/pilihan) — §3D

- **Susunan §3D.1** — `components/pilihan/ParlayBuilder.tsx` ditulis ulang:
  pencarian (lipatan aksen `lipatTeks`, pola langkah 4), tanggal, dan filter
  kelas di atas daftar; urut kickoff dari umpan server; per laga tampil
  **pilihan utama** (2 teratas menurut peluang terbit) + pilihan terpilih di
  luar utama + pengembang "Lihat semua pilihan laga"; paginasi 20 laga +
  "Muat 20 laga lagi" (reset saat filter berubah). Angka total di kepala
  daftar = jumlah pilihan + jumlah laga kanonik atas **seluruh hasil
  terfilter**, bukan halaman yang tampil (terbukti di probe: "37 pilihan ·
  25 laga" saat yang tampil 20 laga; menyusut jadi "1 pilihan · 1 laga"
  saat pencarian "koge").
- **Tambah seketika §3D.2** — klik Tambah → "Terpilih" di tempat, tanpa
  memindah fokus / posisi gulir. HP: bilah "Lihat N pilihan" tepat di atas
  navigasi bawah (`52px + safe-area`), membuka panel bawah "Pilihanmu"
  (gulir mandiri, fokus masuk ke Tutup, Escape / latar menutup dan fokus
  kembali ke bilah; panel menutup sendiri saat pilihan terakhir dihapus).
  Desktop: ringkasan yang sama di kolom kanan. Gerak §9: bilah masuk
  6 px / 160 ms (`.ringkasan-masuk`), panel 12 px / 210 ms (`.panel-masuk`),
  keduanya tunduk pada `prefers-reduced-motion` global.
- **Batas 12** — menambah ke-13 terblokir (tombol nonaktif) dan pesan persis
  **"Maksimal 12 pilihan. Hapus satu untuk menambah yang lain."** tampil di
  ringkasan; penghitung **"{n} dari 12 pilihan"** ada di aside desktop DAN
  kepala panel HP (lihat Penyimpangan f).
- **Draf persisten §3D.3** — `lib/web/draf.ts` (murni, teruji): kunci
  `bola:draf-pilihan`, versi format 1. Yang disimpan HANYA versi + ID
  pilihan + kunci semantik (`fixtureUid|market|line|selection`, bentuk yang
  sama dengan pengelompokan langkah 2) — **tidak ada angka yang disimpan**.
  Saat muat ulang: entri divalidasi ulang terhadap umpan terbaru (ID →
  kunci semantik untuk entri yang ID-nya berubah edisi), lalu baris umpan
  itu sendiri dipakai sebagai snapshot — angka terbit tidak pernah berubah
  oleh draf. Penulisan bersifat *write-through* di titik mutasi. Keadaan
  terbukti di probe browser: muat ulang mempertahankan 3 pilihan / 2 laga;
  hapus satu tetap persisten sesudah muat ulang; klik ganda / tambah cepat
  berurutan idempoten (cermin ref — lihat catatan lint di bawah); kunci
  semantik menolak duplikat lintas alias (suite S + uji umpan sandbox).
  Penyimpanan tidak tersedia → draf tetap berfungsi selama tab terbuka dan
  ringkasan menerangkan "Draf tidak tersimpan di perangkat ini — pilihan
  tetap ada selama tab ini terbuka." Pilihan yang laganya sudah mulai:
  tertanda "Kedaluwarsa — laga sudah mulai, dikeluarkan dari perkiraan.",
  keluar dari perhitungan aktif, tetap bisa dihapus (terbukti dengan jam
  klien dimajukan melewati kickoff saat tab terbuka).
- **Matematika §3D.4** — kontrak `combineSlip` (`lib/web/parlay.ts`) diubah
  mengikuti brief: kelompok satu laga dihitung sebagai **irisan dari SATU
  matriks skor edisi yang sama**; matriks / edisi bersama tidak tersedia
  (atau ada pasar yang tidak punya predikat matriks) → kelompok
  `prob: null, unavailable: true` dengan alasan tertulis, dan gabungan
  keseluruhan menjadi "Peluang gabungan belum tersedia" + alasan — TIDAK
  lagi jatuh ke perkalian antar-pilihan dalam satu laga (fallback lama K7
  digantikan; selaras dengan `joint_unavailable` K3). Laga berbeda tetap
  independensi, dan kalimat §5 tampil apa adanya di ringkasan: "Pilihan
  dalam satu laga dihitung dari kemungkinan skor. Untuk laga yang berbeda,
  perhitungan menganggap hasilnya saling independen." Label basis per
  pilihan ("Peluang saat terbit" + rincian basisnya) terpisah dari label
  basis gabungan ("Basis gabungan: …") sesuai copy §5 "Basis campuran".
  Presisi asli disimpan; persen hanya format tampilan.

### Regresi matematika §3D.5 — TERBUKTI

Fixture sintetis berlabel (snapshot audit tidak dipakai; matriks dicatat
penuh di suite `tests/test-redesain-pilihan-rekam.ts` dan seed panggung):
matriks 6×6 (baris = gol kandang 0–5), total tepat 1,0:

```
0,060 0,070 0,055 0,035 0,012 0,007
0,150 0,140 0,070 0,045 0,020 0,008
0,090 0,050 0,048 0,026 0,011 0,004
0,029 0,028 0,016 0,009 0,004 0,001
0,006 0,003 0,0015 0,0005 0,0003 0,0002
0,0003 0,0001 0,00005 0,00003 0,00001 0,00001
```

- P(Bengaluru mencetak gol) = 0,761; P(total ≤ 3 gol) = 0,749;
  irisan keduanya = **0,529 → "52,9%"** ✓ (suite + panel browser).
- Tambah Shabab Al Ahli mencetak gol 0,872 (laga lain, independensi):
  0,529 × 0,872 = 0,461288 → **"46,1%"** ✓ (suite + bilah/panel browser).
- Jalur tidak-tersedia (tanpa matriks / pasar tak dikenal / campuran)
  menghasilkan gabungan `null` + alasan — semua diasersi.

## B. Rekam hasil (/bukti) — §3E

- **Urutan §3E.1** — judul → detail tiket (bila `?tiket=`) → baris periode
  + form filter → **"Ringkasan periode"** → tab → "Tiket resmi" → "Uji
  historis". Tab (`components/bukti/TabRekam.tsx`): **Sudah dinilai
  (default)** / Menunggu / Batal, lengkap dengan jumlah; penanda jingga
  bergeser 160 ms (§9); navigasi papan ketik panah + *roving tabindex*;
  panel adalah simpul yang dirender server dan diteruskan ke komponen tab,
  jadi mengganti tab tidak pernah merender ulang angka.
- **Ringkasan dua kalimat §3E.2** — `kalimatRingkasan` di `lib/web/rekam.ts`
  dihitung dari `cohortStats` yang sama dengan daftar (konsistensi Fix-6 /
  K7 utuh). Pola brief terbukti persis pada contoh brief itu sendiri
  (995 / 1.321 / 5.142 / 175 laga → "995 dari 1.321 pilihan tepat (75,3%)
  di 175 laga" + "Dari 5.142 pilihan yang sudah waktunya dinilai, 1.321
  sudah memiliki hasil (25,7%)"). Filter periode / liga / kelas / pasar
  menggerakkan pembilang dan penyebut bersama; tab hanya mengatur daftar —
  mengganti tab tidak dapat memalsukan cakupan 100% (ringkasan dirender
  server di luar tab). Akurasi 0% hanya muncul bila ada pilihan dinilai dan
  semuanya meleset.
- **Tab Menunggu** terpisah "Sudah lewat — menunggu hasil resmi" dan
  "Belum mulai". **Keadaan 0/74** (fixture langkah 1): tab awal memuat
  "Belum ada pilihan yang sudah dinilai" + "74 pilihan masih menunggu hasil
  resmi." + aksi **"Lihat 74 yang menunggu"** yang mengalihkan tab
  (delegasi klik `data-alih-tab`). Tanggal kosong → penjelasan yang sesuai.
- **Sesudah rekam publik** — "Tiket resmi" dari pustaka K3 apa adanya
  (tautan lama `/bukti?tiket=…` tetap bekerja; terbukti di probe termasuk
  halaman detailnya) dan "Uji historis" dengan copy kejujuran Fix-6:
  kandidat prediksi teruji + hitungan laga fisik unik
  (`lab_resolved_matches = COUNT(DISTINCT match_id)`). Draf pribadi TIDAK
  tampil di sini (tetap di Pilihan). Penerbitan tiket otomatis (Fix-4)
  bukan cakupan langkah ini dan tidak dikerjakan.

## C. Verifikasi

- **Suite baru** `tests/test-redesain-pilihan-rekam.ts` (dirantai ke
  `test:web`): **63 assertion hijau** — 41 murni (matematika, draf,
  kalimat ringkasan, pengelompokan tab), 15 sandbox rekam (jendela arsip
  19 Nov: terbit 74, dinilai 0, cakupan "0 sudah memiliki hasil (0%)";
  semua periode: "2 dari 3 pilihan tepat (66,7%) di 2 laga", cakupan
  "(3,9%)"), 7 sandbox umpan (alias sm_/mt_ melebur jadi satu laga,
  restore draf via kunci semantik terhadap umpan asli). Bagian sandbox
  berjalan sebagai subproses (getter DB mengunci koneksi per proses —
  pola suite reproduksi langkah 1).
- **Probe browser** `~/workspace/tools/pwshot/redesain5-probe.mjs` terhadap
  build produksi + data panggung: **45/45 PASS** — paginasi, pencarian
  lintas 20 laga + lipatan aksen, total terfilter, regresi 52,9% → 46,1%
  di bilah dan panel, fokus panel (masuk / Escape / kembali), draf
  persisten + hapus persisten, batas 12 + pesan persis + penghitung,
  Kosongkan menutup panel, kedaluwarsa saat jam dimajukan, /bukti (tab
  default, dua kalimat, Menunggu terpisah, Batal, tiket K3 + detail,
  0/74 + aksi alih tab), nol *pageerror*, nol overflow horizontal di 378.
- **Regresi penuh**: test:data 278/278 · test:web 396/396 (termasuk suite
  baru 63) · test:api 42/42 · test:e2e 7/7 · test:quant 138/138 ·
  test:baseline:d01 12/12 · `tsc --noEmit` bersih · `npm run build` bersih.
- **Lint gate LOLOS**: 91 error ≤ baseline 92, **nol error baru**. Empat
  error `react-hooks/set-state-in-effect` + satu `react-hooks/purity` yang
  sempat muncul dari penulisan ulang builder DIBERESKAN dengan
  restrukturisasi, bukan disable: simpan draf jadi write-through di titik
  mutasi; restore draf memakai `useSyncExternalStore` + penyesuaian saat
  render (pola resmi React untuk store eksternal); visibilitas panel jadi
  state turunan (`panelTampil`); reset paginasi jadi penyesuaian saat
  render; toggle membaca jam dari state `nowMs`. Di tengah refactor probe
  menangkap regresi nyata (klik cepat berurutan membaca closure basi →
  pilihan tertimpa) — diperbaiki dengan cermin ref seleksi yang ditulis
  serentak di titik mutasi dan disamakan ulang lewat effect sesudah
  restore; probe kembali 45/45.

## Penyimpangan & keputusan yang dicatat

a. **Kontrak `combineSlip` berubah** mengikuti §3D.4 (lihat di atas);
   penyesuaian di `tests/test-rekam.ts` hanya soal nulabilitas tipe U03
   (`combined: number | null`) — seluruh ekspektasi numeriknya tidak
   berubah (75%, irisan matriks 51%, 35,19% → "35,2%" tetap lolos).
b. **"Pilihan utama" = 2 teratas menurut peluang terbit** per laga
   (keputusan desain; brief tidak menetapkan urutan lain). Pilihan
   terpilih di luar utama tetap ditampilkan tanpa membuka pengembang.
c. **Draf hanya menyimpan versi + ID + kunci semantik** — tidak pernah
   angka; snapshot selalu baris umpan terbaru yang terverifikasi.
d. **Sesudah muat ulang**, pilihan yang laganya sudah mulai tidak ada lagi
   di umpan server (umpan hanya pra-laga), jadi terhitung sebagai entri
   `hilang` dengan pemberitahuan "{n} pilihan dari draf tersimpan tidak
   lagi tersedia…". Penandaan "Kedaluwarsa" berlaku selama tab tetap
   terbuka (kasus yang dituntut brief §7 baris Draf).
e. **Keadaan tab tidak masuk URL** (murni klien); ringkasan periode
   dirender server di luar tab — konsekuensi yang disengaja demi
   konsistensi angka §3E.2.
f. **Penghitung "{n} dari 12 pilihan" ditambahkan ke kepala panel HP** —
   sebelumnya hanya ada di aside desktop; probe menemukan celahnya di
   permukaan utama 378 px. Penambahan satu baris, tanpa mengubah copy.
g. **Deduplikasi alias di level browser tidak diprobe terpisah** — jalur
   yang sama (kunci semantik) terbukti di suite sandbox umpan + restore
   semantik + pagar idempoten builder; laga alias di panggung browser
   akan menggandakan skenario yang sama.
h. **Catatan lingkungan panggung**: `next start` dari direktori panggung
   wajib menautkan `next.config.ts` checkout — tanpanya semua rute 500
   (`DYNAMIC_SERVER_USAGE`) karena konfigurasi PPR tidak terbaca. Seed
   panggung menempatkan laga selesai/batal di 18 Nov WIB supaya jendela
   19 Nov murni 0/74.

## Berkas

- Pilihan: `lib/web/parlay.ts`, `lib/web/draf.ts` (baru),
  `components/pilihan/ParlayBuilder.tsx`, `app/(terminal)/pilihan/page.tsx`,
  `app/globals.css` (kelas gerak `.ringkasan-masuk` / `.panel-masuk`).
- Rekam: `lib/web/rekam.ts`, `components/bukti/TabRekam.tsx` (baru),
  `app/(terminal)/bukti/page.tsx`.
- Uji & panggung: `tests/test-redesain-pilihan-rekam.ts` (baru),
  `tests/helpers/redesain5-probe.ts` (baru),
  `tests/helpers/redesain5-stage-seed.ts` (baru),
  `tests/test-rekam.ts` (nulabilitas U03), `package.json` (rantai suite).
