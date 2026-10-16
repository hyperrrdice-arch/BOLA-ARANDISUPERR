import {
  getTheStatsDb,
  getTeamSquad,
  getH2HLogs,
  type TeamMatchLogRecord,
  type SquadPlayerRecord,
} from "./thestats-dataset";

export interface TeamRollingTelemetry {
  team_id: string;
  sample_size: number; // Total match dianalisis
  
  // 1. Observed Sampel Metrics
  observed_xg_samples: number;
  observed_shots_samples: number;
  observed_passes_samples: number;
  observed_aerial_samples: number;

  // 2. Kualitas Peluang Murni (NULL jika data tidak tersedia di raw)
  rolling_xg_for: number | null;
  rolling_xg_against: number | null;
  rolling_npxg_for: number | null;
  rolling_npxg_against: number | null;

  // 3. Gol & Hasil Aktual (Terverifikasi dari skor resmi)
  rolling_goals_for: number;
  rolling_goals_against: number;
  win_rate: number;
  clean_sheet_rate: number;
  form_sequence: string; // e.g. "W-W-D-L-W"

  // 4. Penguasaan & Tembakan Granular
  avg_possession_pct: number | null;
  avg_shots_for: number | null;
  avg_shots_on_target_for: number | null;
  avg_shots_inside_box_for: number | null;
  avg_big_chances_for: number | null;
  avg_box_touches_for: number | null;

  // 5. Passing, Crossing & Duel Udara (Fitur Pasar Khusus)
  avg_passes_accurate_for: number | null;
  avg_pass_accuracy_pct: number | null;
  avg_crosses_accurate_for: number | null;
  avg_aerial_duels_pct_for: number | null;

  // 6. Bertahan & Disiplin
  avg_tackles_for: number | null;
  avg_corners_for: number | null;
  avg_fouls_committed: number | null;
  avg_yellow_cards: number | null;

  recent_logs: TeamMatchLogRecord[];
}

export interface TeamSquadTelemetry {
  team_id: string;
  total_players: number;
  goalkeepers: number;
  defenders: number;
  midfielders: number;
  forwards: number;
  injured_players: SquadPlayerRecord[];
  active_players: SquadPlayerRecord[];
  unknown_status_players: SquadPlayerRecord[];
  has_verified_injury_data: boolean;
}

/**
 * Helper resolusi team_id baik dari ID langsung ('tm_9145') maupun nama klub ('Arsenal')
 */
export function resolveTeamId(teamIdOrName: string): string {
  if (!teamIdOrName) return teamIdOrName;
  if (teamIdOrName.startsWith("tm_")) return teamIdOrName;
  try {
    const db = getTheStatsDb();
    const row = db.prepare(`
      SELECT team_id FROM teams 
      WHERE lower(name) = lower(?) OR lower(short_name) = lower(?)
      LIMIT 1
    `).get(teamIdOrName, teamIdOrName) as { team_id: string } | undefined;
    return row ? row.team_id : teamIdOrName;
  } catch {
    return teamIdOrName;
  }
}

/**
 * Mengambil log laga pra-pertandingan (Anti-Data Leakage)
 * Hanya mengambil laga dengan match_date < beforeDate jika beforeDate disediakan
 */
export function getPreMatchLogs(teamIdOrName: string, limit: number = 6, beforeDate?: string): TeamMatchLogRecord[] {
  const db = getTheStatsDb();
  const teamId = resolveTeamId(teamIdOrName);
  if (beforeDate) {
    const stmt = db.prepare(`
      SELECT * FROM team_match_logs
      WHERE team_id = ? AND match_date < ?
      ORDER BY match_date DESC
      LIMIT ?
    `);
    return stmt.all(teamId, beforeDate, limit) as unknown as TeamMatchLogRecord[];
  }

  const stmt = db.prepare(`
    SELECT * FROM team_match_logs
    WHERE team_id = ?
    ORDER BY match_date DESC
    LIMIT ?
  `);
  return stmt.all(teamId, limit) as unknown as TeamMatchLogRecord[];
}

/**
 * Menghitung rolling metrics tanpa silent imputation (Zero False Assumptions)
 * Data observed yang tidak tersedia di raw API tetap bernilai NULL secara transparan.
 */
