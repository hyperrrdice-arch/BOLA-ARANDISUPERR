# ARCHITECTURE — Football Pre-Match Analyst Agent

Dokumen ini menjelaskan pipeline **aktif** (planner loop + view-model BFF, Okt 2026). Versi lama ada di `archive/legacy-docs/ARCHITECTURE.md`.

---

## 1. Gambaran Besar

App ini menganalisis pertandingan sepak bola **sebelum kickoff** dan memutuskan: ada value bet atau tidak. Empat lapis:

1. **Agent** — satu planner (`bai/mimo-v2.6-pro`) yang merencanakan analisis, memanggil tool, mengevaluasi hasil, dan re-plan bila ada gap (loop, bukan pipeline statis)
2. **Deterministic Quant Engine** — semua angka (probabilitas, fair odds, EV, stake Kelly) dihitung **code murni** di `lib/quant/*`, nol LLM
3. **Multi-Model Syndicate (R1-only sejak 19 Okt)** — 5 persona (Bull/Neutral/Bear paralel → J1 → J2 sequential) + consensus deterministik. Satu ronde, tanpa re-debate
4. **Fallback Guard (21 Okt)** — `lib/quant/fallback-guard.ts`: tim sumber `fallback` butuh edge >50% atau verdict SKIP. Deterministik, di luar jangkauan LLM
4. **View-Model (BFF)** — `lib/view/analysis-view.ts` mengubah output pipeline menjadi JSON bersih per section; frontend adalah dumb renderer, tidak pernah menggali path dalam (+ field `data_quality` / `fallback_guard` sejak 21 Okt)

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
   │     Stage 2 sequential: J1 → J2 (J2 lihat output J1, wajib setuju/bantah)
   │     (R1-ONLY sejak 19 Okt: cap 1 ronde, tanpa re-debate; guard fallback → SKIP bila edge <50%)
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
| `lib/syndicate-orchestrator.ts` | Debat 5 persona (R1-only) + J2 sequential + consensus deterministik + voice guide |
| `lib/quant/fallback-guard.ts` | Guard fallback-source (21 Okt): SKIP bila sisi fallback & edge <50% (`FALLBACK_MIN_EDGE`) |
| `lib/llm/voice-guide.ts` | 1 sumber gaya persona + format verdict (kontrak JSON tetap akhir) |
| `lib/quant/*` | Dixon-Coles, vig-stripping (Shin), Kelly, ratings (James-Stein), luck regression, special markets, half-profile, momentum, fallback-guard |
| `lib/db/*` | SQLite lokal: dataset TheStats, team telemetry, vault payload, master historis |
| `lib/stats-cache.ts` | Cache TTL in-memory untuk fetch TheStatsAPI |
| `scripts/sync-weekly-telemetry.ts`, `ingest-*.ts` | Ingestion data mingguan/multi-liga (CLI manual) |
| `scripts/calibrate-ratings.ts`, `backtest-dixon-coles.ts` | Kalibrasi rating + backtest harness (workstream kuantitatif) |
| `scripts/test-planner-tool-calling.ts`, `test-planner-loop.ts` | Runnable check pipeline agent |
| `scripts/test-debate-r1.ts`, `test-fallback-guard.ts` | R1-only (38) + guard fallback (55): cap ronde, J2 sequential, SKIP/warning, guard angka |
| `scripts/test-half-profile.ts`, `test-momentum.ts` | Sinyal konteks: babak (59) + momentum (73), guard prob/fair identik |
| `scripts/test-view-mapper.ts` | Runnable check BFF: fixture wajib lolos `AnalysisSchema`, assert skala angka, null jujur, anti-kebocoran field mentah, marker `is_strictly_grounded` |
| `scripts/test-quant-scale.ts`, `test-value-bets.ts` | Runnable check quant: kontrak skala λ=G·α·β·γ, kalibrasi ratings per liga (Σλ≈Σx, Σμ≈Σy), vig throw odds invalid, value bet hanya dari odds pasar nyata |
| `scripts/test-snapshot-db.ts`, `test-stats-mapper.ts`, `test-upcoming-guard.ts`, `test-http-json.ts`, `test-stats-cache.ts` | Runnable check data layer: cache snapshot tolak fallback, eval skor NULL, mapper anti-karangan, guard fixture scheduled, gzip/JSON, negative-cache |
| `archive/` | Sisa pipeline lama, komponen terpotong (`archive/legacy-components/`), eksplorasi one-off (lihat `archive/README.md`) |

