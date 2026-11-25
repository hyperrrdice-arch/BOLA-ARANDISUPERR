# Laporan Audit Item 21 — Ketersediaan xG, Shots Proxy, & Lineup (Prasyarat ML1)

**Sifat: 100% READ-ONLY AUDIT.** Tidak ada kode produksi, database, cron, atau
config yang diubah. Tidak ada pelatihan ML1 (Item 5) / Q3 (Item 4). Status
parkir Item 27 tidak diubah. R-04 tidak dikerjakan. Semua angka berasal dari
query aktual read-only (`mode=ro`) ke DB/file lokal pada 25 Nov 2026 malam;
tidak ada kuota API-Football / football-data.org yang dipakai.

**Basis:** brief menyebut master `6d783ab`; HEAD aktual saat audit dimulai
`81cf16c` (satu commit laporan Fix-4/WAL di atas `6d783ab`; isi kode/data yang
diaudit identik). Log: `81cf16c` → `6d783ab` → `2c5c646`.

---

## Fase 0 — Jangkar Isolasi & Inventaris Sumber

Hash jangkar (awal = akhir, lihat §Isolasi):

| File | sha256 |
|---|---|
| `data/model-manifest.json` | `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` |
| `data/calibrated_ratings.json` | `be93286a1f55836e7645ea03d7f19415e8a193b6d6ab5c9d257229589a636685` |

`git status` pada awal audit **tidak bersih** — churn terjadwal free-refresh
(`data/calibrated_ratings.json`, `data/fixture-links.json`,
`data/league-canonical.json`, `data/team-canonical.json`, file `tasks/*`) +
file tak-terlacak pra-ada (`data/market_snapshots.db`,
`data/model-artifacts/*.json`, `data/model-manifest.candidate.json`,
`tasks/reports/diagnosis-hang-2026-11-23.md`). Jejak audit ini hanya SATU file
baru: laporan ini.

Sumber yang **benar-benar ada** (diverifikasi, bukan diasumsikan):

| Sumber | Isi relevan |
|---|---|
| `data/thestats_dataset.db` (3,04 GB) | `matches` 71.695 baris (semua `status='finished'`); `team_match_logs` 91.125 log tim-laga (kolom xG/shots/SoT/corners/fouls/cards/possession lengkap per baris); `team_match_logs_canonical` 85.194 log (hasil dedupe, `chosen_source`); `expected_lineups` 796 baris; `team_squads` 3.893 |
| `data/football_master.db` (9,8 MB) | `matches` 28.922 laga, 16 divisi, 2021-07-23 s.d. 2026-10-14; kolom `hs/as_shots/hst/ast` + `h_xg/a_xg` |
| `data/historical/raw/` | 96 CSV football-data.co.uk (16 divisi × musim 21/22–26/27), 28.923 baris; kolom `HS/AS/HST/AST/HF/AF/HC/AC/HY/AY/HR/AR` |
| `data/market_snapshots.db` | 1.160 snapshot odds (1X2/OU) — **tidak ada kolom xG/lineup**; bukan sumber fitur |
| `data/predictions.db` | Prediksi probabilitas Sportmonks — bukan statistik laga |
| `data/picks.db` | Ledger pick/tiket — bukan sumber fitur historis |

**Pekerjaan lama yang TIDAK diulang (PR 4, `tasks/reports/pr4-kandidat-report.md`):**
kandidat Q1 memakai fitur `[rest_diff, venue_neutral, promoted, form_residual,
missing_flags]`; `form_residual` sengaja berbasis **gol** karena xG saat itu
hanya ada di 34.474/83.426 log Sportmonks (±41%) — angka itu terkonfirmasi
persis oleh audit ini. Ablasi pada α\*=0,3: NLL V2 model penuh 1,796243 vs
tanpa `form_resid` 1,796388 → kontribusi form hanya **−0,000144**. Gate promosi
**GAGAL**: Δ pooled 1X2 kandidat−champion −0,000066 (CI 95% [−0,000752;
+0,000625], memuat 0; ambang manfaat −0,005 tidak tercapai).

---

## Fase 1 — Cakupan xG & Proxy

### Identifikasi kolom aktual

- **xG asli:** `team_match_logs(.canonical).xg_for/xg_against` (+ `npxg_*`,
  `first_half_xg_*`); `football_master.matches.h_xg/a_xg`. CSV mentah
  football-data.co.uk **tidak punya kolom xG sama sekali**.
