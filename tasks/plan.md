# Implementation Plan: Football Analyst untuk Pemain Parlay (Master)

Satu-satunya plan aktif. Semua plan lama (offline survival, depth, frontend,
parlay-pivot, phase-*, perf, lint, data-coverage) diarsipkan di `tasks/archive/`
— selesai atau digantikan. Jangan bikin file plan baru tanpa arsipkan yang ini.

## Overview
App = analis pre-match untuk **pemain mix parlay 10 legs**. Tiga lapis terpisah:
**Matematika** (quant: prob/fair/EV — buta konteks, jujur, frozen) →
**Keputusan** (judge: opsi A/B/C/D berangka + skip + sizing — tempat akal sehat) →
**Ingatan** (track record: override mana yang bener — yang bikin sistem pinter).
Kegagalan yang tidak boleh terulang: verdict headline longshot fallback
(Sporting→LASK, Inter→Shakhtar, 21 Okt) — benar matematis, beracun buat slip.

Status 22 Okt: pipeline R1-only 70–110s, guard fallback aktif, 9 run UCL 21 Okt
grounded 9/9, model formasi hemat (luna/gemini/muse-J2), frontend redesign selesai.

## Architecture Decisions
- Quant FROZEN: judge baca angka, tidak reinterpretasi. Guard via test hitung-ulang.
- Verdict = leg teraman + jebakan + skip (cap 3), tiap opsi wajib: prob + status
  harga + 1 kalimat + kondisi batal. Aturan "no number, no scenario".
- Harga absen = "pantau, jangan bet". Dilarang ngarang odds.
- Fallback-source = warga kelas dua: edge >50% atau SKIP + tulis kualitas data.
- Kontrak view additive-only (pick lama tidak dihapus) sampai lock dengan frontend.
- Hermes/MCP = lapisan operasi di samping app, bukan di dalam pipeline.

## Task List
Lihat `tasks/todo.md`. Urutan: verdict parlay → odds totals → skenario → eval.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Judge kreatif tanpa angka | High | "no number, no scenario" + test assert tiap opsi |
| Odds totals zonk | Med | Adapter read-only + degradasi "pantau"; tidak blokir Task 2 |
| Scope merembet ke quant | High | Guard prob/fair identik tiap task; koefisien = keputusan owner |
| Kontrak pecah dengan frontend | Med | Additive-only; lock bentuk sebelum eksekusi Task 2 |

## Open Questions
- Ambang edge fallback 50% — final?
- Cap opsi 3 atau 2?
- Slip builder v2 masuk plan ini atau plan pisah?
