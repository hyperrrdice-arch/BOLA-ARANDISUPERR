# Laporan Cleanup + Optimasi Pra-Deploy — football-agent

Tanggal: 2026-11-07 · Eksekutor: subagent cleanup (rencana disetujui owner)
Basis: `tasks/pre-deploy-audit-2026-11-07.md` · Branch `master`,
HEAD awal `925c578` → HEAD akhir: lihat commit terakhir laporan ini.
Setiap batch: `npx tsc --noEmit` + `npm run build` diverifikasi sebelum
commit; batch yang mengubah angka wajib menyertakan angka sebelum/sesudah.

## Ringkasan per batch

| Batch | Isi | Commit | Status |
|---|---|---|---|
| 0 | Commit laporan audit apa adanya | `33d4950` | ✅ |
| B1 | Hapus kode mati 0-referensi (25 file + 1 fungsi + 4 npm script) | `08c4817` | ✅ |
| B2 | Hapus data legacy ±61,5 MB + bukti free-refresh exit 0 | `122cabd` | ✅ |
| B3 | Perf saji: cache landingStats + COUNT upcoming + cache fixture recent | `874d8e1` | ✅ (kedua perubahan dipertahankan — delta di luar derau) |
| B4 | Perf telemetri: kolom eksplisit + streaming | — | ↩️ **DI-REVERT penuh** (lihat §B4) |
| B5 | Tooling: eslint-config-next ^16 + bersih trivial; noUnusedLocals tidak diaktifkan (alasan terukur) | `81334d9` | ✅ sebagian (sisa temuan dicatat) |
| B6 | ARCHITECTURE.md + STRUCTURE.md ke keadaan final | `24d17ab` (+ koreksi path docs) | ✅ |

## B1 — kode mati (commit `08c4817`)

Dihapus: 19 file `components/dashboard/` (disisakan `types.ts` — masih
diimpor `app/api/odds`); 6 file lib (`stats-fetch.ts`,
`db/thestats-vault.ts`, `api-budget.ts`, `db/sqlite-master.ts`,
`stats-log-mapper.ts`, `thestats-competitions.ts`); fungsi `getH2HLogs`
(`lib/db/thestats-dataset.ts`) + impor matinya di
`lib/db/team-telemetry.ts`; 4 npm script mati (`ingest:multileague`,
`report:snapshot`, `sync:outcomes`, `sync:weekly` — file target
terverifikasi tidak ada).
Verifikasi ekstra sebelum hapus: grep impor modul + grep **seluruh 31
nama ekspor** modul mati di `app/ lib/ scripts/ components/` = 0
referensi di luar file itu sendiri. Sesudah: grep ulang = 0; tsc
bersih; build sukses. Diff: 28 file, −5.012 baris.

## B2 — data legacy (commit `122cabd`)

Dihapus dari disk (nama cocok persis dengan audit/`ls`):
`data/thestats_raw_vault.db` (18.780.160 B) + sidecar -shm/-wal;
`thestats_dataset.db.bak_sm7_20261027` (20.639.744);
`thestats_dataset.db.bak_sm6_20261027` (20.414.464) + -shm/-wal;
`thestats_dataset.db.bak_1792149069738` (770.048) + `thestats_dataset.db.bak`
(761.856); 13 file state/log era lama (92.797 B total:
sm_sync_last_batch, sm_backfill_state, sm_daily_state, sm_sync_state,
sm6_state, sm7_state, sm6_deleted.log, sweep.log,
backfill-master-manifest, backtest_report, backtest0.1,
stub-merge-audit, task1_market_track_c) + `sm_sync_skip.jsonl` 0-byte
(file ke-14 sekelas, refs=0 terverifikasi grep terpisah).
Total terhapus ±61,5 MB. `sm_prediction_log.jsonl` SENGAJA
dipertahankan (direferensikan `lib/odds/sportmonks-wire.ts`).
Bukti tidak ada yang putus: satu siklus penuh
`node --env-file=.env.local --import tsx scripts/free-refresh.ts` —
**7/7 langkah exit 0** (import 40,2s; team-canonical 1,3s;
fixture-links 1,4s; calibrate 58,9s; cup-offsets 2,6s; telemetry
430,0s; pick-slate 77,5s; slate rated 390, ledger +0).

