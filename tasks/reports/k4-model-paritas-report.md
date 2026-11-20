# Laporan K4 — Model yang Sama di Lab dan Produksi

- **Branch:** `prd/k4-model-paritas` (worktree `~/workspace/coding/app-football-k4`)
- **SHA awal:** `96f8baa` (tip `prd/k3-tiket-resmi`)
- **Commit K4:**
  - `5e90ab7` feat(quant): ekstraksi fit bersama dari calibrate-ratings
  - `5cc3463` feat(quant): manifest model berversi + gerbang promosi
  - `f1af448` feat(quant): prediktor bersama + snapshot as-of + evaluator lab + slate memuat manifest
  - `09fbb8e` test(quant): suite Q01–Q04 paritas model (K4)
  - commit laporan ini
- **Status:** selesai di branch; **belum merge** (keputusan pemilik: merge
  setelah K8), **belum deploy**, database produksi tidak ditulis (semua
  bukti fit/paritas/promosi berjalan di sandbox/salinan).

## Ringkasan

Jalur rating lab dan produksi sekarang disatukan di belakang satu
**manifest model berversi** (`data/model-manifest.json`): konfigurasi
(κ, kfit, half-life, mode ρ, blend James-Stein), cakupan data latih
(total + per liga + jendela), status kalibrasi, dan hash artefak rating
+ hash isi manifest. Jalur fit menulis **kandidat**; manifest aktif hanya
berubah lewat **gerbang promosi** eksplisit; refresh tidak pernah
mempromosikan diam-diam. Jalur produksi (pick-slate) dan jalur lab
(evaluator) **memuat manifest yang sama** dan berhenti dengan kesalahan
bernama bila manifest hilang/rusak/tidak cocok. Prediksi kedua jalur
memakai komposisi parameter yang sama persis (satu prediktor bersama),
sehingga paritas pada sampel yang dinyatakan dokumen terukur **0**.

κ/kfit produksi **tidak berubah** (tetap 10/10) — eksperimen kandidat
κ-fit 20 adalah wilayah K5.

## Q01–Q04 satu per satu

Suite: `tests/test-model.ts` (**61 assertion**), dirantai ke
`npm run test:quant`. Semua lewat jalur sebenarnya (mesin Dixon-Coles,
`probFromMatrix`/`jointProbFromMatrix` produksi, fit produksi, evaluator
lab `scripts/evaluate-model.ts`, dan jalur produksi asli
`buildQuantPackage` planner lewat `tests/helpers/predict-runner.ts`).

### Q01 — Integritas probabilitas · LULUS

- Masukan: matriks fixture `joint_matrix` dari `acceptance.json`
  ([[0.10,0.08,0.02],[0.12,0.10,0.03],[0.20,0.15,0.20]]) + matriks
  Dixon-Coles asli dari parameter contoh.
- Hasil: P(1)=0,47, P(X)=0,40, P(2)=0,13, P(1X)=0,87 (toleransi 1e-8);
  irisan 1∩1X=0,47; 1∩2=0; urutan P(1X) ≥ 1∩1X ≥ 1∩2 terpenuhi;
  Σ sel matriks fixture = 1 dan Σ sel matriks DC = 1 ± 1e-9; semua sel
  ≥ 0; produk dua laga independen (dibangun sebagai produk luar dua
  matriks) cocok dengan perkalian peluangnya dalam 1e-12.
- Harapan dokumen: persis angka-angka di atas. ✔

### Q02 — Determinisme dan pemisahan latih/uji · LULUS

- Fit deterministik: `fitLeagueRatings` (IPF + peluruhan waktu +
  penyusutan log-space) diekstrak **verbatim** dari
  `scripts/calibrate-ratings.ts` ke `lib/quant/fit.ts`; dua kali fit
  pada masukan sintetis yang sama (30 laga, 6 tim) menghasilkan
  parameter yang **identik persis** (serialisasi dibandingkan byte per
  byte), termasuk `fitRhoOnTrain`.
- Bukti ekstraksi tidak mengubah perilaku: `calibrate-ratings.ts` versi
  K3 vs K4 dijalankan pada dataset sintetis identik (2 kompetisi × 112
  laga) — **selisih parameter maksimum 0,0** (leagueAvgGoals,
  homeAdvantage, ρ, attack/defense semua tim).
