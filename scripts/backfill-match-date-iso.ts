/**
 * TASK 9 — plan-data-coverage.md: backfill `team_match_logs.match_date` ke ISO penuh.
 *
 * Sumber: `matches.utc_date` (sumber nyata — BUKAN tebakan). Idempotent: hanya
 * baris berformat 10-digit yang diubah. Baris tanpa pasangan di `matches`
 * dibiarkan apa adanya + dilaporkan (dilarang mengarang).
 *
 * Jalankan: npx tsx scripts/backfill-match-date-iso.ts
 */
import { getTheStatsDb } from "../lib/db/thestats-dataset";

function main() {
  const db = getTheStatsDb();
  const before = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE length(match_date) = 10").get() as any).c as number;
  const upd = db
    .prepare(`
      UPDATE team_match_logs
      SET match_date = (SELECT m.utc_date FROM matches m WHERE m.match_id = team_match_logs.match_id)
      WHERE length(match_date) = 10
        AND EXISTS (SELECT 1 FROM matches m WHERE m.match_id = team_match_logs.match_id)
    `)
    .run();
  const orphan = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE length(match_date) = 10").get() as any).c as number;

  console.log(`[backfill match_date] ${before} baris 10-digit → ${upd.changes} diisi ISO dari matches.utc_date`);
  if (orphan > 0) {
    console.log(`⚠️ ${orphan} baris TANPA pasangan di matches — dibiarkan apa adanya (jangan ditebak)`);
    process.exitCode = 1;
  } else {
    console.log("✅ semua match_date kini ISO penuh");
  }
}

main();
