# PRD · Bola — jadwal, prediksi, dan rekam hasil

**Status dokumen** · Siap untuk implementasi per tahap oleh Muse Spark

**Produk** · bola.mhmdarandi.biz.id · **Bahasa** · Indonesia · **Zona tampilan** · WIB

**Basis kode** · `hyperrrdice-arch/BOLA-ARANDISUPERR` · `main` pada `b9b3871` · **Tanggal** · 20 November 2026

Seorang pembaca membuka situs dari ponsel, melihat laga malam ini, dan mengetuk salah satunya. Dalam satu layar ia mengetahui kapan laga dimulai, hasil apa yang diprediksi, seberapa besar peluangnya, serta kapan prediksi itu diterbitkan. Setelah pertandingan, tautan yang sama mempertemukan prediksi awal dengan skor akhirnya. Itulah alur yang harus selesai sebelum produk menyebut modelnya akurat.

## Mulai di sini, Muse Spark

1. Baca dokumen ini. Ambil **satu** baris dari tabel urutan kerja. Baca hanya bab terkait dan kontrak repo yang disebut di baris itu. Nomor K0–K8 dipakai sebagai rujukan kerja di seluruh paket.
2. Catat SHA kerja, file produser, file pembaca, dan satu masukan yang menunjukkan masalah di branch saat itu. Untuk kode Next.js, lihat dokumentasi versi yang terpasang. Bila masalah sudah diperbaiki upstream, buktikan dengan tes dan lanjutkan bagian yang masih terbuka.
3. Tambahkan uji pembuktian, jalankan pada perilaku lama, perbaiki melalui pintu masuk normal, lalu uji ulang. Pisahkan perubahan perilaku data, eksperimen model, dan pekerjaan visual agar hasilnya dapat diatribusikan.
4. Serahkan satu PR kecil per hasil yang dapat diperiksa. Tulis perintah persis, hasil terukur, data uji, dampak ke baris historis dan cara kembali. Catat syarat data yang belum tersedia. Pekerjaan UI/data tetap bisa maju saat calon model masih mengumpulkan bukti.
5. Mulai dengan **K0 dan uji D01**. Selesai tahap itu, pengelola harus dapat menjalankan pemeriksaan dari checkout bersih dengan database sementara.

**Instruksi siap ditempel**

> Kerjakan K0 pada PRD peningkatan aplikasi Bola. Gunakan commit kerja saat ini. Baca bab Data serta QA untuk uji D01. Buat CI Node 24 yang bisa menjalankan tes offline dari checkout bersih. Bekukan satu contoh kegagalan impor–penilaian sebagai baseline yang dapat diulang. Laporkan hasil tes yang benar-benar dijalankan dan nama file yang berubah. Pekerjaan VPS di luar tahap ini. Lanjutkan K1 setelah bukti K0 tersedia.

| Dokumen | Isi yang perlu dibuka |
|---|---|
| [Data, API, dan ledger](01-data-api-ledger.md) | Identitas laga, skor 90 menit, publikasi, perubahan skor, bukti dan kontrak empat endpoint |
| [Model dan eksperimen](02-model-quant.md) | Prediksi *as-of*, kesetaraan produksi dan backtest, eksperimen κ, kalibrasi, syarat promosi dan peluang tiket |
| [Antarmuka dan bahasa](03-antarmuka-bahasa.md) | Lima halaman, perjalanan pengguna, token visual, contoh copy, status data dan perilaku ponsel |
| [QA dan rilis](04-qa-rilis.md) | Skenario yang dapat dijalankan, perintah, biaya query, aksesibilitas, migrasi dan pemulihan |
| [Kartu kerja Muse Spark](05-kartu-muse.md) | Satu prompt per tahap K0–K8 beserta bukti yang harus dikirim di akhir PR |
| [Catatan untuk GitHub](catatan-refresh-github.md) | Teks issue, riwayat pembaruan VPS, perbedaan repo yang harus dicek dan kriteria sinkronisasi |
| [Referensi tampilan](visual/referensi.html) | Buka file HTML secara lokal untuk menelusuri lima layar. Seluruh data di dalamnya adalah contoh. |
| [Data uji lintas tahap](fixtures/acceptance.json) | Masukan deterministik untuk identitas laga, batas kickoff, probabilitas publikasi, tiket, dan penyebut statistik |

