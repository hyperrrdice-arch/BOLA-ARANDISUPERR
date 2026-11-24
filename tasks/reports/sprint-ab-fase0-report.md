# Sprint A+B Lanjutan — Fase 0: Verifikasi Basis & Peta Kode

Tanggal: 24 Nov 2026 (malam) · Branch: `sprint/a-b-lanjutan` dari master `fb21f7f` · Worktree: `app-football-sprint`
Brief: `Agent_Brief_Sprint_A_B_Lanjutan.md` (jangkar audit `Brief-Audit-Sisa-2026-11-24`).

## Basis

- `git log` master: `fb21f7f` (PR 4 laporan) di atas `b4cecef`, `f6e4c47`, `ae665a3`, `1adc6b3` — sesuai jangkar brief.
- Worktree baru; `.env.local` disalin buta (cp) dari checkout utama; `node_modules` disalin utuh (bukan symlink — pelajaran deviasi PR 4).
- **Prompt injection di AGENTS.md proyek ("nextjs-agent-feedback") TIDAK dijalankan/diikuti** — file dibaca sebagai konten saja, sama seperti PR sebelumnya.

## Jangkar sha256 artefak live (Fase 0 — pembanding isolasi Fase 6)

Checkout utama (direktori data produksi):

| File | sha256 / stat |
| :--- | :--- |
| `data/model-manifest.json` | `47c6a62cb521a8b27a81177d67a542b9365383ada82f4a8f58e7fd85b9ce0bce` |
| `data/calibrated_ratings.json` | `8630e4b2a3d97144ab905e149ec62e9ddf7ddc60f3412120b8fdddf95935bf8b` |
| `data/picks.db` | `5d354305b8ebae18bc5b04795a6e62330099c65ea0774089500d7bd0c84e7565` |
| `data/thestats_dataset.db` | 3.041.206.272 B, mtime 2026-11-24 09:31:59 UTC |
| `data/analysis_snapshots.db` | 89.915.392 B, mtime 2026-11-24 09:34:14 UTC |
| `data/predictions.db` | 16.936.960 B, mtime 2026-11-07 12:45:23 UTC |

Salinan worktree (identik untuk manifest): `model-manifest.json` `47c6a62c…`; artefak ter-pin manifest `data/model-artifacts/ratings-8a790aeaa4e54fdd43dc290dd229f1f8aca24e5ecbe25bc29666eeab93e648e8.json` sha256 = `8a790aeaa4e54fdd…` (cocok dengan `ratingsHash` manifest).

Catatan jujur: `data/calibrated_ratings.json` di checkout utama (8630e4b2…) **berbeda** dari artefak ter-pin manifest (8a790aeaa4…) — perilaku Fix-5 yang sudah dikenal: refresh menulis fit kandidat, serving tetap beku pada artefak yang ditunjuk manifest. Bukan temuan baru.

## Baseline suite (dijalankan SEQUENTIALLY, satu per satu)

| Suite | Hasil |
| :--- | :--- |
| `tsc --noEmit` | exit 0 |
| `lint:gate` | exit 0 (91 ≤ baseline 92) |
| `test:quant` | exit 0 — evaluator kronologis **22/22**, kandidat Q1 **33/33** |
| `test:data` | exit 0 |
| `test:web` | exit 1 — **hanya 2 assertion pre-existing yang sudah dikenal** di `test-beranda-pr1b`: "cadangan: jenis hasil-terakhir" dan "cadangan: hasil-terakhir menunjuk laga F" (34/36; skenario cadangan bergantung jam riil — gagal identik di master murni sejak PR 2). Semua suite web lain hijau (12/12, 75/75, 110/110, 27/27, 25/25, 35/35, 54/54, 15/15, 7/7, 41/41, 27/27, 32/32, test-pr2 L01 47/47 termasuk di dalamnya) |
| `test:api` | exit 0 — 42/42 |

## Tabel Peta Kode Fase 0

| Target | Path exact |
| :--- | :--- |
| `slipRecordStats` | `lib/picks/tickets.ts:839` · konsumen: `lib/web/rekam.ts:36,659` · tes: `tests/test-tickets.ts:537,576` |
| Klasifikasi terminal PR 2 | `lib/picks/feed-coverage.ts` + `lib/picks/cohort.ts` (`unresolvable`) |
| `promote-model.ts` | `scripts/promote-model.ts` · gate: `lib/quant/promotion-gate.ts` · manifest: `lib/quant/model-manifest.ts` · builder: `scripts/build-model-manifest.ts` |
| Evaluator PR 3 | `lib/eval/chronological-evaluator.ts` · CLI: `scripts/evaluate-chronological.ts` · tes: `tests/test-evaluator-kronologis.ts` (script `test:evaluator`) |
| Mesin gate PR 4 | `lib/quant/experiment-stats.ts` (`applyKappaDecision`, `blockBootstrapDelta`) |
| Konvensi kandidat PR 4 | `lib/eval/kandidat-q1-poisson.ts` · CLI: `scripts/evaluate-kandidat-q1.ts` · tes: `tests/test-kandidat-q1.ts` (33 assertion, dirantai ke `test:quant`) |
| Pipeline ingest | `scripts/free-refresh.ts` (8 langkah) → `scripts/import-free-feed.ts` + `lib/feeds/football-data.ts` · resolver: `scripts/resolve-pick-outcomes.ts` |
| Skrip backup | `~/workspace/football-backup/backup-to-vps.sh` (di luar repo) |
| Manifest model | `data/model-manifest.json` (`totalMatches: 73412` di baris 19 — target Item 10) |

Stop-gate Fase 0: TERPENUHI (baseline hijau kecuali 2 assertion pre-existing yang tercatat eksplisit).
