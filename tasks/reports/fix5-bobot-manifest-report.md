# Laporan Fix-5 — Bobot rujukan manifest: artefak immutable, pointer atomik, penjaga point-in-time

**Butir:** review pemilik K8 §5 ("Pastikan prediksi memakai bobot yang tercantum di manifest").
**Branch:** `fix/review-k8` · **Basis:** tip butir 3 (`3fa8042`) · **Commit perbaikan:** `2f3df21` · **κ tetap 10** · Tanpa merge, tanpa sentuh produksi/VPS/master.

## 1. Cacat yang ditutup

`scripts/calibrate-ratings.ts` menimpa `data/calibrated_ratings.json` **sebelum** manifest kandidat ditulis, dan `scripts/pick-slate.ts` memuat bobot dari file lepas itu tetapi membaca **nama versi** dari manifest aktif secara terpisah. Refit berikutnya dapat menghasilkan angka baru yang berlabel model lama — paritas K4 bocor di jalur waktu: yang berubah diam-diam adalah bobotnya, yang tercatat adalah label champion.

## 2. Desain perbaikan

### Artefak immutable per hash (store)

- Bobot disimpan di `data/model-artifacts/ratings-<sha256-penuh>.json` — content-addressed, satu file per isi unik, **tidak pernah ditimpa**. `storeRatingsArtifact()` (di `lib/quant/model-manifest.ts`): isi sama → no-op terverifikasi (`created=false`, byte diperiksa ulang); file bernama hash yang isinya tidak cocok dengan hash namanya → `artifact_conflict` (store rusak, berhenti bernama).
- Jalur fit tidak berubah bentuknya dari luar: `writeCandidateManifest()` sekarang **menyimpan artefak dulu, lalu membangun manifest kandidat dari byte yang sama persis** — kandidat selalu mendeskripsikan artefak yang tersimpan. Kedua pemanggil lama (`calibrate-ratings.ts`, `fit-global-offsets.ts`) otomatis ikut; rantai refresh (calibrate → offsets) menghasilkan artefak kandidat berurutan, masing-masing immutable.
- Bootstrap champion: `scripts/build-model-manifest.ts --activate` kini juga menyimpan artefak champion. Store repo berisi artefak champion saat ini: `ratings-8a790aeaa4e54fdd43dc….json` (hash cocok dengan `data/model-manifest.json`: `sha256:8a790aeaa4e54fdd`).

### Pointer aktif + validasi + identitas satu kesatuan

- Manifest aktif adalah **satu-satunya pointer**. `loadServingModel(dataDir)` membaca pointer **satu kali**, menyelesaikan artefak dari store lewat prefix `ratingsHash`, dan **memvalidasi dua lapis**: hash pendek isi artefak == `manifest.ratingsHash` DAN hash penuh isi == nama file. Artefak tidak ada → `artifact_missing`; isi berubah → `manifest_ratings_mismatch`. Tidak ada fallback ke file lepas dalam keadaan apa pun.
- `scripts/pick-slate.ts`: blok lama (hash dihitung dari file lepas + versi dibaca terpisah dari manifest) diganti satu panggilan `loadServingModel` **sebelum** pemuatan ratings dan jauh sebelum publikasi pertama (urutan ini dikunci tes wiring statis). Bobot artefak ditanam ke singleton `ratings-loader` lewat jahitan baru `setCalibratedRatingsOverride()` sehingga **seluruh konsumen dalam proses** (slate sendiri + planner) menghitung dari artefak pointer. Yang dicap ke paket terbit — `ratings_marker` dan `model_version` pada `publishPicks` — berasal dari objek manifest yang sama: angka dan label tidak bisa berpisah lagi.
- `scripts/evaluate-model.ts` memakai pintu yang sama (resolusi artefak + override), bukan lagi verifikasi terhadap file lepas.

### Perpindahan pointer hanya lewat promosi atomik

- `scripts/promote-model.ts` memverifikasi kandidat terhadap **store** (`verifyManifestArtifact`: artefak kandidat harus ada dan hash-cocok) menggantikan cek file lepas; kandidat basi → reject bernama seperti sebelumnya.
- Penulis manifest aktif dan kandidat kini menulis **atomik** (file temp di direktori yang sama + `rename`): pembaca pointer tidak pernah melihat manifest setengah tertulis, dan artefak yang dirujuk pointer baru sudah tersimpan sebelum flip (diverifikasi gerbang). Gerbang promosi K4 tetap satu-satunya penentu keputusan.

