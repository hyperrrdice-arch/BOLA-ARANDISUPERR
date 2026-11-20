# Data, API, dan ledger

**Dipakai pada K1–K3 dan integrasi K6–K7.** Bangun vertikal pertama dari satu fixture CSV sampai skor tampil di detail. Pertahankan `match_id` lama sebagai alamat yang sah. Semua nama kolom tambahan di sini merupakan usulan kontrak; cocokkan dengan `PRAGMA table_info` dan fungsi existing sebelum menulis migrasi.

## D1 · Pemilik data dan identitas pertandingan

| Store | Data yang dimiliki | Pembaca dan penulis |
|---|---|---|
| `upcoming_fixtures.db` | Katalog sumber, jadwal, `sm_id_map` | Importer menulis. Slate dan adapter jadwal membaca. Pembersihan katalog tidak boleh memutus histori. |
| `thestats_dataset.db` | Tim, liga, pertandingan, telemetri, odds, hasil kanonik | Tambahkan identitas fixture yang persisten serta revisi hasil di sini. Referensikan canonical team/league registries yang sudah ada. |
| `analysis_snapshots.db` | Tabel `packages`, matriks, metadata, penanda rating dan waktu penghitungan | `lib/picks/packages.ts` menyimpan paket. Paket yang pernah dipakai publik mempunyai referensi stabil. |
| `picks.db` | Pilihan resmi, hasil pilihan, tiket resmi dan anggota | `lib/picks/ledger.ts` menjadi penulis keputusan/hasil. Web membaca generasi yang sudah lengkap. |
| `predictions.db` | Panel probabilitas arsip Sportmonks | Hanya sumber pembanding berlabel. Nilai panel tidak mengisi harga bookmaker atau peluang kuant. |

Usulan struktur minimum di dataset: `canonical_fixtures(fixture_uid PRIMARY KEY, competition_cid, season, home_cid, away_cid, stage_or_leg, kickoff_current_utc, state, neutral)` dan `fixture_aliases(source, source_match_id, fixture_uid, first_seen_utc, last_seen_utc, match_basis)`. Pasangan `(source, source_match_id)` unik. Indeks balik `fixture_uid` harus mengembalikan seluruh alias. Gunakan UID opak yang disimpan sekali; ID ini bertahan ketika kickoff, nama tampilan, atau sumber utama berubah. Simpan ID sumber asli pada row lama. Registry lama dan `fixture-links.json` boleh menjadi input awal. File saat ini berbentuk `links[].{twin_id,canonical_id}`, sedangkan pembaca web mencari `groups`. Sediakan satu parser tervalidasi.

**Algoritme pencocokan.**

1. Cari alias yang sudah diketahui atau kaitan resmi dari provider. Jika ada, gunakan UID dan validasi sisi tim. Simpan perubahan jadwal sebagai revisi.
2. Untuk kandidat baru, cocokkan kompetisi kanonik, musim, tim kandang/tamu berurutan, dan kickoff tepercaya. Cocokkan babak/leg bila tersedia. Gabungkan otomatis hanya jika satu kandidat memenuhi bukti tersebut; simpan alasan.
3. Dua kandidat, tanggal tanpa jam, pertukaran sisi pada venue netral, perubahan tanggal tanpa referensi, tim senior vs cadangan/putri, atau dua leg berbeda masuk antrean peninjauan. Simpan observasi asli dan alasan `identity_ambiguous`; tangguhkan publikasi atau settlement yang akan mengandalkannya. Terima pertandingan berbeda pada hari yang sama bila kompetisi/babaknya berbeda.
4. Kedua proses impor, jadwal dan hasil, memanggil resolver ini dan menyimpan kaitan walaupun row katalog telah ada. Satukan identitas sebelum deduplikasi slate, pemilihan paket, penilaian hasil dan penghitungan tiket. URL alias yang sah memberi detail kanonik dengan skor yang sama.

