# ARCHITECTURE — Football Pre-Match Analyst Agent

Dokumen ini menjelaskan pipeline **aktif** (planner loop, Okt 2026). Versi lama ada di `archive/legacy-docs/ARCHITECTURE.md`.

---

## 1. Gambaran Besar

App ini menganalisis pertandingan sepak bola **sebelum kickoff** dan memutuskan: ada value bet atau tidak. Tiga lapis:

1. **Agent** — satu planner (`bai/mimo-v2.6-pro`) yang merencanakan analisis, memanggil tool, mengevaluasi hasil, dan re-plan bila ada gap (loop, bukan pipeline statis)
2. **Deterministic Quant Engine** — semua angka (probabilitas, fair odds, EV, stake Kelly) dihitung **code murni** di `lib/quant/*`, nol LLM
3. **Multi-Model Syndicate** — 5+ model berbeda beradu argumen (Bull/Neutral/Bear + 2 Judgement + Arbiter) sebagai cross-check anti-bias

Aturan emasnya: **LLM hanya boleh menyusun narasi dan keputusan alur. Semua angka datang dari tool.**

---

## 2. Alur End-to-End

```
User buka dashboard (app/page.tsx) ──► GET /api/matches?hours=72        [katalog match]
User klik match ──► GET /api/agent?match_id=...                          [analisis]
                     │
                     ▼
        app/api/agent/route.tsx  (HTTP shell: validasi + merge + response)
                     │
                     ▼
        lib/agent/planner.ts :: runPlannerAnalysis()
        model bai/mimo-v2.6-pro, loop native tool-calling, hard cap 8 step
                     │
   ┌─────────────────┼──────────────────────────────────────┐
   ▼                 ▼                                      ▼
 [1] check_data_integrity ─► lib/stats-fetcher-agent.ts
   │     dispatcher endpoint + fetch TheStatsAPI + Zod sanitizer
   │     ─► VerifiedMatchIntelligence + missing_data_registry
   ▼
 [2] fetch_missing_intel (hanya bila ada gap) ─► fetch ulang, bandingkan delta
   ▼
 [3] run_quant_package ─► lib/quant/* (100% code)
   │     getShrunkMatchParameters (James-Stein) → calculateDixonColes
   │     → stripVigShin → evaluateValueBet → evaluatePortfolioKelly
   │     → generateSpecialMarketsPackage
   ▼
 [4] run_syndicate_debate ─► lib/syndicate-orchestrator.ts
   │     Stage 1 paralel: Bull / Neutral / Bear (model berbeda)
   │     Stage 2: Judgement 1 + Judgement 2 → consensus + arbiter
   │     (boleh ronde 2 bila trigger CONSENSUS_LEMAH)
   ▼
 [5] run_editorial_analysis ─► lib/agent/llm.ts
   │     prompt closed-world 7 aturan anti-halusinasi → JSON editorial
   ▼
 [6] stop_with_verdict ─► sintesis planner (narasi prediksi, faktor kunci)
   │
   ▼
 route.tsx merge (Zod AnalysisSchema) ─► response JSON ─► cards dashboard
```

Setiap tool mengembalikan `coverage_check` (hasil evaluator **code**, bukan self-report LLM) yang menjadi bahan re-plan planner.

---

## 3. Peta File

