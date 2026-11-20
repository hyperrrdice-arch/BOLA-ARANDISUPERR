# Antarmuka dan bahasa Indonesia

**Dipakai pada K6–K7.** Pembaca membuka situs untuk melihat siapa yang main, kapan, berapa peluangnya, lalu bagaimana hasil prediksi sebelumnya. Gunakan unsur yang sudah akrab dari halaman jadwal olahraga. Jadikan informasi itu sendiri sebagai identitas visual. [Prototipe lima layar dengan data rekaan](visual/referensi.html).

## U1 · Navigasi, waktu dan pola dasar

Masthead **Bola** membawa pengguna ke beranda. Menu tetap berisi **Beranda**, **Jadwal**, **Pilihan**, **Rekam hasil**. Tautan berupa URL yang dapat disalin, dibuka langsung, dan digunakan dengan tombol Kembali. Pertahankan URL lama, termasuk ID provider yang telah menjadi alias. Tautan detail menyimpan identitas pertandingan, bukan nama tim yang dapat berubah. Keadaan filter jadwal dan periode rekam tercermin pada query string. Validasi nilai filter dari URL dan gunakan default terdokumentasi bila tidak dikenal.

Gunakan HTML `lang="id"`, judul halaman yang spesifik, navigasi semantik, dan tautan “Lewati ke isi”. Judul tab misalnya “Jadwal pertandingan | Bola”, “Persada FC vs Rawa United | Bola”. Format tanggal dengan `id-ID` di `Asia/Jakarta`. Simpan UTC di backend. Tulis “Jumat, 20 November · 20.00 WIB”, “Terbit 17.40 WIB”, serta “Diperbarui 18.20 WIB” hanya bila jamnya memang milik peristiwa itu. Tanggal pertandingan dalam filter Hari ini berganti pada tengah malam WIB. Untuk pembulatan tampilan, persentase memakai maksimal satu desimal, misalnya **72,5%**, odds desimal memakai dua, misalnya **2,10**. Simpan presisi asli untuk matematika. Enam pertandingan terakhir memakai Menang, Seri, Kalah dan nama lawan.

## U2 · Beranda dan jadwal

| Rute | Urutan dan interaksi | Kondisi data dan penerimaan |
|---|---|---|
| `/` — Bola hari ini | Baris pertama judul dan waktu data. Sorot satu laga dengan kompetisi, sepak mula, kedua tim, tiga peluang bernama, jam terbit, dan **Baca analisis**. Di sebelahnya jadwal terdekat. Di bawahnya dua hasil terakhir dan **Lihat rekam hasil**. | Pilih laga belum mulai yang punya analisis pra-laga layak, urut kickoff lalu UID, di tanggal WIB aktif. Tanpa kandidat, sorot jadwal terdekat atau hasil terakhir dengan tautan jelas. Jangan mengarang angka. Satu ketukan membuka detail. |
| `/pertandingan` — Jadwal pertandingan | Pilih tanggal, lalu status Semua / Akan datang / Selesai. Tampilkan urutan waktu dan kelompok kompetisi yang dapat dipindai. Setiap baris memiliki tim kandang dan tamu, jam atau skor, serta keadaan analisis. Seluruh baris menjadi tautan. | Mulai dari jadwal kanonik, termasuk laga tanpa paket. Alias menghasilkan satu baris. Untuk daftar mendatang, sepak mula paling dekat di atas; untuk hasil, waktu terbaru di atas. Pertahankan tanggal/filter saat kembali dari detail. |
| Batas liputan jadwal | Tulis jendela yang benar, misalnya “72 jam ke depan” jika query memang hanya mengambil 72 jam. Saat melewati batas arsip, tampilkan “Jadwal setelah tanggal ini belum tersedia.” | Kalender tidak boleh menyiratkan bahwa tidak ada pertandingan di dunia saat sumber data tidak mencakup tanggal atau kompetisi tersebut. Bedakan `empty`, `out_of_coverage` dan `unavailable`. |

Buang headline generik, bola 3D besar di atas lipatan, tumpukan statistik lab berulang dan badge teknis yang tidak membantu memilih laga. Angka hanya muncul sekali pada konteks yang menjelaskan penyebutnya. Nama resmi liga, tim dan penyedia data tetap mengikuti sumber. Jika logo tim tidak ada, siapkan nama atau monogram yang tenang dan terbaca. Jangan memerlukan gambar untuk memuat daftar pertama.