### Penjaga point-in-time di evaluator

- Bentuk yang dipilih: **berhenti bernama secara default** — konsisten dengan desain K4 (manifest hilang/rusak pun berhenti bernama; tidak ada fallback diam-diam di seluruh modul ini). `pointInTimeViolations(manifest, decisionAts)` menandai keputusan yang melanggar; `runEvaluation` melempar `ModelManifestError` berkode `point_in_time_violation` sebelum prediksi apa pun dihitung.
- Aturan (konservatif, dinyatakan terbuka di kode): pelanggaran iff `training.window.end >= tanggal keputusan`. Jendela latih berakhir pada tanggal laga terakhir yang masuk fit; tanggal saja tidak membuktikan jam ketersediaan hasil hari yang sama, jadi keputusan pada tanggal yang sama pun ditolak. Contoh review — keputusan 1 November dinilai rating berlatih s.d. 16 November — tertangkap aturan ini.
- Pengecualian hanya lewat `--allow-non-point-in-time` yang eksplisit; hasilnya **tercap mencolok**: field `pointInTime: false` + `pointInTimeWarning` di keluaran JSON dan banner `*** PERINGATAN: HASIL INI BUKAN POINT-IN-TIME ***` di stderr. Run yang sah membawa `pointInTime: true`.
- **Keterbatasan historis, apa adanya:** snapshot artefak per-keputusan dari era sebelum kartu ini **tidak ada** — rating historis hanya tersimpan sebagai file lepas yang tertimpa berkali-kali, jadi evaluasi atas keputusan lama **tidak dapat dibuat point-in-time secara retroaktif** dan laporan ini tidak mengklaim backtest point-in-time historis apa pun. Artefak immutable mulai kartu inilah yang membuat **shadow prospektif** mungkin ke depan: setiap keputusan baru dapat dinilai ulang persis dengan artefak yang aktif pada jam keputusan itu, karena artefaknya tidak akan pernah tertimpa.

## 3. Perubahan per file

| File | Perubahan |
|---|---|
| `lib/quant/model-manifest.ts` | Store artefak immutable (`storeRatingsArtifact`, `resolveRatingsArtifact`, `verifyManifestArtifact`, `artifactPath`, hash penuh), `loadServingModel` (pointer satu kali + validasi), `pointInTimeViolations`, kode galat baru (`artifact_missing`, `artifact_conflict`, `point_in_time_violation`), tulis manifest atomik, `writeCandidateManifest` menyimpan artefak sebelum membangun kandidat |
| `lib/quant/ratings-loader.ts` | Jahitan `setCalibratedRatingsOverride()` + `clearCalibratedRatingsCache()` pada singleton cache |
| `scripts/pick-slate.ts` | Blok penanda file lepas + baca manifest terpisah diganti `loadServingModel` + override; `ratings_marker`/`model_version` dari manifest yang sama; impor `createHash`/`loadActiveManifest` lama dibuang |
| `scripts/promote-model.ts` | Verifikasi kandidat berbasis store (`verifyManifestArtifact`) menggantikan cek file lepas |
| `scripts/build-model-manifest.ts` | `--activate` menyimpan artefak champion ke store |
| `scripts/evaluate-model.ts` | Bobot dari artefak pointer (bukan file lepas) + penjaga point-in-time (berhenti bernama / izin eksplisit tercap) + field `pointInTime` di keluaran |
| `data/model-artifacts/ratings-8a790….json` | BARU: artefak immutable champion aktif saat ini |
| `tests/test-model-artifacts.ts` | BARU: suite penerimaan fix-5 (32 assertion), dirantai ke `test:quant` |
| `tests/test-model.ts` | Cek wiring slate diperbarui ke jahitan baru (`loadServingModel`) — lihat penyimpangan §6 |
| `package.json` | `test:quant` merantai suite baru |