| Path | Peran |
|---|---|
| `app/page.tsx` + `components/dashboard/*` | Dashboard (17 kartu: QuantEngine, KellyMatrix, SyndicateDebate, OddsDislocation, dll) |
| `app/api/matches/route.ts` | Katalog match dari TheStatsAPI |
| `app/api/agent/route.tsx` | **HTTP shell pipeline analisis** — panggil planner, merge output, jaga kontrak response |
| `app/api/betting/route.ts` | Bonus: analisis taruhan dual-model A/B (`bai/qwen3.8-27b` + `bai/deepseek-v4.1-flash`) |
| `app/api/odds/route.ts` | Bonus: perbandingan odds TheStatsAPI vs pasar |
| `lib/agent/planner.ts` | **Otomasi inti**: loop `plan→act→evaluate→re-plan`, tool definitions, `buildQuantPackage` |
| `lib/agent/coverage.ts` | Evaluator coverage (code) + aturan trigger re-plan machine-verifiable |
| `lib/agent/schemas.ts` | `AnalysisSchema` (kontrak response), `VerdictInputSchema`, `PlannerTraceSchema` |
| `lib/agent/llm.ts` | Klien 9Router (sumber tunggal), `callModelWithFallback`, `extractJSON`, `buildEditorialPrompts` |
| `lib/llm/models.ts` | Sumber tunggal nama model: `PLANNER`, `SYNDICATE`, `STATS_FETCHER`, `EDITORIAL` |
| `lib/stats-fetcher-agent.ts` | Dispatcher pemilihan endpoint + fetch selektif TheStatsAPI |
| `lib/stats-validator.ts` | Zod sanitizer `VerifiedMatchIntelligence` |
| `lib/syndicate-orchestrator.ts` | Debat 5 persona multi-model + dual judgement + arbiter |
| `lib/quant/*` | Dixon-Coles, vig-stripping (Shin), Kelly, ratings (James-Stein), luck regression, special markets |
| `lib/db/*` | SQLite lokal: dataset TheStats, team telemetry, vault payload, master historis |
| `lib/stats-cache.ts` | Cache TTL in-memory untuk fetch TheStatsAPI |
| `scripts/sync-weekly-telemetry.ts`, `ingest-*.ts` | Ingestion data mingguan/multi-liga (CLI manual) |
| `scripts/calibrate-ratings.ts`, `backtest-dixon-coles.ts` | Kalibrasi rating + backtest harness (workstream kuantitatif) |
| `scripts/test-planner-tool-calling.ts`, `test-planner-loop.ts` | Runnable check pipeline agent |
| `archive/` | Sisa pipeline lama & eksplorasi one-off (lihat `archive/README.md`) |

---

## 4. Tool Contract (dipanggil planner)

| Tool | Input | Fungsi | Wajib? |
|---|---|---|---|
| `check_data_integrity` | `alasan?` | Fetch + validasi Zod semua data match → gap registry | Ya, pertama |
| `fetch_missing_intel` | `alasan?` | Fetch ulang saat gap → delta missing | Hanya saat gap |
| `run_quant_package` | `alasan?` | Quant engine lengkap → probabilitas, fair odds, value bets | Ya |
| `run_syndicate_debate` | `alasan?` | Debat 5 persona → consensus, verdict panel | Ya (maks 2 ronde) |
| `run_editorial_analysis` | `alasan?` | Editorial closed-world → JSON naratif | Ya |
| `stop_with_verdict` | `prediksi`, `faktor_kunci`, `ringkasan_perencanaan` | Tutup analisis | Ya, terakhir |

Semua argumen divalidasi Zod (`inputSchema`); semua output tool dihasilkan server-side.

---

## 5. Loop & Trigger Re-plan

Loop = `plan → act → evaluate → re-plan`, hard cap **8 step** (`PLANNER_MAX_STEPS`). Re-plan **hanya sah** bila evaluator code (`lib/agent/coverage.ts`) menemukan:

| Trigger | Kondisi numerik | Aksi yang diperbolehkan |
|---|---|---|
| `FIELD_KOSONG` | `missing_data_registry` tidak kosong | `fetch_missing_intel` (maks 1×; kalau tetap kosong → degradasi eksplisit) |
| `CONSENSUS_LEMAH` | `consensus_level` ∈ {SPLIT_DECISION, DISSENT} | `run_syndicate_debate` ronde 2 (maks 2) |
| `ODDS_DISLOCATION` | \|EV\| value bet > 20% | Editorial wajib membahas gap odds |

Hasil evaluasi disuntikkan ke tiap tool result sebagai `coverage_check`. Setelah loop, route menyimpan jejaknya di response field `plannerTrace` (steps + alasan + stop_reason + gaps).

