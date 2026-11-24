# PR 1A — Audit Read-Only: Rekonsiliasi Angka, Pasokan Data, Inventaris Snapshot, Profil Beranda

**Brief:** `Brief-Data-Akurasi-dan-Efisiensi-Bola.pdf` (14 hal., P0/PR 1A)
**Basis commit:** `e648404f1295ae8aa20115a4fa42b45ff1477e1c` (master = origin/main)
**Branch:** `audit/pr-1a` · **Worktree:** `app-football-audit1a`
**Tanggal audit:** 2026-11-24 (WIB) · **Sifat:** READ-ONLY — nol perubahan
perilaku app, nol tulis ke produksi, nol merge, nol deploy. Semua query DB
produksi dibuka `mode=ro` atau atas salinan konsisten (sqlite `.backup`).
**Perubahan kode app:** TIDAK ADA. Yang ditambah hanya skrip diagnostik
(`tasks/pr1a/`) + laporan ini + bukti (`tasks/reports/pr1a-evidence/`).
**Rollback:** n/a (read-only; branch dapat dibuang tanpa efek).

---

## Temuan terpenting (urut dampak)

**F1 · Biaya Beranda didominasi agregat Rekam hasil, bukan dua pembaca 72 jam.**
Profil staging (salinan DB produksi): total 3 pembaca Beranda ≈ **1.051 ms**
median hangat, dan **±97%-nya adalah `ambilRekam`** (median 1.025 ms, dingin
1.386 ms). Dua pembaca 72 jam (`sorotanBeranda` + `jadwalBerikutnya`, yang
masing-masing memanggil `listUpcomingPada` sendiri — duplikasi nyata)
gabungan hanya ±100 ms. Request dingin: total dokumen **6,85 dtk** dan
memblokir event loop ±6,8 dtk (log `[timing] dur_ms=6733`, event-loop
`max_ms=6761.2`). Urutan PR 1B yang didukung bukti: **pembaca ringkasan kohor
dulu**, baru satukan dua pembaca 72 jam. Detail: bukti
`pr1a-evidence/profil-dan-query-plan.md`.

**F2 · Angka grade yang beredar benar pada snapshot-nya — dan kedaluwarsa ±10 jam kemudian.**
Klaim brief (A 434/513 = 84,6%; B 638/828; C 213/331; total 1.672)
**terreproduksi persis** pada snapshot `picks.db` cadangan pra-deploy
2026-11-23 19:11 UTC. Pada DB produksi saat audit (24 Nov ±08:40 WIB),
resolver refresh 04:21 telah menambah **+1.349 outcome** sehingga irisan
settled menjadi A **890/1.081 = 82,3%**, B **993/1.336 = 74,3%**, C
**368/604 = 60,9%** (total settled 3.021). Populasi ter-grade penuh adalah
**9.367 baris live-run**, bukan 1.672 (1.672 = settled pada snapshot lama).
Setiap klaim akurasi wajib menyebut snapshot + populasi + basis peluangnya.

**F3 · Dua basis "klaim" berbeda antar-permukaan /bukti.**
Agregat di `lib/web/data.ts` (baris ±850–941) membandingkan hit dengan
**rerata `model_prob`**, sedangkan `lib/picks/cohort.ts` membandingkan
dengan **rerata `published_prob`** atas irisan resmi saja (n settled 532).
Hasil irisan-sama yang terukur: basis published resmi — A 0,8127 vs hit
0,7926 (**−2,0 pp**, overconfident), B 0,7205 vs 0,7358 (+1,5 pp), C 0,6237
vs 0,5534 (**−7,0 pp**); basis model semua settled — A 0,8193 vs 0,8233,
B 0,7280 vs 0,7433, C 0,6374 vs 0,6093. Angka "klaim vs kenyataan" yang
tampil ke pengguna bergantung permukaan mana yang membacanya → bahan tes
parity PR 2 (L01).