---

## 4. Tool Contract (dipanggil planner)

| Tool | Input | Fungsi | Wajib? |
|---|---|---|---|
| `check_data_integrity` | `alasan?` | Fetch + validasi Zod semua data match → gap registry | Ya, pertama |
| `fetch_missing_intel` | `alasan?` | Fetch ulang saat gap → delta missing | Hanya saat gap |
| `run_quant_package` | `alasan?` | Quant engine lengkap → probabilitas, fair odds, value bets | Ya |
| `run_syndicate_debate` | `alasan?` | Debat 5 persona → consensus, verdict panel (+ guard fallback) | Ya (cap 1 ronde) |
| `run_editorial_analysis` | `alasan?` | Editorial closed-world → JSON naratif | Ya |
| `stop_with_verdict` | `prediksi`, `faktor_kunci`, `ringkasan_perencanaan` | Tutup analisis | Ya, terakhir |

Semua argumen divalidasi Zod (`inputSchema`); semua output tool dihasilkan server-side.

---

## 5. Loop & Trigger Re-plan

Loop = `plan → act → evaluate → re-plan`, hard cap **8 step** (`PLANNER_MAX_STEPS`). Re-plan **hanya sah** bila evaluator code (`lib/agent/coverage.ts`) menemukan:

| Trigger | Kondisi numerik | Aksi yang diperbolehkan |
|---|---|---|
| `FIELD_KOSONG` | `missing_data_registry` tidak kosong | `fetch_missing_intel` (maks 1×; kalau tetap kosong → degradasi eksplisit) |
| `CONSENSUS_LEMAH` | `consensus_level` ∈ {SPLIT_DECISION, DISSENT} | Editorial wajib bahas (R1-only: tanpa ronde tambahan) |
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
7. **Value bet hanya dari odds pasar nyata** — tanpa odds pasar, TIDAK ada value bet untuk market itu; odds karangan (1.95/1.88/fair-odds model) menghasilkan EV/stake/`recommended_odds` yang tidak dimiliki bandar mana pun. Market tanpa field odds (BTTS, AH DNB) dilewati sampai sumbernya tersedia
8. **Setiap LLM call ber-timeout per-tier** — persona 90s / judge 120s / retry 60s / editorial 120s (via env, default di `models.ts`/`llm.ts`); timeout = fallback template jujur, bukan retry membabi-buta. Plafon loop planner 30 menit
9. **Anti-leakage fail-closed** — cutoff waktu form/H2H lokal butuh `utc_date` valid; kalau absen, sumber lokal dilewati total, bukan membuka query tanpa batas waktu

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
is_strictly_grounded : true = analisis penuh; false = ada bagian fallback/template
             (marker jujur — WAJIB ditampilkan ke user, jangan disembunyikan)
data_quality: {home_source, away_source, is_fallback_involved} (21 Okt, additive)
fallback_guard: {skipped, reason, edge, threshold, original_pick/verdict} (21 Okt, additive)
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

| Peran | Aktif (`.env.local`, 21 Okt) | Sifat |
|---|---|---|
| Planner (loop agent) | `bai/mimo-v2.6-pro` | Reasoning kuat + native tool-calling |
| Bull persona | `ag/gemini-3.8-flash-medium` | Argumen pro |
| Neutral persona | `cx/gpt-6-luna` | Argumen netral |
| Bear persona | `cx/gpt-6-luna` | Argumen kontra / audit risiko |
| Judgement 1 | `ag/gemini-3.8-flash-high` | Hakim ketua |
| Judgement 2 | `muse/muse-spark-1.3-contributor` | Penguji silang (catatan: sering balas kosong → fallback jujur; verdict cenderung UNANIMOUS by-construction) |
| Fallback + editorial default | `cx/gpt-6-luna` (`NINE_ROUTER_MODEL`) | Pengganti saat model gagal |
| Endpoint dispatcher | `bai/qwen3.8-27b` | Keputusan fetch (heuristic langsung; LLM di balik flag `DISPATCHER_LLM=1`) |
| Betting A/B | `bai/qwen3.8-27b`, `bai/deepseek-v4.1-flash` | Analisis taruhan bonus |

