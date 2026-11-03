import { getTheStatsDb, getTeamRecentLogs, TeamMatchLogRecord } from "../db/thestats-dataset";

export interface TeamLuckMetrics {
  team_id: string;
  sample_size: number;
  total_goals_for: number;
  total_xg_for: number;
  finishing_luck_per_match: number; // Goals - xG (> 0 = hoki cetak lebih banyak dari xG)
  total_goals_against: number;
  total_xg_against: number;
  defensive_luck_per_match: number; // xGA - Goals Conceded (> 0 = lawan buang peluang / kiper save berlebih)
  net_luck_rating: number; // finishing_luck + defensive_luck
  status: "OVERPERFORMING" | "UNDERPERFORMING" | "NEUTRAL" | "INSUFFICIENT_DATA";
  description: string;
}

export interface MatchupLuckSignal {
  home: TeamLuckMetrics;
  away: TeamLuckMetrics;
  luck_disparity: number; // home.net_luck_rating - away.net_luck_rating
  market_bias_warning: string | null;
  agentic_tactical_thesis: {
    bull_angle: string;
    bear_angle: string;
  };
}

/**
 * Menghitung Metrik Keberuntungan & Regresi xG untuk Tim Tertentu
 */
export function calculateTeamLuckMetrics(
  teamIdOrName: string,
  limit: number = 6,
  beforeDate?: string
): TeamLuckMetrics {
  const db = getTheStatsDb();

  // Resolusi team_id jika input berupa nama tim
  let resolvedTeamId = teamIdOrName;
  if (!resolvedTeamId.startsWith("tm_")) {
    const row = db
      .prepare(
        `SELECT team_id FROM teams WHERE LOWER(name) = LOWER(?) OR LOWER(short_name) = LOWER(?) LIMIT 1`
      )
      .get(teamIdOrName, teamIdOrName) as { team_id: string } | undefined;
    if (row) {
      resolvedTeamId = row.team_id;
    }
  }

  let query = `
    SELECT * FROM team_match_logs 
    WHERE team_id = ?
  `;
  const params: any[] = [resolvedTeamId];

  if (beforeDate) {
    query += ` AND match_date < ?`;
    params.push(beforeDate);
  }

  query += ` ORDER BY match_date DESC LIMIT ?`;
  params.push(limit);

  const logs = db.prepare(query).all(...params) as unknown as TeamMatchLogRecord[];

  if (!logs || logs.length === 0) {
    return {
      team_id: resolvedTeamId,
      sample_size: 0,
      total_goals_for: 0,
      total_xg_for: 0,
      finishing_luck_per_match: 0,
      total_goals_against: 0,
      total_xg_against: 0,
      defensive_luck_per_match: 0,
      net_luck_rating: 0,
      status: "INSUFFICIENT_DATA",
      description: "Data telemetry belum tersedia untuk mengukur regresi xG.",
    };
  }

  let validXgLogs = 0;
  let sumGf = 0;
  let sumXgf = 0;
  let sumGa = 0;
  let sumXga = 0;

  for (const l of logs) {
    if (typeof l.xg_for === "number" && typeof l.xg_against === "number") {
      validXgLogs++;
      sumGf += l.goals_for;
      sumXgf += l.xg_for;
      sumGa += l.goals_against;
      sumXga += l.xg_against;
    }
  }

  if (validXgLogs === 0) {
    return {
      team_id: resolvedTeamId,
      sample_size: logs.length,
      total_goals_for: logs.reduce((acc, l) => acc + l.goals_for, 0),
      total_xg_for: 0,
      finishing_luck_per_match: 0,
      total_goals_against: logs.reduce((acc, l) => acc + l.goals_against, 0),
      total_xg_against: 0,
      defensive_luck_per_match: 0,
      net_luck_rating: 0,
      status: "INSUFFICIENT_DATA",
      description: "Match log tercatat namun xG terukur tidak tersedia.",
    };
  }

  const finishingLuck = Number(((sumGf - sumXgf) / validXgLogs).toFixed(3));
  const defensiveLuck = Number(((sumXga - sumGa) / validXgLogs).toFixed(3));
  const netLuck = Number((finishingLuck + defensiveLuck).toFixed(3));

  let status: "OVERPERFORMING" | "UNDERPERFORMING" | "NEUTRAL" | "INSUFFICIENT_DATA" = "NEUTRAL";
  let description = "";

  if (netLuck > 0.35) {
    status = "OVERPERFORMING";
    description = `Tim overperforming xG (+${netLuck}/laga). Hasil gol jauh melampaui peluang nyata. Rawan regresi performa turun.`;
  } else if (netLuck < -0.35) {
    status = "UNDERPERFORMING";
    description = `Tim underperforming xG (${netLuck}/laga). Peluang tercipta tinggi namun konversi sial. Kandidat kuat pembalikan positif.`;
  } else {
    status = "NEUTRAL";
    description = `Performa gol selaras dengan ekspektasi peluang (Net luck: ${netLuck}).`;
  }

  return {
    team_id: resolvedTeamId,
    sample_size: validXgLogs,
    total_goals_for: sumGf,
    total_xg_for: Number(sumXgf.toFixed(2)),
    finishing_luck_per_match: finishingLuck,
    total_goals_against: sumGa,
    total_xg_against: Number(sumXga.toFixed(2)),
    defensive_luck_per_match: defensiveLuck,
    net_luck_rating: netLuck,
    status,
    description,
  };
}

/**
 * Menganalisis Disparitas Keberuntungan Kedua Tim untuk Sinyal Pasar
 */
export function evaluateMatchupLuck(
  homeTeam: string,
  awayTeam: string,
  beforeDate?: string
): MatchupLuckSignal {
  const home = calculateTeamLuckMetrics(homeTeam, 6, beforeDate);
  const away = calculateTeamLuckMetrics(awayTeam, 6, beforeDate);

  const disparity = Number((home.net_luck_rating - away.net_luck_rating).toFixed(3));

  let warning: string | null = null;
  if (home.status === "OVERPERFORMING" && away.status === "UNDERPERFORMING") {
    warning = `TRAP LINE ALERT: Tuan rumah (${homeTeam}) overperforming sementara tim tamu (${awayTeam}) underperforming. Pasar kemungkinan overprice tuan rumah.`;
  } else if (home.status === "UNDERPERFORMING" && away.status === "OVERPERFORMING") {
    warning = `VALUE REBOUND ALERT: Tuan rumah (${homeTeam}) underperforming sementara tim tamu overperforming. Potensi nilai positif pada tuan rumah.`;
  }

  const bullAngle =
    home.status === "UNDERPERFORMING"
      ? `${homeTeam} menciptakan kualitas peluang konsisten (${home.total_xg_for} xG) meski hasil akhir belum berpihak. Peluang rebound tinggi.`
      : `${homeTeam} memegang net luck rating ${home.net_luck_rating}.`;

  const bearAngle =
    home.status === "OVERPERFORMING"
      ? `Waspada: ${homeTeam} mengonversi gol (+${home.finishing_luck_per_match}/laga) jauh di atas xG. Rawan drop saat lawan bermain defensif solid.`
      : `${awayTeam} berpeluang mengeksploitasi celah dengan net luck rating ${away.net_luck_rating}.`;

  return {
    home,
    away,
    luck_disparity: disparity,
    market_bias_warning: warning,
    agentic_tactical_thesis: {
      bull_angle: bullAngle,
      bear_angle: bearAngle,
    },
  };
}