- **Proxy:** `shots_for`, `shots_on_target_for`, `corners_for`,
  `fouls_committed`, `yellow_cards`, `red_cards`, `possession_pct` (semua di
  `team_match_logs*`); `hs/hst` di `football_master`; `HS/HST/HC/HY/HR` di CSV.
- **Corners/cards di `football_master.db`: TIDAK TERSEDIA (0%)** — kolomnya
  tidak ikut terimpor (ada di CSV mentah: 99,9%).

### Matriks per provider (log tim-laga, `team_match_logs`)

| Provider (source) | n log | % xG | % Shots | % SoT | % Corners | % Kartu Kuning | % Possession |
|---|---:|---:|---:|---:|---:|---:|---:|
| sportmonks | 83.426 | 41,3 | 82,5 | 82,6 | 83,8 | 78,7 | 81,9 |
| football-data | 5.276 | 83,2 | 100,0 | 100,0 | 0,0 | 0,0 | 0,0 |
| (source NULL) | 2.348 | 90,4 | 95,2 | 95,5 | 95,5 | 95,6 | 95,5 |
| master | 75 | 100,0 | 100,0 | 100,0 | 0,0 | 0,0 | 0,0 |

### Sportmonks per musim — cakupan TIDAK stabil antar-era

| Musim | n log | % xG | % Shots | % SoT | % Corners | % Kartu Kuning |
|---|---:|---:|---:|---:|---:|---:|
| 2025 | 15.578 | 26,0 | 75,0 | 75,5 | 76,2 | 70,0 |
| 2025/2026 | 33.574 | 59,5 | 94,6 | 94,6 | 94,7 | 92,7 |
| 2026 | 21.444 | 17,5 | 66,9 | 67,3 | 69,6 | 57,9 |
| 2026/2027 | 12.822 | 52,2 | 86,1 | 85,6 | 88,2 | 87,1 |

xG Sportmonks berayun 17,5–59,5% antar musim — bukan properti yang bisa
diasumsikan konstan untuk backtest panjang.

### football-data.co.uk (CSV mentah + impor `football_master`)

- Shots/SoT: **99,9%** (28.881/28.922 di DB; CSV 99,9% untuk HS/HST/HC/HY/HR
  di semua 16 divisi).
- xG di `football_master`: **0,0% untuk semua divisi musim 2021/22–2025/26**;
  100% hanya pada musim berjalan 2026/2027 (1.078 laga) → total **3,7%**.
  Untuk jendela historis panjang, xG dari sumber ini = TIDAK TERSEDIA (0%).

### Jendela evaluasi PR 3 (V1 / V2 / H)

Definisi persis dari `lib/eval/chronological-evaluator.ts` (baris 93–95) +
`scripts/evaluate-chronological.ts`: universe = `matches` dengan
`competition_id LIKE 'sm:%'`, `status='finished'`, skor non-null, terurut
`competition_id, utc_date` — **69.065 laga, 103 kompetisi**. Lipatan adalah
irisan indeks kronologis **per kompetisi**: V1 = [55%, 70%), V2 = [70%, 85%),
H = [85%, 100%). Cakupan di bawah = % laga uji yang log **kedua tim**-nya ada
dan fitur non-null (log canonical; angka log mentah Sportmonks berbeda ≤0,2
poin). Kehadiran log kedua tim sendiri: 99,8–100,0% di semua lipatan.

| Lipatan | n laga | % xG Asli | % Shots | % SoT | % Corners | % Kartu Kuning |
|---|---:|---:|---:|---:|---:|---:|
| V1 | 10.354 | 43,5 | 82,8 | 83,1 | 84,5 | 79,6 |
| V2 | 10.366 | 41,6 | 81,3 | 81,5 | 83,1 | 78,2 |
| H | 10.406 | 42,8 | 86,2 | 85,9 | 87,2 | 80,7 |

Kelayakan *rolling as-of* (kedua tim punya ≥3 log lampau berfitur sebelum
kickoff — syarat riwayat minimum yang dipakai `form_residual` PR 4):

| Lipatan | ≥3 prior xG | ≥3 prior Shots | ≥1 prior xG | ≥1 prior Shots |
|---|---:|---:|---:|---:|
| V1 | 44,6% | 76,6% | 45,8% | 85,0% |
| V2 | 43,7% | 78,6% | 45,3% | 85,4% |
| H | 48,3% | 82,0% | 51,1% | 89,9% |

