# ARCHITECTURE — Football Pre-Match Analyst Agent

Dokumen ini menjelaskan pipeline **aktif** (planner loop + view-model BFF, Okt 2026). Versi lama ada di `archive/legacy-docs/ARCHITECTURE.md`.

---

## 1. Gambaran Besar

App ini menganalisis pertandingan sepak bola **sebelum kickoff** dan memutuskan: ada value bet atau tidak. Empat lapis:

1. **Agent** — satu planner (`bai/mimo-v2.6-pro`) yang merencanakan analisis, memanggil tool, mengevaluasi hasil, dan re-plan bila ada gap (loop, bukan pipeline statis)
2. **Deterministic Quant Engine** — semua angka (probabilitas, fair odds, EV, stake Kelly) dihitung **code murni** di `lib/quant/*`, nol LLM
3. **Multi-Model Syndicate** — 5+ model berbeda beradu argumen (Bull/Neutral/Bear + 2 Judgement + Arbiter) sebagai cross-check anti-bias
4. **View-Model (BFF)** — `lib/view/analysis-view.ts` mengubah output pipeline menjadi JSON bersih per section; frontend adalah dumb renderer, tidak pernah menggali path dalam

Aturan emasnya: **LLM hanya boleh menyusun narasi dan keputusan alur. Semua angka datang dari tool, disalin apa adanya sampai ke layar.**

---

## 2. Alur End-to-End

```
User buka dashboard (app/page.tsx) ──► GET /api/matches?hours=12|24|48|72   [katalog]
User klik match ──► GET /api/agent?match_id=...                              [analisis]
                     │
                     ▼
        app/api/agent/route.tsx  (HTTP shell: validasi + merge)
                     │
                     ▼
        lib/agent/planner.ts :: runPlannerAnalysis()
        model bai/mimo-v2.6-pro, loop native tool-calling, hard cap 8 step
                     │
   ┌─────────────────┼──────────────────────────────────────┐
   ▼                 ▼                                      ▼
 [1] check_data_integrity ─► lib/stats-fetcher-agent.ts
   │     fetch TheStatsAPI + Zod sanitizer → missing_data_registry
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
 lib/view/analysis-view.ts :: mapPipelineToView()          ← LAPISAN BFF
   pure function, Zod AnalysisViewSchema, angka disalin apa adanya
   │
   ▼
 response JSON: { match, ringkasan, kuantitatif, odds, debat, thinking, markets }
   (?debug=1 → payload mentah pipeline, untuk audit)
   │
   ▼
 dashboard 4 tab: Ringkasan (default) · Kuantitatif · Odds · Debat
 + pasar 1xBet on-demand (lazy, butuh scan manual)
```

Setiap tool mengembalikan `coverage_check` (hasil evaluator **code**, bukan self-report LLM) yang menjadi bahan re-plan planner **dan** dicatat ke `plannerTrace` per step (ditampilkan UI sebagai section "Cara Agen Menyusun Analisis Ini").

---

## 3. Peta File

