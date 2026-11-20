# Laporan K0 — CI dapat direproduksi + baseline D01

Format jawaban PR mengikuti `docs/plans/peningkatan-aplikasi-bola/05-kartu-muse.md`.

## 1. Tujuan kartu dan SHA awal

Kartu **K0 · CI dapat direproduksi** (bab QA `04-qa-rilis.md` bagian K0):
membuat hasil uji bisa dipercaya — workflow CI yang memanggil file yang
benar-benar ada, Node 24, suite quant/data/web/e2e yang berjalan di atas
fixture sandbox, dan baseline D01 yang terekam apa adanya (bug D01
**tidak** diperbaiki di kartu ini; itu pekerjaan K1).

- SHA awal: `b9b38713b214f4e34c5e56c4cb5c222e4ab50c64`
- Branch: `prd/k0-ci-d01` (worktree bersih dari SHA awal; checkout utama
  tidak disentuh — 9 file artefak refresh-nya yang kotor dibiarkan).
- Lingkungan: Node v24.22.1 lokal, zona proses UTC untuk subprocess uji.

## 2. Masukan reproduksi, hasil saat mulai, hasil yang diharapkan

**D01** (`fixtures/acceptance.json` blok `import_replay`): katalog upcoming
berisi `sm_901` (catalog only); dataset berisi `sm_902` berstatus
`scheduled`; CSV hasil E0 berisi Alpha Athletic 2–1 Beta Town dan
Gamma FC 0–1 Delta United (dengan kolom xG/telemetri + odds closing);
2 pick 1x2 kandang seri live-run (selection `1` — kosakata ledger untuk
"home"). Seluruh urutan importer sebenarnya → builder alias → resolver →
adapter dijalankan **dua kali** (`tests/d01-scenario.ts`).

- Harapan acceptance: 2/2 ter-resolve, verdict `[hit, miss]`, 2 laga
  selesai, 4 log sisi tim, hitungan rerun identik.
- Hasil audit semula: **0/2 ter-resolve**.
- Hasil saat mulai (terekam sebagai baseline, `tests/baseline/`):
  **0/2 ter-resolve** — persis seperti audit. Rinciannya terukur:
  - Importer run 1: hasil Alpha/Beta **dimasukkan sebagai baris fd_ baru**
    (inserted=1, +2 log telemetri + odds closing), hasil Gamma/Delta
    **ter-bridge ke sm_902** (bridged=1) tetapi skornya **tidak pernah
    ditulis** ke baris sm_902 yang masih `scheduled` — di sinilah resolusi
    mati untuk sm_902. Fixture: Alpha ter-bridge ke sm_901, Gamma masuk
    sebagai fixture fd_ (inserted=1).
  - Builder alias: **0 tautan** — katalog hanya memuat satu baris per laga
    fisik (baris hasil fd_ hidup di dataset, bukan di katalog), jadi
    jembatan kembar untuk sm_901 tidak pernah terbentuk.
  - Resolver: examined=2, **resolved=0** pada kedua run.
  - Keadaan akhir: 1 dari 2 laga fixture berstatus finished berskor;
    **2 log sisi tim** (harapan 4); verdict `[]`.
  - Adapter: `getResult(sm_901)` = null (skor ada di bawah id fd_);
    `getResult(fd_alpha)` = `{2, 1, finished: false}` — flag `finished`
    salah karena adapter memeriksa status `'FT'` sedangkan dataset
    memakai kosakata `'finished'`; `getResult(sm_902)` = null.
  - Run 2 idempoten: seluruh metrik keadaan identik dengan run 1.

## 3. File produser, file pembaca, migrasi, perilaku data lama

**Produser yang diubah (satu-satunya):**

- `lib/feeds/football-data.ts` — injeksi sumber CSV minimum:
  `fetchSeasonCsv`/`fetchFixturesCsv` membaca direktori lokal bila env
  `FOOTBALL_DATA_CSV_DIR` di-set (tata letak sama seperti URL:
  `mmz4281/<season>/<DIV>.csv`, `fixtures.csv`; file absen = semantik
  404). Tanpa env itu, jalur jaringan produksi **tidak berubah sama
  sekali**. Tidak ada injeksi clock: assertion fixture tidak bergantung
  jam dinding (tanggal laga tetap; cap waktu run tidak dibandingkan).

**File baru (semua di `tests/`):**

