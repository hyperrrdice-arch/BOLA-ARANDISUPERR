# Implementation Plan: Offline Depth — perdalam app hanya dari DB lokal

## Overview

Stok lokal sudah kaya tapi dangkal dipakai: `team_match_logs` punya tanggal (rest-days tak terpakai), split babak 1/2 (tak terpakai), 60+ kolom telemetri (baru corners/cards/aerial yang dipakai); `football_master.db` 28.922 laga + odds Bet365 + HT + shots (baru jadi prior rating); `analysis_snapshots.db` + VIEW eval (baru jadi laporan manual). Plan ini mengubah data-yang-sudah-ada menjadi kedalaman analisis — nol API, nol key, nol biaya. Bukan janji edge (backtest jujur: model kalah dari closing) — janjinya decision-support yang makin dalam + makin terukur.

## Architecture Decisions

- **Konteks dulu, koefisien jangan.** Sinyal baru (fatigue, momentum, profil babak) masuk sebagai evidence/prompt-context + integrity flag, BUKAN koefisien model — kecuali backtest membuktikan skill (preseden quant-refit: klaim tanpa angka = tolak).
- **Bridge diukur dulu.** Semua yang gabung `football_master` (nama tim) ↔ `tm_*` lewat `team-normalizer` + laporan coverage; <80% = stop, jangan imputasi.
- **Read-only dulu.** Fase A–C tidak mengubah skema DB produksi; tabel baru (kalau perlu) di file terpisah atau kolom nullable + migration test.
- **Jujur tier.** Setiap sinyal baru bawa sample-size + tier (HIGH/MODERATE/LOW/INSUFFICIENT_DATA) pola `special-markets-engine` — tidak ada angka tanpa provenance.

## Task List

### Phase A: Matchup depth (dari team_match_logs, sudah ada)
- [ ] Task 1: Rest-days & congestion (fatigue flag)
- [ ] Task 2: Profil babak 1 vs 2 (slow starter / second-half team)
- [ ] Task 3: Momentum last-3 vs last-6 (form arrow)

### Checkpoint: Matchup
- [ ] Bukti baru tampil ≤5 baris + jujur tier · prompt sindikat pakai konteks · tsc+build hijau

### Phase B: Market depth (dari football_master, sudah ada)
- [ ] Task 4: Panel kalibrasi Bet365 (Brier/log-loss per liga, read-only)
- [ ] Task 5: Profil first-half dari master (bridge terukur)

### Checkpoint: Market
- [ ] Angka kalibrasi tampil · bridge ≥80% atau stop · tidak regresi backtest

### Phase C: Learning loop (dari snapshots, sudah ada)
- [ ] Task 6: Laporan kalibrasi bulanan otomatis (eval → UI honesty panel)

### Checkpoint: Final
- [ ] Semua acceptance hijau · live 1 analisis pamer fitur baru · review user

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bridge nama master↔tm_* <80% | Tinggi | Ukur dulu (Task 5); gagal = stop, bukan imputasi |
| Sinyal baru dikira edge | Med | Label konteks + tier; koefisien model TIDAK berubah tanpa backtest |
| Scope merayap ke API baru | Med | Larangan keras: task ini DB-lokal only; API = plan terpisah |
| File raksasa baru | Rendah | Helper kecil per sinyal + test runnable per task |

## Open Questions

- Fatigue/momentum cukup sebagai konteks prompt, atau lo mau angka bombastis di hero? (usulan: konteks dulu)
- Panel kalibrasi publik (jualan) atau internal (jaga diri)? (usulan: internal dulu, publik setelah 100+ snapshot evaluable)
- Tasks di `tasks/todo-offline-depth.md` (file baru — plan offline-survival tidak disentuh).