### Kompetisi terbesar di universe — heterogenitas ekstrem

| Kompetisi | n | % xG | % Shots | % Corners |
|---|---:|---:|---:|---:|
| Club Friendlies 3 (sm:2451, uncalibrated) | 12.624 | 0,0 | 23,8 | 25,9 |
| Club Friendlies 4 (sm:2452, uncalibrated) | 3.056 | 0,0 | 33,0 | 36,9 |
| FA Cup (sm:24, uncalibrated) | 1.922 | 3,3 | 16,5 | 17,5 |
| MLS (sm:779, calibrated) | 1.540 | 66,8 | 66,8 | 66,8 |
| Liga Profesional Argentina (sm:636, partial) | 1.364 | 71,7 | 72,3 | 72,3 |
| National League Inggris (sm:17, partial) | 1.296 | 0,0 | 57,3 | 57,2 |
| Championship (sm:9, partial) | 1.281 | 56,6 | 56,6 | 56,6 |
| League One (sm:12, calibrated) | 1.271 | 56,3 | 56,3 | 56,3 |
| League Two (sm:14, partial) | 1.277 | 56,4 | 56,4 | 56,4 |
| La Liga 2 (sm:567, partial) | 1.067 | 56,2 | 56,2 | 56,2 |
| Serie A Brasil (sm:648, partial) | 1.099 | 65,4 | 65,4 | 65,4 |
| Liga BetPlay Kolombia (sm:672, partial) | 1.254 | 0,0 | 65,7 | 65,7 |

Pola liga-liga Inggris/Spanyol ±56% seragam di semua fitur = per laga
sifatnya *all-or-nothing* (satu paket stat-line utuh atau tidak ada sama
sekali). Kompetisi terbesar di universe justru laga persahabatan tanpa
statistik — cakupan pooled menyembunyikan bias per-liga ini.

### Point-in-time (anti-leakage)

- `matches.available_at`: non-null hanya **4 dari 71.695** laga (0,006%,
  ingest fdorg Item 6) → **bukan** instrumen point-in-time yang bisa dipakai
  untuk korpus historis.
- Yang bersih: `team_match_logs.match_date` (0 NULL / 0 format rusak di
  85.194 log canonical) + `matches.utc_date` (kickoff). Agregat *as-of*
  `match_date < kickoff` adalah pola yang dipakai evaluator produksi dan
  terbukti invarian terhadap data masa depan oleh suite injeksi masa depan
  (`tests/test-evaluator-kronologis.ts` bagian A, 22/22).
- Bukti query as-of aktual (target: laga MLS `sm_19609777`, kickoff
  2026-09-06, tim kandang id 292): rata-rata rolling `xg_for` **as-of =
  2,0707 (n=58)** vs tanpa predikat tanggal (bocor) = **2,0214 (n=70)** —
  predikat tanggal benar-benar menyingkirkan 12 log masa depan dan mengubah
  nilai; fitur rolling point-in-time **layak secara konstruksi** untuk
  statistik yang memang ada.

---

## Fase 2 — Lineup

| Sumber | Tersedia di Free Tier? | Publikasi vs Horizon App | Status |
|---|---|---|---|
| Sportmonks — `expected_lineups` lokal | Ya (sudah terambil; 796 baris = 398 fixture × 2 sisi) | Diambil manual via `scripts/sync-context.ts` (`include=lineups`, fixture ≤7 hari) dalam SATU jendela 3–7 Nov 2026; jarak ambil→kickoff terukur: T-0 hari 190 fixture, T-1 163, T-2 37, T-3 8. XI **resmi** sendiri baru terbit ±45–60 mnt pra-kickoff | **PARKIR** |
| Sportmonks — XI aktual historis (`starting_xi_ids`) | Kolom ada | — | **PARKIR** (canonical 0,0%; mentah 810/91.125 = 0,9%) |
| football-data.org free (adapter lokal) | Tidak — adapter `lib/feeds/fdorg-results.ts` hanya mengambil hasil FINISHED; endpoint lineup tidak diimplementasikan | — | **PARKIR** |
| API-Football free (adapter lokal) | Tidak terimplementasi — adapter `lib/feeds/api-football.ts` hanya `/fixtures` + `/odds` | — | **PARKIR** |