File read-only (`lib/agent/*`, `lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak disentuh.

## 4. Hasil uji penerimaan (suite `test-model-artifacts`, 32/32)

Naratif sandbox memakai artefak asli repo sebagai champion A dan subprocess asli (builder, gerbang CLI, evaluator):

1. **A tetap saat B ditolak.** Refit disimulasikan (liga B1 dibuang dari file lepas → kandidat latih menyusut): artefak kandidat tersimpan, manifest aktif **byte-identik**, gerbang CLI menolak (exit 2, `candidate_training_smaller`). Sesudahnya file lepas terbukti berisi B (hash B ≠ A), tetapi `loadServingModel` tetap mengembalikan versi + hash A, dan **prediksi evaluator identik byte-per-byte dengan dasar A** — bobot A yang dipakai, bukan file lepas B.
2. **B pindah bersama.** Kandidat B sah (serangan Arsenal diubah di semua fit yang memuatnya, versi artefak baru) dipromosikan lewat CLI resmi (exit 0, `promote`): pointer saji berpindah ke B (versi + hash + file artefak B), dan keluaran evaluator berpindah bersama — identitas B **dan** probabilitas berubah (probHome laga Arsenal berubah > 1e-6 dari dasar A).
3. **Hash dirusak → gagal eksplisit sebelum publikasi.** Satu byte artefak aktif diubah: `loadServingModel` (jahitan yang dipanggil slate sebelum penerbitan apa pun) melempar `manifest_ratings_mismatch`; evaluator subprocess berhenti bernama dengan kode yang sama dan **nol berkas keluaran terbit**. Kasus store kosong → `artifact_missing`; file bernama hash berisi asing → `artifact_conflict`.
4. **Point-in-time.** Keputusan 15 hari sebelum akhir jendela latih → evaluator berhenti `point_in_time_violation`; dengan `--allow-non-point-in-time` → jalan tetapi `pointInTime: false` + peringatan di JSON + banner di stderr; keputusan 5 hari sesudah jendela → `pointInTime: true`. Batas fungsi murni diuji termasuk contoh review (keputusan 1 Nov vs latih s.d. 16 Nov) dan kesamaan tanggal (melanggar).

## 5. Regresi

Seluruh permukaan hijau dari commit yang sama:

| Suite | Hasil |
|---|---|
| test:quant | 22/22 |
| test:model | 61/61 |
| test:model-artifacts (baru) | 32/32 |
| test:experiment-stats | 23/23 |
| test:data (data 18 + identity 58 + publication 110 + tickets 69 + resolver-score 23) | 278/278 |
| test:web (web 12 + ui 66 + rekam 110 + detail-render 27) | 215/215 |
| test:e2e | 7/7 |
| test:baseline:d01 | 12/12 |
| **Total** | **650/650** (618 permukaan lama + 32 baru) |

`npx tsc --noEmit` exit 0 · `npm run build` (env placeholder CI) exit 0.

## 6. Penyimpangan & catatan eksplisit

1. **Cek wiring `tests/test-model.ts` diubah** dari `loadActiveManifest` menjadi `loadServingModel` pada sumber slate — jahitan berevolusi oleh kartu ini; maksud invariantnya sama (slate memuat identitas dari manifest dan mencapnya ke pick) dan kini lebih kuat (pointer + artefak sekaligus).
2. **File lepas `calibrated_ratings.json` tetap ditulis jalur fit** sebagai salinan kerja (pembaca lab/web warisan dan `fit-global-offsets` membacanya) — yang berubah: ia **bukan lagi sumber bobot** bagi saji, promosi, maupun evaluator. Komponen sehat tidak dibongkar; otoritas berpindah, bukan file dimusnahkan.
3. **"Jalankan slate" pada penerimaan** dibuktikan pada jahitan saji yang sama persis dengan yang dieksekusi pick-slate (muat pointer → override loader → prediktor bersama, lewat evaluator subprocess) plus kunci urutan statis (muat sebelum `publishPicks` pertama) — pola yang sama dengan sandbox paritas K4; pick-slate penuh tidak dijalankan di sandbox karena membutuhkan seluruh tumpukan DB produksi.
4. **Konsekuensi operasional yang disengaja** (semantik yang diminta review): sesudah perbaikan ini terdeploy, refit refresh 12 jam hanya menghasilkan **kandidat** — bobot saji membeku pada champion sampai promosi eksplisit dijalankan. Promosi menjadi langkah operasional yang terlihat, bukan efek samping refresh.
5. **Penemuan samping:** resolusi saji Premier League memakai fit `SM8` (Sportmonks), bukan `E0` — tes B karena itu mengubah Arsenal di semua fit yang memuatnya. Bukan cacat kartu ini; dicatat agar tidak mengejutkan pembaca tes.
6. `verifyManifestRatings` (cek terhadap byte mentah) dipertahankan sebagai fungsi lib untuk kompatibilitas suite K4; jalur promosi tidak lagi memakainya.
