# Audit Pra-Deploy — football-agent (branch `master`)

Tanggal: 2026-11-07 · Auditor: subagent audit pra-deploy (perintah owner via agen utama: "audit dulu sekali lagi, efficientkan codenya, struktur file dibenerin, yang ga kepake delete, performance optimasi")
Sifat: **READ-ONLY**. Audit ini tidak mengedit/menghapus/commit file apa pun (satu run refresh Sportmonks sedang aktif di repo ini selama audit — tidak diganggu, tidak ada build, tidak ada script refresh/slate yang dijalankan). Satu-satunya file yang ditulis adalah laporan ini.
Metode: inventaris `du`/`ls` terukur, grep referensi penuh per kandidat hapus (impor + nama ekspor), baca langsung jalur saji (`lib/web/*`) dan script telemetry, analisis artefak build `.next` yang ada, dan `EXPLAIN QUERY PLAN` read-only pada `picks.db`, `analysis_snapshots.db`, `thestats_dataset.db`. Semua angka di laporan ini hasil perintah yang dijalankan pada sesi audit ini, kecuali yang secara eksplisit dirujuk ke audit 2026-11-05.

## Bagaimana tiga skill diterapkan (konkret)

- **performance_optimization** — workflow MEASURE → IDENTIFY → FIX → VERIFY: tidak ada usulan optimasi tanpa baseline terukur (ukuran chunk dari artefak `.next`, `EXPLAIN QUERY PLAN` bukan tebakan indeks, baseline telemetry dari pengukuran audit sebelumnya). Setiap usulan di §5 disertai rencana ukur-ulang dengan metode yang sama; perubahan yang hasilnya di dalam derau (netral) = revert, sesuai aturan skill.
- **code_simplification** — prinsip *Chesterton's Fence* + *preserve behavior exactly*: setiap kandidat hapus dibuktikan dulu pemanggilnya (grep impor modul DAN grep nama fungsi/konstanta ekspor). Contoh pagar yang terbukti masih berdiri dan TIDAK masuk daftar hapus: `lib/quant/index.ts` (barrel — diimpor `lib/agent/planner.ts` dan `lib/agent/llm.ts` lewat `@/lib/quant`) dan `lib/db/thestats-vault.ts` sebelum rantai pemanggilnya ditelusuri. Duplikasi hidup (predikat pasar) tidak "disederhanakan" sepihak — diusulkan penyatuan + uji kesetaraan agar perilaku identik.
- **code_review_and_quality** — lima sumbu (korektnes, keterbacaan, arsitektur, keamanan, performa) + *dead-code hygiene*: kandidat mati didaftar eksplisit berkelompok dan yang menyangkut keputusan owner ditandai untuk ditanya, bukan dihapus diam-diam (kelompok c). Temuan diberi peringkat dampak × risiko × usaha (§4).

---

## 1. Inventaris struktur + ukuran terukur

Total repo saat audit: **3.993.419.368 byte (±3,99 GB)** — naik dari ±3,8 GB di konteks induk karena `thestats_dataset.db` sedang ditulis run refresh yang aktif.

| Direktori/file | Byte | Catatan |
|---|---:|---|
| `data/` | 3.188.652.869 | 79,8% repo — lihat rincian di bawah |
| `node_modules/` | 629.047.939 | tidak ikut transfer deploy (`npm ci` di VPS) |
| `.next/` | 85.975.028 | artefak build; 63.178.980 di antaranya `cache/` — tidak ikut deploy |
| `archive/` | 61.308.277 | warisan app lama — kelompok (c) |
| `.git/` | 12.469.873 | riwayat; 566 file ter-track |
| `.agents/` | 6.801.482 | ±52 skill vendored untuk agen dev — bukan runtime |
| `tasks/` | 4.736.825 | 52 item laporan kerja — bukan kode |
| `.taste-skill/` | 1.950.554 | artefak inspeksi desain lokal (sudah di-`.gitignore`) |
| `lib/` | 627.688 | 16.553 baris TS total |
| `scripts/` | 574.501 | 33 script |
| `components/` | 230.880 | 185.856 di antaranya `dashboard/` mati (lihat §2) |
| `docs/` | 148.243 | |
| `app/` | 122.439 | 5 rute halaman v2 + 4 rute API warisan |
| `design-system/` | 101.802 | artefak desain, bukan runtime |

Rincian `data/` (dari `ls -la`, diurut ukuran):