Alasan putusan: (1) XI resmi terbit ±45–60 menit pra-kickoff — secara
struktural **sesudah** cutoff tiket resmi Fix-4 14:00 WIB dan jauh di dalam
horizon prediksi app (T-24, T-12); memakainya = melanggar aturan horizon
anti-leakage brief. (2) Lineup *prediksi* memang bisa ada di Sportmonks
beberapa hari sebelumnya, tetapi app tidak punya jalur tangkap otomatisnya
(sync-context manual, bukan rantai refresh) dan arsip historisnya hanya 398
fixture dari satu pekan — **tidak ada basis latih maupun validasi**. (3) XI
aktual historis untuk fitur turunan (mis. kontinuitas susunan) pun 0,0% di
tabel canonical. Kesimpulan: lineup **tetap diparkir (Item 27)** untuk ML1.

---

## Fase 3 — Ringkasan Wajib & Rekomendasi Go / No-Go

### (1) Tabel Cakupan Fitur per Provider × Musim

| Provider | Musim / Lipatan | n | % xG Asli | % Shots / SoT | % Corners / Cards |
|---|---|---:|---:|---:|---:|
| Sportmonks (log) | 2025 | 15.578 | 26,0 | 75,0 / 75,5 | 76,2 / 70,0 |
| Sportmonks (log) | 2025/2026 | 33.574 | 59,5 | 94,6 / 94,6 | 94,7 / 92,7 |
| Sportmonks (log) | 2026 | 21.444 | 17,5 | 66,9 / 67,3 | 69,6 / 57,9 |
| Sportmonks (log) | 2026/2027 | 12.822 | 52,2 | 86,1 / 85,6 | 88,2 / 87,1 |
| football-data (log) | semua | 5.276 | 83,2 | 100,0 / 100,0 | 0,0 / 0,0 |
| football-data.co.uk (CSV) | 21/22–26/27 | 28.923 | TIDAK TERSEDIA (0%) | 99,9 / 99,9 | 99,9 / 99,9 |
| football-data.co.uk (impor DB) | 21/22–25/26 | 27.844 | 0,0 | 99,9 / 99,9 | TIDAK TERSEDIA (0%) |
| Log canonical (universe PR 3) | V1 | 10.354 | 43,5 | 82,8 / 83,1 | 84,5 / 79,6 |
| Log canonical (universe PR 3) | V2 | 10.366 | 41,6 | 81,3 / 81,5 | 83,1 / 78,2 |
| Log canonical (universe PR 3) | H | 10.406 | 42,8 | 86,2 / 85,9 | 87,2 / 80,7 |

### (2) Tabel Evaluasi Lineup

Lihat Fase 2 — semua sumber berstatus **PARKIR**; XI resmi ±45–60 mnt
pra-kickoff vs cutoff Fix-4 14:00 WIB / horizon T-24 & T-12; arsip historis
398 fixture (satu pekan manual) + `starting_xi_ids` canonical 0,0%.

### (3) Rekomendasi Go / No-Go (berbasis angka)

**Ambang cakupan yang dipakai (USULAN AUDIT INI — bukan aturan pemilik;
brief maupun audit sebelumnya tidak menetapkan ambang cakupan ML1):** fitur
dinyatakan lolos bila di **setiap** lipatan V1/V2/H: (i) cakupan kedua tim
≥80%, dan (ii) kelayakan as-of ≥3 log lampau untuk kedua tim ≥80% (angka 3 =
syarat riwayat minimum `form_residual` PR 4). Di bawah itu, mayoritas sinyal
yang dilatih adalah pola *missing*-nya, bukan permainannya — dan PR 4 sudah
membuktikan fitur form bercakupan ~penuh pun kontribusinya hanya −0,000144.

- **ML1 Tahap A (Form / Elo di atas `base_margin` champion): GO.**
  Inputnya tidak punya masalah cakupan: skor lengkap 100% menurut konstruksi
  universe (69.065 laga), log kedua tim hadir 99,8–100,0% di semua lipatan,
  form gol/Elo dapat dihitung as-of untuk nyaris semua laga uji. *Catatan
  wajib:* GO ini soal kesiapan data, bukan janji lift — eksperimen terdekat
  (lapisan koreksi Q1 PR 4) gagal di gate beku; Tahap A tetap harus
  pra-registrasi + tunduk gate yang sama.
