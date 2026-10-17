# Review database & brief perbaikan — Premier League

> Untuk coding agent. Audit lokal read-only pada 16 Oktober 2026. Fokus produk saat ini **Premier League**, bukan ekspansi ke liga lain. Angka di bawah adalah snapshot database lokal saat audit, bukan target minimum atau jaminan data real-time. Verifikasi ulang sebelum mengubah ingestion.

## Ringkasan keputusan

**Rapikan dataset dari raw vault, tetapi jangan langsung melatih model dengan semua kolom.** Enam puluh pertandingan memang wajar untuk tahap awal satu liga. Risiko utama saat ini adalah pemetaan data yang keliru, perbedaan data terukur vs estimasi, kesegaran cache, dan belum terhubungnya dataset baru ke alur prediksi aplikasi. Banyak kolom tersimpan di SQLite **tidak otomatis** menyebabkan overfitting; risiko itu timbul saat terlalu banyak parameter dipelajari dari sedikit observasi, apalagi bila evaluasinya bocor dari masa depan.

## Kondisi yang sudah dicek

| Sumber | Snapshot | Peran sekarang |
| --- | --- | --- |
| `data/football_master.db` | 22.394 laga, 16 divisi, 4 musim; tanggal pertandingan terakhir 2025-06-01 | Histori untuk kalibrasi offline; **bukan** telemetry PL musim berjalan. |
| `data/calibrated_ratings.json` | 16 liga, 428 tim; kompilasi 2026-10-13, tetapi tanggal pertandingan terbaru yang mendasari rating 2025-06-01 | Dibaca oleh `lib/quant/ratings-loader.ts` pada prediksi aktif. Perlu label umur data/validasi, bukan diasumsikan rating terbaru. |
| `data/thestats_dataset.db` | 20 tim, 60 laga selesai PL musim 2026/27, 120 team logs (6 per tim), 513 pemain; 95 kolom pada `team_match_logs` | Dataset telemetry baru; belum terlihat dibaca oleh route analisis aktif. |
| `data/thestats_raw_vault.db` | 134 payload: 49 stats, 49 lineups, 18 injuries, 17 players, 1 daftar matches | Sumber raw untuk audit dan re-ingestion, bukan sinyal prediksi yang langsung diberikan ke model. |

Ketiga file SQLite lolos `PRAGMA quick_check` dan `PRAGMA foreign_key_check` tidak menemukan pelanggaran. Ini hanya cek integritas penyimpanan/relasi, **bukan** bukti mapping dan semantik seluruh kolom benar.

## Temuan prioritas

### P0 — Cedera/suspensi masuk vault, tetapi tidak masuk status pemain

Raw vault memuat 56 entri injury dan 5 entri suspension dari 18 payload tim. Entri yang diperiksa memakai `player_id`, sedangkan `scripts/ingest-rich-telemetry-pl.ts` sekitar baris 155–165 mencari `inj.player?.id`/`susp.player?.id`. Dalam snapshot, 513/513 pemain di tabel skuad berstatus `FIT`. **Jangan menafsirkan `FIT` sebagai bukti tidak ada cedera.** Selain mapping, cek juga pemain yang tidak ada di katalog skuad dan dua tim tanpa payload injury.

**Arah fix:** baca ID sesuai shape raw yang benar setelah validasi; cocokkan dengan skuad; bedakan `FIT` (sumber aktual secara eksplisit menyatakan fit), `INJURED`/`SUSPENDED`, dan `UNKNOWN`/belum diverifikasi. Catat jumlah raw entry, yang match ke pemain, dan yang gagal match. Uji dengan fixture anonim yang memiliki injury serta suspension.

### P0 — Statistik pertandingan hilang tidak boleh diam-diam menjadi xG terukur

Dataset menyimpan 120 team logs; 98 memiliki `xg_for` (49 pertandingan), 22 tidak (11 pertandingan). Empat puluh sembilan payload stats di raw vault punya nilai xG pada shape yang diperiksa. `lib/db/team-telemetry.ts` sekitar baris 97–110 saat ini mengganti xG kosong dengan `goals_for * 0.85` dan npxG kosong dengan `goals_for * 0.75` dalam rolling metric; beberapa statistik lain juga punya default. Angka hasil imputasi itu **bukan observed xG/npxG**.

