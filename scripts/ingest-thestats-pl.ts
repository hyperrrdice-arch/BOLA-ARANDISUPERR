import {
  getTheStatsDb,
  upsertTeam,
  upsertSquadPlayer,
  upsertMatch,
  upsertTeamMatchLog,
  getDatabaseMetrics,
  type TeamRecord,
  type SquadPlayerRecord,
  type MatchMetaRecord,
  type TeamMatchLogRecord,
} from "../lib/db/thestats-dataset";

const API_BASE = "https://api.thestatsapi.com/api";
const COMP_ID = "comp_3039"; // Premier League England
const SEASON_NAME = "2026/2027";
const SEASON_START_DATE = "2026-08-01";

const apiKey = process.env.STATS_API_KEY;
if (!apiKey) {
  console.error("[Ingestion Error] STATS_API_KEY tidak ditemukan di environment variables!");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let apiCallsCount = 0;

async function safeApiGet(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    apiCallsCount++;
    await sleep(650); // Rate limiter: ~90 requests/menit (aman di bawah 120/menit)

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (res.status === 429) {
        console.warn(`[HTTP 429 Rate Limit] Menunggu 3.5 detik untuk reset quota window... (Attempt ${attempts})`);
        await sleep(3500);
        continue;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        console.warn(`[HTTP ${res.status}] ${path}:`, errJson?.error?.message || res.statusText);
        return null;
      }

      return await res.json();
    } catch (e: any) {
      console.warn(`[Network Warning] ${path} error: ${e.message}. Mencoba lagi...`);
      await sleep(1500);
    }
  }
  return null;
}

