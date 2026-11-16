# tasks/ — folder kerja football-agent

Dirapikan 2026-11-16 lewat sensus referensi penuh (repo + cron): hanya file yang
tidak dirujuk path mana pun yang dipindah. Isi semua file tidak pernah diubah.

## Level atas = file LIVE / terujuk — jangan dipindah tanpa sensus ulang

- **Ditulis/dibaca rantai refresh & skrip:** `pick-slate-latest.json` / `.md`,
  `free-import-unmatched.json` (juga dibaca cron `football-free-refresh`),
  `team-canonical-report.md`, `telemetry-canonical-report.md`,
  `coverage-latest.md`, `oos-results.json`, `oos-gate.json`, `cup-oos.json`,
  `cup-form-blend-oos.json`, `tier-table.json`, `parlay-lab-results.json`,
  `parlay-lab-report.md`, `pick-engine-acceptance.json`, `closing-benchmark.*`,
  `e2e-*.json`, `telemetry-*.json`, dan snapshot berpola tulis skrip
  (`form-snapshot-*.json`, `luck-snapshot-*.json`).
- **Dirujuk dokumen** (`ARCHITECTURE.md`, `STRUCTURE.md`, `docs/`):
  `db-audit-report.md`, `free-mode-report.md`, laporan-laporan fase awal, dll.
- **Saling merujuk antar-file tasks/ lewat path penuh `tasks/<nama>`:**
  `db-audit-worklog.md`, `cup-form-blend-report.md`,
  `cup-form-blend-fenerbahce.json`, `cup-form-blend-fenerbahce-inputs.json`,
  `slate-review-uel-uecl-2026-11-06.md`, `uel-uecl-resolutions-2026-11-06.json`,
  `oos-results-pre-t5-2026-11-09.json`.
- **Catatan kerja manusia:** `plan.md`, `todo.md`, `backend-flow-map.md`,
  `backend-readonly-hashes.txt`.

## reports/

Laporan fase/audit/catatan sesi satu kali yang tidak dirujuk path mana pun
(9 file per 2026-11-16, termasuk laporan Fase 0 dan perbaikan Celta).

## evidence/

Bukti run berbentuk JSON/txt (snapshot, dump paket, hasil uji) yang tidak
dirujuk path mana pun. Per 2026-11-16 masih kosong — semua kandidat bukti
ternyata saling merujuk atau dirujuk file live, jadi tetap di level atas.

## Konvensi ke depan

- Laporan baru → `reports/`
- Bukti/hasil run baru → `evidence/`
- File yang dibaca/ditulis skrip, cron, atau dokumen → tetap di level atas.