| File | Byte | Status rujukan (grep §2) |
|---|---:|---|
| `thestats_dataset.db` | 2.998.222.848 | HIDUP — dirujuk 26 file kode; 734.203 halaman × 4 KB, `journal_mode=wal` |
| `picks.db` | 47.476.736 | HIDUP — ledger; 167.273 baris picks, 163.008 outcomes |
| `analysis_snapshots.db` | 34.430.976 | HIDUP — store paket; 3.802 paket |
| `thestats_dataset.db.bak_sm7_20261027` | 20.639.744 | MATI — backup 27 Okt, 0 rujukan |
| `thestats_dataset.db.bak_sm6_20261027` | 20.414.464 | MATI — backup 27 Okt, 0 rujukan |
| `thestats_raw_vault.db` | 18.780.160 | MATI transitif — satu-satunya pembaca adalah modul mati (§2b) |
| `predictions.db` | 14.237.696 | HIDUP (jalur trial/panel SM) — 7 file |
| `data/historical/` | 13.746.650 | data kerja `lib/feeds/football-data.ts` |
| `football_master.db` | 9.822.208 | SEMI — hanya dibaca `scripts/build-league-canonical.ts` (tool rebuild registry), bukan jalur saji/refresh |
| `upcoming_fixtures.db` | 1.732.608 | HIDUP — 15 file |
| `team-canonical.json` | 2.263.957 | HIDUP — 6 file |
| `calibrated_ratings.json` | 545.429 | HIDUP — 16 file |
| `league-canonical.json` | 134.308 | HIDUP — 8 file |
| `fixture-links.json` | 24.674 | HIDUP — `lib/web/data.ts` + builder |
| `*.bak*` kecil + `*-shm` sisa | ±1.564.672 | MATI |
| 13 file state/log/json kecil era lama | 92.797 total | MATI — 0 rujukan (§2b) |
| `backtest_cache/` | 114.282 | cache riset |

`.gitignore` sudah mengecualikan semua DB runtime, `*.bak*`, dan `data/sm*.json*` dari git — jadi file-file mati di `data/` adalah sisa lokal, bukan isi repo ter-track. Yang ter-track dari daftar mati hanyalah JSON kecil (`backfill-master-manifest.json`, `backtest_report.json`, `backtest0.1.json`, `stub-merge-audit.json`, `task1_market_track_c.json` muncul di `git ls-files data/`).

### Masalah struktur konkret

1. **`components/dashboard/` (20 file) — subtree komponen app lama di luar jalur hidup.** Frontend v2 tidak mengimpor satu pun komponennya (bukti §2a). Yang janggal: satu-satunya rujukan eksternal ke folder ini adalah `app/api/odds/route.ts` yang mengimpor tipe dari `components/dashboard/types.ts` — **tipe milik route API disimpan di folder komponen mati** (salah tempat dua kali: folder mati, dan tipe API bukan milik komponen).
2. **`data/` satu folder untuk tiga generasi.** DB runtime aktif bercampur dengan backup `.bak` era 27 Okt, state/log era TheStatsAPI (`sm_*`, `sweep.log`), dan artefak riset (`backtest*.json`) tanpa penanda. Pembaca baru tidak bisa membedakan mana yang hidup tanpa grep.
3. **`lib/` root menampung modul mati era fetcher lama** (`stats-fetch.ts`, `stats-log-mapper.ts`, `thestats-competitions.ts`, `api-budget.ts`) bercampur modul hidup — nama `stats-fetch.ts` vs `stats-fetcher-agent.ts` (hidup, dipakai planner + pick-slate) mudah tertukar.
4. **`scripts/` 33 file tanpa pemisah peran**: rantai produksi bebas (8), rantai trial Sportmonks (7), dan riset/one-off (±18: `parlay-lab.ts` 90.397 B, `backtest-*.ts`, `validate-*.ts`, `run-one-*.ts`, `measure-*.ts`, migrasi satu-kali) duduk sejajar. Tidak ada penanda folder/nama mana yang wajib ada di server produksi.
5. **`archive/legacy-backups/` = duplikasi riwayat di luar git**: folder `backup_v1`…`backup_v1.3` + 4 zip versi app lama (59.754.431 B) — fungsi yang sudah digantikan git.
6. **Artefak dev di root repo**: `.agents/` (6,8 MB), `.taste-skill/` (2,0 MB), `tasks/` (4,7 MB, 52 laporan) — sah untuk workspace dev, tapi harus masuk daftar *exclude* paket deploy secara eksplisit, bukan terbawa karena `rsync` root.

---

## 2. Kandidat hapus — dengan bukti per item

Metode bukti: (i) grep impor modul (`from ".../<nama>"`) di `app/ lib/ scripts/ components/`; (ii) untuk modul yang lolos (i), grep setiap nama ekspornya di seluruh pohon yang sama; (iii) untuk file data, grep nama file persis di `lib/ scripts/ app/ components/`. "0 referensi" = kedua/tiga grep kosong di luar file itu sendiri.

### (a) Aman hapus — kode tak terpakai terverifikasi