- `tests/helpers/fixture-env.ts` — sandbox unik per run di `os.tmpdir()`;
  skema DB dibangun dengan kode repo sebenarnya (`getTheStatsDb`,
  `getUpcomingDb`, `getPicksDb`, `ensurePackagesSchema`) setelah
  `chdir` ke sandbox; runner subprocess produser; kerangka assertion
  dengan exit code sebagai kontrak. Dua penyesuaian keadaan produksi yang
  didokumentasikan di dalamnya: (a) tabel `sm_id_map` dibuat meniru kolom
  INSERT `scripts/sync-sportmonks-fixtures.ts` (tidak ada modul repo yang
  membuat tabel ini, tetapi resolver membacanya — tanpa tabelnya resolver
  crash); (b) migrasi aditif `source`/`capture_kind` pada
  `match_odds_history` diterapkan persis seperti `scripts/capture-odds.ts`
  (skema dasar di `thestats-dataset.ts` belum memuatnya, importer
  mengasumsikannya ada — DB produksi memilikinya dari migrasi itu).
- `tests/helpers/scenarios.ts` — seed D01 + seed jalur-hijau (kembar
  katalog sm_777 ↔ fd_) + runner probe adapter.
- `tests/helpers/web-probe.ts` — memanggil adapter sebenarnya
  (`getMatchDetail`/`getResult`/`ledgerStats`) sebagai subprocess di cwd
  sandbox dan mencetak JSON.
- `tests/test-quant.ts`, `tests/test-data.ts`, `tests/test-web.ts`,
  `tests/test-e2e.ts` — empat suite hijau (lihat §4).
- `tests/d01-scenario.ts`, `tests/record-d01-baseline.ts`,
  `tests/test-baseline-d01.ts`, `tests/baseline/d01-baseline.json`,
  `tests/baseline/d01-baseline.md` — skenario + perekam + pembanding
  baseline D01.
- `package.json` — script baru: `test:quant`, `test:data`, `test:web`,
  `test:e2e`, `test:baseline:d01`.
- `.github/workflows/ci.yml` — ditulis ulang (lihat §4).
- `docs/plans/peningkatan-aplikasi-bola/**` — salinan paket PRD apa
  adanya (termasuk `fixtures/acceptance.json`).