## Keputusan produk dan ukuran keberhasilan

Produk ini membantu pembaca sepak bola Indonesia membaca peluang pra-laga dan memeriksa kinerja pilihan yang telah diterbitkan. Pembaca utama menggunakan ponsel dan mengenal istilah seperti seri, gol, dan parlay. Pembaca yang ingin menyelidiki angka dapat membuka sumber, sampel, metode dan versi model. Pertahankan akses anonim, lima URL utama, model deterministik, serta jalur baca publik dari data lokal. Prioritas urutan pilihan mengikuti peluang dan mutu bukti. EV dan Kelly, bila ditampilkan di fungsi lama, tetap merupakan informasi sekunder.

| Tujuan | Definisi dan tanda selesai |
|---|---|
| Satu laga dapat ditelusuri | Semua alias yang terkonfirmasi membuka laga fisik yang sama. Dua uji audit pulih dari 0/2 menjadi 2/2 dan dari 3/4 menjadi 4/4 baris historis yang dapat dinilai. |
| Prediksi dapat dibuktikan | Seluruh pilihan resmi yang baru memiliki waktu terbit sebelum kickoff, referensi paket, versi model dan peluang terbit. Rekam hasil menggunakan cohort yang sama untuk klaim dan kenyataan. |
| Jadwal dan hasil cepat ditemukan | Dari beranda, satu ketukan membuka detail laga. Nama tim, waktu atau skor, dan status tampil tanpa menggulir pada detail ponsel contoh. Tautan menuju rekam hasil mudah ditemukan. |
| Mutu model bisa diukur | Peluang berasal dari satu jalur hitung. Laporkan log-loss, Brier, kalibrasi, cakupan, dan hasil tiket resmi pada data setelah batas latih. Promosi mengikuti kriteria yang ditulis sebelum uji. |
| Biaya halaman terkendali | Pembacaan daftar 75 laga memiliki batas query tetap. Halaman beranda tidak menghitung statistik 163 ribu pilihan lab pada tiap kunjungan. Anggaran uji tertera di bab QA. |

**Batas keputusan.** Nama tampilan yang diusulkan adalah **Bola** dan arah visualnya adalah meja jadwal redaksi olahraga dengan aksen kuning. Keduanya keputusan desain untuk rilis ini. Situs tidak memerlukan akun, transaksi taruhan, sumber data berbayar baru atau migrasi framework untuk menyelesaikan alur tersebut. Rekomendasi yang ditulis sistem dan kombinasi yang disusun sendiri oleh pengguna memiliki riwayat berbeda. Tenggat katalog arsip 5 Januari 2027 adalah risiko cakupan fixture, bukan alasan untuk mempromosikan model sebelum sampelnya cukup.

## Bukti awal

| Bukti | Implikasi yang masuk spesifikasi |
|---|---|
| 20 Nov, jadwal publik menampilkan pembaruan pukul **04.22 WIB**. Pemilik mengonfirmasi refresh telah diperbarui di VPS terbaru. | Catat sinkronisasi di GitHub. Insiden lama tidak menjadi pekerjaan operasional untuk Muse. |
| Pada pemeriksaan publik yang sama, beranda mengulang **163.008** kandidat lab. Halaman rekam hasil menampilkan **7.766** pilihan live-run dan **1.321** sudah dinilai. | Bedakan lab, pilihan aktual, laga mendatang, hasil tertunda, dan tiket. Angka ini snapshot tampilan, bukan konstanta UI atau ukuran akurasi. |
| Beranda berbunyi *Know your odds.* dan tabel memakai *Promised / Actual*. Dari jadwal, detail Vissel Kobe–Mito Hollyhock (`sm_19719152`) menampilkan pesan server gagal memuat. | Lokalkan semua teks, buat rute detail tahan data parsial dan tambahkan uji browser. Penyebab error publik perlu log terpisah. Pada audit lokal, input `bookmakers=null` memang menjatuhkan ekspresi render. |
| 11 run GitHub Actions yang tersedia saat audit gagal. Run terakhir lolos typecheck lalu mencari file tes yang hilang. Pada uji terisolasi 41 pemeriksaan quant dan 20/20 probabilitas dua paket lolos. | Jadikan tes yang relevan dapat dijalankan dari checkout bersih. Ketepatan menghitung ulang sebuah paket dan kemampuan memprediksi pertandingan diukur terpisah. |
| Dalam snapshot 18 Nov, 421/548 pilihan memiliki perbedaan peluang mentah dan efektif ≥1 poin persentase. Sebanyak 183/221 pilihan A berasal dari liga berlabel partial. | Simpan angka yang benar-benar dipublikasikan. Selalu sertakan cakupan bukti di samping grade. |
| Bukti uji historis, kelemahan look-ahead, dan hasil benchmark pasar dirinci di bab model. | Hit-rate pilihan double chance dan tiket lengkap memerlukan penyebut berbeda. |