| Item | Ukuran | Bukti |
|---|---:|---|
| `components/dashboard/` — 19 dari 20 file (semua kecuali `types.ts`) | 176.056 B (185.856 total − 9.800 `types.ts`) | grep `components/dashboard` di luar foldernya: **hanya 1 hit**, `app/api/odds/route.ts:9` mengimpor `./types`. Nol impor ke 19 file lain dari `app/`, `lib/`, `scripts/`, maupun komponen hidup. Pemanggil `/api/odds` & `/api/betting` dari klien juga hanya dua kartu dashboard ini sendiri (`TheStatsOddsComparisonCard.tsx:67`, `OneXBetDeepMarketsCard.tsx:95`) — rantai mati tertutup. |
| `lib/db/sqlite-master.ts` | 7.156 B | 0 hit grep nama modul; ke-7 ekspornya (`getMasterDb`, `insertMatchRecord`, `getHistoricalMatchesByDiv`, dst.) masing-masing **refs=0**. (`football_master.db` tetap dibaca langsung oleh `build-league-canonical.ts` — bukan lewat modul ini.) |
| `lib/stats-fetch.ts` | 5.740 B | 0 impor persis (`"@/lib/stats-fetch"`, `"./stats-fetch"`, dst. kosong). Modul fetcher TheStatsAPI era lama; jalur hidup memakai `stats-fetcher-agent.ts` (modul berbeda). |
| `lib/stats-log-mapper.ts` | 5.659 B | 0 hit modul; ekspor `mapStatsToTelemetry` + 2 interface: **refs=0**. |
| `lib/thestats-competitions.ts` | 2.655 B | 0 hit modul; `TARGET_COMPETITIONS`, `getCompetitionById/ByDivCode`, `getAllTargetCompetitionIds`: **refs=0**. |
| `lib/db/thestats-vault.ts` | 3.157 B | Satu-satunya pengimpor = `lib/stats-fetch.ts:10` (mati, di atas). Mati transitif. |
| `lib/api-budget.ts` | 2.366 B | Satu-satunya pengimpor = `lib/stats-fetch.ts:11` (mati). Mati transitif. (`data/api-budget.json` sudah di-.gitignore sebagai counter runtime.) |
| Fungsi `getH2HLogs` di `lib/db/thestats-dataset.ts:587` + impor matinya di `lib/db/team-telemetry.ts:4` | — (di dalam file hidup) | **Status A6 audit lama: MASIH TERBUKA, tidak berubah.** Grep repo penuh: tepat 2 hit — definisi + baris impor. Tidak ada pemanggil. File induknya hidup; yang dihapus hanya fungsi + impor. |
| 4 entri npm script mati di `package.json` | — | **Status A5 audit lama: MASIH TERBUKA.** `ingest:multileague` → `scripts/ingest-historical-data.ts`, `report:snapshot` → `scripts/snapshot-report.ts`, `sync:outcomes` → `scripts/sync-match-outcomes.ts`, `sync:weekly` → `scripts/sync-weekly-telemetry.ts` — keempat file target terverifikasi tidak ada (`ls` gagal untuk semuanya). |

Subtotal (a): **25 file utuh** (19 dashboard + 6 lib) + 1 fungsi + 4 entri script ≈ **202.789 byte kode**.

Catatan pagar (yang dicek dan ternyata HIDUP — jangan dihapus): `lib/quant/index.ts` (barrel, diimpor planner/llm), `lib/quant/cup-form-blend.ts` (hanya dipakai harness backtest Phase C — modul riset, bukan mati produksi; simpan selama harnessnya disimpan), `lib/web/parlay.ts`, `components/landing/*`, `components/pilihan/*`, `components/ui.tsx`, `Nav/NavClient` (dipakai halaman v2).

### (b) Data/file legacy — 0 rujukan kode mana pun

| Item | Ukuran | Bukti |
|---|---:|---|
| `data/thestats_raw_vault.db` | 18.780.160 | refs nama file = 1, yaitu `lib/db/thestats-vault.ts` — modul mati transitif (§2a). Setelah (a) dieksekusi, rujukan = 0. |
| `data/thestats_dataset.db.bak_sm7_20261027` | 20.639.744 | grep `bak_sm`/`.bak` di `lib/ scripts/ app/`: **kosong**. Backup manual 27 Okt (isi snapshot pra-sprint, 20 MB vs dataset hidup 3,0 GB). |
| `data/thestats_dataset.db.bak_sm6_20261027` (+ `-shm` 32.768) | 20.447.232 | sama seperti di atas. |
| `data/thestats_dataset.db.bak_1792149069738` + `data/thestats_dataset.db.bak` | 1.531.904 | sama seperti di atas. |
| 13 file state/log kecil: `sm_sync_last_batch.json` (50.121), `backfill-master-manifest.json` (18.457), `sm_prediction_log.jsonl` — **dikecualikan, lihat catatan**, `sm6_deleted.log` (6.630), `backtest_report.json` (4.632), `backtest0.1.json` (4.629), `sm7_state.json` (2.165), `sm_daily_state.json` (2.064), `sm_sync_state.json` (1.259), `sm6_state.json` (866), `task1_market_track_c.json` (743), `sm_backfill_state.json` (654), `sweep.log` (413), `stub-merge-audit.json` (164) | 92.797 (tanpa jsonl) | grep nama file persis → **refs=0** untuk semuanya; grep pola tulis `_state.json`/`state.json` di `scripts/ lib/` juga kosong (tidak ada penulis bernama pola). |