Riwayat rotasi (Okt 2026): `space-bunny-free` mati 410 ModelDeprecated → diganti;
`deepseek/deepseek-v4.1-flash` tanpa kredensial (404) → tidak dipakai;
`qwen3.8-flash` hang 120s+60s → dikeluarkan dari judge. Model gratisan rotasi cepat —
cek via probe `chat/completions` sebelum dipasang.

Semua bisa dioverride lewat env (lihat `.env.example`).

---

## 9. Data Layer

- **TheStatsAPI** (remote, kuota terbatas) → `lib/stats-cache.ts` (TTL in-memory) → Zod sanitizer
- **SQLite lokal** (`lib/db/`): `thestats-dataset`, `team-telemetry`, `thestats-vault`, `sqlite-master`, `upcoming-fixtures`, `analysis-snapshot`
- **`data/calibrated_ratings.json`** — hasil kalibrasi rating (James-Stein shrinkage) dari `scripts/calibrate-ratings.ts`
- Tier-1 offline diprioritaskan: fetch online hanya fallback bila SQLite kosong
- **Semua baris telemetri lewat `lib/stats-log-mapper.ts`** — skor/status absen → baris **dilewati** dengan warning, TIDAK PERNAH dikarang jadi 0-0/"finished". Akumulasi statistik (xG, shots, dll.) memakai counter per sisi: data absen → nilai `null` + sample size mengecil, bukan dihitung 0

**Peta 4 DB lokal** (semua di `data/`, semua di-gitignore):

| DB | Isi | Bisa di-rebuild? | Boleh DELETE/refresh? |
|---|---|---|---|
| `football_master.db` | 28.922 match historis (CSV football-data.co.uk) | ✅ download ulang | ✅ |
| `thestats_dataset.db` | 2.423 log / 225 tim season 26/27 (telemetri TheStatsAPI; 75 baris bertag master dari backfill Task 1) | ✅ sync ulang | ✅ |
| `thestats_raw_vault.db` | 1.129 payload mentah API | ✅ (tapi isinya kadaluarsa) | ✅ |
| `analysis_snapshots.db` | ~130 snapshot analisis + outcomes (§9.1) | ❌ **tidak bisa** | ❌ append-only |
| `upcoming_fixtures.db` | 246 fixture 30 hari (§9.2) | ✅ sync ulang | ✅ disposable |

**Perintah rebuild** (fresh clone / DB terhapus): `npx.cmd tsx scripts/sync-weekly-telemetry.ts 400` — argumen = hari lookback; default `8` hanya mengambil delta mingguan, **bukan** membangun ulang riwayat musim. Consumer lokal (`getLocalH2HMatches`/`getLocalRecentMatches`) memberi `console.warn` saat tabel kosong supaya degradasi tidak pernah diam-diam.

`football_master.db` = **prior** (α/β attack/defense dari fitting 22rb match, materialisasi di `calibrated_ratings.json`); `thestats_dataset.db` = **observasi** season berjalan (n di shrinkage `w = n/(n+κ)`). Keduanya beda ID space (nama tim vs `mt_*`) — jembatannya `lib/quant/team-normalizer.ts`.

### 9.1 `data/analysis_snapshots.db` — riwayat analisis (data pribadi, APPEND-ONLY)

Berkas **terpisah** dari `thestats_dataset.db` (`lib/db/analysis-snapshot.ts`), di-gitignore.
Tabel `analysis_snapshots` (hasil pipeline, lengkap dengan `view_json` sebagai sumber kebenaran
+ kolom ringkas untuk query), `match_outcomes` (hasil aktual, boleh di-refresh via upsert),
dan dua VIEW evaluasi (`v_snapshot_eval`, `v_snapshot_eval_market`) yang menyaring
`lead_time_minutes > 0` (pre-match) + `status = 'finished'` untuk mencegah leakage.