Titik kode: [impor fixture dan hasil](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/scripts/import-free-feed.ts#L179) · [builder alias](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/scripts/build-fixture-links.ts#L43) · [resolver hasil](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/scripts/resolve-pick-outcomes.ts#L45) · [pembaca web](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/lib/web/data.ts#L238).

## D2 · Status, hasil 90 menit dan koreksi

| Kejadian | Transisi dan akibat |
|---|---|
| Jadwal masuk | `scheduled`, kickoff UTC dan presisi waktu disimpan. `00:00` hasil imputasi diberi penanda kepastian. |
| Kickoff tiba atau dimajukan | Hilangkan dari daftar pilihan yang masih dapat disusun sejak waktu kickoff. Jika tidak ada feed live, tampilkan “Waktu sepak mula telah lewat · menunggu hasil”. Waktu saja tidak menyatakan laga sudah selesai. |
| Skor final 0–0 atau 2–1 | Terima status final yang dipetakan adapter, antara lain `FT` dan `finished`. Verifikasi kedua skor ada, bilangan bulat dan ≥0. Perbarui row sebelumnya yang `scheduled`, termasuk telemetri pendamping yang tersedia. |
| Piala, perpanjangan waktu, penalti | Pasar standar diselesaikan dari skor 90 menit termasuk tambahan waktu. Simpan skor normal, ekstra dan penalti terpisah. Jika sumber hanya menyediakan skor setelah adu penalti, tampilkan hasil tersedia dengan basisnya, dan tandai pasar 90 menit `pending_score_basis`. |
| Laga ditunda atau dibatalkan | Laga ditunda tetap pada UID, dengan waktu baru jika dikonfirmasi. Untuk rilis ini, pilihan resmi ditandai void ketika provider membatalkan laga, atau menjadwalkan ulang ke hari kalender WIB yang berbeda setelah publikasi. Pergeseran jam pada hari yang sama tetap sah selama waktu terbit mendahului kickoff revisi. Catat aturan dalam `settlement_policy_version`. |
| Feed terlambat, konflik atau koreksi | Poll lama `scheduled/null` tidak menurunkan status final. Append observasi sumber dengan cap waktu dan checksum. Konflik final dua sumber dengan otoritas setara menunggu review; koreksi sumber hasil yang disepakati membuat `result_revision` baru. Nilai ulang seluruh pilihan/tiket terkait, dengan jejak skor sebelumnya. |

Satu fungsi `evaluatePick` tetap menjadi sumber semantik pasar. Validasi pasangan kode pasar/seleksi sebelum memanggilnya. Kode yang tidak dikenal mendapat alasan `unsupported_market` dan tetap di luar angka menang/kalah. Publik melihat “Menunggu verifikasi hasil” atau “Dibatalkan” sesuai status. Web memakai status internal yang sama untuk daftar selesai, detail dan rekam hasil. [Aturan pasar saat ini](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/lib/picks/ledger.ts#L303).

## D3 · Pilihan yang beku saat terbit

**Satu pilihan resmi** adalah keputusan pertama dalam seri produksi pada `(fixture_uid, market, line, selection, series)`. Untuk pasar yang telah mengodekan garis, misalnya `ou25`, normalisasikan `line` sekali. Gunakan nilai kanonik yang pasti untuk pasar tanpa garis agar indeks UNIQUE tidak dilonggarkan oleh perilaku NULL di SQLite. Versi model, waktu refresh dan versi paket adalah metadata. Upgrade versi tidak mencetak pilihan kedua di seri yang sama. Kandidat lab, calon model dan slip pribadi terpisah.

| Bidang | Aturan saat penulisan |
|---|---|
| Identitas | `pick_uid`, `fixture_uid`, `source_match_id`, `market`, `line`, `selection`, `series`, referensi `package_id` lama dan kunci paket stabil bila lintas salinan. |
| Waktu dan versi | `decision_at_utc` adalah batas informasi, `published_at_utc` waktu terbit yang berhasil, `kickoff_at_issue_utc`, `model_version`, hash rating, `grade_policy_version`, `settlement_policy_version`, `code_sha`, `input_snapshot_id`. |
| Angka yang ditampilkan | Simpan `model_prob`, `effective_prob`, `published_prob` dan `probability_basis`. Untuk rilis kompatibilitas, `published_prob = effective_prob ?? model_prob` memakai nilai terpilih yang tersedia dan valid saat terbit. Jika nilai efektif tersedia tetapi invalid, tandai kesalahan input, jangan mengubahnya secara diam-diam. Nol tetap nilai sah. |
| Bukti dan harga | `grade`, `gate_status`, kualitas bukti segmen, serta sumber dan umur bukti pada waktu terbit. Odds menyimpan bookmaker, periode, garis, nilai desimal dan waktu tangkap. Data hilang tetap null dengan alasan. |
| Komit | Cek `decision_at ≤ published_at < kickoff` dan status `scheduled` lagi saat publikasi. Bila diketahui aktual lebih awal, gunakan batas yang lebih awal. Run yang dimulai sebelum kickoff tetapi baru selesai sesudahnya menyimpan analisis internal saja. |

**Retry lintas DB.** Buat identitas operasi stabil dari seri, fixture, cutoff yang dijadwalkan dan fingerprint input; simpan intent sebelum memulai. Tulis paket dulu dengan unique computation key. Dalam satu transaksi `picks.db`, verifikasi identitas/hash paket, tulis baris pilihan, dan commit status publikasi lengkap. Bila mati setelah paket, retry menemukan paket yang sama. Bila mati setelah ledger commit, retry mengenali operation key yang sudah sukses. Berkas WAL dari beberapa SQLite tidak memberikan jaminan commit serentak lintas berkas ketika host gagal. Gunakan transaksi lokal, unique key dan rekonsiliasi read-only untuk mendeteksi intent tertunda. `computed_utc = now()` sendirian tidak mengidentifikasi retry. [Kontrak SQLite](https://www.sqlite.org/lang_attach.html) · [penulis paket](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/lib/picks/packages.ts#L226).

**Paket versi kedua.** Detail dapat menampilkan analisis terbaru selama belum kickoff, dengan cap waktunya. Bagian “Prediksi saat terbit” selalu mengambil `package_id` milik pilihan resmi. Setelah laga selesai, utamakan snapshot resmi dan skor 90 menit. Riwayat awal yang tidak menyimpan peluang terbit hanya dapat diberi nilai dari bukti immutable yang benar-benar merekam angka yang ditampilkan. Jika bukti tidak ada, tulis `unknown_legacy` dan tampilkan jumlah yang dikeluarkan dari perbandingan probabilitas.

## D4 · Tiket resmi dan statistik yang bisa diperiksa

Tambahkan `published_slips(slip_uid, edition_key, slot, series, published_utc, policy_version, combined_prob, combined_basis, state)` dan `slip_legs(slip_uid, position, pick_uid, fixture_uid, package_ref, frozen_prob)`. Cegah duplikat `(series, edition_key, slot)` dan `(slip_uid, pick_uid)`. Publikasikan tiket dan seluruh anggota dalam satu transaksi di ledger. Semua anggota sudah resmi dan belum kickoff. Simpan komposisi saat terbit. Mengganti satu anggota memerlukan tiket baru yang ditandai terpisah dan tidak membatalkan jejak tiket lama.

Tiket resmi menang bila seluruh pilihan menang. Saat seluruh anggota mempunyai hasil terminal, tiket dengan satu kekalahan masuk kalah, tiket yang seluruhnya menang masuk tepat, dan tiket yang mengandung void tanpa kekalahan masuk batal untuk evaluasi probabilitas gabungan asli. Selama masih ada anggota tertunda, boleh tampilkan “Sudah ada pilihan yang meleset”, tetapi status evaluasi akhir tetap tertunda agar waktu inklusi adil. Slip yang disusun sendiri di browser tidak masuk penyebut rekam hasil. Simpan sumber tiket dan versi aturan. Sediakan jalur baca satu tiket resmi melalui `/bukti?tiket=<slip_uid>` dan tautan ke snapshot setiap anggota.

| Ukuran pada filter yang sama | Pembilang, penyebut, dan tampilan |
|---|---|
| Tepat per pilihan | `hit / (hit + miss)`. Sertakan `jumlah tepat / jumlah dinilai`. Hitung per edisi resmi pertama, setelah alias duplikat ditandai. |
| Cakupan penilaian | `dinilai / (dinilai + pending yang sudah jatuh tempo)`. Untuk pasar 90 menit, batas jatuh tempo yang diusulkan adalah 6 jam setelah kickoff, dengan ketentuan final terverifikasi yang datang lebih awal langsung layak. Bedakan belum mulai, sedang menunggu jendela, void, sumber tidak mencakup, dan konflik. Pending tanpa sumber tetap ada dalam penyebut yang sudah jatuh tempo. |
| Peluang terbit vs kenyataan | `AVG(published_prob)` dan `AVG(hit)` pada irisan baris terselesaikan dengan peluang terbit diketahui. Tampilkan jumlah irisan serta jumlah warisan yang hanya bisa dinilai hit/miss. |
| Tepat per tiket | `tiket tepat / (tiket tepat + tiket meleset)` untuk tiket resmi yang selesai. Laporkan void, pending, jumlah pertandingan unik, panjang tiket, periode dan model. |
| Nilai kosong | Angka 0% berarti setidaknya ada satu observasi yang dinilai. Tanpa penyebut, tampilkan “Belum ada hasil” dan jumlah atau alasan yang tersedia. |

## D5 · API, kompatibilitas, dan performa baca

Halaman saat ini menggunakan fungsi di `lib/web/data.ts` langsung dari Server Components. Gunakan kemampuan baca yang sama untuk halaman dan adapter yang memerlukannya. Pertahankan bentuk respons publik yang sudah dikonsumsi; bidang baru bersifat aditif. Sediakan snapshot kontrak untuk sukses, kosong dan error sebelum mengubah adapter.

| Pintu masuk | Kontrak kompatibilitas dan uji |
|---|---|
| `GET /api/matches` | Pertahankan `hours` (default 12, rentang 1–48) dan `competition_id`. Uji store lokal dan fallback terisolasi. Daftar nyata dedup per UID. Bedakan response 200 berisi nol pertandingan dari data sementara tak tersedia. |
| `GET /api/odds?match_id=…` | ID kosong tetap 400. Dukung quote football-data berbentuk `books` dan format lama `bookmakers`; satu pembaca bersama jalur slate. Pertahankan bidang availability, bookmaker, cap waktu dan harga. Cek quote E0 2,10, garis, periode dan bookmaker. Odds pra-laga, closing, dan panel arsip diberi tipe berbeda. |
| `GET /api/agent` | Pertahankan `match_id`, hint kompetisi dan bentuk `debug=1`; uji output normal, cache hit/miss, 400 saat ID kosong dan rate limit yang ada menggunakan stub lokal. Membaca analisis tidak menerbitkan pick atau tiket resmi. |
| `GET/POST /api/betting` | Adapter lama untuk ID 1xBet/nama tim. Pertahankan status konfigurasi 503, input tidak valid 400 ketika konfigurasi tersedia, serta bentuk `not_found`, `empty`, `success` pada cabang yang mendukungnya. Uji kontrak dengan stub. Pisahkan ID provider dari UID laga. |

Titik masuk: [matches](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/app/api/matches/route.ts) · [odds](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/app/api/odds/route.ts) · [agent](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/app/api/agent/route.tsx) · [betting](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/app/api/betting/route.ts) · [lapisan baca halaman](https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR/blob/b9b38713b214f4e34c5e56c4cb5c222e4ab50c64/lib/web/data.ts).

Untuk landing, ambil kandidat terbatas dalam urutan kickoff yang deterministik. Daftar jadwal mengambil data ringkas, hasil satu batch per store serta alias yang diperlukan. Detail baru mengambil score matrix lengkap. Indeks mengikuti predicate dan `ORDER BY` yang benar-benar dipakai. Untuk bukti, cache agregat per versi ledger, revisi hasil dan filter; invalidasi saat publikasi atau koreksi, termasuk koreksi dengan jumlah baris tetap. Kriteria query dan uji ukuran data ada di bab QA.

## D6 · Menelusuri satu putaran pipeline

| Langkah di `scripts/free-refresh.ts` | Artefak atau fakta yang diverifikasi pada uji integrasi |
|---|---|
| 1. Import feed | Simpan waktu tangkap, ID provider dan jenis sumber untuk jadwal, hasil, telemetri, odds pra-laga dan closing. Validasi skema serta karantina baris invalid dengan alasan. Rekam jumlah accepted, updated, unchanged dan rejected. |
| 2–3. Registry tim dan tautan fixture | Tim dan liga referensial dapat di-resolve. Seluruh alias terkonfirmasi dapat ditemukan dari UID maupun ID lama. Catat jumlah yang tetap ambigu. Registry yang dipakai prediksi mempunyai versi. |
| 4–5. Fit rating dan offset | Tulis artefak fit, hash fitur, cutoff dan versi konfigurasi. Terapkan offset piala sesudah refit; verifikasi blok offset masih ada di artefak yang benar-benar dimuat. Liganya tercatat ketika fit tidak tersedia. |
| 6. Telemetri kanonik | Pilih satu observasi tepercaya per kunci, simpan sumber dan konflik. Pembaca memakai generasi yang sudah selesai. Catatan terpisah menangani paritas implementasi GitHub dengan VPS baru. |
| 7. Slate 72 jam | Baca fixture unik dan data as-of, hitung paket per laga, catat alasan tidak terpilih, tulis pilihan/tiket sesuai kebijakan yang dibekukan. Verifikasi terbit < kickoff. Jumlah 0 sah bila benar-benar tidak ada yang memenuhi syarat. |
| 8. Resolve | Konsumsi hasil final yang telah terverifikasi atau koreksi terbaru, evaluasi leg dan tiket resmi serta naikkan revisi generasi rekam. Detail dan `/bukti` membaca generasi yang sama. Monitor umur dan alasan item yang masih tertunda. |

Buat manifest putaran yang merekam `run_id`, waktu mulai/akhir, status dan jumlah per tahap, versi input/output, serta status data yang ditampilkan. Kegagalan pada satu tahap memberi hasil parsial yang eksplisit; paket lama yang utuh tetap bisa dibaca dengan waktu asalnya. Jika rangkaian memilih melanjutkan sesudah langkah gagal, tahap dependen harus memeriksa versi masukan. Ia tidak boleh menerbitkan paket berlabel baru memakai data lama tanpa merekam sumber, umur dan keputusan fallback.

**Cakupan sumber.** Bedakan `football-data.co.uk` untuk liga yang diliput feed gratis, fixture lama dari arsip Sportmonks, dan panel probabilitas arsip. Jangan menebak odds atau hasil kompetisi di luar jangkauan. Catat `last_success_at`, fixture berikut/terakhir per kompetisi, `fixture_coverage_until` bila benar-benar diketahui, serta sumber yang berwenang memberi skor. Uji tanggal sesudah akhir katalog arsip pada 5 Januari 2027 dengan satu liga tercakup feed gratis dan satu hanya di arsip. Liga tercakup tetap tampil; liga tanpa sumber aktif memberi label cakupan terbatas. Opsi provider baru melewati adapter, pemeriksaan kelengkapan pasar dan anggaran tersendiri.

**Kontrak baca untuk komponen.** Sediakan objek ringkasan berisi `fixture_uid`, nama kedua tim, `kickoff_utc`, presisi waktu, status resmi, skor regulasi nullable, liputan, waktu observasi dan ketersediaan analisis. Detail menambah `latest_package` nullable, `issued_picks[]` yang refer ke paket asal, sumber per pasar, dan alasan untuk nilai yang hilang. Ringkasan bukti membawa filter efektif, jumlah terbit/dinilai/tepat/pending/void, jumlah laga unik, ukuran irisan peluang-tercatat, dan revisi agregat. DTO daftar tidak membawa seluruh matriks. Satu adapter teruji membentuk DTO bagi komponen lama dan baru selama rollout.