| Path | Peran |
|---|---|
| `app/page.tsx` + `components/dashboard/*` | Dashboard: tab Ringkasan (verdict + faktor kunci + ThinkingPlannerCard + integrity), Kuantitatif (QuantEngineCard: hero prob/fair odds + bukti + lipatan Kelly & metode), Odds (TheStatsOddsComparison + OddsDislocationBar), Debat (SyndicateDebateCard, argumen per persona terlipat) |
| `app/api/matches/route.ts` | Katalog match dari TheStatsAPI |
| `app/api/agent/route.tsx` | **HTTP shell pipeline analisis** — panggil planner, validasi `AnalysisSchema`, map ke `AnalysisView` |
| `app/api/betting/route.ts` | Bonus: analisis taruhan dual-model A/B (`bai/qwen3.8-27b` + `bai/deepseek-v4.1-flash`) |
| `app/api/odds/route.ts` | Bonus: perbandingan odds TheStatsAPI vs pasar (di-cache di client) |
| `lib/view/analysis-view.ts` | **BFF**: `AnalysisViewSchema` + `mapPipelineToView()` — pure function, angka copy 1:1, helper format sadar-skala, null jujur ("—", bukan 0) |
| `lib/agent/planner.ts` | **Otomasi inti**: loop `plan→act→evaluate→re-plan`, tool definitions, `buildQuantPackage`, trace + coverage per step |
| `lib/agent/coverage.ts` | Evaluator coverage (code) + aturan trigger re-plan machine-verifiable |
| `lib/agent/schemas.ts` | `AnalysisSchema` (kontrak pipeline), `VerdictInputSchema`, `PlannerTraceSchema` (termasuk `coverage` per step) |
| `lib/agent/llm.ts` | Klien 9Router (sumber tunggal), `callModelWithFallback`, `extractJSON`, `buildEditorialPrompts` |
| `lib/llm/models.ts` | Sumber tunggal nama model: `PLANNER`, `SYNDICATE`, `STATS_FETCHER`, `EDITORIAL` |
| `lib/stats-fetcher-agent.ts` | Dispatcher fetch selektif TheStatsAPI (heuristic langsung; LLM di balik flag `DISPATCHER_LLM=1`) |
| `lib/stats-validator.ts` | Zod sanitizer `VerifiedMatchIntelligence` |
| `lib/syndicate-orchestrator.ts` | Debat 5 persona multi-model + dual judgement + arbiter |
| `lib/quant/*` | Dixon-Coles, vig-stripping (Shin), Kelly, ratings (James-Stein), luck regression, special markets |
| `lib/db/*` | SQLite lokal: dataset TheStats, team telemetry, vault payload, master historis |
| `lib/stats-cache.ts` | Cache TTL in-memory untuk fetch TheStatsAPI |
| `scripts/sync-weekly-telemetry.ts`, `ingest-*.ts` | Ingestion data mingguan/multi-liga (CLI manual) |
| `scripts/calibrate-ratings.ts`, `backtest-dixon-coles.ts` | Kalibrasi rating + backtest harness (workstream kuantitatif) |
| `scripts/test-planner-tool-calling.ts`, `test-planner-loop.ts` | Runnable check pipeline agent |
| `scripts/test-view-mapper.ts` | Runnable check BFF: fixture wajib lolos `AnalysisSchema`, assert skala angka, null jujur, anti-kebocoran field mentah |
| `archive/` | Sisa pipeline lama, komponen terpotong (`archive/legacy-components/`), eksplorasi one-off (lihat `archive/README.md`) |

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

`coverage_check` disuntikkan ke tiap tool result **dan** distempel ke step `plannerTrace` (checklist, gaps, triggers). UI menampilkannya apa adanya di thinking panel — 2 step pertama + step ber-trigger terbuka, sisanya terlipat.

---

## 6. Guardrails (jangan dilanggar)

1. **Angka hanya dari tool** — planner dilarang menghitung/mengarang angka; `lib/quant/*` tidak boleh memanggil LLM
2. **Fidelitas angka sampai ke layar** — view-model menyalin angka apa adanya; konversi tampilan hanya lewat helper **sadar skala** (sumber desimal vs sumber persen beda helper — `top_scorelines.prob` sudah persen, jangan dikali 100 lagi). Tidak ada nilai default karangan: field absen → `null` / "—", bukan 0
3. **Closed-world grounding** — prompt editorial punya 7 aturan anti-halusinasi; status estimasi dihormati
4. **Evaluasi oleh code** — coverage & trigger re-plan dihitung Zod/numerik, bukan klaim LLM
5. **Multi-model jangan diseragamkan** — kesalahan antar vendor tidak berkorelasi; itu nilai cross-check-nya
6. **Fail-fast eksplisit** — data inti hilang → HTTP 500 + `plannerTrace`, bukan output palsu

---

## 7. View-Model & Frontend

**Kontrak client = `AnalysisViewSchema`** (`lib/view/analysis-view.ts`), bentuknya persis yang dirender:

```
match      : id, home, away, kickoff_wib, competition, venue, wasit, wasit_kartu, status_lineup
ringkasan  : verdict, prediksi, keyakinan, alasan, faktor_kunci, integrity {gaps, status_estimasi}
kuantitatif: hero {prob, fair_odds, ev_teratas} · bukti[] (maks 5) · detail {kelly, metode, splits, pasar_lain}
odds       : dislocation {ringkasan_1x2, asian_handicap, over_under, btts, pasar_konsensus, fair}, smart_money
debat      : consensus, supreme, persona[] (terlipat per persona), dual_bench
thinking   : steps[] {step, tool, alasan, trigger, coverage}, stop_reason, durasi_ms
markets    : null (on-demand dari /api/betting)
```

Aturan frontend:
- **Dumb renderer** — tiap section render field-nya 1:1; nol penggalian path dalam, nol kalkulasi angka baru (perhitungan turunan display seperti delta% odds ada di card, bukan di mapper)
- **Anti-tumpuk**: tiap view satu elemen dominan; terbuka default = ringkasan + ≤5 baris bukti; sisanya `<details>` native dengan judul informatif
- **Verdict-first** — tab default Ringkasan: keputusan (PASS/NO BET + skor + keyakinan) terbaca ≤1 layar
- **Markets on-demand** — 1xBet/Scanner lazy (`next/dynamic`), butuh scan manual, entry 1 klik dari Ringkasan
- **Payload minimal** — `rawLineups`/`audit`/`cacheMetrics` tidak pernah ke client (audit via `?debug=1`)
- Kontrak `/api/betting` dijaga dari sisi client: `match_context.probabilitas_pasar` = `odds.dislocation.pasar_konsensus` (persen konsensus), `wasit_kartu` = `match.wasit_kartu`, `npxg_*` = `detail.splits.npxg_*`

---

## 8. Model Roster (via 9Router lokal, konfigurasi `lib/llm/models.ts`)

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

## 9. Data Layer

- **TheStatsAPI** (remote, kuota terbatas) → `lib/stats-cache.ts` (TTL in-memory) → Zod sanitizer
- **SQLite lokal** (`lib/db/`): `thestats-dataset`, `team-telemetry`, `thestats-vault`, `sqlite-master`
- **`data/calibrated_ratings.json`** — hasil kalibrasi rating (James-Stein shrinkage) dari `scripts/calibrate-ratings.ts`
- Tier-1 offline diprioritaskan: fetch online hanya fallback bila SQLite kosong

### 9.1 `data/analysis_snapshots.db` — riwayat analisis (data pribadi, APPEND-ONLY)

Berkas **terpisah** dari `thestats_dataset.db` (`lib/db/analysis-snapshot.ts`), di-gitignore.
Tabel `analysis_snapshots` (hasil pipeline, lengkap dengan `view_json` sebagai sumber kebenaran
+ kolom ringkas untuk query), `match_outcomes` (hasil aktual, boleh di-refresh via upsert),
dan dua VIEW evaluasi (`v_snapshot_eval`, `v_snapshot_eval_market`) yang menyaring
`lead_time_minutes > 0` (pre-match) + `status = 'finished'` untuk mencegah leakage.

> ⚠️ **Tidak bisa di-rebuild.** Isinya keluaran LLM (200–415 detik per match, model
> nondeterministik). Ngawet ulang berarti menjalankan ulang seluruh pipeline. **Jangan
> pernah DELETE/DROP** di jalur produksi; satu-satunya `DELETE` yang sah adalah cleanup
> data test ber-prefix di `scripts/test-snapshot-db.ts`. Backup manual bila perlu:
> `sqlite3 data/analysis_snapshots.db ".backup data/backup-snapshots-YYYY.db"`.

Skema ini menggantikan tabel `analysis_runs` yang dulu hidup di `thestats_dataset.db`
(DB yang boleh di-refresh — berbahaya bagi data pribadi). Kontrak lengkap: `DB SNAPSHOT.md`.
Operasional: `scripts/sync-match-outcomes.ts` (tarik hasil aktual, lokal dulu),
`scripts/snapshot-report.ts` (report read-only),
`scripts/backfill-panel-market.ts` (isi kolom `panel_market*` untuk baris lama).

