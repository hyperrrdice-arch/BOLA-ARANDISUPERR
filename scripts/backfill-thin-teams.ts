/**
 * TASK 6 — plan-data-coverage.md: TUNTASKAN TIM TIPIS + BACKFILL xG.
 *
 *   (a) Log dengan `xg_for IS NULL`: force-refresh payload stats dari API
 *       (bukan cache), remap. Kalau API tetap tidak punya xG → DINYATAKAN
 *       "sumber kosong", TANPA imputasi. Kolom terisi tidak boleh jadi NULL.
 *   (b) Tim dengan <6 log finished: listing `?team_id=X&status=finished`
 *       (1 req/tim) → ambil stats match yang belum ada sampai tim mencapai 6 log.
 *       Semua dari sumber nyata; skip match tanpa skor (mapper return null).
 *
 * Idempotent: kedua bagian melewatkan yang sudah beres tanpa fetch.
 * Jalankan: npx tsx scripts/backfill-thin-teams.ts
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import {
  getTheStatsDb,
  upsertTeam,
  upsertMatch,
  upsertTeamMatchLog,
} from "../lib/db/thestats-dataset";
import { mapStatsToTelemetry } from "../lib/stats-log-mapper";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const RATE_PAUSE_MS = 1000;
const TARGET_LOGS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seasonOf = (utc: string) => (utc >= "2026-08-01" ? "2026/2027" : "2025/2026");

function remapAndUpsert(db: any, matchRow: any, statsData: any, homeName: string | null, awayName: string | null): boolean {
  const mapped = mapStatsToTelemetry({
    // Baris dataset pakai `match_id`, listing API pakai `id` — samakan dulu.
    m: { ...matchRow, id: matchRow.id ?? matchRow.match_id },
    stats: statsData,
    competitionId: matchRow.competition_id ?? matchRow.competitionId,
    seasonName: matchRow.season ?? seasonOf(matchRow.utc_date),
  });
  if (!mapped) return false;
  const homeId = String(mapped.homeLog.team_id);
  const awayId = String(mapped.awayLog.team_id);
  if (!db.prepare("SELECT 1 FROM teams WHERE team_id = ?").get(homeId)) {
    upsertTeam({ team_id: homeId, name: homeName ?? homeId });
  }
  if (!db.prepare("SELECT 1 FROM teams WHERE team_id = ?").get(awayId)) {
    upsertTeam({ team_id: awayId, name: awayName ?? awayId });
  }
  upsertMatch(mapped.match);
  upsertTeamMatchLog(mapped.homeLog);
  upsertTeamMatchLog(mapped.awayLog);
  return true;
}

async function main() {
  const db = getTheStatsDb();

  // ───────────────── (a) Backfill xG yang hilang ─────────────────
  const missIds = (
    db.prepare("SELECT DISTINCT match_id FROM team_match_logs WHERE xg_for IS NULL").all() as any[]
  ).map((r) => String(r.match_id));
  console.log(`🔬 [XG BACKFILL] ${missIds.length} match dengan log tanpa xG`);

  const stillMissing: string[] = [];
  for (const matchId of missIds) {
    // Force refresh (maxAgeMs=1 → cache lama tidak dipakai ulang).
    const raw: any = await statsFetch(`/football/matches/${matchId}/stats`, null, `stats_${matchId}`, "stats", {
      maxAgeMs: 1,
      retries: 5,
    });
    const statsData = raw?.data ?? raw ?? null;
    const mRow = db.prepare("SELECT * FROM matches WHERE match_id = ?").get(matchId) as any;
    const hasXg = statsData?.overview?.expected_goals != null || statsData?.xg != null;
    if (!mRow) {
      stillMissing.push(matchId);
      console.warn(`  ⚠️ ${matchId}: baris matches tidak ada — dibiarkan`);
    } else if (!hasXg) {
      stillMissing.push(matchId);
      console.warn(`  ⚠️ ${matchId}: API tetap tanpa expected_goals → SUMBER KOSONG, tidak diimputasi`);
    } else {
      remapAndUpsert(db, mRow, statsData, null, null);
      console.log(`  ✅ ${matchId}: xG terisi dari payload segar`);
    }
    await sleep(RATE_PAUSE_MS);
  }

  // Verifikasi: kolom yang sudah terisi tidak boleh jadi NULL (guardrail 7).
  const nullAfter = (db.prepare("SELECT count(*) c FROM team_match_logs WHERE xg_for IS NULL").get() as any).c as number;
  console.log(`   log tanpa xG tersisa: ${nullAfter} (sumber kosong apa adanya)`);

  // ───────────────── (b) Tim tipis → 6 log ─────────────────
  const thin = db
    .prepare(`
      SELECT t.team_id, t.name, count(l.log_id) AS n
      FROM teams t LEFT JOIN team_match_logs l ON l.team_id = t.team_id
      GROUP BY t.team_id HAVING n < ${TARGET_LOGS}
      ORDER BY n ASC
    `)
    .all() as any[];
  console.log(`\n🩹 [TIM TIPIS] ${thin.length} tim di bawah ${TARGET_LOGS} log`);

  const knownLogs = new Set(
    (db.prepare("SELECT DISTINCT match_id FROM team_match_logs").all() as any[]).map((r) => String(r.match_id))
  );

  for (const t of thin) {
    let logCount = Number(t.n);
    // Listing per tim: 1 request per 100 match (murah). team_id di luar 7 kompetisi
    // tetap sah — ini observasi nyata untuk form tim.
    const listing: any = await statsFetch(
      "/football/matches",
      { team_id: t.team_id, status: "finished", per_page: 100, page: 1 },
      `team_list_${t.team_id}_p1`,
      "matches",
      { maxAgeMs: 6 * 3600 * 1000 }
    );
    const rows: any[] = Array.isArray(listing?.data) ? listing.data : [];
    if (rows.length === 0) {
      console.warn(`  ⚠️ ${t.name}: listing team kosong / team_id tidak didukung — tidak ada sumber tambahan`);
      continue;
    }
    // Terbaru dulu, belum ada di dataset, selesai, abad 21 (hindari arsip aneh).
    const candidates = rows
      .filter((m) => m?.status === "finished" && m.utc_date && !knownLogs.has(String(m.id)))
      .sort((a, b) => Date.parse(b.utc_date) - Date.parse(a.utc_date));

    for (const m of candidates) {
      if (logCount >= TARGET_LOGS) break;
      const raw: any = await statsFetch(`/football/matches/${m.id}/stats`, null, `stats_${m.id}`, "stats", { retries: 5 });
      const statsData = raw?.data ?? raw ?? null;
      const ok = remapAndUpsert(db, { ...m, competitionId: m.competition_id }, statsData, m.home_team?.name ?? null, m.away_team?.name ?? null);
      if (ok) {
        knownLogs.add(String(m.id));
        logCount += 2;
      } else {
        console.warn(`  ⚠️ ${m.id}: skor/status absen — skip, TIDAK dikarang`);
      }
      await sleep(RATE_PAUSE_MS);
    }
    console.log(`  -> ${t.name}: ${logCount} log (target ${TARGET_LOGS})`);
  }

  const thinAfter = db
    .prepare(`
      SELECT count(*) c FROM (
        SELECT t.team_id FROM teams t LEFT JOIN team_match_logs l ON l.team_id = t.team_id
        GROUP BY t.team_id HAVING count(l.log_id) < ${TARGET_LOGS}
      )
    `)
    .get() as any;
  console.log(`\n🎉 [TASK 6 SELESAI]`);
  console.log(`- Tim <${TARGET_LOGS} log tersisa: ${thinAfter.c} (laporkan apa adanya kalau memang tidak ada sumber)`);
  console.log(`- Log tanpa xG tersisa: ${nullAfter} (sumber kosong, TANPA imputasi)`);
  console.log(`- Sisa budget: ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
}

main().catch((err) => {
  console.error("[backfill-thin-teams] gagal:", err);
  process.exit(1);
});