**F4 · Panel Sportmonks mati total untuk kickoff ≥ 23 Nov 2026.**
Arsip panel berhenti di batch **2026-11-07T12:45:22.617Z** (84.721 baris,
924 fixture — persis klaim brief). `sm_prob` pada pick live menurut hari
kickoff: 20 Nov 457/457 terisi, 21 Nov 365/1.882, 22 Nov 7/932,
**≥23 Nov 0/1.024+**. Semua slate berjalan adalah model-only; ini cakupan
bukti (evidence coverage), bukan kegagalan grade — sesuai konteks brief
"825/829 pilihan hanya mengandalkan model".

**F5 · Pola query latest-per-match menggabung atas seluruh tabel sebelum filter jendela.**
`LATEST_PER_MATCH` (`lib/web/data.ts:308`) menghitung `MAX(id) GROUP BY
match_id` atas **seluruh 8.981 paket** lalu memfilter kickoff; query plan:
`SCAN packages USING COVERING INDEX idx_packages_match` + temp B-tree.
Bentuk usulan brief hal. 8 (filter `idx_packages_kickoff` dulu, subquery
korelasi per kandidat) menghasilkan **hasil identik** pada jendela uji
(127 baris, 1.173.692 byte payload) — kandidat PR 1B yang aman. Payload
diparse penuh per baris (rerata 8.853 byte, memuat `score_matrix`):
±1,17 MB JSON di-decode per pembaca 72 jam per render.

**F6 · `sm_panel.batch_utc` NULL pada 3.058/8.981 paket (34,0%) — klaim "1.868" adalah snapshot 20 Nov.**
Kolom `predictions_batch_utc` dan payload `sm_panel.batch_utc` sepakat:
3.058 NULL, **0 nilai epoch** (jadi "tanggal epoch" yang terlihat di UI
adalah default presentasi atas NULL, bukan nilai tersimpan). Kumulatif
NULL s.d. 19 Nov = 1.672, s.d. 20 Nov = 1.942 → angka 1.868 konsisten
dengan snapshot tengah-hari 20 Nov. Lonjakan NULL mulai 18 Nov (939/1.388
paket hari itu) seiring habisnya jangkauan arsip panel.

**F7 · Mayoritas pick terbit tidak akan pernah settle: tidak ada feed hasil untuk kompetisinya.**
Dari 9.367 pick live ter-grade: settled 3.021, **due-unsettled 5.498**
(kickoff lewat, tanpa outcome). Penyebab struktural: hasil hanya masuk
dari arsip SM (beku 7 Nov) + 22 divisi fd_; pick untuk kompetisi di luar
itu terbit normal tetapi laga penyelesaiannya tidak pernah tiba di
dataset. Contoh ekstrem di CSV: `sm:24` issued 189, settled 7,
due-unsettled 182. Penyebut /bukti (settled saja) menyembunyikan ini —
corong issued → due → settled per liga ada di
`pr1a-evidence/coverage-per-liga.csv`.

**F8 · Kesegaran data terkonsentrasi: 116 dari 138 kompetisi (84%) berhenti sebelum 8 Nov.**
Hanya 21 kompetisi punya laga ≥17 Nov (yang diberi makan fd_). Sumber:
sm_ 69.065 baris (2024-01-01 → 2026-11-07), fd_ 1.405 (2026-08-01 →
2026-11-22), mt_ 1.174 (2026-03-01 → 2026-10-17, berhenti), other 39.

**F9 · Antrean identitas belum tersentuh: 547 item, 0 resolved.**
`fixture_identity_queue` 547 baris, semuanya `resolved_at IS NULL`
(antrean `identity_ambiguous` K1). Lapisan `canonical_fixtures` produksi
berisi 2.916 fixture (cakupan era katalog) — bukan dedup atas 71.683 baris
riwayat; dedup riwayat penuh terukur pada bukti K1 di salinan (71.503 →
70.420 fixture unik, 71.832 alias). Di lapisan mentah masih ada **50
klaster duplikat** (kompetisi+tim+tanggal sama, >1 baris), 45 di antaranya
di ember agregat `sm:2451` (12.624 baris / 3.540 tim).