**Arah fix:** biarkan kolom observed `NULL` bila raw tidak ada; saat agregasi kembalikan jumlah sampel valid per metrik dan sumbernya. Jika memakai prior/estimasi untuk model, pisahkan nama/metadata `estimated`, jangan menampilkan sebagai data API terukur. Hindari membagi total xG valid dengan semua laga tanpa keputusan missingness yang eksplisit.

### P1 — Vault dan daftar pertandingan tidak punya kebijakan freshness yang memadai

`scripts/ingest-rich-telemetry-pl.ts:43-48` selalu mengembalikan payload vault jika tersedia; kunci injuries memakai ID tim dan kunci daftar matches tetap (`matches_${COMP_ID}_finished`). Perubahan status cedera dan laga baru bisa tertahan oleh snapshot lama. Snapshot daftar matches di vault berisi satu halaman berisi 100 entri; metadata menyatakan lebih dari satu halaman. **Jangan menganggap angka `meta.total` pasti jumlah laga PL musim ini** sampai perilaku filter/pagination API diverifikasi.

**Arah fix:** definisikan kebijakan per endpoint: hasil laga selesai/stats historis relatif stabil; injuries, skuad dan daftar laga butuh refresh dan `fetched_at`/`last_checked_at`. Verifikasi pagination, identitas kompetisi/musim, deduplikasi ID, dan stopping condition dari response sebelum ingestion dinyatakan lengkap. Jangan menghabiskan kuota dengan refresh semua payload setiap run; uji lewat fixture/offline lebih dulu.

### P1 — Dataset telemetry belum menyumbang ke prediksi aktif

`app/api/agent/route.tsx` memakai `lib/stats-fetcher-agent.ts` dan `getShrunkMatchParameters()` dari `lib/quant/ratings-loader.ts`; loader membaca `data/calibrated_ratings.json`. Query `getTeamRollingTelemetry()` dari `lib/db/team-telemetry.ts` ditemukan pada script eksplorasi, bukan di jalur route analisis. Memperbanyak kolom dataset sendirian belum memperbaiki output aplikasi.

**Arah fix:** setelah P0 beres, tentukan kontrak kecil untuk memakai telemetry **pra-laga** dengan status sumber, cutoff waktu, jumlah sampel, dan fallback eksplisit. Integrasi dan perubahan model merupakan pekerjaan terpisah; jangan diam-diam mengganti parameter Dixon–Coles yang sudah ada. Bandingkan hasil model lama vs kandidat lewat evaluasi historis sebelum dipakai untuk rekomendasi taruhan.

### P1 — Migrasi schema saat ini destruktif

`scripts/migrate-schema.ts:8-11` menjalankan `DROP TABLE` untuk `team_match_logs` dan `team_squads` tanpa transaksi yang membungkus keseluruhan migrasi. Jangan jalankan script ini pada dataset yang ingin dipertahankan. `CREATE TABLE IF NOT EXISTS` pada `lib/db/thestats-dataset.ts` tidak memigrasikan kolom tabel yang sudah ada.

**Arah fix:** backup SQLite secara konsisten (perhatikan mode WAL), tambah migrasi berversi dan uji pada salinan DB; jangan hapus tabel atau menjalankan re-ingestion yang memakai kuota tanpa persetujuan. Tetapkan validasi schema dan record count sebelum/sesudah migrasi.

## Model statistik: hindari overfitting & leakage

