/**
 * TASK 7 — plan-data-coverage.md: ENRICHMENT (injuries, skuad, referee).
 *
 *   (a) Injuries: SEMUA tim di `teams` → `/football/teams/{id}/injuries-suspensions`
 *       (vault `injuries_{teamId}`, refresh 12 jam → snapshot bertanggal hari ini)
 *       + update `team_squads.injury_status` (format sama dengan sync-weekly).
 *   (b) Skuad kurang: tim dengan <20 pemain → `/football/teams/{id}/players`.
 *   (c) Referee: laga hari ini (upcoming store) → vault `referee_{matchId}` —
 *       dipakai `promote-upcoming-to-telemetry.ts` saat menulis baris match.
 *
 * Data apa adanya dari API (kosong = kosong). Idempotent lewat vault dedupe.
 * Jalankan: npx tsx scripts/enrich-injuries-referee.ts
 */
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

import { getTheStatsDb, upsertSquadPlayer } from "../lib/db/thestats-dataset";
import { getUpcomingDb } from "../lib/db/upcoming-fixtures";
import { getRawPayload } from "../lib/db/thestats-vault";
import { statsFetch } from "../lib/stats-fetch";
import { remainingBudget, API_BUDGET_TOTAL } from "../lib/api-budget";

const RATE_PAUSE_MS = 1000;
const INJ_MAX_AGE = 12 * 3600 * 1000; // snapshot hari ini
const MIN_SQUAD = 20;
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = getTheStatsDb();
  const teams = db.prepare("SELECT team_id, name FROM teams ORDER BY name").all() as any[];
  console.log(`🏥 [INJURIES] snapshot ${teams.length} tim`);

  // ───────────────────── (a) Injuries semua tim ─────────────────────
  let injOk = 0;
  let injEmpty = 0;
  for (const t of teams) {
    const res: any = await statsFetch(
      `/football/teams/${t.team_id}/injuries-suspensions`,
      null,
      `injuries_${t.team_id}`,
      "injuries",
      { maxAgeMs: INJ_MAX_AGE, retries: 5 }
    );
    const list: any[] = res?.data?.injuries ?? [];
    if (res && list.length === 0) {
      injEmpty++; // API bilang memang tidak ada yang cedera — data apa adanya
    }
    if (res) injOk++;
    // Update status cedera (hanya pemain yang disebut — jangan reset yang lain).
    for (const inj of list) {
      const pId = inj.player_id || inj.player?.id;
      if (!pId) continue;
      const reason = (inj.reason || inj.type || "injury").replace(/_/g, " ").toUpperCase();
      const statusStr = `INJURED: ${reason} (${inj.status || "out"})`;
      db.prepare("UPDATE team_squads SET injury_status = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?").run(statusStr, pId);
    }
    await sleep(RATE_PAUSE_MS);
    if ((injOk + injEmpty) % 25 === 0) console.log(`  -> ${injOk + injEmpty}/${teams.length} | sisa budget ${remainingBudget()}`);
  }
  console.log(`✅ Injuries: ${injOk} tim ter-snapshot (${injEmpty} tanpa cedera)`);

  // ───────────────────── (b) Skuad kurang ─────────────────────
  const thinSquads = db
    .prepare(`
      SELECT t.team_id, t.name, count(s.player_id) AS n
      FROM teams t LEFT JOIN team_squads s ON s.team_id = t.team_id
      GROUP BY t.team_id HAVING n < ${MIN_SQUAD}
      ORDER BY n ASC
    `)
    .all() as any[];
  console.log(`\n👟 [SKUAD] ${thinSquads.length} tim dengan <${MIN_SQUAD} pemain`);

  for (const t of thinSquads) {
    const res: any = await statsFetch(`/football/teams/${t.team_id}/players`, null, `players_${t.team_id}`, "players", {
      maxAgeMs: INJ_MAX_AGE,
      retries: 5,
    });
    const players: any[] = Array.isArray(res?.data) ? res.data : [];
    if (players.length === 0) {
      console.warn(`  ⚠️ ${t.name}: API tidak mengembalikan pemain — dibiarkan kosong`);
      await sleep(RATE_PAUSE_MS);
      continue;
    }
    // Status cedera dari snapshot injuries (vault) — 0 request tambahan.
    const injMap = new Map<string, string>();
    const injPayload: any = getRawPayload(`injuries_${t.team_id}`);
    for (const inj of injPayload?.data?.injuries ?? []) {
      const pId = inj.player_id || inj.player?.id;
      if (pId) {
        const reason = (inj.reason || inj.type || "injury").replace(/_/g, " ").toUpperCase();
        injMap.set(String(pId), `INJURED: ${reason} (${inj.status || "out"})`);
      }
    }
    for (const p of players) {
      upsertSquadPlayer({
        player_id: p.id,
        team_id: t.team_id,
        name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        jersey_number: p.current_team?.jersey_number ?? p.jersey_number,
        age: p.age,
        nationality: p.nationality,
        market_value: p.market_value,
        preferred_foot: p.preferred_foot,
        injury_status: injMap.get(String(p.id)) || "FIT",
        is_active: 1,
      });
    }
    console.log(`  -> ${t.name}: ${players.length} pemain`);
    await sleep(RATE_PAUSE_MS);
  }

  // ───────────────────── (c) Referee laga hari ini ─────────────────────
  const up = getUpcomingDb();
  const todayFixtures = up
    .prepare("SELECT match_id, home_team_name, away_team_name FROM upcoming_fixtures WHERE utc_date LIKE ?")
    .all(`${TODAY}%`) as any[];
  console.log(`\n🟨 [REFEREE] ${todayFixtures.length} laga hari ini (${TODAY})`);

  let refOk = 0;
  let refMissing = 0;
  for (const f of todayFixtures) {
    const res: any = await statsFetch(`/football/matches/${f.match_id}/referee`, null, `referee_${f.match_id}`, "referee", {
      retries: 4,
    });
    if (res) refOk++;
    else refMissing++;
    await sleep(RATE_PAUSE_MS);
  }
  console.log(`✅ Referee: ${refOk} tersimpan di vault, ${refMissing} tidak tersedia (404 — jalankan lagi mendekati kickoff)`);

  console.log(`\n🎉 [TASK 7 SELESAI] sisa budget: ${remainingBudget()} dari ${API_BUDGET_TOTAL}`);
}

main().catch((err) => {
  console.error("[enrich-injuries-referee] gagal:", err);
  process.exit(1);
});