## B3 — optimasi saji (commit `874d8e1`)

Perubahan di `lib/web/data.ts`:
1. `landingStats()` — hasil di-cache per **tanda tangan file**
   (mtime+ukuran `calibrated_ratings.json`, `picks.db`,
   `analysis_snapshots.db`, `thestats_dataset.db` + WAL masing-masing)
   ditambah bucket waktu 5 menit (jendela `upcoming` bergantung jam
   dinding — basi maks 5 menit, dinyatakan di komentar kode).
   `upcoming` diganti dari `listUpcoming(72).length` (parse semua
   payload ±447 paket) menjadi `COUNT(*)` atas paket terbaru per laga
   — semantik diverifikasi sama persis (447 = 447).
2. `ledgerStats().recent` — cache Map proses `package_id → {home, away}`
   (`packageFixtureNames`): payload paket yang sama tidak lagi
   di-query + di-parse berulang per pick (pola sama seperti `pkgCache`
   yang sudah ada di `listSafePicks`).

Pengukuran (server produksi lokal `next start -p 3107`, build yang
sama, 1× pemanasan + 5× ukur, median; dijalankan 2 sesi sesudah):

| Rute | Sebelum | Sesudah | Δ |
|---|---|---|---|
| `/` | 2,048s | 1,587s / 1,593s | **−22%** |
| `/bukti` | 1,682s | 1,552s / 1,523s | **−9,5%** |
| `/pertandingan` | 0,254s | 0,326s / 0,233s | dalam derau (tak berubah) |
| `/pilihan` | 0,055s | 0,056s / 0,053s | tak berubah |
| `/pertandingan/[id]` | 0,018s | 0,018s / 0,017s | tak berubah |

Teks ter-render keempat rute utama **identik** sebelum/sesudah (diff
atas HTML ter-strip = 0 baris). Sisa biaya `/` & `/bukti` (±1,5s)
kini didominasi agregat `ledgerStats` atas 163rb baris lab
(grade-per-pasar turunan CASE) — di luar lingkup batch ini; pola cache
yang sama adalah kandidat batch berikutnya bila diinginkan.

## B4 — optimasi telemetri: DI-REVERT (tanpa commit)

Dicoba persis seperti rencana audit: `SELECT *` 98 kolom + `.all()`
di `scripts/build-canonical-telemetry.ts` diganti (1) lintasan sempit
streaming `.iterate()` — kolom identitas/skor/xG eksplisit +
kelengkapan dihitung via ekspresi SQL `(col IS NOT NULL)`; (2) lintasan
penuh yang hanya mengambil baris pemenang. Hasilnya:

- Run varian **tidak selesai dalam ±13 menit** (dibunuh; proses
  kebanyakan di status D — menunggu disk). Run pembanding script ASLI
  standalone juga **tidak selesai dalam ±10 menit** pada kondisi disk
  yang sama (di dalam rantai free-refresh B2 langkah ini 430,0s).
- Mikro-benchmark baca terisolasi (cache hangat) membuktikan sisi baca
  BUKAN masalahnya: lintasan sempit+ekspresi 29,3s; `SELECT *`
  `.iterate()` 28,7s; `SELECT *` `.all()` 38,0s — semua atas 86.687
  baris. Fase yang mendominasi adalah **tulis** (84.388 baris lebar +
  indeks ke file 3,0 GB), tidak tersentuh oleh pola baca mana pun.
  Observasi sampingan: file WAL dataset sempat 1,44 GB selama
  percobaan dan ter-checkpoint bersih sesudahnya (WAL hilang) — run
  pemulihan sesudah itu selesai dalam ±4 menit.