- Pemisahan latih/uji: `selectTrainingRows(rows, cutoff)` hanya
  mengambil baris final bertanggal **< cutoff**; uji menyuntik baris
  tepat pada cutoff dan sesudahnya → keduanya tertolak (30 dari 32
  dipertahankan), dan fit pada baris terseleksi = fit pada data
  dalam-jendela.
- Hash rating: manifest memakai konvensi yang sama dengan
  `ratings_marker` slate yang sudah ada (`sha256:` + 16 hex pertama
  sha256 artefak) — diverifikasi terhadap `node:crypto` langsung.

### Q03 — Manifest dan paritas · LULUS

- Kelengkapan field: manifest sintetis diperiksa field per field
  (versi skema, versi engine, κ/kfit, cakupan total/per-liga/jendela,
  hitungan kalibrasi, kedua hash). Regenerasi dari artefak+konfigurasi
  yang sama menghasilkan `contentHash` dan bytes **identik**
  (`generatedAt` dikecualikan dari hash isi secara desain).
- Berhenti bernama (bukan fallback diam): file hilang →
  `manifest_missing`; JSON rusak → `manifest_corrupt`; field wajib
  hilang → `manifest_field_missing`; isi diubah tanpa bangun ulang →
  `manifest_hash_mismatch`; artefak rating berubah →
  `manifest_ratings_mismatch`. Dua yang pertama juga dibuktikan
  ujung-ke-ujung: evaluator lab keluar non-nol dengan kode itu di
  stderr. Pick-slate memakai pola yang sama (`process.exit(1)` dengan
  pesan bernama).
- Paritas: 20 laga sampel E0 yang dinyatakan (10 tim E0 yang benar-benar
  ada di artefak: Arsenal, Aston Villa, Brentford, Brighton & Hove
  Albion, Chelsea, Crystal Palace, Everton, Fulham, Burnley, Coventry
  City; pasangan i→i+1 dan i→i+3; satu sampel membawa form nyata yang
  diturunkan snapshot). Jalur lab (evaluator + prediktor bersama) vs
  jalur produksi (`buildQuantPackage` planner):
  **selisih per probabilitas maksimum = 0; Σ|Δp| = 0** (toleransi
  dokumen: ≤ 1e-8 per probabilitas, Σ|Δp| ≤ 0,005).
- Snapshot as-of (anti-kebocoran): observasi dengan
  `available_at > waktu keputusan` tidak mengubah snapshot historis;
  observasi sah sebelumnya mengubahnya; hasil berformat tanggal-saja
  pada hari keputusan belum terhitung (baru berlaku untuk keputusan di
  hari berikutnya).

### Q04 — Promosi dan identitas · LULUS

- Identitas champion: manifest bootstrap untuk artefak produksi saat
  ini ter-commit di `data/model-manifest.json` —
  `modelVersion = 2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2`,
  κ=10, kfit=10, data latih **73.412 laga / 84 liga / 2.088 tim**,
  jendela match_dates **2024-01-01 … 2026-11-16**,
  `ratingsHash = sha256:8a790aeaa4e54fdd`, kalibrasi
  {calibrated 32, partial 35, uncalibrated 1, unknown 16}. Dibangun
  lewat staging baca-saja (dataset produksi tidak ditulis).
- Pick berseed: pick yang diterbitkan lewat jalur publikasi K2 dengan
  `model_version`/`ratings_hash` dari manifest tersimpan **persis**
  identitas itu (dan memuat `kfit10`) — jahitan yang sama dipakai
  pick-slate sekarang (sebelumnya konstanta `quant-package-v1`).
- Gerbang menolak fit lebih kecil: kandidat sintetis 500 < champion
  1.000 → `reject` + alasan `candidate_training_smaller`; dibuktikan
  juga lewat CLI pada artefak asli (satu liga dihapus → kandidat lebih
  kecil → exit 2, manifest aktif tidak berubah).
- Regenerasi: evaluator lab dua kali pada salinan data yang sama
  menghasilkan baris prediksi **identik byte per byte**, dan keputusan
  gerbang pada masukan yang sama deterministik (fungsi murni).