**F10 · Lag hasil p50/p95 TIDAK terukur dari data historis (null + alasan).**
Tidak ada kolom `available_at`/`ingested_at`; `matches.updated_at` adalah
waktu update baris terakhir, bukan ketersediaan pertama. Sesuai perintah
brief hal. 3, kolom lag di CSV diisi null + alasan. Mengukurnya butuh
instrumentasi ingest ke depan (PR 2), bukan rekonstruksi.

**F11 · Build di checkout segar gagal tanpa `.env.local` — lingkungan, bukan regresi.**
Run pertama di worktree: `build`, `test:verifikasi`, `test:lanjut` exit 1
semua dari akar yang sama — `Failed to collect configuration for
/api/agent: Environment variable 'NINE_ROUTER_BASE_URL' belum diisi`.
Sesudah `.env.local` disalin buta dari checkout utama: **ketiganya exit
0**. Suite lain tidak terpengaruh. Catatan runbook: worktree baru wajib
menyalin `.env.local` sebelum build/suite yang mem-boot server.

---

## Bagian A — Tabel klaim → bukti → keputusan → tes

| # | Klaim | Bukti primer (diukur ulang) | Keputusan | Tes/rujukan |
|---|---|---|---|---|
| A1 | "Level B 1,0092" adalah angka model aktif | 1,0092 = `tasks/oos-results.json` heldout **"winner kx2"**, params `hl365\|rho:zero\|kfit:20`, κ-scale 2, n=6.317 (+ README.md:101). Manifest aktif: κ-fit **10**, hl 365, ρ 0, blend JS ×2. Hitung ulang artefak K5 dari `predictions-h.jsonl`: Level B κ10 = **1,0134022623271062**, κ20 = **1,014223498439091** (n=6.708, 33 pekan, 0 clamp) — persis klaim brief 1,013402/1,014223; Level A 1,022740/1,022468. Diagnostik seri: prediksi 23,597% vs aktual 25,194% (klaim brief 23,60/25,19 ✓) | **RETAIN** champion κ10; 1,0092 dilabeli "eksperimen lama κ-fit 20, cohort 6.317" di semua permukaan | `tasks/pr1a/k5-recompute.mjs` (dapat diulang; output di evidence) |
| A2 | Benchmark "+0,032 vs Pinnacle" | `tasks/closing-benchmark-report.md`: pooled 1X2 n=1.223, model 1,0090 vs closing 0,9769, Δ **+0,0320**. Prediksi model = lab lama; `scripts/parlay-lab.ts` `compAvgGoals()` menghitung rerata gol kompetisi dari **seluruh store** tanpa batas waktu (kodenya + komentarnya sendiri: "dari SELURUH store") → normalisasi lintas periode bocor ke prediksi historis. Horizon closing (jelang kickoff) ≠ horizon publikasi | **PROCEED** ke PR 3: hitung ulang dari evaluator baru pada irisan sepadan; closing disimpan sebagai benchmark terpisah. Tidak dihitung ulang di PR ini (perintah brief) | provenans terdokumentasi; tidak ada tes baru |
| A3 | Grade A 84,6% (434/513), A/B/C 1.672 baris | Terreproduksi **persis** pada snapshot cadangan `picks.db.bak` 2026-11-23 19:11 UTC (A 434/513, B 638/828, C 213/331). Produksi saat audit: A **890/1.081 = 82,3%**, B 993/1.336 = 74,3%, C 368/604 = 60,9%; settled total 3.021 (+1.349 semalam); graded penuh 9.367 baris (A 3.499 baris / **1.225 fixture**, B 4.013/1.325, C 1.855/1.043 → kandidat per laga saling terkait, ±2,9 pick/fixture di A). Per pasar A (settled): dc 382/459 = 83,2%; team_over05_home 269/332 = 81,0%; team_over05_away 144/175 = 82,3%; ou15 89/109 = 81,7%; ou35 6/6. **Tidak ada** baris A untuk 1x2/ou25/btts (konsisten cap pasar lab). Per gate A: calibrated 398/482, partial 452/543, uncalibrated 40/56. Mean-vs-hit irisan sama: lihat F3 | Klaim **benar bersyarat snapshot**; publikasi angka grade wajib label snapshot + populasi + basis. Evaluasi formal ditunda ke evaluator PR 3 | `tasks/pr1a/db-audit.mjs` → `pr1a-evidence/db-audit.json` |
| A4 | `applyGateCap` pass-through; panel mengisi evidence sesudah grade | Kode: `lib/picks/engine.ts:272` `applyGateCap(grade, gate) { void gate; return grade; }` — label, bukan pemotong (sesuai INV-04). `gradeLeg` dipanggil (engine.ts:363) dari prob stated; `market_prob`/`sm_prob`/`agreement_spread` ditempel sesudahnya (baris 367–383). Panel: 84.721 baris, 924 fixture, batch terakhir **2026-11-07T12:45:22.617Z** ✓; cakupan per hari kickoff: lihat F4 | **PROCEED**: tampilkan grade, status liga, sumber bukti sebagai label terpisah (PR 2); panel kosong = "Waktu arsip tidak tersedia" | inspeksi kode + query ro predictions.db |
| A5 | published_prob membekukan effective_prob historis; matriks menghasilkan model_prob | Freeze utuh: `published_prob == effective_prob` pada **1.562/1.562** baris resmi (0 selisih); published ≠ model pada 1.435/1.562 (memang basisnya effective). Vs paket **terbaru** laga yang sama: **1.459/1.562 (93,4%) berbeda**, rerata \|Δ\| 0,0249, maks 0,1089. Pemetaan pembaca: Beranda sorotan → published (data.ts:535–552); daftar/detail paket → urutan model_prob (data.ts:669, 727); /bukti data.ts → AVG(model_prob); cohort.ts → AVG(published_prob) irisan resmi; rekam.ts:588 → published bila ada, fallback model | **PROCEED** ke PR 2: satu pembaca resmi + tes parity antar-reader (L01 brief hal. 13) | `tasks/pr1a/divergence.mjs` |
| A6 | 73.412 (manifest) vs 71.503 (dataset) | 73.412 = **Σ `totalMatches` tersimpan per fit** di `calibrated_ratings.json` (Σ perLeague manifest terverifikasi = 73.412 persis; 84 fit; `teamCount` 2.088 = Σ tim per fit — tim lintas liga terhitung ganda; fit legacy div fd bertanggal Okt 2026 membawa korpus arsip multi-musim, mis. E1 totalMatches 2.879/44 tim vs 80 baris dataset E1 kini). 71.503 = baris `matches` finished+berskor dengan `utc_date ∈ [2024-01-01, 2026-11-17)` — **terhitung persis 71.503**, sama dengan basis migrasi K1 ("71.503 baris → 70.420 fixture unik, 71.832 alias", `tasks/reports/k1-identitas-hasil-report.md:148`). Total dataset saat audit 71.683 (selisih 180 = fd_ 17–22 Nov di luar jendela fit). Registry: 6.541 tim kanonik, 250 liga kanonik | Kedua angka **benar pada populasinya**; cacatnya adalah penyandingan tanpa label populasi. Manifest perlu keterangan "Σ hitungan per fit" (dokumentasi PR 2/3) | query ro dataset + `lib/quant/model-manifest.ts:196,212` |

