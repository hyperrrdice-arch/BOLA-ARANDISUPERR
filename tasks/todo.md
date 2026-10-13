# Tasks: Dual-Layer SQLite Relational Database & Dixon-Coles Calibration

## Slice 1: Database Schema & Hybrid Ingestion Pipeline

- [x] Task 1: SQLite Master Schema & Database Client (`lib/db/sqlite-master.ts`)
  - **Description**: Membangun modul koneksi dan inisialisasi schema database SQLite menggunakan native `node:sqlite`. Tabel `matches` mencakup date, div, home_team, away_team, fthg, ftag, ftr, hthg, htag, hs, as, hst, ast, closing odds (pinnacle, bet365). Menyediakan helper query terindeks untuk lookup riwayat tim.
  - **Acceptance criteria**:
    - [x] Schema terbuat dengan indeks pada `(div, date)` dan `(home_team, away_team)`.
    - [x] Mendukung idempotent creation (`CREATE TABLE IF NOT EXISTS`).
    - [x] Fungsi upsert match mencegah duplikasi record (`INSERT OR IGNORE` / `REPLACE`).
  - **Verification**:
    - [x] Tests pass: Ingestion 22.394 baris berhasil tanpa duplikasi.
    - [x] Build succeeds: `npx tsc --noEmit` lulus.
    - [x] Manual check: Database `data/football_master.db` (7.3 MB) tercipta dan tabel terverifikasi.
  - **Dependencies**: None
  - **Files touched**:
    - `lib/db/sqlite-master.ts`
    - `lib/db/index.ts`
    - `types/node-sqlite.d.ts`

- [x] Task 2: Team Name Resolution Engine (`lib/quant/team-normalizer.ts`)
  - **Description**: Membangun modul normalisasi nama klub sepak bola yang memetakan variasi nama dari dataset Football-Data.co.uk dan sumber eksternal ke nama standar TheStatsAPI & 1xBet untuk 10 divisi (Top 5 Eropa + 5 Kasta Kedua).
  - **Acceptance criteria**:
    - [x] Memetakan minimal 50+ alias umum (misal: "Man United" -> "Manchester United", "Nott'm Forest" -> "Nottingham Forest", "Ath Madrid" -> "Atletico Madrid", "Sp Gijon" -> "Sporting Gijon").
    - [x] Fungsi `normalizeTeamName(rawName: string): string` tahan terhadap spasi berlebih, aksen (diakritik), dan variasi kapitalisasi.
  - **Verification**:
    - [x] Tests pass: 428 klub di 16 divisi dipetakan dan diuji.
    - [x] Build succeeds: `npx tsc --noEmit` lulus.
  - **Dependencies**: None
  - **Files touched**:
    - `lib/quant/team-normalizer.ts`
    - `lib/quant/index.ts`

- [x] Task 3: Historical Dataset Downloader & Ingestion Script (`scripts/download-historical-data.mjs` & `scripts/ingest-historical-data.ts`)
  - **Description**: Membuat downloader otomatis yang mengunduh dataset 4 musim (2021/22 s/d 2024/25) dari Football-Data.co.uk untuk 16 divisi ke `data/historical/raw/`, serta ingestion worker yang mem-parse file CSV dan menyimpannya ke `data/football_master.db`.
  - **Acceptance criteria**:
    - [x] Downloader berhasil mengambil 64 file CSV tanpa error network (Total: 9.92 MB).
    - [x] Ingestion worker membersihkan record, menormalkan nama tim, dan memasukkan data ke SQLite.
    - [x] Total 22.394 pertandingan berhasil di-ingest ke `data/football_master.db`.
  - **Verification**:
    - [x] Script run: `node scripts/download-historical-data.mjs` (64/64 OK)
    - [x] Ingest run: `npx tsx scripts/ingest-historical-data.ts` (22.394 match OK)
    - [x] Manual check: Database size 7.3 MB.
  - **Dependencies**: Task 1, Task 2
  - **Files touched**:
    - `scripts/download-historical-data.mjs`
    - `scripts/ingest-historical-data.ts`
    - `data/historical/raw/*.csv`

---

## Slice 2: Dixon-Coles MLE Calibration & Ratings Matrix Builder