Catatan kehati-hatian (b): `sm_prediction_log.jsonl` punya refs=1 dari `lib/odds/sportmonks-wire.ts` (jalur trial, dorman tapi KEEP per aturan owner) — **tidak** masuk daftar hapus. File `.bak*` adalah titik restore manual era 27 Okt: 0 rujukan kode (keyakinan tinggi untuk kode), nilai restore-nya keputusan owner bila ia masih mau menyimpan snapshot pra-sprint di luar repo.

Subtotal (b): **±19 file ≈ 61.491.837 byte (±61,5 MB)** — didominasi vault DB (18,8 MB) + backup dataset (42,6 MB).

### (c) Perlu keputusan owner — JANGAN hapus diam-diam

| Item | Ukuran | Kenapa owner |
|---|---:|---|
| `archive/` seluruhnya | 61.308.277 | Berisi arsip yang owner perintahkan disimpan saat package store menggantikan snapshots (21 baris legacy diarsipkan dulu). Rincian: `legacy-backups/` 59.754.431 (folder+zip app v1.0–v1.3), `analysis_snapshots-legacy-2026-10.db` 872.448, `legacy-docs/` 425.490, `legacy-scripts/` 170.530, `legacy-components/` 44.345, `legacy-lib/` 5.815, `legacy-api/` 123. Rekomendasi audit: keluarkan dari paket deploy pasti; hapus dari repo hanya atas kata owner. |
| Rute API warisan (utang **A2**) | 52.853 (4 file) | `app/api/agent/route.tsx` 19.074, `app/api/odds/route.ts` 13.460, `app/api/betting/route.ts` 11.965, `app/api/matches/route.ts` 8.354. Terverifikasi: frontend v2 tidak memanggil satu pun (satu-satunya pemanggil fetch adalah komponen dashboard mati). Tetap permukaan HTTP hidup tanpa auth → keputusan di langkah deploy (hapus rute / gating reverse proxy), sesuai catatan audit lama. |
| `components/dashboard/types.ts` | 9.800 | Terikat A2: satu-satunya pengimpornya adalah `app/api/odds`. Bila rute odds dihapus di deploy → file ini ikut kelompok (a). Bila rute dipertahankan → tipe sebaiknya dipindah ke `lib/` (salah tempat sekarang). |
| **KEEP — lib sindikat** | 113.317 | `lib/syndicate-orchestrator.ts` 52.760 + `lib/agent/` 55.501 + `lib/llm/` 5.056. Aturan owner: tetap utuh walau dormant. **TIDAK masuk daftar hapus, tidak dihitung sebagai pangkasan.** Yang ditandai hanya route HTTP-nya (A2 di atas) dan dependensi `ai`/`@ai-sdk/openai` yang hanya dipakai jalur ini + `app/api/betting`. |
| `data/football_master.db` | 9.822.208 | Bukan kandidat hapus (sumber rebuild registry liga), tapi kandidat **exclude dari paket deploy**: tidak dibaca jalur saji maupun rantai free-refresh; hanya `scripts/build-league-canonical.ts`. |
| `data/predictions.db` | 14.237.696 | Panel SM masih hidup sampai trial berakhir; nasib pasca-trial (arsip vs hapus) keputusan owner di penutupan 10 Nov. |

### Status temuan audit 2026-11-05 (diverifikasi ulang sesi ini)