## U3 · Detail pertandingan

1. Judul berisi kedua tim. Di atas atau dekat judul tampil kompetisi, hari, waktu WIB, dan status. Laga selesai menampilkan skor resmi dan jenis skor. Di ponsel, dua nama tim dan waktu atau skor harus terlihat pada viewport pertama.
2. **Peta peluang** menampilkan tiga kolom atau baris dengan nama dan angka. “Persada menang 46% · Seri 29% · Rawa menang 25%.” Satu kalimat bila membantu menafsirkan angka. “Persada paling berpeluang menang. Model tetap memberi peluang 54% untuk seri atau kemenangan Rawa.” Nilai berasal dari snapshot yang sama. Tiga segmen punya label teks dan tidak bergantung pada warna.
3. **Pilihan sebelum laga** berisi nama pilihan, peluang saat terbit, waktu terbit, basis peluang, status bukti, tautan sumber dan aksi sesuai keadaan. Jika snapshot analisis berubah, pisahkan “Analisis terbaru” dan “Prediksi saat terbit”, masing-masing dengan waktunya. Setelah FT, tampilkan pilihan awal dan hasil Tepat/Meleset dekat skor. Jangan menghasilkan narasi dengan LLM pada saat pembaca membuka halaman.
4. **Sumber angka** menjelaskan Model, Harga pasar, dan Panel arsip masing-masing dengan angka, pasar dan cap waktu yang tersedia. Harga pasar dikonversi menjadi peluang tersirat setelah margin dihapus dengan metode yang terdokumentasi. Sumber yang tak memberi nilai untuk pasar ini dicatat kosong. `N sumber tersedia` mengukur jumlah sumber. Untuk mengklaim angka “berdekatan”, definisikan dulu ambangnya dalam poin persentase dan tampilkan angka pembanding.
5. Penjelasan matriks, skor yang paling mungkin, metode dan enam laga terakhir dapat dibuka setelah ringkasan. Beri alternatif teks untuk matriks. Jangan merender xG, odds, hasil, atau tanggal epoch pengganti dari nilai null. Arah tandang/kandang datang dari data yang dinormalisasi.
6. Detail untuk fixture terjadwal tanpa paket tetap bisa dibuka. Tampilkan “Analisis belum tersedia untuk laga ini” dan **Kembali ke jadwal**. Untuk ID asing tampilkan 404 lokal. Jika DB atau komponen penting gagal, tampilkan **Coba lagi** dan pertahankan navigasi. Tambahkan regresi berkondisi seperti detail publik `sm_19719152`, serta uji terisolasi `bookmakers=null`; log sebab kegagalan publik bila tersedia.

## U4 · Pilihan dan rekam hasil

| Bagian | Perilaku yang harus dibuat |
|---|---|
| `/pilihan` — Pilihan pra-laga | Kelompokkan menurut laga lalu waktu. Setiap pilihan menyebut kejadian sepak bola, peluang saat terbit dan jenis basis. Tombol **Tambah** punya accessible name lengkap, seperti “Tambah Persada menang atau seri, Persada FC vs Rawa United”. Tombol aktif menjadi **Terpilih** dan dapat dilepas. Saat menambah, fokus tetap pada pilihan yang digunakan. |
| Ringkasan kombinasi | Tulis “2 pilihan dari 1 laga” dan “Perkiraan peluang semua pilihan tepat”. Panel bisa dibuka di ponsel tanpa menutup tombol terakhir atau fokus pengguna. **Hapus** dan **Kosongkan** memulihkan keadaan. Pertahankan batas produk saat ini, maksimal 12 pilihan unik; pada batas itu jelaskan “Maksimal 12 pilihan. Hapus satu untuk menambah pilihan lain.” Jumlah, tombol, dan perhitungan harus konsisten di desktop dan ponsel. |
| Perhitungan dan perubahan waktu | Gunakan data grup per UID kanonik. Jika dua pilihan di laga yang sama punya irisan matriks 51%, tampilkan 51%. Dengan laga kedua 69%, tampilkan 35,2% beserta asumsi independensi antarlaga. Bila matriks tidak tersedia, tampilkan alasan kosong. Jika kickoff tiba saat tab terbuka, kunci penambahan, tandai pilihan kedaluwarsa, dan keluarkan dari estimasi aktif sampai pengguna membersihkannya. Hitung ulang saat input berubah atau tab kembali aktif. |
| `/bukti` — Rekam hasil | Default ke **Pilihan yang diterbitkan**. Tampilkan periode, waktu pembaruan, jumlah terbit, sudah dinilai, menunggu, batal, serta cakupan yang sudah jatuh tempo. Bedakan hit-rate tiap pilihan dan tiap tiket resmi. Tabel memuat laga, pilihan, peluang saat terbit, skor dan hasil. Filter pasar/kelas/liga/periode memakai penyebut terfilter yang sama. |
| Bukti dan histori | Tautkan baris ke pilihan dan paket yang dipublikasikan. Detail tiket resmi dapat dibagikan lewat `/bukti?tiket=<id>`. Jika ID tidak ada, tampilkan “Tiket tidak ditemukan” dan tautan kembali. Label sekunder **Uji historis** memiliki periode, jumlah laga, kebijakan dan versi eksperimen. Jangan menggabungkan angka lab dengan pilihan pra-laga resmi atau draf pribadi. |

