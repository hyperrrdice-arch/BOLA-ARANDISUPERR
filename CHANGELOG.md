# Changelog

Semua perubahan penting pada proyek **football-agent** didokumentasikan di file ini mengikuti format [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan prinsip [Semantic Versioning](https://semver.org/lang/id/).

---

## [2.0.0] - 2026-10-17 (V-2.0)

Rilis **v2.0.0 (V-2.0)** merupakan perombakan arsitektural menyeluruh (*Architecture & Engine Overhaul*) dari platform analisis dan sindikat kuantitatif sepak bola `football-agent`. Rilis ini mentransformasi sistem dari pipeline linear monolitik menjadi loop otonom berbasis *Pre-Match Analyst Planner*, mengintegrasikan layer telemetri *high-density*, mengekspansi kalibrasi matematis Dixon–Coles dengan James-Stein Empirical Bayes Shrinkage, memvalidasi model melalui harness backtest kuantitatif (Track A–E), serta menghadirkan arsitektur presentasi baru berbasis *Dedicated View Mapper*.

### 1. Database & Telemetry Ingestion Layer
- **High-Density Telemetry SQLite Architecture**:
  - Implementasi trio arsitektur database: `thestats-dataset.ts` (penyimpanan model matrix), `thestats-vault.ts` (raw immutable audit payload), dan `team-telemetry.ts` (rolling metrics & query window).
  - Mode SQLite WAL (*Write-Ahead Logging*) dengan checkpoint aman dan proteksi konkurensi.
- **Ekspansi Data Historis & Multi-Musim**:
  - Perluasan dataset historis dari 4 musim menjadi 6 musim lengkap (2021/22 hingga 2026/27).
  - Schema migrasi non-destruktif dengan penambahan kolom granular `h_xg` dan `a_xg` serta UPSERT idempoten pada `sqlite-master.ts`.
- **Multi-League Ingestion & Weekly Sync Pipeline**:
  - Dukungan ingestion telemetri untuk seluruh liga utama Eropa (E0, SP1, I1, D1, F1, N1, UCL).
  - Pipeline pembaruan berkala otomatis via `scripts/sync-weekly-telemetry.ts` dan `scripts/ingest-rich-telemetry-multileague.ts`.
- **Perbaikan Pemetaan Cedera & Integritas Status Pemain**:
  - Perbaikan parsing `player_id` dari TheStatsAPI raw vault.
  - Pembedaan status transparan antara `FIT`, `INJURED`, `SUSPENDED`, dan isolasi status `UNKNOWN` tanpa membuat klaim `FIT` palsu.
  - Kebijakan anti-leakage pre-match: filter ketat tanggal kickoff pertandingan agar telemetri hanya mengagregasi laga yang telah selesai sebelum laga target.

### 2. Quantitative Dixon-Coles & Backtest Engine
- **James-Stein Empirical Bayes Shrinkage**:
  - Fusi bobot dinamis $w_i = n_i / (n_i + \kappa)$ yang menjembatani *Macro Prior* jangka panjang (calibrated ratings 428+ klub) dengan *Micro Telemetry* (rolling observed xG musim berjalan).
  - Penandaan eksplisit tipe sumber data (`thestats_observed_xg`, `thestats_observed_goals`, atau `macro_prior_only`) serta pelaporan flag estimasi transparan.
- **Special Markets Engine (1xBet & TheStatsAPI)**:
  - Pemodelan probabilistik Poisson deterministik untuk pasar sekunder:
    - *Headed Goal Market*: Peluang $\ge 1$ gol sundulan berdasarkan persentase duel udara dan korelasi aerial dominance.
    - *Corners Market*: Distribusi total corner, Over/Under 9.5 & 10.5 dengan fair odds.
    - *Cards Market*: Ekspektasi total kartu kuning/merah, Over/Under 3.5 & 4.5 terkalibrasi dengan ketegasan wasit.
    - *Passing Dominance*: Estimasi volume dan selisih operan akurat kedua tim.
- **Unified Backtest Harness & Evaluasi Metodologis (Track A–E)**:
  - Evaluasi kuantitatif out-of-sample pada $6.528$ pertandingan (Track A), $1.078$ pertandingan (Track B), dan $405$ pertandingan (Track C).
  - Audit transparansi kebocoran data (*leakage audit*) dengan $1.000$ iterasi paired bootstrap confidence interval.
  - Normalisasi kekuatan liga untuk UEFA Champions League ($q$-scaling).
  - Simulasi sequential bankroll Kelly (Flat, Full, Quarter, dan Capped Quarter Kelly) pada $6.438$ picks.
  - Dokumentasi resmi definitif di [`docs/backtest-report.md`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/docs/backtest-report.md) dan dataset terstruktur [`data/backtest_report.json`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/data/backtest_report.json).

### 3. Agent & Pipeline Architecture
- **Pre-Match Analyst Planner Loop (`lib/agent/`)**:
  - Transformasi proses inferensi menjadi loop otonom (`plan` $\rightarrow$ `act` $\rightarrow$ `evaluate` $\rightarrow$ `re-plan`) di `lib/agent/planner.ts`.
  - Integrasi dynamic native tool-calling (`check_data_integrity`, `calculate_quant_model`, `run_syndicate_debate`, `stop_with_verdict`).
  - Strict Zod validation schemas (`lib/agent/schemas.ts`) untuk menjamin kepatuhan tipe tanpa halusinasi format JSON.
  - Trace reasoning transparan (`plannerTrace`) yang merekam setiap pemanggilan tool, durasi eksekusi, evaluasi coverage liga, serta pemicu re-planning.
- **Single-Source LLM Client & Optimasi Throughput**:
  - Unifikasi konfigurasi model dan client 9Router pada [`lib/llm/models.ts`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/lib/llm/models.ts).
  - Eliminasi double-inference token dan bypass pemanggilan LLM dispatcher yang redundan.
  - Logging performa di belakang gate `PIPELINE_DEBUG`.
- **Refactoring Shell HTTP**:
  - `app/api/agent/route.tsx` dirampingkan menjadi HTTP controller shell yang bersih dan murni menangani eksekusi loop planner.

### 4. Frontend & Modern UI/UX Overhaul
- **Dedicated View Mapper Adapter (`lib/view/analysis-view.ts`)**:
  - Pemisahan total antara struktur internal pipeline data dengan presentation contract frontend.
  - *Fidelitas angka sadar skala*: normalisasi desimal vs persentase (probabilitas, top scorelines, odds), pencegahan angka anomali seperti 1320%.
  - *Prinsip Anti-Karangan*: nilai data yang tidak tersedia ditampilkan sebagai `null` / `'—'`, bukan `0` atau `'-'`.
  - *Zero Field Leakage*: field internal operator (`audit`, `plannerTrace`, `cacheMetrics`, dsb.) tidak bocor ke interface root.
- **Komponen Baru & Restrukturisasi Dashboard**:
  - Komponen baru [`ThinkingPlannerCard.tsx`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/components/dashboard/ThinkingPlannerCard.tsx) untuk visualisasi interaktif langkah penalaran planner agent dan audit coverage.
  - Dashboard restack anti-tumpuk dengan folded expandable details.
  - Integrasi lazy on-demand 1xBet special markets drawer.
  - Penyegaran visual styling: dark quantitative terminal aesthetics, refined typography, hairlines, and depth hierarchy.
- **Jaminan Kualitas Pengujian**:
  - Test suite komprehensif [`scripts/test-view-mapper.ts`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/scripts/test-view-mapper.ts) (45 skenario assertion lulus 100%).
  - Verification suite [`scripts/verify-pl-pipeline.ts`](file:///c:/Users/ARS011/Documents/FILE%20RANDI/football-agent/archive/legacy-scripts/verify-pl-pipeline.ts) untuk integritas telemetri Premier League.

---

## [1.3.0] - 2026-10-15
- Clinical blueprint UI redesign.
- 100% non-Gemini 9Router LLM routing.
- Deep market scanner and Asian Handicap push-adjusted odds.

## [1.2.0] - 2026-10-13
- 5-Agent Syndicate closed-world debate system.
- Live TheStatsAPI & 1xBet integration.
- Initial Dixon-Coles MLE engine and bento terminal.

## [1.1.0] - 2026-10-12
- Dual-layer SQLite master DB integration with Dixon-Coles MLE calibration.
- Shin 1993 vig-stripping implementation.

## [1.0.0] - 2026-10-11
- Initial release of football-agent syndicate prediction platform.
