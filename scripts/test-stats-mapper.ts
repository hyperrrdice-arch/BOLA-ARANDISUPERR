/**
 * RUNNABLE CHECK — mapper stats → baris DB (dipakai sync:weekly + promosi).
 * Offline: pakai payload mentah dari `thestats_raw_vault.db` (nggak hit API).
 * Kalau mapping rusak, kedua skrip itu ikut rusak diam-diam.
 *
 * Jalankan: npx tsx scripts/test-stats-mapper.ts
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mapStatsToTelemetry } from "../lib/stats-log-mapper";

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

const vaultPath = "data/thestats_raw_vault.db";
if (!fs.existsSync(vaultPath)) {
  console.log("SKIP: data/thestats_raw_vault.db tidak ada (fresh clone / belum sync) — bukan regresi.");
  process.exit(0);
}
const vault = new DatabaseSync(vaultPath, { readOnly: true });
function payload(id: string): any {
  const row = vault.prepare("SELECT payload_json FROM raw_api_vault WHERE resource_id = ?").get(id) as any;
  return row ? JSON.parse(row.payload_json) : null;
}
const stats = payload("stats_mt_206118228")?.data ?? payload("stats_mt_206118228");
console.log("=== TEST STATS MAPPER (offline, dari vault) ===\n");
if (!stats) {
  console.log("SKIP: fixture stats_mt_206118228 tidak ada di vault (belum tersinkron) — bukan regresi.");
  vault.close();
  process.exit(0);
}
assert(!!stats, "payload stats ada di vault");

// Susun match dari kolom tabel dataset (bukan dari vault — match tidak disimpan di vault).
import { getTheStatsDb } from "../lib/db/thestats-dataset";
const ds = getTheStatsDb();
const mRow = ds.prepare("SELECT * FROM matches WHERE match_id = ?").get("mt_206118228") as any;
if (!mRow) {
  console.log("SKIP: baris match mt_206118228 tidak ada di dataset (belum tersinkron) — bukan regresi.");
  vault.close();
  process.exit(0);
}
assert(!!mRow, "baris match ada di dataset");

const mapped = mapStatsToTelemetry({ m: mRow, stats, competitionId: mRow.competition_id, seasonName: mRow.season });
assert(!!mapped, "mapping menghasilkan match + 2 log");
if (!mapped) {
  vault.close();
  process.exit(1);
}

const { match: outMatch, homeLog, awayLog } = mapped;
console.log(`\nmatch: ${outMatch.home_team_id} vs ${outMatch.away_team_id} → ${outMatch.home_score}-${outMatch.away_score} (${outMatch.status})`);
console.log(`home: xG ${homeLog.xg_for}  npxG ${homeLog.npxg_for}  shots ${homeLog.shots_for}  sot ${homeLog.shots_on_target_for}  poss ${homeLog.possession_pct}%`);
console.log(`away: xG ${awayLog.xg_for}  npxG ${awayLog.npxg_for}  shots ${awayLog.shots_for}  sot ${awayLog.shots_on_target_for}  poss ${awayLog.possession_pct}%`);

assert(outMatch.home_score === Number(mRow.home_score), "skor home cocok dengan baris matches");
assert(outMatch.away_score === Number(mRow.away_score), "skor away cocok dengan baris matches");
assert(homeLog.xg_for !== null, "xG home terisi (payload punya expected_goals)");
assert(homeLog.shots_for !== null, "shots home terisi");
assert(homeLog.raw_stats_json !== null && homeLog.raw_stats_json.length > 1000, "raw_stats_json utuh (>1KB)");
assert(homeLog.log_id === `${outMatch.match_id}_${homeLog.team_id}`, "log_id home format matchId_teamId");
assert(awayLog.log_id === `${outMatch.match_id}_${awayLog.team_id}`, "log_id away benar");
assert(homeLog.opponent_id === awayLog.team_id && awayLog.opponent_id === homeLog.team_id, "opponent saling tukar");
assert(homeLog.result === (homeLog.goals_for > homeLog.goals_against ? "W" : homeLog.goals_for === homeLog.goals_against ? "D" : "L"), "result home konsisten dengan skor");
assert(awayLog.result === (awayLog.goals_for > awayLog.goals_against ? "W" : awayLog.goals_for === awayLog.goals_against ? "D" : "L"), "result away konsisten");
assert(homeLog.venue === "HOME" && awayLog.venue === "AWAY", "venue benar");

// Kontrak ketat: nggak ada kolom 0-karangan — null boleh, 0 palsu tidak.
assert(homeLog.possession_pct !== 0 || homeLog.possession_pct === null, "possession 0 tidak boleh karangan");
assert(homeLog.shots_on_target_for === null || homeLog.shots_on_target_for <= homeLog.shots_for, "sot <= shots");

// Kontrak jujur: skor/status absen → return null (bukan 0-0 / "finished" karangan).
const noScore = { ...mRow, home_score: null, away_score: null };
assert(
  mapStatsToTelemetry({ m: noScore, stats, competitionId: mRow.competition_id, seasonName: mRow.season }) === null,
  "skor keduanya absen → return null (bukan 0-0)"
);
const oneScoreMissing = { ...mRow, away_score: null };
assert(
  mapStatsToTelemetry({ m: oneScoreMissing, stats, competitionId: mRow.competition_id, seasonName: mRow.season }) === null,
  "salah satu skor absen → return null"
);
const noStatus = { ...mRow, status: null };
assert(
  mapStatsToTelemetry({ m: noStatus, stats, competitionId: mRow.competition_id, seasonName: mRow.season }) === null,
  "status absen → return null (bukan 'finished' karangan)"
);

vault.close();
console.log(`\n=== ${passed} lulus, ${failed} gagal ===`);
process.exit(failed > 0 ? 1 : 0);