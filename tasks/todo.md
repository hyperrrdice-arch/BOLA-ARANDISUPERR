# Tasks: 2026 Historical Dataset Ingestion & Quant Model Calibration

## Phase 1: Storage Layer & Dataset Importer
- [ ] Task 1: Buat direktori `data/datasets/` dan skema Zod `HistoricalMatchRecord`
  - Description: Menyiapkan skema data lokal terstruktur untuk menyimpan catatan pertandingan masa lalu.
  - Acceptance Criteria: Skema tervalidasi Zod, menangani ID, tanggal, nama tim, skor, dan xG opsional.
- [ ] Task 2: Buat CLI importer script `scripts/import-2026-dataset.ts`
  - Description: Skrip otomatis untuk membaca file data mentah pihak ketiga (CSV/JSON), membersihkan duplikasi, dan menyimpannya ke `data/datasets/matches_2026.json`.
  - Acceptance Criteria: Mendukung CLI input path, validasi sanitasi nilai skor, log ringkasan total laga yang diimpor.

## Checkpoint: Storage & Importer
- [ ] Eksekusi skrip import berhasil memuat contoh dataset tanpa kendala tipe.

## Phase 2: Historical Rating Engine & Normalizer
- [ ] Task 3: Buat `lib/quant/team-normalizer.ts`
  - Description: Kamus resolusi alias nama tim untuk menyamakan format nama dari pihak ketiga dengan TheStatsAPI / 1xBet.
  - Acceptance Criteria: Normalisasi minimal 20 variasi tim top Eropa (Premier League, La Liga, Serie A, dll.).
- [ ] Task 4: Buat `lib/quant/historical-store.ts`
  - Description: Engine analitik untuk menghitung rata-rata performa tim dengan filter waktu (`date < kickoff`) dan pembobotan peluruhan waktu $\exp(-\xi \Delta t)$.
  - Acceptance Criteria: Mengembalikan $N$, weighted attack, weighted defense, dan baseline liga; zero lookahead bias.
- [ ] Task 5: Upgrade `lib/quant/dixon-coles.ts` dengan Empirical Bayes
  - Description: Menerapkan shrinkage James-Stein untuk menarik estimasi tim dengan sampel kecil ke rata-rata liga.
  - Acceptance Criteria: Formula terintegrasi rapi, probabilitas tetap berjumlah 1.0000.

## Checkpoint: Quant Engine Calibration
- [ ] Skrip uji diagnostik membuktikan penekanan varians dan stabilitas nilai probabilitas.

## Phase 3: Pipeline & UI Integration
- [ ] Task 6: Hubungkan `historical-store.ts` ke `lib/stats-validator.ts` & `app/api/agent/route.tsx`
  - Description: Mengintegrasikan pembacaan dataset lokal ke dalam alur live agen dengan fallback otomatis ke scraping API jika data lokal kosong.
  - Acceptance Criteria: Tidak ada null pointer; fallback berfungsi mulus.
- [ ] Task 7: Uji end-to-end integrasi sistem
  - Description: Menguji endpoint `/api/agent` dan menjalankan typecheck komprehensif.
  - Acceptance Criteria: `npx.cmd tsc --noEmit` sukses; respons API menyertakan metrik historis terkalibrasi.

## Checkpoint: Final Verification
- [ ] Semua tes unit dan typecheck lulus tanpa error.
