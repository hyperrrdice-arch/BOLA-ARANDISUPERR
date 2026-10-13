# Implementation Plan: Dual-Layer SQLite Relational Database & Dixon-Coles Calibration

## Architectural Overview
Integrasi penyimpanan data relasional dua lapis (Dual-Layer Architecture):
1. **Penyimpanan Master Lokal / VPS**: Menggunakan SQLite lokal (`node:sqlite`) di `data/football_master.db` untuk menyimpan riwayat pertandingan 3 musim terakhir dari 10 divisi (Top 5 Liga Eropa + 5 Kasta Kedua). Engine komputasi MLE Dixon-Coles dijalankan secara offline di layer ini.
2. **Runtime Matrix (Edge & Vercel Ready)**: Menghasilkan matriks parameter terkompilasi `data/calibrated_ratings.json` (~80-120 KB). File ini dimuat ke memori oleh Next.js serverless functions di Vercel dalam waktu <0.05 ms tanpa latensi jaringan dan tanpa koneksi database eksternal.
3. **Empirical Bayes Shrinkage**: Memadukan data form live TheStatsAPI ($N=5-10$) dengan baseline historis terkalibrasi via formula James-Stein ($w_i = \frac{n_i}{n_i + 16}$).

---

## Scope & Target Divisions
- **Inggris**: Premier League (`E0`), EFL Championship (`E1`)
- **Spanyol**: La Liga (`SP1`), Segunda División (`SP2`)
- **Italia**: Serie A (`I1`), Serie B (`I2`)
- **Jerman**: Bundesliga (`D1`), 2. Bundesliga (`D2`)
- **Prancis**: Ligue 1 (`F1`), Ligue 2 (`F2`)
- Total sampel data: ~8.000 - 10.000 pertandingan historis (3 musim terakhir).

---

## Vertical Slices

### Slice 1: Database Schema & Hybrid Ingestion Pipeline
- **Task 1**: SQLite Master Schema & Database Client (`lib/db/sqlite-master.ts`)
- **Task 2**: Team Name Resolution Engine (`lib/quant/team-normalizer.ts`)
- **Task 3**: Historical Dataset Downloader & Ingestion Script (`scripts/download-historical-data.mjs` & `scripts/ingest-historical-data.ts`)

### Slice 2: Dixon-Coles MLE Calibration & Ratings Matrix Builder
- **Task 4**: Dixon-Coles Bivariate Poisson MLE Calibration Engine (`scripts/calibrate-ratings.ts`)
- **Task 5**: Runtime Ratings Loader with Empirical Bayes Shrinkage (`lib/quant/ratings-loader.ts`)

### Slice 3: Agent Integration, Diagnostics & Verification
- **Task 6**: Live Agent Pipeline Integration (`app/api/agent/route.tsx`)
- **Task 7**: Comprehensive Typecheck, Diagnostics & Git Sync via `repo-manager`
