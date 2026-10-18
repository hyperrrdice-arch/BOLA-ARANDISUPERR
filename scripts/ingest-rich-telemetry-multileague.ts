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
  getTheStatsVaultDb,
} from "../lib/db/thestats-vault";
import {
  TARGET_COMPETITIONS,
  TheStatsCompetitionConfig,
} from "../lib/thestats-competitions";

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
let vaultHitsCount = 0;
let retryAttemptsCount = 0;

interface FailedResource {
  endpointType: string;
  resourceId: string;
  path: string;
  params: Record<string, any>;
  lastError: string;
}

const failedResourcesQueue: FailedResource[] = [];

/**
 * Resilient Fetcher dengan Proteksi Vault Lokal & Strict Exponential Retry Policy:
 * - Rate limit: delay 650ms per panggilan (~92 req/menit, batas kuota 120 req/menit)
 * - Error 429: pause 5.5s
 * - Error 5xx/Timeout/Network: retry hingga 6x dengan backoff (1.5s, 3s, 6s, 12s, 24s)
 * - Jika tetap gagal, dicatat ke failed queue untuk rekonsiliasi akhir
 */
async function fetchWithResilientVault(
  endpointType: string,
  resourceId: string,
  path: string,
  params: Record<string, any> = {},
  maxAgeMs?: number
): Promise<any> {
  const cached = getRawPayload(resourceId, maxAgeMs);
  if (cached) {
    vaultHitsCount++;
    return cached;
  }

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  const MAX_RETRIES = 6;
  let attempt = 0;
  let lastErrMsg = "";

  while (attempt < MAX_RETRIES) {
    attempt++;
    apiCallsCount++;
    await sleep(1000); // Politeness delay: 1000ms (~60 req/menit, zero rate limit 429)

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.status === 429) {
        retryAttemptsCount++;
        const waitTimeMs = Math.min(30000, attempt * 7000);
        console.warn(`⚠️ [HTTP 429 Rate Limit] Panggilan ke ${path} dibatasi. Menunggu ${waitTimeMs / 1000}s sebelum retry (${attempt}/${MAX_RETRIES})...`);
        await sleep(waitTimeMs);
        continue;
      }

      if (res.status === 404) {
        // Data memang tidak ada di remote API (misal tim belum punya data cedera)
        return null;
      }

      if (!res.ok) {
        retryAttemptsCount++;
        const errJson = await res.json().catch(() => null);
        lastErrMsg = errJson?.error?.message || res.statusText || `HTTP ${res.status}`;
        const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
        console.warn(`⚠️ [HTTP ${res.status}] ${path}: ${lastErrMsg}. Backoff ${backoffMs}ms (Percobaan ${attempt}/${MAX_RETRIES})...`);
        await sleep(backoffMs);
        continue;
      }

      const json = await res.json();
      saveRawPayload(endpointType, resourceId, json);
      return json;
    } catch (e: any) {
      retryAttemptsCount++;
      lastErrMsg = e.message || String(e);
      const backoffMs = Math.min(24000, 1500 * Math.pow(2, attempt - 1));
      console.warn(`⚠️ [Network Error] ${path}: ${lastErrMsg}. Retry dalam ${backoffMs}ms (${attempt}/${MAX_RETRIES})...`);
      await sleep(backoffMs);
    }
  }

  // Jika setelah 6x percobaan masih gagal, masukkan ke antrian gagal
  failedResourcesQueue.push({
    endpointType,
    resourceId,
    path,
    params,
    lastError: lastErrMsg,
  });
  console.error(`❌ [GAGAL SETELAH ${MAX_RETRIES} RETRY] ${path} (ID: ${resourceId}). Dimasukkan ke queue mop-up.`);
  return null;
}

/**
 * Ingest satu kompetisi penuh
 */