## Bagian B — Audit pasokan data

Deliverable: **`pr1a-evidence/coverage-per-liga.csv`** — 138 baris
kompetisi × kolom: catalog_n, scored_90_n (semua baris dataset berstatus
finished+berskor: 71.683/71.683), unique_teams, campuran sumber sm/fd/mt,
first/last date, laga 7/30 hari terakhir (menurut tanggal laga), in-window
fit, **n_eff** bobot hl-365 pada 2026-11-16 (`(Σw)²/Σw²`), canonical_n,
result_revisions_n, duplicate_cluster_n, corong rated (paket) → issued →
settled → due-unsettled, dan lag p50/p95 = **null + alasan** (F10).

Ringkasan corong global (live-run): katalog paket 8.981 (1.712 laga) →
issued 9.367 → due 8.519 → settled 3.021 (35,5% dari due) → sisanya 5.498
due-unsettled (F7). Cakupan hasil 30 hari menurut tanggal laga: fd_ 506
baris, sm_ 1.086 (semua ≤7 Nov), mt_ 0.

## Bagian C — Inventaris snapshot

| Store | Terukur saat audit | Klaim | Putusan |
|---|---|---|---|
| analysis_snapshots.db `packages` | **8.981** paket; 1.712 laga distinct; computed 2026-11-04T04:11Z → 2026-11-23T21:55Z; trigger: slate 8.907, legacy-import 70, manual 4 | 8.859 | Benar pada snapshot-nya; +122 dari refresh 04:21 24 Nov |
| `predictions_batch_utc` NULL | **3.058** (34,0%); epoch 0 | 1.868 | Snapshot tengah-hari 20 Nov (lihat F6) |
| predictions.db `sm_predictions` | **84.721** baris; **924** fixture; batch per hari: 3 Nov 736, 4 Nov 11.927, 7 Nov 72.058; maks captured **2026-11-07T12:45:22.617Z** | 84.721 / 924 / 2026-11-07T12:45:22Z | Persis |

