import {
  getTheStatsDb,
  upsertTeam,
  upsertSquadPlayer,
  upsertMatch,
  upsertTeamMatchLog,
  type TeamRecord,
  type SquadPlayerRecord,
  type MatchMetaRecord,
  type TeamMatchLogRecord,
} from "../lib/db/thestats-dataset";
import {
  saveRawPayload,
  getRawPayload,
  hasRawPayload,
} from "../lib/db/thestats-vault";
import { TARGET_COMPETITIONS, TheStatsCompetitionConfig } from "../lib/thestats-competitions";

// Auto-load .env.local jika tersedia di Node.js runtime
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(".env.local");
  }
} catch {}

const API_BASE = "https://api.thestatsapi.com/api";

const apiKey = process.env.STATS_API_KEY;
if (!apiKey) {
  console.error("[CRITICAL ERROR] STATS_API_KEY tidak ditemukan di environment!");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let apiCallsCount = 0;
let retryAttemptsCount = 0;

async function fetchWithStrictRetry(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const MAX_RETRIES = 6;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    apiCallsCount++;
    await sleep(850); // Politeness delay: ~70 req/menit

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.status === 429) {
        retryAttemptsCount++;
        const waitMs = Math.min(30000, attempt * 7000);
        console.warn(`⚠️ [HTTP 429 Rate Limit] Menunggu ${waitMs / 1000}s sebelum retry (${attempt}/${MAX_RETRIES})...`);
        await sleep(waitMs);
        continue;
      }

      if (res.status === 404) return null;

      if (!res.ok) {
        retryAttemptsCount++;
        const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
        console.warn(`⚠️ [HTTP ${res.status}] ${path}. Backoff ${backoffMs}ms...`);
        await sleep(backoffMs);
        continue;
      }

      return await res.json();
    } catch (e: any) {
      retryAttemptsCount++;
      const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
      console.warn(`⚠️ [Network Error] ${path}: ${e.message}. Retry dalam ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }

  console.error(`❌ [FAILED] Gagal fetch ${path} setelah ${MAX_RETRIES} percobaan.`);
  return null;
}

export async function syncWeeklyDelta(daysLookback: number = 8) {
  console.log("================================================================================");
  console.log(`🔄 [WEEKLY TELEMETRY BATCH SYNC] Memeriksa Delta Laga Selesai (${daysLookback} Hari Terakhir)`);
  console.log("================================================================================");

  const db = getTheStatsDb();
  const cutoffDate = new Date(Date.now() - daysLookback * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let newMatchesSynced = 0;
  let newLogsSynced = 0;
  let injuriesRefreshed = 0;

  const affectedTeamIds = new Set<string>();

  for (const comp of Object.values(TARGET_COMPETITIONS)) {
    console.log(`\n🔍 Memeriksa jadwal selesai baru: ${comp.name} (Cutoff: >= ${cutoffDate})...`);

    // Selalu refresh endpoint daftar matches terbaru
    const matchesRes = await fetchWithStrictRetry("/football/matches", {
      competition_id: comp.id,
      status: "finished",
      per_page: 50,
      page: 1,
    });

    const pageMatches: any[] = matchesRes?.data || [];
    const recentMatches = pageMatches.filter((m: any) => {
      const matchDate = m.utc_date ? m.utc_date.slice(0, 10) : "";
      return matchDate >= cutoffDate;
    });

    console.log(`-> Ditemukan ${recentMatches.length} laga dalam ${daysLookback} hari terakhir.`);

    for (const m of recentMatches) {
      const matchId = m.id;
      const homeId = m.home_team?.id;
      const awayId = m.away_team?.id;
      if (homeId) affectedTeamIds.add(homeId);
      if (awayId) affectedTeamIds.add(awayId);

      // Cek apakah sudah ada log-nya di database
      const existing = db.prepare("SELECT log_id FROM team_match_logs WHERE match_id = ? LIMIT 1").get(matchId);
      if (existing) {
        // Sudah ada di DB, lewati fetch stats untuk hemat kuota!
        continue;
      }

      console.log(`  📥 Mengambil data telemetry laga baru: ${m.home_team?.name} vs ${m.away_team?.name} (${m.utc_date?.slice(0, 10)})`);

      const statsRes = await fetchWithStrictRetry(`/football/matches/${matchId}/stats`);
      const lineupsRes = await fetchWithStrictRetry(`/football/matches/${matchId}/lineups`);

      if (statsRes) saveRawPayload("stats", `stats_${matchId}`, statsRes);
      if (lineupsRes) saveRawPayload("lineups", `lineups_${matchId}`, lineupsRes);

      const statsData = statsRes?.data || null;
      const lineupsData = lineupsRes?.data || null;

      const homeScore = Number(m.score?.home ?? m.home_score ?? 0);
      const awayScore = Number(m.score?.away ?? m.away_score ?? 0);

      upsertMatch({
        match_id: matchId,
        competition_id: comp.id,
        season: comp.seasonName,
        utc_date: m.utc_date,
        status: m.status,
        home_team_id: homeId,
        away_team_id: awayId,
        home_score: homeScore,
        away_score: awayScore,
      });

      const homeResult: "W" | "D" | "L" = homeScore > awayScore ? "W" : homeScore === awayScore ? "D" : "L";
      const awayResult: "W" | "D" | "L" = awayScore > homeScore ? "W" : homeScore === awayScore ? "D" : "L";

      const ov = statsData?.overview;
      const sh = statsData?.shots;
      const att = statsData?.attack;
      const pass = statsData?.passes;
      const du = statsData?.duels;
      const def = statsData?.defending;
      const gk = statsData?.goalkeeping;
      const npxg = statsData?.np_expected_goals;
      const rawJsonStr = statsData ? JSON.stringify(statsData) : null;

      // Home Log
      const homeLog: TeamMatchLogRecord = {
        log_id: `${matchId}_${homeId}`,
        match_id: matchId,
        team_id: homeId,
        opponent_id: awayId,
        venue: "HOME",
        match_date: m.utc_date ? m.utc_date.slice(0, 10) : "",
        season: comp.seasonName,
        result: homeResult,
        goals_for: homeScore,
        goals_against: awayScore,
        xg_for: ov?.expected_goals?.all?.home ?? statsData?.xg?.home ?? null,
        xg_against: ov?.expected_goals?.all?.away ?? statsData?.xg?.away ?? null,
        npxg_for: npxg?.all?.home ?? null,
        npxg_against: npxg?.all?.away ?? null,
        shots_for: sh?.total_shots?.all?.home ?? ov?.total_shots?.all?.home ?? null,
        shots_against: sh?.total_shots?.all?.away ?? ov?.total_shots?.all?.away ?? null,
        shots_on_target_for: sh?.shots_on_target?.all?.home ?? ov?.shots_on_target?.all?.home ?? null,
        shots_on_target_against: sh?.shots_on_target?.all?.away ?? ov?.shots_on_target?.all?.away ?? null,
        big_chances_for: ov?.big_chances?.all?.home ?? null,
        big_chances_against: ov?.big_chances?.all?.away ?? null,
        touches_in_penalty_area_for: att?.touches_in_penalty_area?.all?.home ?? null,
        touches_in_penalty_area_against: att?.touches_in_penalty_area?.all?.away ?? null,
        possession_pct: ov?.ball_possession?.all?.home ?? null,
        passes_accurate_for: ov?.accurate_passes?.all?.home ?? pass?.accurate_passes?.all?.home ?? null,
        passes_accurate_against: ov?.accurate_passes?.all?.away ?? pass?.accurate_passes?.all?.away ?? null,
        accurate_crosses_for: pass?.accurate_crosses?.all?.home ?? null,
        accurate_crosses_against: pass?.accurate_crosses?.all?.away ?? null,
        aerial_duels_pct_for: du?.aerial_duels_percentage?.all?.home ?? null,
        aerial_duels_pct_against: du?.aerial_duels_percentage?.all?.away ?? null,
        corners_for: ov?.corner_kicks?.all?.home ?? null,
        corners_against: ov?.corner_kicks?.all?.away ?? null,
        yellow_cards: ov?.yellow_cards?.all?.home ?? null,
        red_cards: ov?.red_cards?.all?.home ?? null,
        saves_for: gk?.saves?.all?.home ?? ov?.goalkeeper_saves?.all?.home ?? null,
        saves_against: gk?.saves?.all?.away ?? ov?.goalkeeper_saves?.all?.away ?? null,
        raw_stats_json: rawJsonStr,
      };

      // Away Log
      const awayLog: TeamMatchLogRecord = {
        log_id: `${matchId}_${awayId}`,
        match_id: matchId,
        team_id: awayId,
        opponent_id: homeId,
        venue: "AWAY",
        match_date: m.utc_date ? m.utc_date.slice(0, 10) : "",
        season: comp.seasonName,
        result: awayResult,
        goals_for: awayScore,
        goals_against: homeScore,
        xg_for: ov?.expected_goals?.all?.away ?? statsData?.xg?.away ?? null,
        xg_against: ov?.expected_goals?.all?.home ?? statsData?.xg?.home ?? null,
        npxg_for: npxg?.all?.away ?? null,
        npxg_against: npxg?.all?.home ?? null,
        shots_for: sh?.total_shots?.all?.away ?? ov?.total_shots?.all?.away ?? null,
        shots_against: sh?.total_shots?.all?.home ?? ov?.total_shots?.all?.home ?? null,
        shots_on_target_for: sh?.shots_on_target?.all?.away ?? ov?.shots_on_target?.all?.away ?? null,
        shots_on_target_against: sh?.shots_on_target?.all?.home ?? ov?.shots_on_target?.all?.home ?? null,
        big_chances_for: ov?.big_chances?.all?.away ?? null,
        big_chances_against: ov?.big_chances?.all?.home ?? null,
        touches_in_penalty_area_for: att?.touches_in_penalty_area?.all?.away ?? null,
        touches_in_penalty_area_against: att?.touches_in_penalty_area?.all?.home ?? null,
        possession_pct: ov?.ball_possession?.all?.away ?? null,
        passes_accurate_for: ov?.accurate_passes?.all?.away ?? pass?.accurate_passes?.all?.away ?? null,
        passes_accurate_against: ov?.accurate_passes?.all?.home ?? pass?.accurate_passes?.all?.home ?? null,
        accurate_crosses_for: pass?.accurate_crosses?.all?.away ?? null,
        accurate_crosses_against: pass?.accurate_crosses?.all?.home ?? null,
        aerial_duels_pct_for: du?.aerial_duels_percentage?.all?.away ?? null,
        aerial_duels_pct_against: du?.aerial_duels_percentage?.all?.home ?? null,
        corners_for: ov?.corner_kicks?.all?.away ?? null,
        corners_against: ov?.corner_kicks?.all?.home ?? null,
        yellow_cards: ov?.yellow_cards?.all?.away ?? null,
        red_cards: ov?.red_cards?.all?.away ?? null,
        saves_for: gk?.saves?.all?.away ?? ov?.goalkeeper_saves?.all?.away ?? null,
        saves_against: gk?.saves?.all?.home ?? ov?.goalkeeper_saves?.all?.home ?? null,
        raw_stats_json: rawJsonStr,
      };

      upsertTeamMatchLog(homeLog);
      upsertTeamMatchLog(awayLog);
      newMatchesSynced++;
      newLogsSynced += 2;
    }
  }

  // Refresh Cedera Pemain untuk Tim yang Bertanding
  console.log(`\n🏥 Memperbarui Status Cedera & Kebugaran Skuad (${affectedTeamIds.size} Tim Terkait)...`);
  for (const teamId of affectedTeamIds) {
    const injuriesRes = await fetchWithStrictRetry(`/football/teams/${teamId}/injuries-suspensions`);
    if (injuriesRes) {
      saveRawPayload("injuries", `injuries_${teamId}`, injuriesRes);
      injuriesRefreshed++;

      // Update status cedera di tabel team_squads
      if (injuriesRes.data?.injuries) {
        for (const inj of injuriesRes.data.injuries) {
          const pId = inj.player_id || inj.player?.id;
          if (pId) {
            const reason = (inj.reason || inj.type || "injury").replace(/_/g, " ").toUpperCase();
            const statusStr = `INJURED: ${reason} (${inj.status || "out"})`;
            db.prepare("UPDATE team_squads SET injury_status = ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?").run(statusStr, pId);
          }
        }
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("🎉 [SYNC MINGGUAN SELESAI]");
  console.log(`- Laga Baru Ditambahkan   : ${newMatchesSynced}`);
  console.log(`- Log Baru Tersimpan      : ${newLogsSynced}`);
  console.log(`- Skuad Cedera Di-refresh : ${injuriesRefreshed} tim`);
  console.log(`- Total Request API       : ${apiCallsCount}`);
  console.log(`- Total Retry Berhasil    : ${retryAttemptsCount}`);
  console.log("================================================================================");
}

if (require.main === module) {
  const days = process.argv[2] ? parseInt(process.argv[2], 10) : 8;
  syncWeeklyDelta(days).catch((err) => {
    console.error("[Fatal Error]", err);
    process.exit(1);
  });
}