## Desain manifest

- **Artefak:** `data/model-manifest.json` (aktif) dan
  `data/model-manifest.candidate.json` (kandidat), di direktori data
  yang sama dengan `calibrated_ratings.json`.
- **Field:** `manifestVersion` (skema, 1) · `modelVersion` (identitas
  terbaca: versi rating + kfit + half-life + mode ρ + skala blend) ·
  `engine` {ratingsVersion, implementation} · `config` {kappa, kfit,
  halfLifeDays, rhoMode, blend{kind: james-stein, kappaScale}} ·
  `training` {totalMatches, leagueCount, teamCount, window{start, end,
  basis}, perLeague[{div, matches}]} · `calibration` {calibrated,
  partial, uncalibrated, unknown} · `ratingsHash` (hash artefak) ·
  `generatedAt`/`generatedBy`/`codeSha` · `contentHash` (sha256 atas
  serialisasi kanonik semua field selain dirinya dan `generatedAt`).
- **Sumber kebenaran:** artefak `calibrated_ratings.json` untuk
  cakupan/kalibrasi/hash; konfigurasi champion terpusat di
  `PRODUCTION_MODEL_CONFIG` (`lib/quant/model-manifest.ts`) yang cocok
  dengan default jalur fit yang sudah berjalan; jendela latih dari
  tanggal pertandingan dataset (MIN/MAX `utc_date` laga finished
  berskor) bila terbaca, jika tidak diturunkan dari artefak.
- **Siapa menghasilkan:** jalur fit (`calibrate-ratings.ts` di akhir
  run + `fit-global-offsets.ts` sesudah menulis ulang rating) →
  `writeCandidateManifest` (kandidat saja, kegagalannya tidak
  menggagalkan fit); CLI `scripts/build-model-manifest.ts`
  (`--activate` hanya untuk bootstrap).
- **Siapa membaca:** `scripts/pick-slate.ts` (jalur produksi — wajib,
  berhenti bernama bila tak bisa dipakai; mencap `model_version`
  manifest pada paket & pick), `scripts/evaluate-model.ts` (jalur lab
  — wajib + verifikasi ketat hash rating), `scripts/promote-model.ts`
  (gerbang).

## Gerbang promosi

`evaluatePromotion({champion, candidate, parity?})` di
`lib/quant/promotion-gate.ts` (fungsi murni, deterministik) + CLI
`scripts/promote-model.ts` (exit 0 promote · 2 reject · 1 error
bernama; kandidat basi — hash rating tak cocok dengan artefak saat ini
— ditolak sebelum gerbang):

- **TOLAK** bila `candidate.training.totalMatches <
  champion.training.totalMatches` (`candidate_training_smaller`).
- **TOLAK** bila paritas lab/produksi yang diberikan melebihi
  `PARITY_SUM_ABS_TOLERANCE = 0,005` (`parity_delta_exceeded`).
- **PERINGATAN** (tidak memblokir): liga champion hilang pada kandidat
  (`coverage_missing_league`), jumlah liga calibrated menyusut,
  unknown bertambah, paritas tidak diberikan.
- **CATATAN:** perubahan konfigurasi apa pun dicatat `config_change` —
  promosi konfigurasi baru hanya sah dengan keputusan eksperimen
  terdokumentasi (jalur K5).

**Bukti refresh tidak mempromosikan diam-diam** (suite, pada artefak
asli di sandbox): artefak rating diubah → builder kandidat dijalankan
(seperti yang dilakukan hook jalur fit) → kandidat terbit dengan hash
baru, **manifest aktif byte-identik**; penjaga statis memastikan
`free-refresh.ts` tidak menyebut gerbang dan jalur fit tidak pernah
memanggil penulis manifest aktif (`writeActiveManifest` hanya dipakai
CLI promosi + bootstrap builder). Promosi CLI yang sah terbukti
menuliskan isi kandidat menjadi aktif; penolakan terbukti tidak
mengubah aktif.

## File berubah

Baru:

- `lib/quant/fit.ts` — fit bersama (ekstraksi verbatim dari calibrate).
- `lib/quant/model-manifest.ts` — skema, bangun/parse/verifikasi,
  penulis kandidat/aktif, pemuat bernama.