---

## 6. Guardrails (jangan dilanggar)

1. **Angka hanya dari tool** — planner dilarang menghitung/mengarang angka; `lib/quant/*` tidak boleh memanggil LLM
2. **Closed-world grounding** — prompt editorial punya 7 aturan anti-halusinasi (pemain/cedera/H2H hanya dari data, wajib selaras quant engine, pasar khusus bukan +EV, status estimasi dihormati)
3. **Evaluasi oleh code** — coverage & trigger re-plan dihitung Zod/numerik, bukan klaim LLM
4. **Multi-model jangan diseragamkan** — kesalahan antar vendor tidak berkorelasi; itu nilai cross-check-nya
5. **Fail-fast eksplisit** — data inti hilang → HTTP 500 + `plannerTrace`, bukan output palsu

---

## 7. Model Roster (via 9Router lokal, konfigurasi `lib/llm/models.ts`)

| Peran | Default | Sifat |
|---|---|---|
| Planner (loop agent) | `bai/mimo-v2.6-pro` | Reasoning kuat + native tool-calling |
| Bull persona | `ag/gemini-3.8-flash-high` | Argumen pro |
| Neutral persona | `bai/glm-5.3-flash` | Argumen netral |
| Bear persona | `bai/deepseek-v4.1-flash` | Argumen kontra / audit risiko |
| Judgement 1 & 2 | `ag/gemini-3.8-flash-high`, `bai/qwen3.8-flash` | Vonis ganda + consensus |
| Editorial | `MODEL_JUDGEMENT_1` (fallback `NINE_ROUTER_MODEL`) | Narasi closed-world |
| Endpoint dispatcher | `bai/qwen3.8-27b` | Keputusan fetch (saat ini: heuristic langsung, LLM di balik flag `DISPATCHER_LLM=1`) |
| Betting A/B | `bai/qwen3.8-27b`, `bai/deepseek-v4.1-flash` | Analisis taruhan bonus |

Semua bisa dioverride lewat env (lihat `.env.example`).

---

## 8. Data Layer

- **TheStatsAPI** (remote, kuota terbatas) → `lib/stats-cache.ts` (TTL in-memory) → Zod sanitizer
- **SQLite lokal** (`lib/db/`): `thestats-dataset` (team, squad, match log, H2H, injuries), `team-telemetry` (rolling stats pra-laga), `thestats-vault` (payload mentah), `sqlite-master` (historis untuk backtest)
- **`data/calibrated_ratings.json`** — hasil kalibrasi rating (James-Stein shrinkage) dari `scripts/calibrate-ratings.ts`
- Tier-1 offline diprioritaskan: fetch online hanya fallback bila SQLite kosong

---

## 9. Menjalankan & Menguji

```bash
npm run dev                        # dashboard di http://localhost:3000
npm run sync:weekly                # sinkronisasi telemetry mingguan (CLI)
npm run ingest:multileague         # ingest multi-liga
npx tsx scripts/test-planner-tool-calling.ts   # gate native tool-calling model planner
npx tsx scripts/test-planner-loop.ts           # loop + coverage evaluator (mock tools)
npx tsc --noEmit                   # typecheck
npm run build                      # build produksi
```

Env wajib ada di `.env.local` (lihat `.env.example`): `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_API_KEY`, `STATS_API_KEY`.
Flag debug: `PIPELINE_DEBUG=1` (log verbose), `PLANNER_MAX_STEPS` (cap loop), `DISPATCHER_LLM=1` (aktifkan kembali dispatcher LLM).

---

## 10. Roadmap yang belum dibangun

- Outcome tracker: hasil aktual vs prediksi → feedback ke ratings/confidence
- Trigger otonom (cron per kickoff) — saat ini analisis dipicu klik user
- Trace rencana di UI (`plannerTrace` sudah ada di response, belum dirender)
- `query_odds_dislocation` & `run_special_markets` sebagai tool terpisah (saat ini masuk paket quant)
