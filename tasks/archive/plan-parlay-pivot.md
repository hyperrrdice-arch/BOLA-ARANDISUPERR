# Implementation Plan: Parlay Pivot (hasil 9 run UCL 21 Okt)

## Overview
Sembilan run UCL membuktikan pipeline sehat (grounded 9/9, 70–110s) tapi 2 run
headline-pick longshot fallback (Sporting→LASK, Inter→Shakhtar). Target user =
pemain mix parlay 10 legs: +EV longshot itu racun slip, bukan fitur. Plan ini
mengubah OTAK (judge) tanpa menyentuh MESIN HITUNG (quant). File terpisah dari
todo.md / todo-offline-depth.md / todo-frontend-redesign.md (masih ada unchecked)
— tidak overwrite.

## Architecture Decisions
- Quant (prob/fair/EV/Kelly) FROZEN: judge hanya baca, tidak boleh reinterpretasi
  angka. Guard via test hitung-ulang identik (pola Task 2/3 depth).
- Verdict berubah dari "1 pick +EV" → "leg teraman + jebakan + skip" (cap 3 opsi,
  tiap opsi wajib: prob model + status harga + 1 kalimat alasan + kondisi batal).
- Harga yang tidak ada di DB = "pantau, jangan bet". Dilarang ngarang odds.
- Fallback-source = warga kelas dua: butuh edge >50% atau skip (aturan owner,
  dari temuan 2/9 run).
- Kontrak view: field baru ADDITIVE di `AnalysisView` (pick lama tetap, biar
  frontend lama tidak pecah). Bentuk akhir lock bareng agent frontend.

## Task List
Lihat `tasks/todo-parlay-pivot.md`. Urutan: guard dulu (murah, dampak slip malam
ini) → verdict parlay → odds totals → skenario semi-agentic → GBM offline.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Judge "kreatif": skenario tanpa angka | High | Aturan "no number, no scenario" + test assert tiap opsi bawa prob |
| Odds totals OddsAPI zonk/kosong | Med | Adapter read-only + fallback "pantau"; tidak blokir Task 1-2 |
| Scope merembet ke quant | High | Guard test prob/fair identik tiap task; koefisien = keputusan owner |
| Frontend agent tabrakan kontrak | Med | Additive-only; lock bentuk field sebelum Task 2 dieksekusi |

## Open Questions
- Ambang edge fallback (>50%?) — owner setuju angka final?
- Cap opsi 3 — cukup, atau 2?
- Slip builder (gabung 10 laga + survival) masuk plan ini v2 atau plan terpisah?