## Bagian D — Ulang K5 + suite (worktree, checkout terisolasi)

K5: lihat A1 — hitung ulang persis sampai digit terakhir artefak
(1,0134022623271062 / 1,014223498439091), keputusan artefak **retain**
konsisten dengan aturan Q4 (meanΔ +0,000821 gagal ambang −0,005; UB95
+0,001594 gagal < 0).

| Perintah | Run 1 | Run 2 (sesudah `.env.local`) | Catatan |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | — | |
| `npm run lint:gate` | **0** | — | 91 error ≤ baseline 92 |
| `npm run test:quant` | **0** | — | |
| `npm run test:data` | **0** | — | mengonfirmasi klaim brief hal. 13 (quant+data exit 0 di e648404) |
| `npm run test:web` | **0** | — | termasuk suite stabilisasi 32/32 |
| `npm run test:api` | **0** | — | 42/42 |
| `npm run test:verifikasi` | 1 | **0** | run 1 gagal build internal suite (F11); run 2: 39/39 + 36/36 + 41/41 + 38/38 |
| `npm run test:lanjut` | 1 | **0** | akar sama (F11) |
| `npm run test:e2e` | **0** | — | |
| `npm run build` | 1 | **0** | akar sama (F11): `NINE_ROUTER_BASE_URL` belum diisi |

## Bagian E — Profil Beranda (staging)

Baseline terukur (detail penuh di
`pr1a-evidence/profil-dan-query-plan.md`): dokumen Beranda 48.505 byte;
dingin total **6,849 dtk**; hangat total **p50 1,073 dtk / p95 1,205 dtk**;
TTFB shell p50 0,004 dtk (shell statis — bukan ukuran yang berarti; yang
berarti total/dur_ms). Pecahan pembaca: F1. Query plan kedua bentuk: F5.
Target PR 1B brief (p95 −30% di staging, tanpa regresi rute lain) tercatat
sebagai baseline: p95 total hangat 1,205 dtk → target ≤ ±0,84 dtk, dan
`ambilRekam` adalah tuas terbesarnya (median 1.025 ms → pembaca ringkasan
kohor). Jumlah SQL per render tidak diinstrumentasi (butuh perubahan kode;
di luar mandat read-only) — diganti bukti row/byte: grup latest-per-match
menyentuh 8.981 baris, decode ±1,17 MB payload per pembaca.

