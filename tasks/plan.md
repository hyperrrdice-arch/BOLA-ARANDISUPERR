# Implementation Plan: Dashboard Overhaul — Enteng, Anti-Tumpuk, Verdict-First

## Overview

Redesain UI dashboard di atas pipeline planner loop (ARCHITECTURE.md Okt 2026). Empat kerjaan: (1) buang section redundan, (2) alur enteng (payload kecil, loading jujur), (3) **anti-tumpuk** — susun ulang kepadatan informasi tiap view supaya enak dibaca (keluhan utama: tab model matematis bikin pusing), (4) naikkan kualitas visual (lint: 387 FAIL; inspect: 10 FAIL / 4 WARN) dengan brand terminal dipertahankan.

Bukti audit: 216× `font-mono`, 201 micro-label, 204 hairline, 101 shadow, body 12px, first screen tanpa fokus; duplikat data antar kartu (EV/stake 3×, dual bench 2×, faktor_kunci 2×); tab matematika = 4 panel bertumpuk (~940 baris) semua terbuka tanpa hierarki; `rawLineups`+`audit`+`plannerTrace` dikirim tapi tak dibaca client.

## Design Decisions

1. **Anti-tumpuk — satu elemen dominan per view.** Tiap layar/tab punya tepat SATU hal yang besar (angka keputusan utama), sisanya pendukung. Yang bukan pendukung langsung → terlipat.
2. **Progressive disclosure dua level.** Yang terbuka default: ringkasan besar + maks 5 baris bukti. Metode perhitungan, turunan (λ/μ, margin, sample), argumen panjang, tabel >5 baris → accordion/`<details>` terlipat dengan judul informatif ("Cara angka ini dihitung", "Lihat 14 pasar lainnya").
3. **Hierarki angka.** Keputusan (verdict, skor, probabilitas utama, EV teratas) = display size; angka bukti = body 14–16px; metrik turunan = kecil tapi tetap ≥12px. Jangan semua angka sama rata.
4. **Verdict-first.** Tab default "Ringkasan": PASS/NO BET + prediksi + keyakinan terbaca ≤1 layar sebelum angka detail.
5. **Brand terminal dipertahankan, mono data-only.** Mono untuk angka/tabel/ID (tabular figures), prose & label pakai text face, body naik ke 14–16px. Deviation skill dicatat + `--allow mono`.
6. **Komponen terpotong → `archive/legacy-components/`** (jangan delete, konsisten PLAN-D).
7. **Kontrak API aman.** `rawLineups` tak dikirim kecuali `?debug=1` (konsumen 0, schema tetap). `plannerTrace` justru di-render sebagai kuitansi.
8. **App screen, bukan landing page.** Motion cukup state change; `prefers-reduced-motion` dihormati; lantai "4 gambar" skill tidak berlaku untuk dashboard data.

## Task List

### Phase 1: Buang Redundansi
- [ ] Task 1: CUT `MarketOddsOverviewCard` (duplikat OddsDislocationBar, sering kosong, kartu gelap nyasar) — `pergerakan_smart_money` pindah ke OddsDislocationBar
- [ ] Task 2: MERGE `DualThinkingConclusionCard` (100% kembar Stage 2) ke `SyndicateDebateCard`
- [ ] Task 3: MERGE `KellyMatrixCard` ke `QuantEngineCard` + pangkas `DeepMathEvidenceCard` (285ln → panel metode terlipat)
- [ ] Task 4: `faktor_kunci` dirender 1×

### ✅ Checkpoint Phase 1: build+tsc hijau · nol duplikat · info identik (diff screenshot)

### Phase 2: Alur Enteng + Anti-Tumpuk (inti revisi)
- [ ] Task 5: Tab 5→4: **Ringkasan** (default) · **Kuantitatif** · **Odds** · **Debat**; markets 1xBet/Scanner on-demand
- [ ] Task 6: **Restack Kuantitatif**: satu bintang (prob 1X2 + fair odds + EV teratas display-size) → baris bukti ≤5 → sisanya terlipat (simulator Kelly, metode DC/Shin/Shrinkage, tabel panjang)
- [ ] Task 7: **Restack Debat verdict-first**: consensus/supreme besar di atas, argumen Bull/Neutral/Bear + dual bench dalam accordion per persona
- [ ] Task 8: Loading jujur (elapsed timer, tanpa checklist palsu) + receipt `plannerTrace` di Ringkasan
- [ ] Task 9: Payload & fetch enteng: `rawLineups` butuh `?debug=1`; cache `/api/odds`; `next/dynamic` tab berat
- [ ] Task 10: Horizon 72h di FilterToolbar

### ✅ Checkpoint Phase 2: run nyata end-to-end · tiap view 1 elemen dominan · accordion berfungsi · keputusan ≤1 layar

### Phase 3: Visual & Tipografi
- [ ] Task 11: Tokens & konsistensi: radius/padding/error tone 1 standar, hapus 101 shadow statis + 204 hairline dekoratif (tabel asli tetap boleh bergaris)
- [ ] Task 12: Katalog & header: buang noise operator ("SISTEM SIAP TEMPUR", cache stats), fix wrap mobile, heading display-size, body 12→14/16px, micro-label → sentence case, mono data-only
- [ ] Task 13: Gate `lint.mjs`+`inspect.mjs` + critique (maks 3 ronde), `--allow mono` untuk data

### ✅ Checkpoint Final: inspect tanpa FAIL · 390px layak · build+tsc hijau · test-planner lulus

## Risks & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Info jadi "tersembunyi" setelah disclosure | Sedang | Judul accordion informatif + jumlah item; audit: semua field yang tampil hari ini masih tercapai ≤1 klik |
| Kontrak response berubah (payload trim) | Sedang | `rawLineups` tetap di schema, dibelakangi flag; key yang dikonsumsi UI tak disentuh |
| page.tsx raksasa (110KB+) saat dirombak | Sedang | Slice per task, build check tiap task |
| Identitas terminal hilang | Rendah | `--keep palette,type`, mono untuk data |

## Open Questions
1. Panel terlipat pakai `<details>` native (recommended, tanpa JS state) atau accordion custom yang match style?
2. Debated persona: terlipat per persona (recommended) atau cukup 3 kolom ringkas + klik untuk detail?

## Catatan
- Tasks di `tasks/todo.md`. Plan lama digeser: `tasks/plan-phase-quant-calibration.md`.
- Audit visual: `.taste-skill/inspect/` (report.json + screenshot 3 lebar).