- [x] Task 4: Dixon-Coles Bivariate Poisson MLE Calibration Engine (`scripts/calibrate-ratings.ts`)
  - **Description**: Membangun algoritma optimasi Maximum Likelihood Estimation (MLE) untuk mengestimasi parameter kekuatan serang ($\alpha_i$), bertahan ($\beta_j$), home advantage ($\gamma$), dan koreksi skor rendah ($\rho$) dengan bobot peluruhan waktu eksponensial ($\xi = 0.0035/\text{hari}$). Mengekspor hasilnya ke file `data/calibrated_ratings.json`.
  - **Acceptance criteria**:
    - [x] Konstrain identifiabilitas terpenuhi: mean attack = 1.0.
    - [x] Optimasi konvergen untuk seluruh 16 divisi target.
    - [x] Menghasilkan `data/calibrated_ratings.json` (111.6 KB, 428 klub, 16 liga).
  - **Verification**:
    - [x] Script run: `npx tsx scripts/calibrate-ratings.ts`
    - [x] Output check: `data/calibrated_ratings.json` tercipta (111.6 KB).
    - [x] Sanity check: Liverpool α=1.595, Bayern Munich α=1.930, Arsenal pertahanan terbaik β=1.175.
  - **Dependencies**: Task 3
  - **Files touched**:
    - `scripts/calibrate-ratings.ts`
    - `data/calibrated_ratings.json`

- [x] Task 5: Runtime Ratings Loader with Empirical Bayes Shrinkage (`lib/quant/ratings-loader.ts`)
  - **Description**: Membangun modul runtime ultra-cepat yang memuat `data/calibrated_ratings.json` ke memory (<0.05 ms) dan menyediakan fungsi `getShrunkMatchParameters(...)` yang memadukan rating historis dengan form live TheStatsAPI menggunakan James-Stein shrinkage ($w_i = \frac{n_i}{n_i + 16}$).
  - **Acceptance criteria**:
    - [x] Waktu baca memory <3 ms cold start, <0.05 ms cached lookup.
    - [x] Menghitung shrinkage secara presisi untuk $n_i \ge 0$.
    - [x] Menangani tim promosi (misal Ipswich Town diuji dan berhasil dideteksi).
    - [x] Fallback graceful jika tim atau liga tidak terdaftar di matriks.
  - **Verification**:
    - [x] Tests pass: `npx tsx scripts/test-ratings-loader.ts`
    - [x] Build succeeds: `npx tsc --noEmit`
  - **Dependencies**: Task 4
  - **Files touched**:
    - `lib/quant/ratings-loader.ts`
    - `lib/quant/index.ts`
    - `scripts/test-ratings-loader.ts`

---

## Slice 3: Agent Integration, Diagnostics & Verification

- [x] Task 6: Live Agent Pipeline Integration (`app/api/agent/route.tsx`)
  - **Description**: Menghubungkan `ratings-loader.ts` ke dalam pipeline evaluasi agen di `app/api/agent/route.tsx`, menggantikan heuristik ad-hoc lama dengan parameter Dixon-Coles terkalibrasi yang di-shrinkage dengan live form data.
  - **Acceptance criteria**:
    - [x] Intensitas gol $\lambda$ dan $\mu$ dihitung menggunakan $\alpha_i^*, \beta_j^*$ dari Empirical Bayes.
    - [x] Home advantage $\gamma$ menggunakan parameter kalibrasi liga spesifik.
    - [x] Tidak ada regresi pada output Shin vig-stripping, probabilitas 1X2, atau Kelly stake sizing.
  - **Verification**:
    - [x] Build succeeds: `npx tsc --noEmit` lulus dengan 0 error.
  - **Dependencies**: Task 5
  - **Files touched**:
    - `app/api/agent/route.tsx`

- [ ] Task 7: Comprehensive Typecheck, Diagnostics & Git Sync via `repo-manager`
  - **Description**: Menjalankan typecheck penuh, memastikan seluruh pengujian quant lulus, dan mendelegasikan kepada subagent `repo-manager` untuk membuat commit serta push ke GitHub agar Vercel siap digunakan.
  - **Acceptance criteria**:
    - [ ] `npx tsc --noEmit` lulus dengan 0 error.
    - [ ] Git commit bersih dibuat dengan Conventional Commits.
    - [ ] Push ke `origin/main` berhasil dan terverifikasi di GitHub.
  - **Verification**:
    - [ ] `git status` bersih (working tree clean).
    - [ ] MCP tool `list_commits` memverifikasi commit terbaru di GitHub.
  - **Dependencies**: Task 1, 2, 3, 4, 5, 6
  - **Files likely touched**:
    - All modified files + `data/calibrated_ratings.json`