export function getTeamRollingTelemetry(
  teamId: string,
  limit: number = 6,
  beforeDate?: string
): TeamRollingTelemetry {
  const logs = getPreMatchLogs(teamId, limit, beforeDate);

  if (logs.length === 0) {
    return {
      team_id: teamId,
      sample_size: 0,
      observed_xg_samples: 0,
      observed_shots_samples: 0,
      observed_passes_samples: 0,
      observed_aerial_samples: 0,
      rolling_xg_for: null,
      rolling_xg_against: null,
      rolling_npxg_for: null,
      rolling_npxg_against: null,
      rolling_goals_for: 0,
      rolling_goals_against: 0,
      win_rate: 0,
      clean_sheet_rate: 0,
      form_sequence: "N/A",
      avg_possession_pct: null,
      avg_shots_for: null,
      avg_shots_on_target_for: null,
      avg_shots_inside_box_for: null,
      avg_big_chances_for: null,
      avg_box_touches_for: null,
      avg_passes_accurate_for: null,
      avg_pass_accuracy_pct: null,
      avg_crosses_accurate_for: null,
      avg_aerial_duels_pct_for: null,
      avg_tackles_for: null,
      avg_corners_for: null,
      avg_fouls_committed: null,
      avg_yellow_cards: null,
      recent_logs: [],
    };
  }

  const n = logs.length;

  // Akumulator metrik aktual
  let totalGoalsFor = 0;
  let totalGoalsAgainst = 0;
  let wins = 0;
  let cleanSheets = 0;
  const formArr: string[] = [];

  // Akumulator observed metrics (HANYA dijumlah jika NOT NULL)
  let sumXgFor = 0, countXg = 0;
  let sumXgAgainst = 0;
  let sumNpxgFor = 0, countNpxg = 0;
  let sumNpxgAgainst = 0;
  let sumPossession = 0, countPossession = 0;
  let sumShotsFor = 0, countShots = 0;
  let sumShotsOnTargetFor = 0;
  let sumShotsInBoxFor = 0, countShotsInBox = 0;
  let sumBigChancesFor = 0, countBigChances = 0;
  let sumBoxTouchesFor = 0, countBoxTouches = 0;
  let sumPassesAcc = 0, countPasses = 0;
  let sumPassPct = 0;
  let sumCrossesAcc = 0, countCrosses = 0;
  let sumAerialPct = 0, countAerial = 0;
  let sumTacklesFor = 0, countTackles = 0;
  let sumCornersFor = 0, countCorners = 0;
  let sumFouls = 0, countFouls = 0;
  let sumYellows = 0, countYellows = 0;

  for (const log of logs) {
    totalGoalsFor += log.goals_for;
    totalGoalsAgainst += log.goals_against;
    if (log.result === "W") wins++;
    if (log.goals_against === 0) cleanSheets++;
    formArr.push(log.result);

    // Observed xG
    if (log.xg_for !== null && log.xg_for !== undefined) {
      sumXgFor += log.xg_for;
      sumXgAgainst += log.xg_against ?? 0;
      countXg++;
    }

    // Observed npxG
    if (log.npxg_for !== null && log.npxg_for !== undefined) {
      sumNpxgFor += log.npxg_for;
      sumNpxgAgainst += log.npxg_against ?? 0;
      countNpxg++;
    }

    // Observed Possession
    if (log.possession_pct !== null && log.possession_pct !== undefined) {
      sumPossession += log.possession_pct;
      countPossession++;
    }

    // Observed Shots
    if (log.shots_for !== null && log.shots_for !== undefined) {
      sumShotsFor += log.shots_for;
      sumShotsOnTargetFor += log.shots_on_target_for ?? 0;
      countShots++;
    }

    if (log.shots_inside_box_for !== null && log.shots_inside_box_for !== undefined) {
      sumShotsInBoxFor += log.shots_inside_box_for;
      countShotsInBox++;
    }

    if (log.big_chances_for !== null && log.big_chances_for !== undefined) {
      sumBigChancesFor += log.big_chances_for;
      countBigChances++;
    }

    if (log.touches_in_penalty_area_for !== null && log.touches_in_penalty_area_for !== undefined) {
      sumBoxTouchesFor += log.touches_in_penalty_area_for;
      countBoxTouches++;
    }

    if (log.passes_accurate_for !== null && log.passes_accurate_for !== undefined) {
      sumPassesAcc += log.passes_accurate_for;
      sumPassPct += log.pass_accuracy_pct_for ?? 0;
      countPasses++;
    }

    if (log.accurate_crosses_for !== null && log.accurate_crosses_for !== undefined) {
      sumCrossesAcc += log.accurate_crosses_for;
      countCrosses++;
    }

    if (log.aerial_duels_pct_for !== null && log.aerial_duels_pct_for !== undefined) {
      sumAerialPct += log.aerial_duels_pct_for;
      countAerial++;
    }

    if (log.tackles_for !== null && log.tackles_for !== undefined) {
      sumTacklesFor += log.tackles_for;
      countTackles++;
    }

    if (log.corners_for !== null && log.corners_for !== undefined) {
      sumCornersFor += log.corners_for;
      countCorners++;
    }

    if (log.fouls_committed !== null && log.fouls_committed !== undefined) {
      sumFouls += log.fouls_committed;
      countFouls++;
    }

    if (log.yellow_cards !== null && log.yellow_cards !== undefined) {
      sumYellows += log.yellow_cards;
      countYellows++;
    }
  }

  return {
    team_id: teamId,
    sample_size: n,
    observed_xg_samples: countXg,
    observed_shots_samples: countShots,
    observed_passes_samples: countPasses,
    observed_aerial_samples: countAerial,

    // Rata-rata terukur (NULL jika 0 sampel observed)
    rolling_xg_for: countXg > 0 ? Number((sumXgFor / countXg).toFixed(2)) : null,
    rolling_xg_against: countXg > 0 ? Number((sumXgAgainst / countXg).toFixed(2)) : null,
    rolling_npxg_for: countNpxg > 0 ? Number((sumNpxgFor / countNpxg).toFixed(2)) : null,
    rolling_npxg_against: countNpxg > 0 ? Number((sumNpxgAgainst / countNpxg).toFixed(2)) : null,

    rolling_goals_for: Number((totalGoalsFor / n).toFixed(2)),
    rolling_goals_against: Number((totalGoalsAgainst / n).toFixed(2)),
    win_rate: Number((wins / n).toFixed(2)),
    clean_sheet_rate: Number((cleanSheets / n).toFixed(2)),
    form_sequence: formArr.join("-"),

    avg_possession_pct: countPossession > 0 ? Number((sumPossession / countPossession).toFixed(1)) : null,
    avg_shots_for: countShots > 0 ? Number((sumShotsFor / countShots).toFixed(1)) : null,
    avg_shots_on_target_for: countShots > 0 ? Number((sumShotsOnTargetFor / countShots).toFixed(1)) : null,
    avg_shots_inside_box_for: countShotsInBox > 0 ? Number((sumShotsInBoxFor / countShotsInBox).toFixed(1)) : null,
    avg_big_chances_for: countBigChances > 0 ? Number((sumBigChancesFor / countBigChances).toFixed(1)) : null,
    avg_box_touches_for: countBoxTouches > 0 ? Number((sumBoxTouchesFor / countBoxTouches).toFixed(1)) : null,

    avg_passes_accurate_for: countPasses > 0 ? Math.round(sumPassesAcc / countPasses) : null,
    avg_pass_accuracy_pct: countPasses > 0 ? Number((sumPassPct / countPasses).toFixed(1)) : null,
    avg_crosses_accurate_for: countCrosses > 0 ? Number((sumCrossesAcc / countCrosses).toFixed(1)) : null,
    avg_aerial_duels_pct_for: countAerial > 0 ? Number((sumAerialPct / countAerial).toFixed(1)) : null,

    avg_tackles_for: countTackles > 0 ? Number((sumTacklesFor / countTackles).toFixed(1)) : null,
    avg_corners_for: countCorners > 0 ? Number((sumCornersFor / countCorners).toFixed(1)) : null,
    avg_fouls_committed: countFouls > 0 ? Number((sumFouls / countFouls).toFixed(1)) : null,
    avg_yellow_cards: countYellows > 0 ? Number((sumYellows / countYellows).toFixed(1)) : null,

    recent_logs: logs,
  };
}

/**
 * Mengambil ringkasan telemetry skuad tim (cedera, bugar, unknown)
 */
export function getTeamSquadTelemetry(teamIdOrName: string): TeamSquadTelemetry {
  const teamId = resolveTeamId(teamIdOrName);
  const squad = getTeamSquad(teamId);
  const injured = squad.filter(
    (p) => p.injury_status && (p.injury_status.startsWith("INJURED") || p.injury_status.startsWith("SUSPENDED"))
  );
  const unknown = squad.filter(
    (p) => p.injury_status && p.injury_status.startsWith("UNKNOWN")
  );
  const fit = squad.filter(
    (p) => p.injury_status === "FIT"
  );

  let g = 0, d = 0, m = 0, f = 0;
  for (const p of squad) {
    if (p.position === "G") g++;
    else if (p.position === "D") d++;
    else if (p.position === "M") m++;
    else if (p.position === "F") f++;
  }

  return {
    team_id: teamId,
    total_players: squad.length,
    goalkeepers: g,
    defenders: d,
    midfielders: m,
    forwards: f,
    injured_players: injured,
    active_players: fit,
    unknown_status_players: unknown,
    has_verified_injury_data: unknown.length === 0 && squad.length > 0,
  };
}