- Konsekuensi teknis selama percobaan: dua run yang dibunuh sempat
  meninggalkan `team_match_logs_canonical` kosong (DROP ter-commit,
  transaksi insert ter-rollback). Tabel **dibangun ulang penuh dengan
  script asli** dan diverifikasi: angka laporan identik dengan
  baseline B2 (asal=86687, kanonik=84388, kembar=2299, xg-diisi=0,
  tak-teresolusi=0; pemenang sportmonks=83356, thestats=334,
  football-data=680, master=18) dan **hash isi tabel identik**:
  sha256 `a96b38e65700ac068fd35ca223ab3905e1eed7b763099eeba5be051990c4620f`
  (84.388 baris × 106 kolom, urut `log_id`) — sama sebelum dan sesudah
  seluruh percobaan B4.
- Keputusan: **revert penuh** (script kembali byte-identik ke HEAD).
  Aturan skill performance: perubahan tanpa perbaikan terukur tidak
  dipertahankan. Bila kelak dikejar, target yang benar adalah fase
  tulis/WAL (checkpoint terjadwal, `synchronous`/`journal_size_limit`
  telaah terpisah) — bukan pola SELECT.

## B5 — tooling (commit `81334d9`)

- `eslint-config-next` **^14.2.35 → ^16.4.5** (npm install -D; cocok
  dengan next 16.4.0). Temuan A4 tertutup: `npx eslint .` kini jalan
  ujung-ke-ujung (sebelumnya mati total karena config v14 vs Next 16).
- Lint awal: **101 problems (92 errors, 9 warnings)**. Yang trivial &
  aman diperbaiki (6 warning): impor/tipe tak terpakai di
  `lib/quant/luck-regression.ts`, `scripts/backtest-cup-form-blend.ts`,
  `scripts/backtest-walkforward.ts`, `scripts/parlay-lab.ts`,
  `scripts/sync-context.ts`. Sisa: **95 problems (92 errors,
  3 warnings)**.
- Sisa yang SENGAJA tidak dipaksakan (dicatat, bukan disembunyikan):
  90× `@typescript-eslint/no-explicit-any` tersebar (program
  pengetikan non-trivial; sebagian di file terlarang-sentuh);
  1× `react-hooks/set-state-in-effect` di
  `components/landing/DataBall3D.tsx` (perbaikan menyentuh perilaku
  efek — non-trivial); 3 temuan di `lib/syndicate-orchestrator.ts`
  (KEEP aturan owner); 1 pola `Omit` `_drop` yang disengaja.
- `noUnusedLocals`: **tidak diaktifkan**. Uji via flag CLI memberi
  tepat 2 error TS6133 — `MODEL_DEFAULT` (baris 111) dan `matchSummary`
  (baris 607), keduanya di `lib/syndicate-orchestrator.ts` (zona 🔒).
  Mengaktifkannya merusak build kecuali file owner-protected itu
  disentuh; syarat batch ("bila tidak merusak build") tidak terpenuhi.
  Selain dua itu, seluruh repo lolos `noUnusedLocals`.
- Verifikasi: tsc bersih; build sukses.

## B6 — dokumentasi (commit `24d17ab` + koreksi)

- `ARCHITECTURE.md`: §2 kini membedakan jalur saji aktif (frontend v2
  via `lib/web/data.ts`; rute `/`, `/pertandingan`,
  `/pertandingan/[matchId]`, `/pilihan`, `/bukti`; `feed_mode`
  full/free) dari jalur planner/sindikat dorman + utang A2; §3.2 tabel
  store diperbarui (`picks.db` masuk, vault keluar, dataset ±3,0 GB,
  3.802 paket); §7.2 mencatat modul fetcher yang dihapus; §8 memuat
  ritme `free-refresh` 7 langkah sebagai ritme yang bertahan +
  koreksi tanggal job penutup (10 Nov); §10 addendum status temuan
  audit pasca-cleanup.
