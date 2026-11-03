# Archive — Sisa Pipeline Lama & Eksplorasi One-Off

Folder ini berisi artefak yang **tidak lagi dipakai pipeline aktif** (planner loop `lib/agent/*`).
Tidak ada yang dihapus — semua dipindah dari root pada cleanup PLAN-D (Okt 2026).

## Isi

| Folder | Asal | Isi | Cara pakai lagi |
|---|---|---|---|
| `legacy-docs/` | root | Dokumen review/notes/PRD lama: `analisisdeepseek.md`, `DATABASE_REVIEW_PREMIER_LEAGUE.md`, `FOUNDATION_REVIEW.md`, `GIT_PUSH_BRIEF.md`, `VERSION_1{,.1,.2,.3}_NOTES.md`, `prd_frontend_v2_high_taste_modern_minimalist_motion.md`, `subagents.md`, `llms.md` (dump dokumen model, 297KB), `1xBet API Docummentation.txt`, `1xBET.txt`, `ARCHITECTURE.md` (arsitektur pipeline lama) | Baca langsung; dokumentasi pipeline baru ada di `/ARCHITECTURE.md` |
| `legacy-backups/` | root + `scripts/` | Snapshot source penuh `backup_v1/`–`backup_v1.3/` (~45MB), zip rilis `football-agent-v1.0.0.zip`–`v1.3.0.zip` (~12MB), script `create_backup_v1*.js` / `restore_v1*.js` | Restore manual: jalankan `node archive/legacy-backups/restore_v1_3.js` dari root setelah sesuaikan path di dalam script (script menulis ke lokasi root) |
| `legacy-scripts/` | `scripts/` | ~50 script debug/eksplorasi one-off (`check-*`, `inspect-*`, `probe-*`, `print-*`, `display/list/show-*`, `get-*`, `find-*`, `query-*`, `read-*`, `fix-*`, `run-xemarux-*`, `verify-*`, `test-*` lama, `quant-*-diagnostic/simulation`) | `npx tsx archive/legacy-scripts/<nama>.ts` (sebagian butuh env lama) |
| `legacy-api/` | `app/api/test/` | Health-check endpoint lama (`{status:"ok"}`) tanpa pemanggil | Kembalikan ke `app/api/test/` bila butuh smoke-check endpoint |
| `legacy-lib/` | `lib/` | `league-mapping.ts` (nol importer), `db/index.ts` (barrel mati) | Import langsung bila suatu saat perlu |

## Yang sengaja TIDAK ikut (masih aktif)

- Pipeline baru: `lib/agent/**`, `app/api/agent/route.tsx`, `scripts/test-planner-*.ts`
- Operasional: `scripts/sync-weekly-telemetry.ts`, `ingest-*.ts`, `backup-db.ts`, `calibrate-ratings.ts`, `migrate-schema.ts`, `update-scores.js`, `fetch-missing-squads.ts`
- Workstream kuantitatif: `scripts/backtest-dixon-coles.ts` (shared lib, 7 importer) + seluruh script `task*`/`track-c`/`ucl`
- `app/api/betting` + `app/api/odds` (legacy-live, masih melayani kartu dashboard — dirapikan, tidak diarsipkan)