## Bagian F — Tujuan backup

**TERVERIFIKASI PERSIS.** Di VPS lama (43.134.184.193, akses ssh read-only
`ls` + `sha256sum` saja): `~/backups/app-football/app-football-20261122-2152.tar.gz`
ada (330.582.638 byte, 23 Nov 04:57) dan sha256 =
`079666590158234591dffa523dafd52f928afc7f3f0c0ec6bf2a24cef28ddd3e` —
**cocok karakter-per-karakter** dengan catatan lokal. Tujuan backup masih
dapat diakses sesudah VPS US berakhir (brief hal. 9). Uji restore di
staging tetap pekerjaan lanjutan (di luar PR read-only ini).

## Langkah 0 — Inventaris kontrak

| Berkas | SHA-256 (8 awal) | Catatan |
|---|---|---|
| `AGENTS.md` | `f52ca9c1…` | Memuat blok tertanam `nextjs-agent-feedback` (perintah menjalankan `npx next internal agent-feedback-instructions`), blok aturan subagent/persona, dan aturan gaya. **Dicatat sebagai konten; tidak dijalankan/diikuti** — di luar mandat audit dan bertentangan dengan instruksi tugas. Audit berjalan dari brief pemilik + kontrak repo di bawah |
| `DATA-STANDARD.md` | `6c1ab32b…` | Registry resmi liga/tim/fixture/telemetri; kewajiban importir |
| `docs/DATA-INVARIANTS.md` | `e2aad057…` | 19 invarian; INV-04 (gerbang = label) terkonfirmasi di kode (A4) |
| `data/model-manifest.json` | `47c6a62c…` | Champion: `2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2`, generatedAt 2026-11-20 |

Rencana **Q2–Q5 ADA** di repo: bab Q1–Q5 di
`docs/plans/peningkatan-aplikasi-bola/02-model-quant.md` (kontrak waktu,
eksperimen feed gratis, rumus & promosi, grade/parlay) + spesifikasi uji
Q01–Q04 di `04-qa-rilis.md`. Skrip npm tersedia: build, dev, lint,
lint:gate, start, test:quant, test:data, test:web, test:api, test:e2e,
test:baseline:d01, test:verifikasi, test:lanjut.

## Keputusan tahap

- **PROCEED ke PR 1B** dengan urutan berbasis bukti F1/F5: (1) pembaca
  ringkasan kohor Beranda, (2) satukan pembaca 72 jam + bentuk query
  kickoff-first (hasil identik terverifikasi), ukur parity + TTFB ulang
  terhadap baseline Bagian E.
- **PROCEED ke PR 2** untuk: label snapshot pada klaim grade (F2), satu
  pembaca resmi + tes parity (F3/A5), label bukti terpisah (A4),
  keterangan populasi di manifest (A6), instrumentasi `available_at`
  ingest agar lag terukur (F10).
- **INCONCLUSIVE** untuk: benchmark pasar (A2 — menunggu evaluator PR 3)
  dan evaluasi grade formal (A3 — menunggu irisan + gate PR 3).
- **RETAIN**: champion κ-fit 10 (A1) — tidak ada dasar promosi.

## Artefak

- `tasks/pr1a/k5-recompute.mjs`, `db-audit.mjs`, `divergence.mjs`,
  `league-audit.mjs`, `profile-readers.ts` — skrip diagnostik read-only.
- `tasks/reports/pr1a-evidence/db-audit.json` — keluaran mentah audit DB.
- `tasks/reports/pr1a-evidence/coverage-per-liga.csv` — tabel coverage 138 kompetisi.
- `tasks/reports/pr1a-evidence/profil-dan-query-plan.md` — hitung ulang K5, query plan, profil staging.