| ID | Status sekarang | Bukti sesi ini |
|---|---|---|
| A1 (indeks unik live-run) | **FIXED** | `idx_picks_live_unique` ada di `picks.db` dan dipakai query plan (§3b). |
| A2 (rute API tanpa auth) | TERBUKA — utang deploy | 4 rute masih ada; pemanggil v2 = 0 (§2c). |
| A3 (telemetry ±18 mnt) | TERBUKA | `SELECT *` masih di `scripts/build-canonical-telemetry.ts:67` (§3c). |
| A4 (ESLint mati) | TERBUKA | `package.json`: `next 16.4.0` vs `eslint-config-next ^14.2.35`; `eslint.config.mjs` mengimpor `eslint-config-next/core-web-vitals` (jalur v16) → lint tetap tidak bisa jalan. |
| A5 (4 npm script mati) | TERBUKA | §2a. |
| A6 (`getH2HLogs`) | TERBUKA | §2a. |
| A7 (duplikasi predikat pasar) | TERBUKA | `lib/picks/ledger.ts:265 evaluatePick` vs `lib/web/parlay.ts:45 selectionPredicate` — dua implementasi masih hidup berdampingan. |
| A8 (`top_scorelines` persen) | TERBUKA | `lib/quant/dixon-coles.ts:321` — `prob: Math.round(s.prob * 1000) / 10, // percentage`. |
| A9 (`parsePackage` tanpa guard) | TERBUKA | `lib/web/data.ts:219` — `JSON.parse(r.payload_json as string)` di `parsePackage` masih tanpa try/catch. |
| A10 (catch diam ratings-loader) | TERBUKA | `lib/quant/ratings-loader.ts:857` — `} catch {}` masih ada. |
| A11 (capture-odds INSERT polos) | TERBUKA (umur pendek) | `scripts/capture-odds.ts:173` masih `INSERT INTO match_odds_history` tanpa OR IGNORE; script pensiun bersama trial 10 Nov. |
| A12 (lantai λ 0,2 tak terdokumentasi) | TERBUKA | Komentar `rebuildMatrix` (`lib/picks/engine.ts` ±195–198) menjelaskan trik λ/μ tapi tidak menyebut lantai 0,2 di `dixon-coles`. |
| A13 (komponen dashboard) | TERBUKA → terukur penuh | Sekarang 20 file / 185.856 B (§2a) — audit lama menghitung 16 file. |
| A14 (tepi pita ganda) | TERBUKA | `BAND_LOS` `lib/picks/engine.ts:124` vs `BANDS` `lib/picks/ledger.ts:340` — masih cermin manual. |

Skor: dari 12 minor/note audit lama, **0 yang tertutup** selain A1 (major, sudah diperbaiki sebelum merge). Sisanya persis antrean cleanup yang diminta owner sekarang — tidak ada temuan minor yang memburuk menjadi blocker.

---

## 3. Performa — terukur

### (a) Bundle (artefak `.next` yang ada, build 5 Nov 11:35 WIB)

- Total JS klien di `.next/static/chunks`: **1.271.407 byte mentah**; CSS: **92.485 byte mentah** (satu file).
- Chunk terbesar: **551.273 byte mentah / 135.762 byte gzip** — berisi three.js (4 hit string `WebGLRenderer`). Satu-satunya pengimpor `HeroScene` adalah `app/page.tsx:17,42` (landing) → chunk berat ini terisolasi di rute `/`, konsisten dengan verifikasi v2 (lazy, landing-only). Bukan masalah lintas rute.
- Chunk berikutnya: 229.850 B mentah / 71.970 B gzip; 168.606 B; 118.963 B; 112.594 B (kerangka Next/React + bersama).
- Sisi server: `.next/server/app/(terminal)` 436.482 B untuk 4 halaman saji; `app/api` 97.229 B (4 rute warisan ikut ter-bundle — hilang bila A2 diputuskan hapus).
- Vonis bundle: **sehat untuk app pribadi**; tidak ada temuan "impor berat bocor ke semua rute". Satu catatan: angka ini dari build 5 Nov — wajib diukur ulang dari build baru pada fase eksekusi (batch B3/B5) sebelum menyimpulkan perubahan.

### (b) Pola query DB di jalur saji (`lib/web/data.ts`, 668 baris — dibaca penuh per bagian)

Yang sudah benar (terverifikasi baca kode): koneksi SQLite dibuka **readOnly** dan di-cache di `globalThis` Map (`data.ts:23–36`) — tidak ada buka-tutup per request; `fixture-links.json` dan peta nama tim di-cache di variabel modul (`twinMap`, `teamNameByCanonical`); `listSafePicks` memakai `pkgCache` Map per panggilan untuk memangkas N+1 paket.

`EXPLAIN QUERY PLAN` (read-only, sesi ini):

| Query kunci | Rencana | Vonis |
|---|---|---|
| `picks` — `listSafePicks` (`source='live-run' AND kickoff>=? ORDER BY kickoff, grade, model_prob LIMIT 400`) | `SCAN picks USING INDEX idx_picks_live_unique` + temp B-tree sort | Pakai indeks parsial (subset live-run saja). Sort temp untuk ≤400 baris — wajar. |
| `picks` — `COUNT(*) WHERE source='lab'` | `SCAN USING COVERING INDEX idx_picks_lab_unique` | Covering index, tanpa sentuh tabel. |
| `picks` ⨝ `pick_outcomes` per grade | `SCAN p USING INDEX idx_picks_live_unique`, `SEARCH o USING INTEGER PRIMARY KEY` | Sehat. |
| `packages` — `LATEST_PER_MATCH` + jendela kickoff | co-routine `SCAN packages USING COVERING INDEX idx_packages_match`, `SEARCH p USING PRIMARY KEY`, temp B-tree sort | Agregasi `MAX(id) GROUP BY match_id` atas **3.802 paket** setiap panggilan — murah hari ini, tumbuh linear dengan paket. |
| `packages WHERE id=?` / `WHERE match_id=?` | `SEARCH USING PRIMARY KEY` / `SEARCH USING INDEX idx_packages_match` | Sehat. |
| `matches WHERE match_id=?` (dataset) | `SEARCH USING INDEX sqlite_autoindex_matches_1` | Sehat — PK lookup di DB 3,0 GB tetap O(log n). |
| form kanonik (`canonical_team_id=? AND substr(match_date,1,10)<? ORDER BY match_date DESC LIMIT 6`) | `SEARCH USING COVERING INDEX idx_tmlc_team_date` | Sehat — tidak ada full scan di tabel telemetri. |

