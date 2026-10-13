# Implementation Plan: 2026 Historical Dataset Ingestion & Quant Model Calibration

## Overview
Mengintegrasikan dataset pertandingan pihak ketiga sepanjang tahun 2026 ke dalam penyimpanan lokal (`data/datasets/`) untuk mengalibrasi model kuantitatif Dixon-Coles, mengeliminasi varians sampel kecil, dan meningkatkan akurasi estimasi probabilitas serta formula Kelly.

---

## Architecture Decisions
1. **Local Storage Strategy**: Format JSON terstruktur di `data/datasets/matches_2026.json` (ringan, portable, latensi baca < 2ms, zero dependency database).
2. **Entity Resolution (Team Normalizer)**: Modul pemetaan deterministik untuk menyelaraskan nama tim dari berbagai sumber data pihak ketiga ke penamaan resmi TheStatsAPI & 1xBet.
3. **Temporal Integrity (Zero Lookahead Bias)**: Setiap kalkulasi metrik historis dibatasi secara ketat pada laga sebelum tanggal kick-off pertandingan yang diuji (`date < match_date`).
4. **Exponential Time Decay & Empirical Bayes**: Menerapkan bobot peluruhan waktu Dixon-Coles ($\xi = 0.0035$) dan penyusutan James-Stein menuju baseline rata-rata liga untuk meredam noise.
5. **Seamless Pipeline Fallback**: Jika data lokal tidak tersedia untuk tim/liga tertentu, sistem secara otomatis fallback ke scraping live TheStatsAPI.

---

## Task List

### Phase 1: Storage Layer & Dataset Importer
- [ ] Task 1: Buat direktori `data/datasets/` dan skema Zod untuk `HistoricalMatchRecord`
- [ ] Task 2: Buat CLI importer script `scripts/import-2026-dataset.ts` untuk mengonversi data pihak ketiga (CSV/JSON) ke skema lokal terverifikasi

### Checkpoint: Storage & Importer
- [ ] Dataset lokal tervalidasi dan dapat diimpor tanpa error skema.

### Phase 2: Historical Rating Engine & Normalizer
- [ ] Task 3: Buat `lib/quant/team-normalizer.ts` untuk memetakan alias nama tim
- [ ] Task 4: Buat `lib/quant/historical-store.ts` dengan time-decay weighting dan filter anti-lookahead
- [ ] Task 5: Upgrade `lib/quant/dixon-coles.ts` untuk mendukung Empirical Bayes Shrinkage

### Checkpoint: Quant Engine Calibration
- [ ] Uji unit dan benchmark error margin menunjukkan penurunan SE dari 0.707 ke < 0.250.
- [ ] Tidak ada regresi formula Poisson atau batas Kelly.

### Phase 3: Pipeline & UI Integration
- [ ] Task 6: Hubungkan `historical-store.ts` ke `lib/stats-validator.ts` dan `app/api/agent/route.tsx`
- [ ] Task 7: Uji end-to-end analisis pertandingan dengan data historis lokal terkalibrasi

### Checkpoint: Final Verification
- [ ] Semua pengujian otomatis lulus (`npx.cmd tsc --noEmit`).
- [ ] Analisis live menampilkan metrik historis yang akurat dan stabil.
