// ============================================================================
// IMPORT HASIL football-data.org v4 (Item 7, Sprint C Fase 3)
// ----------------------------------------------------------------------------
// Sumber hasil KEDUA untuk kompetisi terpetakan (12 kompetisi papan atas
// v4; 8 terpetakan ke divisi proyek di FDORG_CODE_TO_DIV). Menarik laga
// FINISHED per kompetisi dengan X-Auth-Token, guard <= 9 req/menit +
// hormati HTTP 429, lalu menerapkan precedence/revisi/available_at lewat
// lib/feeds/fdorg-results.ts (mesin identitas D2 repo).
//
// Env: FOOTBALL_DATA_API_TOKEN (nama yang dikunci brief Sprint C — beda
// dari FOOTBALL_DATA_ORG_TOKEN milik importer fixture fdorg lama, yang
// tidak diubah). Tanpa token: script berhenti dengan pesan jujur
// WAITING_OWNER_TOKEN dan exit 0 (tidak ada fetch yang direka).
// ============================================================================
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  FDORG_CODE_TO_DIV,
  FdorgRateLimiter,
  applyFdorgResults,
  fetchFdorgFinishedMatches,
  parseFdorgFinishedMatches,
  type FdorgApplySummary,
} from "../lib/feeds/fdorg-results";
import { recordIngestAttempt } from "../lib/feeds/ingest-freshness";

async function main(): Promise<void> {
  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    console.log(
      "[fdorg-results] FOOTBALL_DATA_API_TOKEN belum terpasang — WAITING_OWNER_TOKEN. " +
        "Tidak ada fetch yang dijalankan. (Importer fixture lama memakai FOOTBALL_DATA_ORG_TOKEN; tidak diubah.)",
    );
    return;
  }
  const nowUtc = new Date().toISOString();
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  try {
    recordIngestAttempt(ds, "football-data-org", nowUtc);
    const limiter = new FdorgRateLimiter();
    const fetchFn = globalThis.fetch.bind(globalThis);
    const totals: FdorgApplySummary = {
      applied: 0, duplicates: 0, corrected: 0, conflicts_primary_kept: 0,
      identity_ambiguous: 0, unmapped_competition: 0, unmapped_team: 0, rows_written: 0,
    };
    let skippedBasis = 0;
    let skippedStatus = 0;
    for (const code of Object.keys(FDORG_CODE_TO_DIV)) {
      const payload = await fetchFdorgFinishedMatches(fetchFn, token, code, limiter);
      const parsed = parseFdorgFinishedMatches(payload, code);
      skippedBasis += parsed.skipped_basis;
      skippedStatus += parsed.skipped_status;
      const s = applyFdorgResults(ds, parsed.results, new Date().toISOString());
      for (const k of Object.keys(totals) as (keyof FdorgApplySummary)[]) {
        totals[k] += s[k];
      }
      console.log(
        `[fdorg-results] ${code}: parsed=${parsed.results.length} applied=${s.applied} dup=${s.duplicates} ` +
          `corrected=${s.corrected} conflict_primary_kept=${s.conflicts_primary_kept} ` +
          `unmapped_team=${s.unmapped_team} ambiguous=${s.identity_ambiguous}`,
      );
    }
    console.log(
      `[fdorg-results] SELESAI applied=${totals.applied} dup=${totals.duplicates} corrected=${totals.corrected} ` +
        `conflict_primary_kept=${totals.conflicts_primary_kept} unmapped_team=${totals.unmapped_team} ` +
        `unmapped_comp=${totals.unmapped_competition} ambiguous=${totals.identity_ambiguous} ` +
        `rows_written=${totals.rows_written} skipped_basis=${skippedBasis} skipped_status=${skippedStatus}`,
    );
  } finally {
    ds.close();
  }
}

main().catch((e) => {
  console.error("[fdorg-results] GAGAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