**Tidak ditemukan full-table scan tanpa indeks di jalur saji.** Temuan performanya ada di level panggilan, bukan rencana query:

- **P-1 · `landingStats()` tanpa cache sama sekali** (`data.ts:623–647`): setiap panggilan membaca + `JSON.parse` `data/calibrated_ratings.json` (**545.429 B**) dari disk, menjalankan ±6 `COUNT(*)`/join agregat di `picks.db` (167.273 baris), DAN memanggil `listUpcoming(72)` penuh (agregasi latest-per-match + parse payload per laga). Halaman `/` membayar ini per request. Pola cache yang benar sudah ada di file yang sama (`twinMap`) — tinggal diterapkan dengan kunci mtime file.
- **P-2 · N+1 kecil di `ledgerStats().recent`** (`data.ts:576–603`): sampai 40 baris hasil → 1 query `packages` per baris **tanpa** Map cache (paket yang sama berulang antar-pick satu laga ikut ter-query + ter-`JSON.parse` berulang). `listSafePicks` di file yang sama sudah membuktikan pola perbaikannya.
- **P-3 · `parsePackage` mem-parse `payload_json` utuh per paket** (rata-rata **8.046 B**, maks **103.814 B** — terukur dari `AVG/MAX(LENGTH(payload_json))` atas 3.802 paket). Untuk daftar laga (ratusan paket) ini pekerjaan CPU per request yang nyata tapi masih wajar; menjadi relevan hanya bila digabung P-1 (landing memanggil daftar penuh hanya untuk menghitung `.length` upcoming — `landingStats` memakai `listUpcoming(72).length`, membuang seluruh payload yang sudah di-parse. Itu pemborosan paling konkret di jalur saji: hitung tanpa parse).

### (c) Script terlambat rantai free-refresh: `build-canonical-telemetry.ts`

Baseline (audit 2026-11-05, A3): `SELECT *` yang sama atas 86.359 baris memakan **±45 detik** di proses kosong; run rantai penuh 17:40 hari itu langkah ini **±18 menit** (konteks induk: run lain terukur ±18–22 menit), sementara total rantai 04:29 (±8 menit) berjalan di VM idle.

Bukti dari kode (dibaca penuh sesi ini):

1. `scripts/build-canonical-telemetry.ts:67` — `db.prepare("SELECT * FROM team_match_logs").all()`: **seluruh tabel dimuat jadi array objek JS sekaligus**. Tabel ini punya **98 kolom** (terukur `PRAGMA table_info`) — baris sangat lebar (statistik laga lengkap per sumber).
2. Sesudah muat: grouping in-memory linear O(n) lewat `Map` (baris 82–91), scoring per grup kecil (kembar 1–4 baris), lalu **satu transaksi** `BEGIN…COMMIT` untuk semua insert (baris 118–175) + satu `CREATE INDEX` di akhir. Tidak ada pola O(n²), tidak ada insert per baris di luar transaksi — **algoritma bukan penyebabnya**, konsisten dengan vonis A3.
3. Konteks I/O: tabel sumber hidup di file yang sama dengan `match_odds_history` bertumpuk payload — dataset kini **734.203 halaman × 4 KB = ±3,01 GB** (terukur `PRAGMA page_count/page_size` sesi ini; file 2.998.222.848 B). Scan tabel lebar di file sebesar ini dengan cache disk dingin + kontensi CPU/disk VM 4 vCPU (build/tsc/Chromium pada run 17:40) menjelaskan selisih 45 detik → ±18 menit. `journal_mode` file sudah `wal` (terukur sesi ini), jadi saran WAL di A3 sudah tidak berlaku — yang tersisa: lebar baris + ukuran file + kontensi.
4. Perbaikan konkret (untuk fase eksekusi, batch B4): (i) ganti `SELECT *` dengan daftar kolom eksplisit yang benar-benar dipakai (identitas + skor + kolom xG + `source` + hitung kelengkapan via ekspresi SQL), (ii) proses streaming `.iterate()` per grup alih-alih `.all()`, (iii) telaah terpisah pemangkasan payload `match_odds_history` (di audit lama `dbstat` tidak selesai dalam 75 detik — ukuran per tabel di file ini belum pernah terukur; jangan mengklaim angka sebelum terukur).