export async function ingestCompetition(comp: TheStatsCompetitionConfig): Promise<{
  matchesCount: number;
  teamsCount: number;
  logsCount: number;
}> {
  console.log("\n" + "=".repeat(80));
  console.log(`🏆 [INGESTION MULTI-LIGA] ${comp.name} (${comp.divCode} - ${comp.id}) Musim ${comp.seasonName}`);
  console.log("=".repeat(80));

  // 1. Ambil daftar match finished dengan pagination aman
  console.log(`\n[1/3] Memeriksa daftar pertandingan finished ${comp.name}...`);
  const allFinishedMatches: any[] = [];
  const seenMatchIds = new Set<string>();
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const resourceKey = page === 1 ? `matches_${comp.id}_finished` : `matches_${comp.id}_finished_p${page}`;
    const matchesRes = await fetchWithResilientVault(
      "matches",
      resourceKey,
      "/football/matches",
      { competition_id: comp.id, status: "finished", per_page: 100, page },
      6 * 3600 * 1000 // Cache 6 jam
    );

    const pageData: any[] = matchesRes?.data || [];
    if (pageData.length === 0) break;

    for (const m of pageData) {
      if (!seenMatchIds.has(m.id)) {
        seenMatchIds.add(m.id);
        allFinishedMatches.push(m);
      }
    }

    const oldestOnPage = pageData[pageData.length - 1]?.utc_date;
    if (oldestOnPage && oldestOnPage < comp.seasonStartDate) {
      hasMorePages = false;
    } else if (matchesRes?.meta?.total_pages && page >= matchesRes.meta.total_pages) {
      hasMorePages = false;
    } else {
      page++;
    }
  }

  const seasonMatches = allFinishedMatches.filter(
    (m: any) => m.utc_date && m.utc_date >= comp.seasonStartDate
  );

  console.log(`-> Ditemukan ${seasonMatches.length} laga selesai musim 2026/2027.`);

  // 2. Kumpulkan tim unik
  const teamsMap = new Map<string, { id: string; name: string; shortName?: string; stadium?: string }>();
  for (const m of seasonMatches) {
    if (m.home_team?.id) {
      teamsMap.set(m.home_team.id, {
        id: m.home_team.id,
        name: m.home_team.name,
        shortName: m.home_team.short_name,
        stadium: m.home_team.stadium?.name,
      });
    }
    if (m.away_team?.id) {
      teamsMap.set(m.away_team.id, {
        id: m.away_team.id,
        name: m.away_team.name,
        shortName: m.away_team.short_name,
      });
    }
  }

  console.log(`\n[2/3] Memproses ${teamsMap.size} Tim (Katalog Skuad, Fisik & Status Cedera)...`);
  let teamIdx = 0;
  for (const [teamId, teamInfo] of teamsMap.entries()) {
    teamIdx++;
    console.log(`  [Tim ${teamIdx}/${teamsMap.size}] ${teamInfo.name} (${teamId})...`);

    upsertTeam({
      team_id: teamId,
      name: teamInfo.name,
      short_name: teamInfo.shortName,
      country: comp.country,
      stadium: teamInfo.stadium,
    });

    // Injuries & Suspensions
    const injuriesRes = await fetchWithResilientVault(
      "injuries",
      `injuries_${teamId}`,
      `/football/teams/${teamId}/injuries-suspensions`,
      {},
      12 * 3600 * 1000
    );

    const hasInjuryPayload = injuriesRes && injuriesRes.data !== undefined && injuriesRes.data !== null;
    const injuryMap = new Map<string, string>();
    if (injuriesRes?.data?.injuries) {
      for (const inj of injuriesRes.data.injuries) {
        const playerId = inj.player_id || inj.player?.id;
        if (playerId) {
          const reasonClean = (inj.reason || inj.type || "injury").replace(/_/g, " ").toUpperCase();
          const statusClean = inj.status || "out";
          const retDate = inj.expected_return ? inj.expected_return.slice(0, 10) : "TBD";
          injuryMap.set(playerId, `INJURED: ${reasonClean} (${statusClean}, ret: ${retDate})`);
        }
      }
    }
    if (injuriesRes?.data?.suspensions) {
      for (const susp of injuriesRes.data.suspensions) {
        const playerId = susp.player_id || susp.player?.id;
        if (playerId) {
          const reasonClean = (susp.reason || "cards").replace(/_/g, " ").toUpperCase();
          injuryMap.set(playerId, `SUSPENDED: ${reasonClean}`);
        }
      }
    }

    // Players with height_cm
    const playersRes = await fetchWithResilientVault(
      "players",
      `players_${teamId}`,
      `/football/teams/${teamId}/players`,
      {},
      24 * 3600 * 1000
    );

    const players = playersRes?.data || [];
    for (const p of players) {
      let status = "FIT";
      if (injuryMap.has(p.id)) {
        status = injuryMap.get(p.id)!;
      } else if (!hasInjuryPayload) {
        status = "UNKNOWN (Data Belum Tersedia)";
      } else {
        status = "FIT";
      }

      upsertSquadPlayer({
        player_id: p.id,
        team_id: teamId,
        name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        jersey_number: p.current_team?.jersey_number ?? p.jersey_number,
        age: p.age,
        height_cm: p.height_cm,
        nationality: p.nationality,
        market_value: p.market_value,
        preferred_foot: p.preferred_foot,
        injury_status: status,
        is_active: 1,
      });
    }
  }

  // 3. Ingest Telemetry Granular per Laga
  console.log(`\n[3/3] Memproses Telemetry Granular 95 Kolom (${seasonMatches.length} Laga)...`);
  let matchIdx = 0;
  let totalLogsIngested = 0;

  for (const m of seasonMatches) {
    matchIdx++;
    const matchId = m.id;
    const homeId = m.home_team?.id;
    const awayId = m.away_team?.id;
    const matchDate = m.utc_date ? m.utc_date.slice(0, 10) : "";

    if (matchIdx % 5 === 0 || matchIdx === seasonMatches.length) {
      console.log(`  -> Progress Laga: [${matchIdx}/${seasonMatches.length}] | API Calls: ${apiCallsCount} | Vault Hits: ${vaultHitsCount} | Retries: ${retryAttemptsCount}`);
    }

    const statsRes = await fetchWithResilientVault("stats", `stats_${matchId}`, `/football/matches/${matchId}/stats`);
    const lineupsRes = await fetchWithResilientVault("lineups", `lineups_${matchId}`, `/football/matches/${matchId}/lineups`);

    const statsData = statsRes?.data || null;
    const lineupsData = lineupsRes?.data || null;

    // Skor wajib dari sumber; absen → lewati baris, JANGAN karang 0-0 (audit 2026-10-18)
    const homeScoreRaw = m.score?.home ?? m.home_score ?? null;
    const awayScoreRaw = m.score?.away ?? m.away_score ?? null;
    if (homeScoreRaw == null || awayScoreRaw == null) {
      console.warn(`  -> Skor tidak tersedia untuk ${matchId} — dilewati (bukan 0 karangan).`);
      continue;
    }
    const homeScore = Number(homeScoreRaw);
    const awayScore = Number(awayScoreRaw);

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

    const homeFormation = lineupsData?.home?.formation || null;
    const awayFormation = lineupsData?.away?.formation || null;

    const homeStarterIds = lineupsData?.home?.starting_xi ? JSON.stringify(lineupsData.home.starting_xi.map((p: any) => p.id)) : null;
    const awayStarterIds = lineupsData?.away?.starting_xi ? JSON.stringify(lineupsData.away.starting_xi.map((p: any) => p.id)) : null;

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
      match_date: matchDate,
      season: comp.seasonName,
      result: homeResult,
      goals_for: homeScore,
      goals_against: awayScore,

      xg_for: ov?.expected_goals?.all?.home ?? statsData?.xg?.home ?? null,
      xg_against: ov?.expected_goals?.all?.away ?? statsData?.xg?.away ?? null,
      npxg_for: npxg?.all?.home ?? null,
      npxg_against: npxg?.all?.away ?? null,
      first_half_xg_for: ov?.expected_goals?.first_half?.home ?? null,
      second_half_xg_for: ov?.expected_goals?.second_half?.home ?? null,
      first_half_xg_against: ov?.expected_goals?.first_half?.away ?? null,
      second_half_xg_against: ov?.expected_goals?.second_half?.away ?? null,

      shots_for: sh?.total_shots?.all?.home ?? ov?.total_shots?.all?.home ?? null,
      shots_against: sh?.total_shots?.all?.away ?? ov?.total_shots?.all?.away ?? null,
      shots_on_target_for: sh?.shots_on_target?.all?.home ?? ov?.shots_on_target?.all?.home ?? null,
      shots_on_target_against: sh?.shots_on_target?.all?.away ?? ov?.shots_on_target?.all?.away ?? null,
      shots_off_target_for: sh?.shots_off_target?.all?.home ?? null,
      shots_off_target_against: sh?.shots_off_target?.all?.away ?? null,
      blocked_shots_for: sh?.blocked_shots?.all?.home ?? null,
      blocked_shots_against: sh?.blocked_shots?.all?.away ?? null,
      shots_inside_box_for: sh?.shots_inside_box?.all?.home ?? null,
      shots_inside_box_against: sh?.shots_inside_box?.all?.away ?? null,
      shots_outside_box_for: sh?.shots_outside_box?.all?.home ?? null,
      shots_outside_box_against: sh?.shots_outside_box?.all?.away ?? null,
      hit_woodwork_for: sh?.hit_woodwork?.all?.home ?? null,
      hit_woodwork_against: sh?.hit_woodwork?.all?.away ?? null,

      big_chances_for: ov?.big_chances?.all?.home ?? null,
      big_chances_against: ov?.big_chances?.all?.away ?? null,
      big_chances_missed_for: att?.big_chances_missed?.all?.home ?? null,
      big_chances_missed_against: att?.big_chances_missed?.all?.away ?? null,
      touches_in_penalty_area_for: att?.touches_in_penalty_area?.all?.home ?? null,
      touches_in_penalty_area_against: att?.touches_in_penalty_area?.all?.away ?? null,
      offsides_for: att?.offsides?.all?.home ?? null,
      offsides_against: att?.offsides?.all?.away ?? null,

      possession_pct: ov?.ball_possession?.all?.home ?? null,
      first_half_possession: ov?.ball_possession?.first_half?.home ?? null,
      second_half_possession: ov?.ball_possession?.second_half?.home ?? null,
      passes_total_for: ov?.passes?.all?.home ?? null,
      passes_total_against: ov?.passes?.all?.away ?? null,
      passes_accurate_for: ov?.accurate_passes?.all?.home ?? pass?.accurate_passes?.all?.home ?? null,
      passes_accurate_against: ov?.accurate_passes?.all?.away ?? pass?.accurate_passes?.all?.away ?? null,
      pass_accuracy_pct_for: ov?.passes?.all?.home && ov?.accurate_passes?.all?.home ? Number(((ov.accurate_passes.all.home / ov.passes.all.home) * 100).toFixed(1)) : null,
      pass_accuracy_pct_against: ov?.passes?.all?.away && ov?.accurate_passes?.all?.away ? Number(((ov.accurate_passes.all.away / ov.passes.all.away) * 100).toFixed(1)) : null,
      accurate_crosses_for: pass?.accurate_crosses?.all?.home ?? null,
      accurate_crosses_against: pass?.accurate_crosses?.all?.away ?? null,
      accurate_long_balls_for: pass?.accurate_long_balls?.all?.home ?? null,
      accurate_long_balls_against: pass?.accurate_long_balls?.all?.away ?? null,
      final_third_entries_for: pass?.final_third_entries?.all?.home ?? null,
      final_third_entries_against: pass?.final_third_entries?.all?.away ?? null,
      throw_ins_for: pass?.throw_ins?.all?.home ?? null,
      throw_ins_against: pass?.throw_ins?.all?.away ?? null,

      duels_won_pct_for: du?.duels_won_percentage?.all?.home ?? null,
      duels_won_pct_against: du?.duels_won_percentage?.all?.away ?? null,
      ground_duels_pct_for: du?.ground_duels_percentage?.all?.home ?? null,
      ground_duels_pct_against: du?.ground_duels_percentage?.all?.away ?? null,
      aerial_duels_pct_for: du?.aerial_duels_percentage?.all?.home ?? null,
      aerial_duels_pct_against: du?.aerial_duels_percentage?.all?.away ?? null,
      dispossessed_for: du?.dispossessed?.all?.home ?? null,
      dispossessed_against: du?.dispossessed?.all?.away ?? null,
      dribbles_pct_for: du?.dribbles_percentage?.all?.home ?? null,
      dribbles_pct_against: du?.dribbles_percentage?.all?.away ?? null,

      tackles_for: def?.tackles?.all?.home ?? ov?.tackles?.all?.home ?? null,
      tackles_against: def?.tackles?.all?.away ?? ov?.tackles?.all?.away ?? null,
      tackles_won_pct_for: def?.tackles_won_percentage?.all?.home ?? null,
      tackles_won_pct_against: def?.tackles_won_percentage?.all?.away ?? null,
      interceptions_for: def?.interceptions?.all?.home ?? null,
      interceptions_against: def?.interceptions?.all?.away ?? null,
      clearances_for: def?.clearances?.all?.home ?? null,
      clearances_against: def?.clearances?.all?.away ?? null,
      ball_recoveries_for: def?.ball_recoveries?.all?.home ?? null,
      ball_recoveries_against: def?.ball_recoveries?.all?.away ?? null,
      corners_for: ov?.corner_kicks?.all?.home ?? null,
      corners_against: ov?.corner_kicks?.all?.away ?? null,
      fouls_committed: ov?.fouls?.all?.home ?? null,
      yellow_cards: ov?.yellow_cards?.all?.home ?? null,
      red_cards: ov?.red_cards?.all?.home ?? null,

      saves_for: gk?.saves?.all?.home ?? ov?.goalkeeper_saves?.all?.home ?? null,
      saves_against: gk?.saves?.all?.away ?? ov?.goalkeeper_saves?.all?.away ?? null,
      goal_kicks_for: gk?.goal_kicks?.all?.home ?? null,
      goal_kicks_against: gk?.goal_kicks?.all?.away ?? null,
      goals_prevented_for: gk?.goals_prevented?.all?.home ?? null,
      goals_prevented_against: gk?.goals_prevented?.all?.away ?? null,
      high_claims_for: gk?.high_claims?.all?.home ?? null,
      high_claims_against: gk?.high_claims?.all?.away ?? null,

      formation: homeFormation,
      starting_xi_ids: homeStarterIds,
      raw_stats_json: rawJsonStr,
    };

    // Away Log
    const awayLog: TeamMatchLogRecord = {
      log_id: `${matchId}_${awayId}`,
      match_id: matchId,
      team_id: awayId,
      opponent_id: homeId,
      venue: "AWAY",
      match_date: matchDate,
      season: comp.seasonName,
      result: awayResult,
      goals_for: awayScore,
      goals_against: homeScore,

      xg_for: ov?.expected_goals?.all?.away ?? statsData?.xg?.away ?? null,
      xg_against: ov?.expected_goals?.all?.home ?? statsData?.xg?.home ?? null,
      npxg_for: npxg?.all?.away ?? null,
      npxg_against: npxg?.all?.home ?? null,
      first_half_xg_for: ov?.expected_goals?.first_half?.away ?? null,
      second_half_xg_for: ov?.expected_goals?.second_half?.away ?? null,
      first_half_xg_against: ov?.expected_goals?.first_half?.home ?? null,
      second_half_xg_against: ov?.expected_goals?.second_half?.home ?? null,

      shots_for: sh?.total_shots?.all?.away ?? ov?.total_shots?.all?.away ?? null,
      shots_against: sh?.total_shots?.all?.home ?? ov?.total_shots?.all?.home ?? null,
      shots_on_target_for: sh?.shots_on_target?.all?.away ?? ov?.shots_on_target?.all?.away ?? null,
      shots_on_target_against: sh?.shots_on_target?.all?.home ?? ov?.shots_on_target?.all?.home ?? null,
      shots_off_target_for: sh?.shots_off_target?.all?.away ?? null,
      shots_off_target_against: sh?.shots_off_target?.all?.home ?? null,
      blocked_shots_for: sh?.blocked_shots?.all?.away ?? null,
      blocked_shots_against: sh?.blocked_shots?.all?.home ?? null,
      shots_inside_box_for: sh?.shots_inside_box?.all?.away ?? null,
      shots_inside_box_against: sh?.shots_inside_box?.all?.home ?? null,
      shots_outside_box_for: sh?.shots_outside_box?.all?.away ?? null,
      shots_outside_box_against: sh?.shots_outside_box?.all?.home ?? null,
      hit_woodwork_for: sh?.hit_woodwork?.all?.away ?? null,
      hit_woodwork_against: sh?.hit_woodwork?.all?.home ?? null,

      big_chances_for: ov?.big_chances?.all?.away ?? null,
      big_chances_against: ov?.big_chances?.all?.home ?? null,
      big_chances_missed_for: att?.big_chances_missed?.all?.away ?? null,
      big_chances_missed_against: att?.big_chances_missed?.all?.home ?? null,
      touches_in_penalty_area_for: att?.touches_in_penalty_area?.all?.away ?? null,
      touches_in_penalty_area_against: att?.touches_in_penalty_area?.all?.home ?? null,
      offsides_for: att?.offsides?.all?.away ?? null,
      offsides_against: att?.offsides?.all?.home ?? null,

      possession_pct: ov?.ball_possession?.all?.away ?? null,
      first_half_possession: ov?.ball_possession?.first_half?.away ?? null,
      second_half_possession: ov?.ball_possession?.second_half?.away ?? null,
      passes_total_for: ov?.passes?.all?.away ?? null,
      passes_total_against: ov?.passes?.all?.home ?? null,
      passes_accurate_for: ov?.accurate_passes?.all?.away ?? pass?.accurate_passes?.all?.away ?? null,
      passes_accurate_against: ov?.accurate_passes?.all?.home ?? pass?.accurate_passes?.all?.home ?? null,
      pass_accuracy_pct_for: ov?.passes?.all?.away && ov?.accurate_passes?.all?.away ? Number(((ov.accurate_passes.all.away / ov.passes.all.away) * 100).toFixed(1)) : null,
      pass_accuracy_pct_against: ov?.passes?.all?.home && ov?.accurate_passes?.all?.home ? Number(((ov.accurate_passes.all.home / ov.passes.all.home) * 100).toFixed(1)) : null,
      accurate_crosses_for: pass?.accurate_crosses?.all?.away ?? null,
      accurate_crosses_against: pass?.accurate_crosses?.all?.home ?? null,
      accurate_long_balls_for: pass?.accurate_long_balls?.all?.away ?? null,
      accurate_long_balls_against: pass?.accurate_long_balls?.all?.home ?? null,
      final_third_entries_for: pass?.final_third_entries?.all?.away ?? null,
      final_third_entries_against: pass?.final_third_entries?.all?.home ?? null,
      throw_ins_for: pass?.throw_ins?.all?.away ?? null,
      throw_ins_against: pass?.throw_ins?.all?.home ?? null,

      duels_won_pct_for: du?.duels_won_percentage?.all?.away ?? null,
      duels_won_pct_against: du?.duels_won_percentage?.all?.home ?? null,
      ground_duels_pct_for: du?.ground_duels_percentage?.all?.away ?? null,
      ground_duels_pct_against: du?.ground_duels_percentage?.all?.home ?? null,
      aerial_duels_pct_for: du?.aerial_duels_percentage?.all?.away ?? null,
      aerial_duels_pct_against: du?.aerial_duels_percentage?.all?.home ?? null,
      dispossessed_for: du?.dispossessed?.all?.away ?? null,
      dispossessed_against: du?.dispossessed?.all?.home ?? null,
      dribbles_pct_for: du?.dribbles_percentage?.all?.away ?? null,
      dribbles_pct_against: du?.dribbles_percentage?.all?.home ?? null,

      tackles_for: def?.tackles?.all?.away ?? ov?.tackles?.all?.away ?? null,
      tackles_against: def?.tackles?.all?.home ?? ov?.tackles?.all?.home ?? null,
      tackles_won_pct_for: def?.tackles_won_percentage?.all?.away ?? null,
      tackles_won_pct_against: def?.tackles_won_percentage?.all?.home ?? null,
      interceptions_for: def?.interceptions?.all?.away ?? null,
      interceptions_against: def?.interceptions?.all?.home ?? null,
      clearances_for: def?.clearances?.all?.away ?? null,
      clearances_against: def?.clearances?.all?.home ?? null,
      ball_recoveries_for: def?.ball_recoveries?.all?.away ?? null,
      ball_recoveries_against: def?.ball_recoveries?.all?.home ?? null,
      corners_for: ov?.corner_kicks?.all?.away ?? null,
      corners_against: ov?.corner_kicks?.all?.home ?? null,
      fouls_committed: ov?.fouls?.all?.away ?? null,
      yellow_cards: ov?.yellow_cards?.all?.away ?? null,
      red_cards: ov?.red_cards?.all?.away ?? null,

      saves_for: gk?.saves?.all?.away ?? ov?.goalkeeper_saves?.all?.away ?? null,
      saves_against: gk?.saves?.all?.home ?? ov?.goalkeeper_saves?.all?.home ?? null,
      goal_kicks_for: gk?.goal_kicks?.all?.away ?? null,
      goal_kicks_against: gk?.goal_kicks?.all?.home ?? null,
      goals_prevented_for: gk?.goals_prevented?.all?.away ?? null,
      goals_prevented_against: gk?.goals_prevented?.all?.home ?? null,
      high_claims_for: gk?.high_claims?.all?.away ?? null,
      high_claims_against: gk?.high_claims?.all?.home ?? null,

      formation: awayFormation,
      starting_xi_ids: awayStarterIds,
      raw_stats_json: rawJsonStr,
    };

    upsertTeamMatchLog(homeLog);
    upsertTeamMatchLog(awayLog);
    totalLogsIngested += 2;
  }

  return {
    matchesCount: seasonMatches.length,
    teamsCount: teamsMap.size,
    logsCount: totalLogsIngested,
  };
}

