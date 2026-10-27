# Implementation Plan: Performance Optimization Round 2 — Debat Ronde 2 & Tail Latency

> Tasks: `tasks/todo-perf-2.md` · Ledger: `PERF.md`
> Lanjutan dari `tasks/plan-perf.md`. Plan itu **tidak** diganti; tetap jadi catatan ronde 1.

## Overview

Ronde 1 memasang instrumentasi, cache, cancellation, dan overlap. Dengan durasi per stage akhirnya terukur, gambarannya berubah: **bottleneck bukan lagi fetch/quant/editorial, tapi debat sindikat yang jalan DUA RONDE** — 177.3s dari 238.5s (74%) pada run terukur.

## Data (run terukur, terinstrumentasi)

Match `mt_988366076` (Brentford vs Liverpool), total **238.5s**:

| Bagian | Durasi | Porsi |
|---|---|---|
| check_data_integrity (fetch TheStatsAPI) | 2.3s | 1% |
| run_quant_package (kode murni) | 0.0s | 0% |
| **debat ronde 1** (stage1 35.6s + stage2 46.3s) | **81.9s** | 34% |
| **debat ronde 2** (stage1 42.8s + stage2 52.6s) | **95.4s** | 40% |
| run_editorial_analysis | 34.9s | 15% |
| stop_with_verdict | 0.0s | 0% |
| Belum teratribusi (round-trip planner antar tool, ~6 step) | 23.9s | 10% |

Dua fakta tambahan dari `stage_timings`:

1. **`stage_2_ms` == `judgement_2_ms` persis di kedua ronde** (46.3s dan 52.6s). Artinya Hakim 2 selalu jadi straggler; stage 2 sepenuhnya digerbangi satu model (`bai/qwen3.8-flash`).
2. Stage 1 paralel benar: `stage_1_ms` = max(bull, neutral, bear) di kedua ronde.

## Hipotesis akar masalah

Debat memanggil `call9RouterDirect(..., maxTokens = 16384, timeout = 180000)` untuk **semua** persona (`lib/syndicate-orchestrator.ts`), padahal output yang diminta kecil: JSON `{ thesis, key_drivers[2], tactical_edge }` untuk persona, `{ verdict_summary, confidence_tier, recommended_market, ... }` untuk hakim. Anggaran 16384 token keluar = waktu generasi panjang; persona terlambat (J2, 52.6s) langsung menggeser seluruh stage karena stage = max(anggota).

Ronde 2 memperbesar masalahnya 2× (5 panggilan LLM lagi) dan dipicu otomatis oleh `CONSENSUS_LEMAH`.

## Design Decisions

1. **Potong anggaran token, bukan ganti model.** `max_tokens` per peran diturunkan ke ukuran skema JSON-nya. Model tetap tidak diseragamkan (guardrail ARCHITECTURE §6.5 tetap utuh).
2. **Fail-jujur dijaga.** Kalau output kepotong → JSON gagal parse → `fallback_template` + `is_fabricated_fallback`. Itu degradasi yang **terlihat**, bukan diam-diam. Ukur lajunya sebelum/sesudah; kalau naik → revert.
3. **Ronde 2 tidak disentuh di ronde ini.** Menghapus ronde 2 mengubah keputusan produk (ronde 2 bisa membalik SPLIT_DECISION/DISSENT), jadi butuh keputusan user — masuk Open Questions, bukan eksekusi sepihak.
4. **Ukur ulang satu match yang sama** (metode identik: `?debug=1` → `plannerTrace.steps[].durasi_ms`), ronde 1 vs ronde 2. Sampel kecil (LLM itu nondeterministik) → keputusan pakai ambang "lebih baik dari variasi antar-run", dan catat jumlah `fallback_template`.
5. **Jangan sentuh editorial.** Ia sudah overlap dengan debat (ronde 1 Task 4) dan 34.9s-nya sebagian besar tertutup.

## Task List

### Phase 1: Tail latency debat
- [ ] Task 1: Anggaran token per peran (persona vs hakim) + env override
- [ ] Task 2: Ukur ulang 1 run + bandingkan fallback rate

### Checkpoint
- [ ] Total run turun > variasi antar-run · `fallback_template` tidak naik · tsc+build hijau

### Phase 2: Sisa 10% (hanya kalau Phase 1 tidak cukup)
- [ ] Task 3: Round-trip planner 23.9s — audit alasan panggilan (butuh data `onStepFinish`), jangan dikerjakan tanpa bukti

## Risks & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Output kepotong → JSON invalid → lebih banyak `fallback_template` | Sedang | Anggaran diturunkan konservatif (bukan ke minimum), dan laju fallback diukur sebelum/sesudah; kalau naik → revert |
| Kualitas argumen turun (narasi lebih pendek) | Sedang | Persona diminta JSON pendek sejak awal; prompt tidak diubah, hanya plafon |
| Sampel tunggal → salah atribusi | Sedang | Bandingkan juga `stage_1_ms`/`stage_2_ms` per persona, bukan cuma total; ulangi kalau delta di dalam noise |
| Model penalaran butuh ruang token untuk reasoning | Sedang | `thinking.budget_tokens` hanya aktif untuk model native non-`bai/` (tidak berubah); `max_tokens` mengatur output, bukan reasoning |

## Open Questions

1. Ronde 2 debat menyumbang 40% durasi. Boleh di-gate (mis. hanya saat SPLIT_DECISION, atau hanya 1× per match per jam), atau itu nilai produk yang harus tetap penuh? **Rekomendasi: jangan digate dulu** — Task 1 menghapus biayanya tanpa mengubah keputusan.
2. Kalau `bai/qwen3.8-flash` tetap jadi straggler setelah plafon token diturunkan, boleh diganti model lain untuk Hakim 2? **Rekomendasi: tidak** — itu melanggar guardrail independensi vendor; laporkan saja ke user.