> ⚠️ **Tidak bisa di-rebuild.** Isinya keluaran LLM (70–110 detik per match per 21 Okt 2026,
> model nondeterministik). Ngawet ulang berarti menjalankan ulang seluruh pipeline. **Jangan
> pernah DELETE/DROP** di jalur produksi; satu-satunya `DELETE` yang sah adalah cleanup
> data test ber-prefix di `scripts/test-snapshot-db.ts`. Backup manual bila perlu:
> `sqlite3 data/analysis_snapshots.db ".backup data/backup-snapshots-YYYY.db"`.

**Kontrak integritas snapshot (audit 18 Okt 2026):**
- **Cache menolak degradasi** — `getFreshSnapshot` hanya mengembalikan baris
  `is_fallback = 0 AND is_grounded = 1`. Hasil fallback/template tetap tersimpan
  (history/audit) tapi TIDAK PERNAH diservis sebagai analisis segar.
- **`v_snapshot_eval` jujur saat skor NULL** — `hit_recommended`/`hit_panel` bernilai
  `NULL` (belum dinilai), bukan menang/kalah karangan. `actual_result` juga NULL.
- **`upsertOutcome` tidak menimpa dengan NULL** — refresh yang lebih miskin mempertahankan
  kolom statistik lama (`COALESCE`); goals/status tetap authoritative (boleh dikoreksi).
- **Konvensi market key: `deriveMarketKey` = sumber tunggal** — `market_key` di VIEW SQL
  adalah mirror-nya; ekuivalensi JS↔SQL diuji `test-snapshot-db.ts`. Kalau aturan diubah,
  ubah KEDUA sisi atau test akan merah.

Skema ini menggantikan tabel `analysis_runs` yang dulu hidup di `thestats_dataset.db`
(DB yang boleh di-refresh — berbahaya bagi data pribadi). Kontrak lengkap: `docs/db-snapshot.md`.
Operasional: `scripts/sync-match-outcomes.ts` (tarik hasil aktual, lokal dulu),
`scripts/snapshot-report.ts` (report read-only),
`scripts/backfill-panel-market.ts` (isi kolom `panel_market*` untuk baris lama).

**Dua definisi rekomendasi, sengaja dipisah:** `recommended_market_key` = market
dengan EV positif pertama (aturan `hero.ev_teratas` di view), sedangkan
`panel_market_key` = market yang benar-benar direkomendasikan arbiter/supreme
(diturunkan dari teksnya, market yang disebut pertama). Keduanya punya hit rate
sendiri di report — sering berbeda, jadi membandingkan keduanya itu inti evaluasi.
Semua jalur operasional:
- `npm run sync:weekly` — tarik telemetry match selesai (2 call/match + 1 cedera/tim, skip yang sudah ada)
- `npm run sync:outcomes` — tarik skor/statistik aktual → `match_outcomes` (lokal dulu, online fallback)
- `npm run report:snapshot` — evaluasi prediksi vs nyata (read-only, aman diulang)

### 9.2 `data/upcoming_fixtures.db` — katalog fixture (umur pendek, disposable)

Store terpisah dari `thestats_dataset.db` (pola yang sama dengan snapshot: lifecycle
berbeda → file berbeda). Isinya **378 fixture** horizon penuh (sampai **2026-11-29**,
7 liga target + `competition_catalog` 208 kompetisi). Horizon ini bukan pilihan kita:
TheStatsAPI hanya menyediakan ±6 minggu fixture ke depan, dan itu batas kerasnya.
Siklus hidup: diisi `scripts/sync-upcoming-fixtures.ts` → dibaca katalog
`/api/matches` (offline-first, API hanya fallback) → match selesai →
`scripts/promote-upcoming-to-telemetry.ts` menarik telemetry-nya ke dataset utama
lalu **menghapus barisnya** di sini. Dataset utama tidak pernah menyimpan baris
`scheduled` (invariant diuji `scripts/test-upcoming-guard.ts`).

### 9.3 Masa beku online (18 Okt 2026): inventaris yang harus menggantikan API

TheStatsAPI **mati permanen** — kunci ditolak dengan `403 KEY_REVOKED: "API key has
no active subscription plan"` (terverifikasi 18 Okt 2026 ~15:05 UTC, beberapa menit
sebelum kuota berakhir). Semua yang masih hidup sesudah itu wajib dilayani dari data
yang sudah distok:

| Kebutuhan | Sumber lokal | Status |
|---|---|---|
| Katalog fixture | `upcoming_fixtures.db` 378 baris s/d 2026-11-29 + `competition_catalog` 208 | ✅ 200 OK tanpa API (dibuktikan live saat API 403) |
| Harga odds | `match_odds_history` (`thestats_dataset.db`) 378 baris anchor, 112 terisi | ⚠️ data ada, **`/api/odds` belum membaca tabel ini** — kartu odds kosong sampai route disentuh reviewer |
| Lineup | vault `lineups_{matchId}` — 20/24 laga 18 Okt tersimpan | ⚠️ 4 laga terakhir gagal ditarik (API mati) |
| Telemetri | `team_match_logs` 2.348 baris (1.174 match) | ✅ naik 2,7× dalam sesi pembakaran kuota |
| Cedera/skuat | vault `injuries_*` / `players_*` 127 tim | ✅ snapshot bertanggal, tapi **tidak bisa di-refresh** lagi |

Aturan main selama masa beku: **jangan panggil API di jalur render** — katalog, odds,
dan form wajib dilayani dari store; `statsFetch` kini gagal cepat dengan pesan
"AKSES API MATI" supaya tidak ada retry sia-sia.

Update 21 Okt: `ODDSPAPI_API_KEY` sudah ada di env → kandidat sumber odds totals/BTTS
(Task 3 parlay-pivot). Status integrasi: belum ada adapter.

> 📌 Laporan lengkap + item yang gagal karena API mati:
> `tasks/todo-data-coverage.md`. Pengaman offline: `lib/stats-fetch.ts`
> (pacing 5s di bawah limit nyata **12 req/menit** dari header `x-ratelimit-*`),
> `lib/api-budget.ts` (counter disinkronkan header `x-monthly-quota-remaining`).

---

## 10. Menjalankan & Menguji

