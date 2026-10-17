# Performance Ledger

Baseline diukur pada prod server lokal (`next start -p 3100`), 17 Okt 2026.
Metode: `curl -w %{time_total}` (backend), `next build` (bundle), log server (stage).

## Baseline

| Pengukuran | Nilai | Catatan |
|---|---|---|
| Build | compile 2.9s, TS 4.4s | `/` static, 4 API route dynamic |
| `/api/matches` cold | 1.03s | 96 match, jendela 12 jam |
| `/api/matches` warm | 12ms | cache 10 menit jalan |
| `/api/odds` cold | 0.48s | |
| `/api/odds` warm | 10ms | |
| `/api/agent` | **476s (~8 menit)** | 1 analisis, Ljungskile SK vs IK Brage |

## Breakdown `/api/agent` (dari log server)

| Stage | Durasi |
|---|---|
| Debat Stage 1 (Bull+Neutral+Bear, paralel) | 28s |
| Debat Stage 2 (J1+J2, paralel) | 36s |
| Worst case teramati Stage 2 | **226s** (call abort di 180s → retry model sama) |
| Sisa (dispatcher, fetch, quant, editorial, verdict) | ~410s, **tanpa log timing per stage** |

## Temuan struktur

1. **Tidak ada cache hasil `/api/agent`** — analisis ulang match sama = 476s lagi + biaya LLM ulang.
2. **Retry same-model setelah abort** (`syndicate-orchestrator.ts` L193) — timeout 180s + retry = worst case 360s per stage. Teramati nyata.
3. **Serial Stage1 → Stage2** debat; total debat minimal ~64s.
4. **Nggak ada per-stage timing** untuk dispatcher/fetch/quant/editorial/verdict — sisa ~410s belum teratribusi.
5. **Nggak ada cancellation** — client timeout, server tetap proses (run2 habis resource di belakang).
6. `planner_trace.steps` ada tapi tanpa field durasi.
7. Frontend `/` static; heavy cards sudah `dynamic()`; data di-fetch client-side (LCP dibatasi spinner + fetch matches).

## Upaya

| Ide | Baseline → Hasil | Putusan | Kenapa |
|---|---|---|---|
| (baseline) | — | — | belum ada fix yang dicoba |

## Rencana fix (urut dugaan dampak, satu-satu, ukur ulang)

1. Cache hasil `/api/agent` per `matchId` (TTL 10 menit) → warm = <50ms
2. Tambah timing log per stage planner → atribusi sisa ~410s
3. Cancellation: abort pipeline saat client disconnect (`req.signal`)
4. (Setelah ukur) Turunkan timeout LLM / fallback model cepat saat retry, batasi max_tokens debat