**Pembaca yang diubah:** tidak ada. File read-only (`lib/agent/*`,
`lib/coverage.ts`, `lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak
disentuh. `ARCHITECTURE.md` sengaja **tidak** diubah — anotasi §8/§10
milik issue sinkronisasi refresh (§7).

**Perilaku data lama:** tidak ada migrasi data. Semua suite berjalan di
sandbox sementara; DB produksi di checkout utama tidak dibuka sama
sekali oleh suite baru (suite warisan quant membaca dataset lewat sandbox
fixture sm:8, bukan file produksi).

## 4. Perintah yang dijalankan, hasil/exit code, jumlah assertion

Semua di worktree bersih, Node v24.22.1, dijalankan **dua kali penuh**
dengan hasil identik (angka run kedua = run pertama):

| Perintah | Exit | Assertion |
|---|---|---|
| `npm ci` | 0 | 393 paket, 30 dtk |
| `npx --no-install tsc --noEmit` | 0 | bersih, termasuk `tests/` |
| `npm run lint` | **1** | **92 error + 5 warning — pre-existing** (lihat bawah) |
| `npx --no-install eslint tests/ lib/feeds/football-data.ts` | 0 | file baru/berubah: 0 masalah |
| `npm run test:quant` | 0 | **22/22** (di dalamnya: vig 9; quant-correctness subprocess "SEMUA LOLOS" ±41 cek internal, dihitung ≥30 anti-kosong; pick-engine 10) |
| `npm run test:data` | 0 | **18/18** |
| `npm run test:web` | 0 | **12/12** |
| `npm run test:e2e` | 0 | **7/7** |
| `npm run test:baseline:d01` | 0 | **3/3** (perilaku == baseline terekam) |
| `npm run build` (env placeholder, lihat bawah) | 0 | 10 route terbangun |

**Bukti kegagalan yang disengaja (job bisa merah):**

1. Assertion di `test-data.ts` dirusak (harapan skor 3→9):
   `npm run test:data` → **exit 1**, `17/18`, FAIL menunjuk assertion yang
   dirusak. File dikembalikan; run berikutnya 18/18 lagi.
2. Baseline D01 diubah diam-diam (`picks_resolved` run1: 0→1):
   `npm run test:baseline:d01` → **exit 1**, FAIL dengan diff metrik
   persis. Baseline dipulihkan dari salinan; run berikutnya 3/3 lagi.

**Dua temuan baseline yang dicatat apa adanya:**

- **Lint merah pre-existing.** Di SHA awal, `npm run lint` = exit 1
  dengan 92 error (90× `@typescript-eslint/no-explicit-any`, 5 warning)
  menyebar di `app/`, `lib/`, `components/` — termasuk file read-only
  `lib/agent/*`. Memperbaikinya di luar lingkup K0 dan sebagian mustahil
  tanpa menyentuh file read-only. Langkah lint tetap dipasang di CI
  sesuai kartu, dengan komentar di workflow: utangnya terlihat dan
  terukur, bukan disembunyikan; pelunasannya kartu tersendiri.
- **Build butuh env terisi + jaringan font.** Di checkout bersih tanpa
  `.env.local`, `npm run build` gugur: `Error: Failed to collect page
  data for /api/agent` ← `[Konfigurasi] Environment variable
  'NINE_ROUTER_BASE_URL' belum diisi` dari `lib/llm/models.ts` (validasi
  saat import; file read-only, tidak diubah). Dengan env placeholder
  persis contoh `.env.example` (bukan kredensial asli) build **exit 0**.
  CI menangani ini dengan env placeholder pada langkah build (tertulis
  di workflow). `app/layout.tsx` memakai `next/font/google`
  (Archivo + IBM_Plex_Mono) — build mengambil font dari jaringan; di
  mesin ini dan di runner GitHub jaringan tersedia sehingga tidak ada
  kegagalan font. Runner yang sepenuhnya offline akan gugur di
  pengambilan font itu; font **tidak** diganti.

**Cara kedua suite warisan mengakses data & artefak (inspeksi §K0.1):**

- `scripts/quant-correctness-tests.ts`: Temuan 5 membuka
  `data/thestats_dataset.db` read-only relatif cwd; Temuan 3b membuat
  sandbox-nya sendiri di `os.tmpdir()` untuk ledger. Exit code-nya sudah
  benar (1 bila ada FAIL). Di sandbox K0 ia diberi dataset fixture sm:8
  (3 laga sebelum + 2 sesudah cutoff 2025-06-01; rerata point-in-time
  1,333 ≠ rerata penuh 2,0) supaya assertion kebocorannya nyata.
- `scripts/pick-engine-acceptance.ts`: membaca
  `tasks/e2e-run-1-package.json` + `tasks/e2e-cup-package-live.json` dari
  cwd dan menulis `tasks/pick-engine-acceptance.json` ke cwd.
  Pemeriksaan toleransinya **hanya mencetak** peringatan (tidak pernah
  exit ≠ 0). Di K0 ia dijalankan dengan cwd = sandbox (input disalin ke
  `tasks/` sandbox, output tertahan di sandbox — checkout bersih), dan
  `test:quant` menilai JSON outputnya: pelanggaran toleransi sekarang =
  exit gagal. Kasus wajib dari header skripnya (Fenerbahçe BTTS → C,
  OU2.5 → C) ikut di-assert.

## 5. Pemetaan tes lama → baru

CI lama (Node 20) memanggil tiga skrip yang **sudah tidak ada** di repo
(terverifikasi: ketiganya hilang di SHA awal; maksudnya dibaca dari
riwayat git) dan tidak membangun aplikasi sama sekali.

| Skrip lama (maksud) | Nasib maksudnya |
|---|---|
| `test-view-mapper.ts` — kontrak mapper view-model: fidelitas angka sadar skala, field absen → null (anti-karangan), gerbang skema, kontrak `/api/betting` | Mapper itu melayani pipeline agen (`lib/view/analysis-view` + `lib/agent/*` yang read-only dan dorman). Penerus hidup kontraknya di aplikasi saat ini adalah adapter `lib/web/data.ts` — diuji di **test:web** (id tak dikenal → null bukan throw, nama/pick/verdict terbaca benar). Suite mapper lama tidak dihidupkan kembali: fixture inputnya adalah keluaran pipeline agen yang read-only. |
| `test-value-bets.ts` — value bet hanya dari odds pasar nyata; tanpa odds pasar → nol value bet; tidak ada odds karangan | Harness-nya memanggil planner agen (read-only, butuh `.env.local`). Produk sudah berputar ke safe-bet (EV sekunder). Inti kontrak yang masih dipakai produksi adalah vig-stripping — diuji langsung di **test:quant bagian A** pada `lib/quant/vig-stripping.ts`: odds invalid (≤1, NaN, Infinity) throw untuk proporsional + Shin, fair_prob berjumlah ~1, dua-arah simetris 0,5/0,5. |
| `test-quant-scale.ts` [1] invarian skala tim rata-rata | Hidup di quant-correctness **Temuan 1** (skala rasio fallback: attack = form/rerata liga; total gol tanpa form di pita wajar) — jalan di test:quant bagian B. |
| `test-quant-scale.ts` [2] probabilitas 1X2 berjumlah ~1 | Hidup di **Temuan 2** (jumlah matriks ~1 toleransi 1e-9, massa ekor ≤ 1e-8, kasus ekstrem) — test:quant bagian B. |
| `test-quant-scale.ts` [3] vig-stripping throw pada odds invalid | **Tidak ada** di suite hidup mana pun → ditulis penggantinya di test:quant bagian A (lihat baris value-bets di atas). |
| `test-quant-scale.ts` [4] identitas kalibrasi Σλ ≈ Σx, Σμ ≈ Σy per liga | Membutuhkan run kalibrasi penuh di atas dataset produksi; tidak ada padanan fixture dan tidak dibuat di K0 (akan jadi "hijau" yang tidak membuktikan apa-apa). Dicatat sebagai celah terbuka, bukan ditutup diam-diam. |

Tidak ada file tes kosong yang dibuat agar workflow hijau: ketiga nama
lama hilang dari workflow dan setiap maksudnya punya rumah di atas.

## 6. Dampak ke pengguna, cara kembali

- **Pengguna akhir: nol dampak.** Tidak ada perubahan perilaku aplikasi;
  satu-satunya perubahan kode produksi adalah cabang env opsional di
  fetcher CSV (mati total tanpa `FOOTBALL_DATA_CSV_DIR`).
- **Pengembang:** CI sekarang menjalankan lint + typecheck + 4 suite +
  baseline D01 + build di Node 24. Konsekuensi jujurnya: CI akan
  **merah di langkah lint** sampai utang 92 error itu dilunasi kartu
  lain — itu disengaja dicatat, bukan disembunyikan.
- **Cara kembali:** semua perubahan K0 ada di branch `prd/k0-ci-d01`;
  membatalkannya = tidak merge branch ini. Baseline D01 adalah file
  rekaman — menghapus `tests/baseline/*` hanya mematikan pembandingnya,
  tidak mengubah perilaku aplikasi.

## 7. Status catatan sinkronisasi refresh (issue terpisah)

Diverifikasi dari repo (bukan dari server — tidak ada login VPS di K0):

- Tip repo = `b9b3871`; **belum ada commit perbaikan telemetri/refresh**
  di repo. `git log` `scripts/build-canonical-telemetry.ts` berhenti di
  `ad465fb` (fase pakem telemetri kanonik); `scripts/free-refresh.ts`
  berhenti di `09da4fe` (pemasangan resolver langkah 8).
- Kode repo saat ini masih memuat pola snapshot audit:
  `scripts/build-canonical-telemetry.ts:61` —
  `SELECT * FROM team_match_logs` + `.all()` (seluruh tabel form dimuat
  ke memori).
- Kesimpulan sesuai `catatan-refresh-github.md`: perbaikan yang berjalan
  di VPS **belum tersinkron ke repo** — statusnya *menunggu referensi
  patch atau SHA tersanitasi dari pemilik*. Anotasi §8/§10
  `ARCHITECTURE.md` tidak disentuh di K0 karena milik issue itu.

## 8. Yang belum terbukti

- CI belum pernah berjalan di GitHub Actions sungguhan (tidak ada push
  ke `main`); yang terverifikasi adalah perintah-perintahnya satu per
  satu di worktree bersih lokal dengan Node yang sama (v24.22.1).
- Build terverifikasi dengan jaringan tersedia (font Google terambil);
  perilaku runner offline penuh untuk font belum diuji.
- D02–D09, Q01–Q04, U01–U08 belum dikerjakan — itu kartu K1+.
- Identitas kalibrasi Σλ≈Σx (test-quant-scale [4]) belum punya uji
  pengganti (§5).
- `getResult` membaca flag `finished` dari status `'FT'` sementara
  dataset memakai `'finished'`, dan `twinsOf` di `lib/web/data.ts`
  mengharapkan format `groups` pada `fixture-links.json` sedangkan
  builder menulis format `links` — dua ketidakcocokan pembaca yang
  terlihat dari baseline D01; perbaikannya wilayah K1, di K0 hanya
  direkam.

## 9. Kartu berikut yang dependensinya terpenuhi

**K1 · Satu pertandingan, satu hasil** — dependensinya (baseline D01 +
reproduksi yang bisa dijalankan ulang) sekarang ada:
`npm run test:baseline:d01` akan menjadi gerbangnya; K1 memperbarui
baseline ini dengan sadar saat D01 berubah menjadi hijau.