### (d) Waktu respon rute — rencana pengukuran (TIDAK dijalankan sesi ini)

Server tidak dinyalakan sesi ini (repo sedang dipakai run refresh; perintah tugas melarang). Rencana untuk fase eksekusi, sebelum & sesudah batch B3: `next start -p 3101` dari build yang sama, lalu `curl -s -o /dev/null -w '%{time_total}'` untuk `/`, `/pertandingan`, `/pertandingan/<id contoh>`, `/pilihan`, `/bukti` masing-masing 5× sesudah 1× pemanasan, ambil median; catat di laporan batch. Hipotesis yang diuji: `/` (landingStats P-1/P-3) dan `/bukti` (ledgerStats P-2) adalah dua rute terberat per request; `/pertandingan/[id]` paling ringan (PK lookup terindeks).

---

## 4. Temuan efisiensi/penyederhanaan — peringkat dampak × risiko × usaha

| # | Temuan | Dampak | Risiko | Usaha | Perbaikan konkret |
|---|---|---|---|---|---|
| E-1 | Rantai modul mati TheStatsAPI: `stats-fetch` → (`thestats-vault`, `api-budget`) + DB vault 18,8 MB | Sedang (struktur + 18,8 MB) | Sangat rendah (0 pemanggil terbukti berlapis) | Kecil | Hapus 3 file + vault DB dalam satu batch (B1+B2). |
| E-2 | `landingStats` parse-ulang JSON 545 KB + agregasi penuh per request (P-1/P-3) | Sedang (rute `/` tercepat membaik) | Rendah | Kecil | Cache modul bermtime untuk ratings; ganti `listUpcoming(72).length` dengan query `COUNT` khusus tanpa parse payload. |
| E-3 | `components/dashboard` 19 file mati (176 KB) + `types.ts` salah tempat | Sedang (kebersihan; nol efek runtime) | Sangat rendah | Kecil | Hapus 19 file di B1; `types.ts` mengikuti keputusan A2 di B6. |
| E-4 | Duplikasi semantik pasar: `evaluatePick` (ledger) vs `selectionPredicate` (web/parlay) (A7) + tepi pita `BAND_LOS` vs `BANDS` (A14) | Sedang (risiko drift sunyi di permukaan kepercayaan produk) | Sedang (menyentuh jalur nilai pick) | Sedang | Ekspor satu konstanta tepi pita dari ledger; tambah uji kesetaraan kecil evaluatePick×selectionPredicate untuk 8 pasar sebelum menyatukan implementasi. Jangan satukan tanpa uji. |
| E-5 | `build-canonical-telemetry` `SELECT *` 98 kolom + `.all()` (P/A3) | Tinggi untuk waktu rantai (45 dtk idle vs ±18–22 mnt kontended) | Sedang (menulis ulang tabel kanonik — output harus identik) | Sedang | Kolom eksplisit + streaming; verifikasi = laporan build (`asal/kanonik/kembar/xg-diisi`) harus byte-identik angkanya dengan run sebelumnya. |
| E-6 | Modul mati satuan: `sqlite-master`, `stats-log-mapper`, `thestats-competitions`, `getH2HLogs` (A6) | Kecil | Sangat rendah | Kecil | Hapus di B1. |
| E-7 | Perkakas mati: ESLint (A4) + 4 npm script (A5) | Sedang (tanpa gerbang lint, kelas temuan A6 lolos terus) | Rendah | Kecil–sedang | `eslint-config-next` → `^16`; hapus 4 script; aktifkan `noUnusedLocals` di tsconfig lalu bersihkan hasilnya sekali jalan. |
| E-8 | N+1 `ledgerStats.recent` tanpa cache (P-2) | Kecil | Sangat rendah | Kecil | Map cache paket seperti `listSafePicks`. |
| E-9 | Guard parse hilang (A9) + catch diam (A10) + satuan persen `top_scorelines` (A8) + komentar lantai λ (A12) | Kecil (robustness) | Rendah | Kecil | Bungkus parse per baris (lewati + log), `console.warn` ter-rate-limit di catch saji, samakan satuan ke pecahan, tambah 1 baris komentar. Batch terpisah dari cleanup agar diff bersih. |

---

## 5. Rencana eksekusi — batch kecil, terverifikasi, commit terpisah

Urutan dari paling aman/berdampak. Setiap batch: `npx tsc --noEmit` + `npm run build` + smoke 5 rute (200) sesudah server dinyalakan di jendela tanpa run refresh berjalan, lalu commit sendiri. Batch yang mengubah angka (B4) wajib menyertakan angka sebelum/sesudah di pesan commit.