Sumber audit: [commit acuan](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/commit/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64) · [CI yang gagal](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/actions/runs/44481435092) · [slate tersimpan](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/tasks/pick-slate-latest.md) · [invarian data](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/docs/DATA-INVARIANTS.md) · [jadwal publik](https://bola.mhmdarandi.biz.id/pertandingan) · [rekam hasil publik](https://bola.mhmdarandi.biz.id/bukti).

## Urutan kerja dan definisi selesai

| Tahap | Dependensi | Hasil satu PR dan cara menyetujuinya |
|---|---|---|
| K0 · CI dan data contoh | Mulai | Jalankan suite aktif, fail eksplisit saat selisih melewati toleransi, fixture sementara dan build. Rekam kegagalan D01 saat baseline secara terpisah dari suite hijau. |
| K1 · Identitas dan hasil | K0 | Satu resolver untuk impor dan baca. Jadwal menjadi selesai dengan skor, histori koreksi utuh. Lulus D01–D04 dan migrasi ulang. |
| K2 · Publikasi dan bukti pilihan | K1 | Bekukan prediksi saat terbit, ikat versi paket, hitung cohort, tangani retry. D05–D08 lulus termasuk crash parsial. |
| K3 · Tiket dan peluang gabungan | K2 | Bekukan tiket resmi beserta anggota. Grupkan alias, uji peluang dari matriks dan status tiket. D09 serta uji tiket resmi vs draf lulus. |
| K4 · Model yang sama di lab dan produksi | K1, K2 | Samakan fitur menurut waktu, fallback, prior dan grading. Tunjukkan uji kesetaraan Q01–Q04 serta manifest replay. |
| K5 · Eksperimen model | K4 | Bandingkan satu kandidat dan champion dengan protokol terkunci. Hasil yang sah meliputi tetap memakai champion atau sampel belum cukup. |
| K6 · Jadwal, beranda dan detail | K0 untuk prototipe, K1–K2 untuk integrasi | Seluruh state UI teruji dengan fixture, bahasa Indonesia dan tautan lama berfungsi. Inspeksi visual HP/desktop, termasuk detail tanpa odds. |
| K7 · Pilihan dan rekam hasil | K2, K3, fondasi K6 | Lengkapi builder, tiket resmi, bukti live, lab terpisah, serta format angka/waktu. Semua status dan perhitungan pada UAT cocok dengan ledger. |
| K8 · Kinerja dan penerimaan rilis | K0–K4, K6–K7 | Uji ukuran data representatif, keterjangkauan halaman, aksesibilitas, perlindungan riwayat dan rollback baca. Kandidat K5 dapat terus berjalan sebagai eksperimen. |

Batas antar-lapis mengikuti `lib/feeds` → dataset/jadwal → `lib/quant` → `lib/picks` → `lib/web` → komponen halaman. Koreksi hasil berjalan kembali ke ledger dan rekam hasil. Satu definisi identitas, settlement dan peluang terbit dipakai oleh semua pembaca. Pertahankan store terpisah dan adapter API yang sudah dipakai klien. [Peta struktur](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/STRUCTURE.md) · [Keputusan penyimpanan](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/docs/decisions/ADR-002-per-function-database-split.md).