**Contoh rekam yang harus cocok.** Dari 12 pilihan diterbitkan, 8 sudah dinilai dan 4 masih menunggu. Jika 6 dari 8 tepat, tulis “6 dari 8 pilihan tepat (75%) di 4 laga”. Peluang terbit untuk kedelapan pilihan 78, 62, 70, 76, 72, 70, 74, dan 68 persen, rata-rata **71,3%** pada tampilan satu desimal. Berikan jumlah pilihan yang memiliki peluang terbit tercatat ketika membandingkan rata-rata itu dengan hasil. Gunakan judul dan label yang tetap masuk akal ketika jumlahnya nol.

## U5 · Kamus copy yang langsung dapat digunakan

| Teks atau kode lama | Teks tujuan dan ketentuan |
|---|---|
| Know your odds. / Matches / Record | **Bola hari ini** / **Jadwal pertandingan** / **Rekam hasil** |
| Build your parlay. / Your slip / Add | **Pilihan pra-laga** / **Pilihanmu** / **Tambah** |
| Promised / Actual / Live picks | **Peluang saat terbit** / **Porsi yang tepat** / **Pilihan sebelum laga**. Gunakan “Sedang berlangsung” hanya untuk status resmi. |
| 1 / X / 2 | **Persada menang** / **Seri** / **Rawa menang**. Ganti Persada dan Rawa dengan nama singkat yang mudah dibedakan. |
| Double chance 1X / X2 / 12 | **Persada menang atau seri** / **Rawa menang atau seri** / **Salah satu tim menang**. Nilai ketiganya mewakili kejadian berbeda. |
| Over/under 1.5, 2.5, 3.5 | Over → **Minimal dua / tiga / empat gol**. Under → **Maksimal satu / dua / tiga gol**. Teks teknis garis dapat ditaruh di rincian. |
| BTTS yes / no | **Kedua tim mencetak gol** / **Setidaknya satu tim tidak mencetak gol**. |
| Safe / grade A / calibrated | Hindari janji “aman” untuk prediksi. **Kelas A** berarti kelompok pilihan dalam pasar sesuai versi kebijakan. **Kalibrasi liga lolos uji**, **Lolos sebagian**, **Belum lolos uji**, **Bukti belum tersedia** mengikuti bukti yang tercatat. |
| 2 of 3 sources / closing odds | **Dua sumber tersedia** / **Harga pasar menjelang sepak mula**. Beri waktu tangkap yang sebenarnya. |
| Loading the ball… / Try again | **Memuat jadwal…** atau **Memuat analisis laga…** sesuai rute. **Coba lagi** untuk kegagalan yang dapat dipulihkan. |

Gunakan kalimat pendek, istilah yang muncul di siaran atau jadwal Indonesia, dan kata kerja pada tombol. Untuk satu pilihan gunakan “Tepat”, “Meleset”, “Menunggu hasil”, atau “Dibatalkan”. Pertahankan istilah industri yang benar-benar perlu seperti Dixon–Coles di rincian metode. Nama pasar selalu menyatakan kondisi menang secara lugas. Pilih satu format untuk tanggal, gol, status dan peluang di seluruh aplikasi.

## U6 · Keadaan layanan untuk semua route

