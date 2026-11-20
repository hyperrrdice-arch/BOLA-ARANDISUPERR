# Catatan GitHub · Paritas refresh dan rebuild telemetri

**Judul issue siap pakai**

Sinkronkan perbaikan refresh VPS terbaru ke repo dan uji rebuild telemetri

**Status pada 20 November 2026.** Pemilik mengonfirmasi bahwa refresh pada VPS terbaru sudah diperbarui. Saat inspeksi publik, halaman jadwal mencantumkan Jumat, 20 November, pukul 04.22 WIB sebagai pembaruan terakhir. Keterangan di `ARCHITECTURE.md` tentang kegagalan langkah 6 pada 19 November merupakan catatan historis. Cap jadwal menunjukkan keluaran yang terlihat publik; ia tidak mengidentifikasi SHA yang terpasang, cara perbaikan, atau keberhasilan setiap tahap.

## Lingkup issue

Buat GitHub dapat mereproduksi perilaku yang sudah digunakan pemilik. Pekerjaan issue ini terbatas pada perbandingan kode, dokumen dan tes repo. Pemilik telah menyelesaikan bagian VPS. Jangan login ke server, mengubah cron, memasang agen, menyalin database produksi, atau meminta konfigurasi rahasia untuk mengerjakan issue ini.

1. Cek GitHub terbaru terlebih dahulu. Telusuri perubahan pada `scripts/build-canonical-telemetry.ts`, `scripts/free-refresh.ts` dan dokumen operasi. Jika ada commit perbaikan yang sudah dipush, pakai SHA itu untuk pembandingan. Jika perbaikan hanya ada di VPS, tulis “menunggu referensi patch atau SHA tersanitasi dari pemilik”. PRD lain dapat terus dikerjakan.
2. Bandingkan pemrosesan tabel kanonik, penggunaan memori, urutan langkah, status keluar, dan cara mempertahankan hasil terakhir saat rebuild gagal. Dalam snapshot audit, `SELECT * ... .all()` memuat seluruh tabel form, menyusun grup di memori, lalu menghapus tabel tujuan sebelum pengisian selesai. Jangan menebak apakah VPS baru memperbaikinya dengan RAM, chunking atau pendekatan lain.
3. Jika patch menyentuh telemetri, uji pada DB fixture. Bandingkan output bermakna yang diurutkan menurut kunci, termasuk prioritas sumber, tie-break, pemenuhan xG, jumlah alias, dan baris konflik. Jika pemrosesan dicicil, sebuah grup dapat menyeberangi batas batch; uji kasus itu. Jika publisher diganti, bangun tabel baru lalu tukar dalam transaksi lokal setelah validasi. Periksa nama indeks setelah pertukaran, hentikan writer di tengah uji dan pastikan pembaca masih bisa melihat generasi lama yang utuh.
4. Jalankan refresh hanya pada fixture atau staging terisolasi dengan upstream tiruan. Lampirkan perintah, SHA, jumlah row, durasi dan peak RSS pada dataset yang disebutkan. Periksa urutan hingga penulisan paket, slate, ledger dan resolver. Run berikutnya dengan input sama menghasilkan data semantik yang sama. Pisahkan timestamp run dari isi semantik ketika membandingkan.
5. Perbarui keterangan status di dua tempat `ARCHITECTURE.md` (§8 serta daftar keputusan §10). Cantumkan commit yang menyelaraskan repo atau status perbandingan yang masih tertunda. Issue selesai setelah bukti paritas dan tes diterima, atau setelah dokumentasi menjelaskan dengan jujur bahwa repositori sengaja berbeda beserta keputusan pemilik.

**Bukti yang boleh ditempel di GitHub.** SHA, diff kode yang telah diperiksa, ringkasan benchmark fixture, hasil uji per tahap dan tautan dokumen. Data produksi, token, `.env`, alamat internal serta akses VPS tidak diperlukan untuk catatan ini.

[Skrip rebuild pada commit audit](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/scripts/build-canonical-telemetry.ts) · [rantai refresh](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/scripts/free-refresh.ts) · [status historis](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/ARCHITECTURE.md#L949) · [jadwal publik](https://bola.mhmdarandi.biz.id/pertandingan).