```bash
npm run dev                        # dashboard di http://localhost:3101 (port 3101, bukan 3000)
npx tsx scripts/test-debate-r1.ts            # debat R1-only: cap ronde, J2 sequential, voice, guard angka
npx tsx scripts/test-fallback-guard.ts       # guard fallback: replay DB read-only, SKIP/warning, over-block check
npx tsx scripts/test-half-profile.ts         # sinyal konteks babak (59)
npx tsx scripts/test-momentum.ts             # sinyal konteks momentum (73)
npx tsx scripts/ablate-ucl-scaling.ts        # ablasi sqrt(Q) UCL: paired ON vs OFF (UNDECIDED n=50, 19 Okt)
npm run sync:weekly                # sinkronisasi telemetry mingguan (CLI)
npm run ingest:multileague         # ingest multi-liga
npx tsx scripts/test-planner-tool-calling.ts   # gate native tool-calling model planner
npx tsx scripts/test-planner-loop.ts           # loop + coverage evaluator (mock tools)
npx tsx scripts/test-view-mapper.ts            # BFF: fidelitas angka, null jujur, anti-leak
npx tsx scripts/test-snapshot-db.ts            # DB snapshot: round-trip, VIEW, leakage guard, eval NULL
npx tsx scripts/test-quant-scale.ts            # kontrak skala quant + kalibrasi ratings per liga
npx tsx scripts/test-value-bets.ts             # value bet hanya dari odds pasar nyata
npx tsx scripts/test-stats-mapper.ts           # mapper anti-karangan (skor/status absen → null)
npx tsx scripts/test-upcoming-guard.ts         # fixture scheduled tidak bocor ke telemetri
npx tsx scripts/verify-tier1-offline-quant.ts  # integrasi tier-1 offline + quant multi-liga
npx tsx scripts/verify-foundation-phase-a.ts   # regresi foundation phase A
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

## 11. Roadmap (update 22 Okt 2026)

Selesai sejak audit terakhir:
- **Latensi** — ✅ 70–110s/run (R1-only + timeout per-tier + model cepat), dari 200–536s. Target <120s tercapai.
- **Offline survival** — ✅ katalog/odds lokal, degradasi jujur (lihat `tasks/todo.md`)
- **Depth 1–3** — ✅ backfill master, half-profile, momentum (konteks-only, prob frozen)
- **R1 + voice + guard** — ✅ debat 1 ronde, voice guide, fallback guard (`tasks/todo.md` Task 1)
- **Frontend redesign** — ✅ agent frontend (`tasks/plan-frontend-redesign.md`)

Aktif sekarang — **Parlay Pivot** (`tasks/plan.md`, target user = pemain mix parlay):
- [ ] Task 2: verdict gaya parlay (leg teraman + jebakan + skip, cap 3)
- [ ] Task 3: judge skenario semi-agentic (A/B/C/D berangka + kondisi batal)
- [ ] Task 4: odds totals/BTTS via OddsAPI (key sudah di env)
- [ ] Task 5 (usul): web-search khusus lineup/cedera, label unverified
- [ ] Task 6: kalibrasi & track record (panel, profil HT, laporan bulanan)
- [ ] Task 7: GBM challenger offline (wajib kalahkan Dixon-Coles dulu)

Masih terbuka (lama):
- Evaluasi outcome berjalan — accumulate ≥100 snapshot evaluable → kalibrasi ulang
- Slip builder v2 (gabung 10 legs + survival) — sesudah Task 2–4
- Trigger otonom (cron per kickoff)
- Sisa depth 4–6 (panel kalibrasi, profil HT, laporan bulanan)

---

## 12. Status Model & Batasan Terukur (audit Okt 2026)

Hasil backtest jujur out-of-sample — **bahan keputusan pemakaian, jangan diabaikan**:

| Metrik | Angka | Arti |
|---|---|---|
| Log-Loss 1X2 model (6.528 match) | **1.0306** | Punya skill vs baseline naive (1.0771) |
| Log-Loss closing line (vig dibuang) | **0.9949** | Model **kalah dari pasar** — gap 0.036 ≈ harga informasi yang tidak kita punya (lineup, uang tajam) |
| Fusion telemetri (Track C) | 0.9641 vs pasar 0.9736 | Paritas statistik (p=0.348) — tidak signifikan |
| Special markets (corners/cards) | Brier 0.30 vs base rate ~0.25 | **Tidak ada skill** setelah leakage dibetulkan |
| Simulasi Kelly (6.133 pick) | semua strategi bangkrut | "Edge" 1X2 vs closing = ilusi |

Implikasi arsitektur: app adalah **decision-support** (ringkasan data, deteksi dislokasi harga, transparansi sumber, konteks lineup/cedera) — **bukan mesin pilih taruhan** melawan closing line. Kelas edge yang belum teruji: *asymmetric info* (kabar lineup/cedera lebih awal dari harga). Monitoring: response dengan `is_strictly_grounded: false` = pipeline sedang degradasi — jangan pakai output hari itu.

**Debt teknis terbuka (diketahui, belum diperbaiki — 22 Okt 2026):**
- J2 `muse-spark` sering balas kosong → fallback template ngikut pasar J1 → UNANIMOUS by-construction (inflasi keyakinan semu; lihat §8)
- Guard fallback over-block untuk user parlay: leg aman 70%+ ikut ke-SKIP karena value play-nya <50% (tunggu Task 2 parlay-pivot)
- Neutral + Bear sama-sama `gpt-6-luna` (independensi stage-1 turun; hemat kredit bai)
- Cache snapshot tanpa single-flight (2 request paralel = 2 pipeline penuh); `cache_key_hint` terfragmentasi
- `lib/db/analysis-snapshot.ts` 745 baris — aturan market key punya 2 sumber (SQL VIEW + `deriveMarketKey`), dijaga test ekuivalensi tapi tetap duplikasi
- Output teks LLM tidak di-Zod per field (angka aman — sudah diaudit closed-world per run)
- Rate limiter in-memory (reset saat restart; cukup pemakaian pribadi, bukan publik)

Sudah dilunasi: vig fabrication (`overround 1.055` → null jujur), topEv minus-EV, UCL top-5 jatuh prior (cek values map), fixture Genk basi, Sporting ratings-miss.

Audit E2E 18 Okt 2026 (run live Osasuna vs Racing, 375 detik): nol angka karangan, semua desimal prose LLM terlacak ke data/derivasi sah, cache jujur (`hit`, payload identik). Detail eksekusi: `tasks/todo-phase-integrity.md`.