async function main() {
  console.log("================================================================================");
  console.log(`[TheStatsAPI Ingestion] Premier League (${COMP_ID}) - Season ${SEASON_NAME}`);
  console.log("================================================================================");

  const db = getTheStatsDb();

  // 1. Fetch seluruh finished matches Premier League
  console.log("\n[Langkah 1/3] Mengambil daftar pertandingan Premier League musim berjalan...");
  const matchesRes = await safeApiGet("/football/matches", {
    competition_id: COMP_ID,
    status: "finished",
    per_page: 100,
  });

  const allFinished = matchesRes?.data || [];
  const seasonMatches = allFinished.filter(
    (m: any) => m.utc_date && m.utc_date >= SEASON_START_DATE
  );

  console.log(`-> Ditemukan ${allFinished.length} total laga, ${seasonMatches.length} laga di season 2026/2027.`);

  // Kumpulkan list tim unik
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

  console.log(`\n[Langkah 2/3] Memproses ${teamsMap.size} Tim Premier League (Katalog Profil & Skuad Aktif)...`);
  let teamIdx = 0;
  for (const [teamId, teamInfo] of teamsMap.entries()) {
    teamIdx++;
    console.log(`[Tim ${teamIdx}/${teamsMap.size}] Mengunduh skuad & status ${teamInfo.name} (${teamId})...`);

    // Simpan data tim dasar
    upsertTeam({
      team_id: teamId,
      name: teamInfo.name,
      short_name: teamInfo.shortName,
      country: "England",
      stadium: teamInfo.stadium,
    });

    // Ambil data cedera
    const injuriesRes = await safeApiGet(`/football/teams/${teamId}/injuries-suspensions`);
    const injuryMap = new Map<string, string>();
    if (injuriesRes?.data?.injuries) {
      for (const inj of injuriesRes.data.injuries) {
        if (inj.player?.id) {
          injuryMap.set(inj.player.id, `INJURY: ${inj.type || "Injured"} (${inj.expected_return || "Unknown"})`);
        }
      }
    }
    if (injuriesRes?.data?.suspensions) {
      for (const susp of injuriesRes.data.suspensions) {
        if (susp.player?.id) {
          injuryMap.set(susp.player.id, `SUSPENDED: ${susp.reason || "Cards"}`);
        }
      }
    }

    // Ambil seluruh pemain di skuad
    const playersRes = await safeApiGet(`/football/teams/${teamId}/players`);
    const players = playersRes?.data || [];
    for (const p of players) {
      const status = injuryMap.get(p.id) || "FIT";
      upsertSquadPlayer({
        player_id: p.id,
        team_id: teamId,
        name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        jersey_number: p.current_team?.jersey_number ?? p.jersey_number,
        age: p.age,
        nationality: p.nationality,
        market_value: p.market_value,
        preferred_foot: p.preferred_foot,
        injury_status: status,
        is_active: 1,
      });
    }
  }

  // 3. Memproses telemetry match-by-match (Incremental: lewati yang sudah ada)
  console.log(`\n[Langkah 3/3] Memproses Telemetry Match-by-Match (${seasonMatches.length} Laga Selesai)...`);
  let matchIdx = 0;
  let skippedMatches = 0;

  for (const m of seasonMatches) {
    matchIdx++;
    const matchId = m.id;

    // Cek apakah log untuk match ini sudah ada di database lokal
    const existingLogs = db.prepare("SELECT count(*) as c FROM team_match_logs WHERE match_id = ?").get(matchId) as any;
    if (existingLogs && existingLogs.c >= 2) {
      skippedMatches++;
      continue;
    }

    const homeId = m.home_team?.id;
    const awayId = m.away_team?.id;
    const matchDate = m.utc_date ? m.utc_date.slice(0, 10) : "";

    console.log(`[Laga ${matchIdx}/${seasonMatches.length}] Ingesting: ${m.home_team?.name} vs ${m.away_team?.name} (${matchDate})`);

    // 1. Ambil Match Stats
    const statsRes = await safeApiGet(`/football/matches/${matchId}/stats`);
    const statsData = statsRes?.data || null;

    // 2. Ambil Lineup
    const lineupsRes = await safeApiGet(`/football/matches/${matchId}/lineups`);
    const lineupsData = lineupsRes?.data || null;

    // Ekstraksi metrik Home & Away
    const homeXg = statsData?.overview?.expected_goals?.all?.home ?? statsData?.xg?.home ?? null;
    const awayXg = statsData?.overview?.expected_goals?.all?.away ?? statsData?.xg?.away ?? null;

    const homeNpxg = statsData?.np_expected_goals?.home ?? statsData?.overview?.np_expected_goals?.home ?? null;
    const awayNpxg = statsData?.np_expected_goals?.away ?? statsData?.overview?.np_expected_goals?.away ?? null;

    const homePossession = statsData?.overview?.ball_possession?.all?.home ?? statsData?.possession?.home ?? 50.0;
    const awayPossession = statsData?.overview?.ball_possession?.all?.away ?? statsData?.possession?.away ?? 50.0;

    const homeShots = statsData?.shots?.total?.home ?? statsData?.shots?.home ?? null;
    const awayShots = statsData?.shots?.total?.away ?? statsData?.shots?.away ?? null;

    const homeShotsOnTarget = statsData?.shots?.on_target?.home ?? null;
    const awayShotsOnTarget = statsData?.shots?.on_target?.away ?? null;

    const homeBigChances = statsData?.attack?.big_chances?.home ?? null;
    const awayBigChances = statsData?.attack?.big_chances?.away ?? null;

    const homeCorners = statsData?.overview?.corners?.home ?? statsData?.corners?.home ?? null;
    const awayCorners = statsData?.overview?.corners?.away ?? statsData?.corners?.away ?? null;

    const homeFouls = statsData?.duels?.fouls?.home ?? statsData?.fouls?.home ?? null;
    const awayFouls = statsData?.duels?.fouls?.away ?? statsData?.fouls?.away ?? null;

    const homeYellows = statsData?.defending?.yellow_cards?.home ?? null;
    const awayYellows = statsData?.defending?.yellow_cards?.away ?? null;

    const homeReds = statsData?.defending?.red_cards?.home ?? null;
    const awayReds = statsData?.defending?.red_cards?.away ?? null;

    // Skor wajib dari sumber; absen → lewati baris, JANGAN karang 0-0 (audit 2026-10-18)
    const homeScoreRaw = m.score?.home ?? m.home_score ?? null;
    const awayScoreRaw = m.score?.away ?? m.away_score ?? null;
    if (homeScoreRaw == null || awayScoreRaw == null) {
      console.warn(`  -> Skor tidak tersedia untuk ${matchId} — dilewati (bukan 0 karangan).`);
      continue;
    }
    const homeScore = Number(homeScoreRaw);
    const awayScore = Number(awayScoreRaw);

    // Simpan metadata pertandingan
    upsertMatch({
      match_id: matchId,
      competition_id: COMP_ID,
      season: SEASON_NAME,
      utc_date: m.utc_date,
      status: m.status,
      home_team_id: homeId,
      away_team_id: awayId,
      home_score: homeScore,
      away_score: awayScore,
    });

    // Dekomposisi ke 2 Log Sisi Tim
    const homeResult: "W" | "D" | "L" = homeScore > awayScore ? "W" : homeScore === awayScore ? "D" : "L";
    const awayResult: "W" | "D" | "L" = awayScore > homeScore ? "W" : homeScore === awayScore ? "D" : "L";

    const homeFormation = lineupsData?.home?.formation || null;
    const awayFormation = lineupsData?.away?.formation || null;

    const homeStarterIds = lineupsData?.home?.starting_xi ? JSON.stringify(lineupsData.home.starting_xi.map((p: any) => p.id)) : null;
    const awayStarterIds = lineupsData?.away?.starting_xi ? JSON.stringify(lineupsData.away.starting_xi.map((p: any) => p.id)) : null;

    // Log Sisi Home Team
    upsertTeamMatchLog({
      log_id: `${matchId}_${homeId}`,
      match_id: matchId,
      team_id: homeId,
      opponent_id: awayId,
      venue: "HOME",
      match_date: matchDate,
      season: SEASON_NAME,
      result: homeResult,
      goals_for: homeScore,
      goals_against: awayScore,
      xg_for: homeXg,
      xg_against: awayXg,
      npxg_for: homeNpxg,
      npxg_against: awayNpxg,
      possession_pct: homePossession,
      shots_for: homeShots,
      shots_against: awayShots,
      shots_on_target_for: homeShotsOnTarget,
      shots_on_target_against: awayShotsOnTarget,
      big_chances_for: homeBigChances,
      big_chances_against: awayBigChances,
      corners_for: homeCorners,
      corners_against: awayCorners,
      fouls_committed: homeFouls,
      yellow_cards: homeYellows,
      red_cards: homeReds,
      formation: homeFormation,
      starting_xi_ids: homeStarterIds,
    });

    // Log Sisi Away Team
    upsertTeamMatchLog({
      log_id: `${matchId}_${awayId}`,
      match_id: matchId,
      team_id: awayId,
      opponent_id: homeId,
      venue: "AWAY",
      match_date: matchDate,
      season: SEASON_NAME,
      result: awayResult,
      goals_for: awayScore,
      goals_against: homeScore,
      xg_for: awayXg,
      xg_against: homeXg,
      npxg_for: awayNpxg,
      npxg_against: homeNpxg,
      possession_pct: awayPossession,
      shots_for: awayShots,
      shots_against: homeShots,
      shots_on_target_for: awayShotsOnTarget,
      shots_on_target_against: homeShotsOnTarget,
      big_chances_for: awayBigChances,
      big_chances_against: homeBigChances,
      corners_for: awayCorners,
      corners_against: homeCorners,
      fouls_committed: awayFouls,
      yellow_cards: awayYellows,
      red_cards: awayReds,
      formation: awayFormation,
      starting_xi_ids: awayStarterIds,
    });
  }

  const metrics = getDatabaseMetrics();
  console.log("\n================================================================================");
  console.log("🏆 [Ingestion Sukses Selesai!]");
  console.log(`- Total Panggilan API TheStatsAPI: ${apiCallsCount} requests`);
  console.log(`- Sisa Kuota Aman: ~${10000 - apiCallsCount} requests tersisa`);
  console.log(`- Laga Dilewati (Sudah ada di DB): ${skippedMatches}`);
  console.log(`- Database Metrics:`);
  console.log(`  * Total Teams: ${metrics.teamsCount}`);
  console.log(`  * Total Squad Players: ${metrics.squadsCount}`);
  console.log(`  * Total Matches: ${metrics.matchesCount}`);
  console.log(`  * Total Team Match Logs (Granular Rows): ${metrics.logsCount}`);
  console.log("================================================================================");
}

main().catch(console.error);