| Masukan | Teks, aksi dan data yang tetap bisa dibaca |
|---|---|
| Berhasil, 0 baris dalam liputan | “Belum ada pertandingan pada tanggal ini.” Sediakan **Pilih tanggal lain**. |
| Jadwal tersedia tetapi belum ada paket | Nama tim, jadwal dan halaman detail tetap tersedia. “Belum ada analisis.” |
| Peluang pasar null, hanya panel arsip tersedia | Model dan label waktunya tetap terbaca. “Harga pasar belum tersedia.” Label arsip berisi sumber dan tanggal yang benar-benar ada. |
| Kickoff sudah lewat, hasil belum diterima | “Menunggu hasil dari sumber data.” Tutup pilihan baru. Gunakan label in-play hanya jika feed mengonfirmasi. |
| Data terakhir masih sah tetapi pengambilan baru gagal | “Pembaruan terakhir gagal. Menampilkan data per …” dengan waktu sukses yang sebenarnya. Jika tidak ada data sah, tampilkan kegagalan dan **Coba lagi**. |
| Nol hasil dinilai, atau seluruh hasilnya meleset | Nol hasil → “Belum ada pilihan yang bisa dinilai pada rentang ini.” Dari lima hasil, nol tepat → “0 dari 5 pilihan tepat (0%)”. |
| Memuat, ID tidak dikenal, terjadi kesalahan | Skeleton sederhana dengan `aria-busy`; 404 “Laga tidak ditemukan”; kegagalan sementara “Analisis belum bisa dimuat” dan aksi pemulihan. Tes tiap kondisi dengan fixture. |

## U7 · Sistem visual dan implementasi

- Gunakan latar kertas `#F7F6F2`, tinta `#18201E`, aksen utama `#F3B34B` dengan **teks gelap**. Gunakan garis tipis dan whitespace untuk kelompok. Simpan token yang dipakai runtime di satu tempat dan sinkronkan dokumentasi desainnya. Situs sekarang memakai tema gelap dan Archivo, sedangkan dokumen desain menyebut Geist terang. Implementor memilih satu sumber dan menghapus nilai duplikat yang digantikannya.
- Pertahankan Archivo bila aset yang sudah ada memungkinkan; siapkan fallback sans lokal. Beri angka skor dan persentase numeralia tabular. Lebar konten desktop sekitar 1.160–1.240 px; kolom informasi pendukung di kanan. Pada lebar 320–430 px, masthead dan menu masing-masing punya baris, kartu menjadi satu kolom, sisi kandang/tandang tetap terbaca dalam urutan alami. Judul panjang boleh membungkus. Gunakan jarak komponen konsisten, umumnya 8/12/16/24/32 px.
- Target kontrol 44 × 44 px, ring fokus terlihat pada semua permukaan, urutan tab masuk akal, teks normal berkontras minimal 4,5:1 dan teks besar 3:1. Status punya kata, bentuk atau ikon dan nama aksesibel. Tabel punya heading, navigasi aktif memakai `aria-current`, perubahan ringkasan menggunakan `aria-live="polite"` satu kali. Dukungan reduced-motion dan pembesaran tetap berfungsi. [Acuan kontras WCAG](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Reuse Server Components untuk konten pertama. Tambahkan interaktivitas hanya pada filter, pengungkapan dan builder. Hindari memuat aset tiga dimensi di jalur awal. Konsolidasikan `components/Nav{,Client}.tsx`, `components/ui.tsx`, `components/pilihan/ParlayBuilder.tsx`, `lib/web/{data,format,parlay}.ts`, `app/layout.tsx`, `app/globals.css`, dan token yang digunakan. Susun formatter Indonesia serta kamus pasar bersama. Verifikasi ejaan nama file terhadap checkout.
- Takeover visual dilaksanakan setelah adaptor menyediakan field yang benar. Gunakan `error.tsx`, `loading.tsx`, dan `not-found.tsx` pada batas yang tepat. Putusan apakah satu pilihan benar tetap milik backend. Rute dapat menampilkan hasil tanpa memanggil planner, model bahasa, atau API pihak ketiga pada saat render.

**Acuan yang dapat dibuka.** Prototipe memperagakan alur utama, satu laga tanpa analisis, hasil akhir, serta perhitungan kombinasi. Keadaan gangguan provider, proses migrasi, penyimpanan tiket resmi, riwayat revisi dan ekspor bukti memerlukan implementasi dan tes di repo. [Format saat ini](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/lib/web/format.ts) · [layout aplikasi](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/app/layout.tsx) · [builder saat ini](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/components/pilihan/ParlayBuilder.tsx) · [prototipe](visual/referensi.html).