- `STRUCTURE.md`: ditulis ulang penuh dari pohon file aktual (peta
  lama masih menyebut `components/dashboard` sebagai UI dashboard dan
  frontend "MENYUSUL", serta 6 file lib yang sudah dihapus).

## Ukuran repo

| | Byte |
|---|---|
| Sebelum cleanup | 4.029.412.190 |
| Sesudah cleanup | 3.985.588.093 |
| **Delta bersih terukur** | **−43.824.097 (−43,8 MB)** |

Kenapa bukan −61,7 MB penuh: dalam jendela cleanup yang sama, run
verifikasi free-refresh sendiri menumbuhkan data runtime
(`thestats_dataset.db` 2.998→3.036 GB dari impor + rebuild telemetri;
`analysis_snapshots.db` 34,4→38,0 MB; `predictions.db` 14,2→16,9 MB)
dan upgrade eslint menambah `node_modules` (629→641 MB). Yang dihapus
permanen: ±61,5 MB data legacy + ±0,20 MB kode mati.

## Yang SENGAJA tidak disentuh (keputusan owner — bukan wewenang eksekutor)

- `archive/` (61,3 MB) — utuh; hanya dikecualikan dari paket deploy.
- Rute API warisan `app/api/agent|betting|odds|matches` (A2) —
  keputusan langkah deploy (hapus vs gating reverse proxy);
  `components/dashboard/types.ts` mengikuti nasib `app/api/odds`.
- `data/football_master.db` — tetap di repo (sumber rebuild registry);
  exclude dari paket deploy.
- `data/predictions.db` — nasib pasca-trial diputuskan di penutupan
  10 Nov.
- Seluruh kode sindikat (`lib/syndicate-orchestrator.ts`, `lib/agent/`,
  `lib/llm/`) — KEEP utuh per aturan owner (berdampak terukur ke B5:
  lint & noUnusedLocals menyisakan temuan tepat di zona ini).
- `data/thestats_dataset.db`, `data/picks.db`,
  `data/analysis_snapshots.db` — kargo runtime wajib.
- `data/sm_prediction_log.jsonl` — direferensikan kode live trial.

## Cara trio skill efisiensi diterapkan (konkret)

- **performance_optimization (MEASURE → IDENTIFY → FIX → VERIFY):**
  tidak ada optimasi tanpa baseline — B3 diukur median-5× sebelum &
  sesudah di server produksi lokal dan hanya dipertahankan karena
  delta di luar derau (`/` −22%, `/bukti` −9,5%; rute tak-terkait
  terbukti dalam derau); B4 dibatalkan justru karena pengukuran
  membuktikan sisi baca bukan leher botolnya (29–38s dari total
  ±430s) — revert berdasarkan data, bukan selera.
- **code_simplification (Chesterton's Fence + preserve behavior):**
  setiap kandidat hapus B1/B2 dibuktikan dulu pemanggilnya (grep impor
  + grep per-nama ekspor untuk 31 ekspor; grep nama file persis untuk
  data) sebelum satu byte pun dihapus; pagar yang terbukti hidup
  (`lib/quant/index.ts`, `types.ts`, `sm_prediction_log.jsonl`,
  pola `Omit` `_drop`) dipertahankan dan dicatat alasannya. Perilaku
  dijaga persis: COUNT B3 dibuktikan sama (447=447), teks render 4
  rute identik, dan isi tabel telemetri dibuktikan hash-identik.
- **code_review_and_quality (lima sumbu + dead-code hygiene):**
  temuan dipilah per sumbu — korektnes (semantik COUNT & hash
  telemetri diverifikasi, bukan diasumsikan), keamanan (A2 TIDAK
  diselesaikan diam-diam; ditandai sebagai keputusan owner di docs),
  performa (B3/B4 terukur), keterbacaan/arsitektur (docs ditulis
  ulang dari pohon aktual), dan hygiene (kode/data mati dihapus
  berkelompok dengan bukti, yang menyangkut owner ditandai eksplisit
  di §"tidak disentuh", bukan dihapus diam-diam).