- **B1 — Hapus kode mati 0-referensi** (§2a): 19 file dashboard, 6 file lib, fungsi `getH2HLogs` + impornya, 4 npm script mati. Verifikasi: tsc + build + smoke; grep ulang nama-nama itu = 0. *(dampak: −25 file, ±0,20 MB kode)*
- **B2 — Hapus data legacy** (§2b): vault DB, 4 file `.bak*` dataset (+shm sisa), 13 file state/log kecil. Verifikasi: rantai free-refresh berikutnya jalan exit 0 (membuktikan tak ada pembaca runtime), `git status` bersih untuk file ter-track. *(−±61,5 MB)*
- **B3 — Perf saji**: cache `landingStats` (mtime ratings + COUNT tanpa parse), Map cache di `ledgerStats.recent`. Verifikasi: pengukuran respon rute sesuai §3d sebelum/sesudah (median 5×), angka halaman identik. Terapkan aturan skill: bila delta di dalam derau → revert.
- **B4 — Perf telemetry**: kolom eksplisit + streaming di `build-canonical-telemetry.ts`. Verifikasi: angka laporan build identik dengan run sebelumnya + waktu langkah terukur pada run free-refresh berikutnya.
- **B5 — Perkakas**: `eslint-config-next ^16`, lint bersih, `noUnusedLocals` aktif. Verifikasi: `npx eslint` exit 0, tsc tetap bersih.
- **B6 — Keputusan owner** (bukan eksekusi sepihak): nasib `archive/`; rute A2 (hapus vs gating) + `types.ts`; `football_master.db` exclude-deploy; `predictions.db` pasca-trial.
- **B7 — Paket deploy ramping**: daftar exclude eksplisit untuk transfer ke VPS — `node_modules/` (629 MB, `npm ci` di tempat), `.next/` (86 MB, build di tempat), `.agents/`, `.taste-skill/`, `tasks/`, `docs/`, `design-system/`, `archive/` (sesuai B6), script riset/one-off di `scripts/` (simpan di repo, tak perlu di server: ±18 file ±0,39 MB dari total scripts 574.501 B). Yang wajib ikut: kode app/lib/components, 8 script rantai bebas + resolver, dan data runtime ±3,10 GB (dataset 2.998 MB + picks 47,5 MB + snapshots 34,4 MB + predictions 14,2 MB + upcoming 1,7 MB + JSON registry ±2,97 MB).

Catatan kejujuran ukuran: potensi pangkasan terbesar TIDAK ada di kode (total kode first-party cuma ±1,3 MB) — ada di isi `thestats_dataset.db` (3,0 GB) itu sendiri, dan itu **belum terukur per tabel** (dbstat tak selesai 75 detik di audit lama). Telaah payload `match_odds_history` adalah investigasi terpisah; laporan ini tidak mengklaim angka untuk itu.

---

## 6. Ringkasan headline

- **Repo sekarang: 3.993.419.368 B (±3,99 GB)** — 79,8%-nya `data/`, dan 75%-nya satu file dataset runtime yang **wajib ikut deploy** (bukan pangkasan).
- **Pangkasan repo terverifikasi (a)+(b): ±61,7 MB** — (a) 25 file kode + 1 fungsi + 4 script mati (±0,20 MB); (b) ±19 file data legacy (±61,5 MB: vault 18,8 + backup 42,6 + state/log 0,09).
- **Menunggu keputusan owner (c): ±123 MB berpotensi** — `archive/` 61,3 MB + rute A2 52,9 KB + `types.ts` 9,8 KB; lib sindikat 113,3 KB berstatus **KEEP** dan tidak dihitung.
- **Paket deploy wajib: ±3,10 GB data runtime + <2 MB kode** (di luar `node_modules` hasil `npm ci` di VPS). Exclude terukur dari transfer: `node_modules` 629 MB, `.next` 86 MB, `.agents` 6,8 MB, `tasks/` 4,7 MB, `.taste-skill/` 2,0 MB, docs/design-system 0,25 MB.
- **Temuan performa teratas**: (1) `landingStats()` tanpa cache — parse JSON 545 KB + agregasi penuh per request, termasuk parse semua payload hanya untuk `.length`; (2) `build-canonical-telemetry` `SELECT *` atas tabel 98 kolom di file 3,0 GB (algoritma linear — I/O + kontensi, bukan logika); (3) N+1 ≤40 query tanpa cache di `ledgerStats.recent`. Semua query kunci lain terverifikasi memakai indeks (EXPLAIN) — tidak ada full-table scan di jalur saji.
- **Audit lama**: A1 FIXED; 11 minor/note lain (A4–A14 + A3) masih terbuka persis seperti tertulis — itulah isi batch B1–B5. A2 tetap utang langkah deploy.