1. **Jangan gunakan 95 kolom sebagai 95 parameter bebas.** Mulai dari baseline yang sudah ada; eksperimen kandidat dengan sedikit sinyal yang masuk akal, misalnya rolling xG for/against dan kekuatan lawan, hanya jika cukup laga valid tersedia. Banyak fitur seperti shots, xG, big chances saling berkorelasi; jangan menghitung semua sebagai bukti independen.
2. **Unit observasi untuk evaluasi adalah pertandingan**, bukan dua team logs yang diperlakukan sebagai dua pertandingan independen. Enam laga per tim terlalu pendek untuk mengestimasi banyak koefisien spesifik tim. Pertahankan regularization/shrinkage ke prior dan tampilkan ukuran sampel.
3. **Potong data berdasarkan waktu kickoff.** Untuk memprediksi laga X, hanya gunakan pertandingan yang selesai, status cedera, lineup dan odds yang benar-benar tersedia *sebelum* kickoff X; statistik atau lineup final laga X adalah leakage. Simpan/cek `as_of` pada fitur, bukan hanya tanggal pertandingan.
4. **Walk-forward validation** pada urutan pertandingan PL: di tiap fold, fit/kalibrasi hanya memakai masa lalu, nilai prediksi pada periode berikutnya, lalu geser jendela. Bandingkan baseline vs kandidat pada laga yang sama dengan metrik yang cocok untuk target (mis. log loss/Brier untuk 1X2; kalibrasi probabilitas). Jangan menilai dari ROI kecil saja dan jangan tuning pada test fold berulang kali.
5. **60 laga bukan alasan untuk membuang dataset**; itu cukup untuk audit pipeline dan baseline eksplorasi, tetapi terlalu sedikit untuk klaim edge/value bet terkalibrasi dari puluhan fitur. Tetapkan aturan `PASS` saat sampel/coverage/freshness tidak memenuhi syarat yang disepakati, bukan mengisi keyakinan palsu.

## Instruksi implementasi untuk coding agent

Kerjakan **bertahap**, hanya Premier League, dan minta persetujuan sebelum tindakan destruktif atau pengeluaran kuota API besar:

1. **Audit ingestion offline dari raw vault.** Konfirmasi shape injury/suspension, jumlah raw vs matched, 49 stats vs 60 laga, daftar halaman matches, dan cakupan nilai non-null per fitur. Jangan tampilkan payload mentah/secrets di laporan.
2. **Perbaiki mapping dan pelabelan missingness.** Dahulukan injury/suspension dan observed-vs-estimated telemetry. Pertahankan raw vault asli; migration/backfill memakai salinan/backup; jangan overwrite status historis dengan snapshot cedera terbaru ketika membuat fitur pra-laga.
3. **Tetapkan freshness/pagination.** Refresh hanya resource dinamis yang kadaluarsa, buat proses ingestion idempotent, dan validasi jumlah laga serta coverage setelah refresh.
4. **Baru rancang integrasi ke analisis dan eksperimen model.** Mulai dari baseline, fitur minimal, cutoff `as_of`, ukuran sampel, dan evaluasi walk-forward. Jangan kirim rekomendasi taruhan/stake baru atas dasar data hasil imputasi atau odds fiktif.

### Acceptance criteria minimum

- Test offline menunjukkan injury dan suspension dengan `player_id` termap ke pemain yang sesuai; yang tidak cocok dilaporkan sebagai unknown, bukan otomatis `FIT`.
- Laga tanpa stats menyimpan xG/npxG observed sebagai `NULL`; rolling metric menyatakan berapa laga benar-benar berisi setiap metrik. Test memastikan default/estimasi tidak berlabel observed.
- Fixture multi-page membuktikan pagination berlanjut hingga selesai, tanpa duplikasi match ID; resource dinamis dapat di-refresh tanpa merusak payload historis.
- Migrasi pada salinan DB mempertahankan baris yang ada dan lolos `quick_check` + `foreign_key_check`; tidak ada `DROP TABLE` tak disetujui pada DB asli.
- Jika model diubah, ada pembandingan walk-forward baseline vs kandidat pada laga yang sama, tanpa fitur pasca-kickoff; bila belum ada bukti peningkatan yang stabil, pertahankan baseline.

**Di luar scope brief ini:** memperluas ke liga lain, menginstal dependency baru, mengubah UI, mengklaim ROI atau akurasi yang belum diukur, serta menjalankan script migrasi/re-ingestion terhadap file DB asli tanpa backup dan persetujuan.
