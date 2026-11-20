# Kartu kerja Muse Spark

Pilih kartu pertama yang dependensinya sudah selesai. Mulai sesi baru dengan judul kartu, SHA branch saat itu, tautan bab dan hasil PR yang mendahului. Setelah satu kartu lolos, tulis ringkasan untuk kartu berikutnya. Jika tugas terlalu besar untuk satu PR, pecah di batas yang disebut di kartu. Tidak perlu menyalin seluruh PRD ke setiap prompt.

## K0 · CI dapat direproduksi

**Prompt.** Telusuri workflow dari checkout sampai tes. Buktikan file mana yang dipanggil dan ada. Siapkan Node 24, data SQLite sementara, provider tiruan, seeded clock, dan entrypoint npm pada bab QA. Hubungkan tes quant, pilihan, data dan frontend serta build. Pertahankan maksud uji lama dengan assertion yang bisa gagal. Sertakan reproduksi D01 melalui importer sebenarnya dan log baseline. Selesai bila dua checkout bersih memberi hasil yang sama dan kegagalan yang disengaja membuat job merah. Fokus perubahan pada workflow, skrip test dan injeksi path/clock minimum.

## K1 · Satu pertandingan, satu hasil

**Prompt.** Gambar satu contoh row dari CSV sampai `getMatchDetail` pada kedua kasus D01. Perbaiki upsert hasil untuk row yang sudah ada dan parser registry `links`. Tambahkan UID persisten, indeks alias dua arah, dan normalisasi status/skor di reader dan writer. Jalankan D01–D04, termasuk dua leg yang tidak boleh digabung, 0–0 dan koreksi hasil. Tunjukkan kueri sebelum/sesudah untuk dua fixture. Jika dipecah, selesaikan resolver dan migrasi dahulu, lalu sambungkan importer, resolver hasil dan adapter web. Buka `scripts/import-free-feed.ts`, `scripts/build-fixture-links.ts`, `scripts/resolve-pick-outcomes.ts`, `lib/web/data.ts` dan bab Data.

## K2 · Publikasi yang dapat ditelusuri

**Prompt.** Temukan tempat slate menulis paket dan ledger. Tambahkan identitas operasi yang stabil, validasi cutoff pada saat commit, idempotensi antar-worker dan referensi paket asli. Pastikan snapshot A tetap menjawab pertanyaan “berapa peluang saat terbit?” setelah paket B tersedia. Migrasi data yang benar-benar punya bukti; beri status `unknown_legacy` pada sisanya. Hitung lima kelompok hasil dan cakupan D07, lalu bandingkan claim dan outcome pada sampel yang sama. Jalankan D05–D08. Review cukup dengan satu ledger contoh, dua waktu, dua paket dan satu koreksi yang membuktikan statistik terinvalidasi.

## K3 · Tiket resmi dan perhitungan gabungan

**Prompt.** Pisahkan tiket resmi yang diterbitkan server dan pilihan yang disusun di browser. Simpan seluruh leg, snapshot, waktu, versi kebijakan dan basis peluang dalam satu transaksi ledger. Gunakan satu UID per laga dan irisan score matrix untuk dua predikat dari laga yang sama. Tambah aksi baca tiket resmi beserta hasil setiap leg. Jalankan D09, Q01, Q04. Bukti minimum adalah kasus alias 80%, irisan 51%, dua laga 35,2%, dan satu tingkat kepastian yang tak bisa dihitung karena matriks hilang. Verifikasi `lib/web/parlay.ts`, `lib/picks/{packages,ledger}.ts` dan penulis slate.

## K4 · Prediktor yang sama untuk backtest dan produksi

**Prompt.** Ambil satu fixture dan catat data yang diketahui pada jam keputusan. Ekstrak atau reuse kalkulasi murni yang sudah ada; delegasikan adapter live dan evaluator ke prediktor yang sama. Pindahkan pembentukan fitur, registry dan baseline liga ke pembaca yang menghormati `available_at`. Uji masukan sama sebelum/sesudah dan suntikan data masa depan. Jalankan Q01–Q04. Berikan satu manifest lengkap yang dapat mengulang output tanpa memakai berkas “latest” saat ini. Kerjakan perubahan evaluator dan perubahan wrapper live dalam commit yang bisa diperiksa sendiri-sendiri.

## K5 · Uji kandidat κ-fit 20

**Prompt.** Daftarkan A/B/C/H, horizon utama dan calon konfigurasi sebelum membuka hasil H. Pertahankan κ-fit 10 sebagai champion dan bandingkan κ-fit 20 pada baris identik; sejajarkan blend, prior, input, jam keputusan dan kebijakan pilihan agar hanya satu hipotesis berubah. Bekukan kalibrasi. Laporkan ukuran irisan, log-loss, Brier, kalibrasi, interval Δ dan cakupan. Pasar penutupan dilaporkan dalam panel terpisah. Jika H yang benar-benar baru atau data prospektif belum cukup, serahkan `inconclusive` dan daftar data yang masih dibutuhkan. Perubahan default produksi memerlukan bukti pada bab Model.

## K6 · Beranda, jadwal dan detail

**Prompt.** Buka prototipe HTML pada Beranda, Jadwal dan Laga. Ubah struktur informasi terlebih dahulu; jadwal adalah sumber daftar, detail tetap dapat dibuka tanpa paket atau odds. Terapkan token bersama, format WIB/Indonesia, nav aktif, judul tab, teks error/loading/404 dan tiga probabilitas bernama. Pindahkan data pendukung setelah ringkasan. Verifikasi `app/page.tsx`, navigasi, `app/(terminal)/pertandingan` dan `lib/web/{data,format}.ts`. Serahkan U01/U02/U04/U06/U07/U08 beserta gambar 390 dan 1440 px. Jangan mengganti URL publik.

## K7 · Pilihan dan rekam hasil

**Prompt.** Hubungkan builder ke data K2–K3 dan render peluang resmi, jumlah pilihan, jumlah laga unik serta alasan hitung. Pastikan keadaan saat kickoff berubah, alias duplikat, batas 12 dan tombol Hapus/Kosongkan tetap berfungsi. Hubungkan rekam ke cohort tertutupnya: tampilkan `tepat/dinilai`, periode, rata-rata peluang atas irisan tercatat dan cakupan jatuh tempo. Pisahkan resmi, draf pengguna dan lab. Sediakan detail tiket resmi. Serahkan U03–U08 dan contoh 6/8 tepat dengan rata-rata peluang 71,3% yang cocok dengan 8 row sumber.

## K8 · Penerimaan aplikasi

**Prompt.** Jalankan seluruh D/Q/U yang relevan pada build staging dengan fixture, periksa empat endpoint yang didukung, biaya query pada 10/75 laga dan cache setelah koreksi. Ulang alur ketika provider hilang, data telat dan proses berhenti di tengah. Uji backup/restore dan pembaca kompatibel di lingkungan terpisah, lalu dokumentasikan urutan rilis serta tanda untuk kembali. Sertakan status eksperimen model dan status paritas GitHub–VPS sebagai dua catatan mandiri. Laporkan hanya tes yang benar-benar dijalankan.

## Format jawaban setiap PR

1. Tujuan kartu dan SHA awal.
2. Masukan reproduksi, hasil saat mulai, dan hasil yang diharapkan.
3. File produser, file pembaca, migrasi dan perilaku untuk data lama.
4. Perintah yang dijalankan, hasil/exit code, jumlah assertion atau sampel, serta file hasil.
5. Dampak ke pengguna, cara kembali, hal yang belum terbukti, dan kartu berikut yang dependensinya terpenuhi.