- `lib/quant/promotion-gate.ts` — aturan gerbang murni.
- `lib/quant/predict.ts` — prediktor bersama (komposisi planner).
- `lib/quant/snapshot.ts` — snapshot form as-of.
- `scripts/build-model-manifest.ts`, `scripts/promote-model.ts`,
  `scripts/evaluate-model.ts` — CLI builder/gerbang/evaluator.
- `data/model-manifest.json` — manifest aktif bootstrap (artefak asli).
- `tests/test-model.ts` (61 assertion) + `tests/helpers/predict-runner.ts`.

Diubah:

- `scripts/calibrate-ratings.ts` — memakai fit bersama (perilaku
  identik, bukti selisih 0,0) + hook kandidat manifest.
- `scripts/fit-global-offsets.ts` — hook kandidat manifest sesudah
  menulis ulang rating.
- `scripts/pick-slate.ts` — memuat manifest aktif (berhenti bernama) +
  mencap `model_version` manifest (mengganti konstanta
  `quant-package-v1`); cap `ratings_hash` tidak berubah.
- `package.json` — `test:quant` merantai `tests/test-model.ts`.

Tidak disentuh: file read-only (`lib/agent/*`, `lib/coverage.ts`,
`lib/syndicate-orchestrator.ts`, `lib/llm/*`), skema K2/K3,
`lib/picks/*`, database produksi, checkout utama, VPS.

## Perintah + hasil

| Perintah | Exit | Hasil |
|---|---|---|
| `npx --no-install tsc --noEmit` | 0 | bersih |
| `npm run test:quant` | 0 | test-quant 22/22 · **test-model 61/61** |
| `npm run test:data` | 0 | data 18/18 · identity 58/58 · publication 89/89 · tickets 69/69 |
| `npm run test:web` | 0 | 12/12 |
| `npm run test:e2e` | 0 | 7/7 |
| `npm run test:baseline:d01` | 0 | 12/12 |
| `npm run build` (env placeholder CI) | 0 | selesai |
| `npx eslint <13 file K4>` | 0 | bersih |
| test:quant + test:data, 2× | 0 | hasil identik kedua run |
| Ekuivalensi calibrate K3-vs-K4 (data sintetis) | 0 | selisih parameter maksimum **0,0** |
| Paritas terukur 20 laga (lab vs produksi) | — | maxAbs **0**, Σ\|Δp\| **0** |

## Cara kembali

Semua perubahan aditif di branch `prd/k4-model-paritas`: hapus branch/
worktree untuk membatalkan K4 sepenuhnya. Tanpa K4 pun jalur lama tetap
utuh — satu-satunya perubahan perilaku produksi adalah pick-slate kini
memuat manifest (file bootstrap ter-commit bersama branch) dan mencap
versi manifest; mengembalikan dua titik itu di `scripts/pick-slate.ts`
mengembalikan perilaku persis pra-K4. Manifest kandidat/aktif adalah
file JSON biasa; menghapusnya mengembalikan slate ke keadaan berhenti
bernama (by design), bukan fallback diam.

## Belum terbukti / terbuka

- **Produksi + deploy menunggu K8** (keputusan pemilik): manifest aktif
  di branch ini belum berjalan di VPS; migrasi/aktivasi produksi adalah
  bagian rilis akhir.
- **Eksperimen κ = K5:** K4 tidak mengubah κ/kfit produksi (10/10);
  kandidat κ-fit 20 dan keputusan promosinya adalah kartu berikutnya.
- **32 konflik skor `identity_ambiguous` dari K1** masih menunggu
  peninjauan pemilik.
- Jendela latih manifest bootstrap berbasis tanggal pertandingan
  dataset produksi (match_dates); pada lingkungan tanpa dataset,
  builder menurunkan jendela dari artefak (basis `artifact-derived`)
  dan mencatat basisnya di manifest.
- Suite paritas memakai 20 laga E0 (liga dengan cakupan rating penuh);
  liga lain mengikuti jalur kode yang sama tetapi tidak termasuk
  sampel yang dinyatakan dokumen.