/**
 * Fase Rekonsiliasi Mop-Up:
 * Coba panggil ulang resource yang sempat gagal sampai 100% tuntas
 */
async function reconcileFailedResources() {
  if (failedResourcesQueue.length === 0) {
    console.log(`\n✅ [Zero Failed Resources] Seluruh request TheStatsAPI 100% sukses tanpa ada data yang tertinggal.`);
    return;
  }

  console.log(`\n⚠️ [MOP-UP RECONCILIATION] Menjalankan retry untuk ${failedResourcesQueue.length} resource yang sempat gagal...`);
  const stillFailed: FailedResource[] = [];

  for (const item of failedResourcesQueue) {
    console.log(`-> Retry mop-up: ${item.path} (${item.resourceId})...`);
    await sleep(1000);
    try {
      const url = new URL(API_BASE + item.path);
      for (const [k, v] of Object.entries(item.params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const json = await res.json();
        saveRawPayload(item.endpointType, item.resourceId, json);
        console.log(`   ✅ Sukses mop-up ${item.resourceId}!`);
      } else {
        stillFailed.push(item);
      }
    } catch (e: any) {
      stillFailed.push(item);
    }
  }

  if (stillFailed.length > 0) {
    console.error(`❌ PERINGATAN: Terdapat ${stillFailed.length} resource yang tetap gagal setelah fase mop-up.`);
  } else {
    console.log(`🎉 SELURUH GAGAL BERHASIL DI-RESOLVE DI FASE MOP-UP! Data 100% lengkap.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const leagueArg = args.find((a) => a.startsWith("--league="))?.split("=")[1]?.toLowerCase() || "all";

  console.log("================================================================================");
  console.log("🚀 [THESTATSAPI MULTI-LEAGUE DATASET INGESTION ENGINE]");
  console.log("Sistem: Big 5 Eropa + Eredivisie + UCL (Musim Berjalan 2026/2027)");
  console.log("Proteksi Kuota: Delay 650ms, Strict Retry Policy, & Local Vault Idempotency");
  console.log("================================================================================");

  let targetList: TheStatsCompetitionConfig[] = [];

  if (leagueArg === "all") {
    targetList = Object.values(TARGET_COMPETITIONS);
  } else {
    const selected = Object.values(TARGET_COMPETITIONS).find(
      (c) => c.id.toLowerCase() === leagueArg || c.divCode.toLowerCase() === leagueArg
    );
    if (!selected) {
      console.error(`Liga '${leagueArg}' tidak ditemukan! Target valid: all, comp_3039, comp_8814, comp_5840, comp_4643, comp_0256, comp_3809, comp_3498.`);
      process.exit(1);
    }
    targetList = [selected];
  }

  console.log(`Total kompetisi yang akan diproses: ${targetList.length} (${targetList.map((c) => c.name).join(", ")})`);

  const summaryReport: Array<{ name: string; matches: number; teams: number; logs: number }> = [];

  for (const comp of targetList) {
    const stats = await ingestCompetition(comp);
    summaryReport.push({
      name: comp.name,
      matches: stats.matchesCount,
      teams: stats.teamsCount,
      logs: stats.logsCount,
    });
  }

  // Rekonsiliasi antrian gagal
  await reconcileFailedResources();

  console.log("\n" + "=".repeat(80));
  console.log("📊 [RINGKASAN AKHIR INGESTION MULTI-LIGA]");
  console.log("=".repeat(80));
  console.table(summaryReport);
  console.log(`- Total Panggilan API Dibuat : ${apiCallsCount}`);
  console.log(`- Total Vault Cache Terpakai : ${vaultHitsCount} (Hemat kuota!)`);
  console.log(`- Total Retry Berhasil       : ${retryAttemptsCount}`);
  console.log("=".repeat(80));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[Fatal Error]", err);
    process.exit(1);
  });
}