- **ML1 Tahap B (+xG asli atau +Shots/SoT proxy as-of): GO TERBATAS — hanya
  jalur proxy; NO-GO untuk xG asli.**
  - **xG asli: NO-GO.** Cakupan lipatan 41,6–43,5% dan as-of ≥3 hanya
    43,7–48,3% — separuh ambang di semua lipatan; 0,0% utuh di National
    League, Liga BetPlay, dan dua kompetisi persahabatan terbesar; antar
    musim berayun 17,5–59,5%. Melatih di atasnya = melatih bias ketiadaan.
  - **Fitur yang lolos syarat: `shots_for` dan `shots_on_target_for`
    (rolling as-of).** Cakupan lipatan 81,3–86,2% (lolos uji (i) di semua
    lipatan). Uji (ii) as-of ≥3: 76,6% / 78,6% / 82,0% — lolos hanya di H,
    kurang 1,4–3,4 poin di V1/V2; kekurangan itu terkonsentrasi di awal
    lipatan (tim ber-riwayat tipis) dan membaik monoton ke H, jadi fitur
    ini dinyatakan lolos **dengan syarat wajib**: *missing flags* (pola yang
    sudah ada sejak Q1) + ablasi pra-registrasi melawan champion dan Tahap
    A. Bila ambang 80% dituntut kaku juga untuk uji (ii), statusnya berubah
    menjadi NO-GO — angkanya tertulis apa adanya di Fase 1 untuk keputusan
    pemilik.
  - **Tidak lolos / belum lolos:** `corners_for` — cakupan lipatan lolos
    (83,1–87,2%) tetapi as-of ≥3 tidak diukur terpisah (satu paket stat-line
    dengan shots; tidak diklaim lolos). `yellow_cards` — tidak lolos uji
    (i) (78,2% di V2). `possession_pct` — 81,9% di log Sportmonks keseluruhan
    tetapi tidak dihitung per lipatan → tidak masuk daftar lolos.
- **Perlu bayar data tambahan sekarang? TIDAK.** (1) Lubang xG adalah soal
  cakupan per-kompetisi/era di tier gratis, dan jalur proxy gratis (shots/
  SoT 81–86% + CSV 99,9%) belum pernah diablasi — belum ada bukti fitur
  non-gol menambah sinyal di atas champion (PR 4: form gol cakupan-penuh
  hanya −0,000144 dan gate gagal). (2) Membayar untuk menaikkan cakupan xG
  sebelum ablasi proxy gratis terbukti bernilai = belanja mendahului bukti.
  Tinjau ulang hanya bila ablasi Tahap B proxy menunjukkan lift nyata dan
  xG menjadi kendala pengikatnya.

### (4) Konfirmasi Isolasi 100% Read-Only

- sha256 akhir `data/model-manifest.json` =
  `a6cf947a4f9f1ccfb80fcfccc739dca522bfc00dd042f2b6759530dca2b54315` —
  **identik** dengan Fase 0.
- sha256 akhir `data/calibrated_ratings.json` =
  `be93286a1f55836e7645ea03d7f19415e8a193b6d6ab5c9d257229589a636685` —
  **identik** dengan Fase 0.
- Semua koneksi SQLite dibuka `mode=ro`; tidak ada penulisan ke DB,
  manifest, ratings, `lib/quant/*`, cron, atau config web.
- `git status` akhir: himpunan churn free-refresh yang sama persis dengan
  awal audit (pra-ada, bukan dari audit) + satu-satunya file baru dari audit
  ini adalah laporan ini, yang di-commit tunggal sesuai brief.

---

## Lampiran — Metode Replikasi Lipatan

Universe & lipatan direplikasi persis dari `scripts/evaluate-chronological.ts`
(loader: `competition_id LIKE 'sm:%' AND status='finished' AND home_score IS
NOT NULL AND away_score IS NOT NULL ORDER BY competition_id, utc_date`) dan
`foldForIndex` di `lib/eval/chronological-evaluator.ts`
(V1 [0,55; 0,70), V2 [0,70; 0,85), H [0,85; 1,00) dari indeks per kompetisi).
Cakupan lipatan dihitung atas `team_match_logs_canonical` (dipakai produksi)
dan dicross-check atas log mentah `source='sportmonks'` (dipakai evaluator);
selisih ≤0,2 poin persentase. Nama kompetisi dari `league_calibration`.