**Dua definisi rekomendasi, sengaja dipisah:** `recommended_market_key` = market
dengan EV positif pertama (aturan `hero.ev_teratas` di view), sedangkan
`panel_market_key` = market yang benar-benar direkomendasikan arbiter/supreme
(diturunkan dari teksnya, market yang disebut pertama). Keduanya punya hit rate
sendiri di report — sering berbeda, jadi membandingkan keduanya itu inti evaluasi.

### 9.2 `data/upcoming_fixtures.db` — katalog fixture (umur pendek, disposable)

Store terpisah dari `thestats_dataset.db` (pola yang sama dengan snapshot: lifecycle
berbeda → file berbeda). Isinya fixture 30 hari ke depan (246 baris, 7 liga target).
Siklus hidup: diisi `scripts/sync-upcoming-fixtures.ts` → dibaca katalog
`/api/matches` (offline-first, API hanya fallback) → match selesai →
`scripts/promote-upcoming-to-telemetry.ts` menarik telemetry-nya ke dataset utama
lalu **menghapus barisnya** di sini. Dataset utama tidak pernah menyimpan baris
`scheduled` (invariant diuji `scripts/test-upcoming-guard.ts`).

---

## 10. Menjalankan & Menguji

```bash
npm run dev                        # dashboard di http://localhost:3000
npm run sync:weekly                # sinkronisasi telemetry mingguan (CLI)
npm run ingest:multileague         # ingest multi-liga
npx tsx scripts/test-planner-tool-calling.ts   # gate native tool-calling model planner
npx tsx scripts/test-planner-loop.ts           # loop + coverage evaluator (mock tools)
npx tsx scripts/test-view-mapper.ts            # BFF: fidelitas angka, null jujur, anti-leak
npx tsx scripts/test-snapshot-db.ts            # DB snapshot: round-trip, VIEW, leakage guard
npx tsx scripts/sync-match-outcomes.ts         # tarik hasil aktual (CLI, idempoten)
npx tsx scripts/snapshot-report.ts             # report prediksi vs hasil (read-only)
npx tsx scripts/sync-upcoming-fixtures.ts 30  # isi store fixture 30 hari ke depan (CLI)
npx tsx scripts/promote-upcoming-to-telemetry.ts  # fixture selesai → telemetry (CLI)
npx tsc --noEmit                   # typecheck
npm run build                      # build produksi
```

Env wajib ada di `.env.local` (lihat `.env.example`): `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_API_KEY`, `STATS_API_KEY`.
Flag debug: `PIPELINE_DEBUG=1` (log verbose), `PLANNER_MAX_STEPS` (cap loop), `DISPATCHER_LLM=1` (aktifkan kembali dispatcher LLM).

Catatan dev: jangan jalankan `next build` bareng `next dev` (output stdout build terpotong — bug Next.js yang sudah dilaporkan). `?debug=1` menjalankan analisis ulang penuh (belum mengambil raw dari run yang sama).

---

## 11. Roadmap (topik bahasan berikutnya)

- **Optimasi latensi** — run 2–7 menit (debate 2 ronde + editorial sekuencial); kandidat: paralelisasi debate↔editorial, `?debug=1` tanpa re-run
- **Riwayat analisis** — ✅ selesai: `AnalysisView` per match tersimpan permanen di `data/analysis_snapshots.db` (§9.1), bukan hilang setelah refresh
- **Evaluasi outcome berjalan** — lengkapi: tarik `match_outcomes` otomatis per jadwal (`sync-match-outcomes.ts` via cron), accumulate ≥100 snapshot evaluable, lalu pakai angka Brier/log-loss/P-L untuk kalibrasi ulang ratings & confidence
- **Trigger otonom** (cron per kickoff) — saat ini analisis dipicu klik user
- `query_odds_dislocation` & `run_special_markets` sebagai tool planner terpisah (saat ini masuk paket quant)
- Sisa polish UI: struktur katalog (grid kartu identik), radius/tokens menyeluruh
