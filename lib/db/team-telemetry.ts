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
  observed_crosses_samples: number;

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
  // CATATAN SEMANTIK: aerial_duels_pct_for + ground_duels_pct_for = duels_won_pct_for.
  // Jadi aerial_duels_pct_for adalah JUMLAH duel udara yang dimenangkan (bukan persentase
  // dan bukan win-rate udara). Rasio aerial_share dihitung di konsumen.
  avg_duels_won_pct_for: number | null;
  avg_ground_duels_pct_for: number | null;

  // 6. Bertahan & Disiplin
  avg_tackles_for: number | null;
  avg_corners_for: number | null;
  avg_fouls_committed: number | null;
  avg_yellow_cards: number | null;

  recent_logs: TeamMatchLogRecord[];

  // 7. Gesekan Jadwal & Kelelahan Kontinental (Midweek Fatigue Signal)
  schedule_friction?: {
    last_match_date: string | null;
    rest_days: number | null;
    midweek_continental: boolean;
    fatigue_risk: "HIGH" | "MODERATE" | "LOW";
  };
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

export const COMPETITION_AVG_GOALS: Record<string, number> = {
  comp_3039: 1.48, // EPL (E0)
  comp_8814: 1.54, // LaLiga (SP1)
  comp_5840: 1.43, // Serie A (I1)
  comp_4643: 1.91, // Bundesliga (D1)
  comp_0256: 1.45, // Ligue 1 (F1)
  comp_3809: 1.87, // Eredivisie (N1)
  comp_3498: 2.04, // UCL (Continental)
};

export const DIV_TO_COMPETITION_ID: Record<string, string> = {
  E0: "comp_3039",
  SP1: "comp_8814",
  I1: "comp_5840",
  D1: "comp_4643",
  F1: "comp_0256",
  N1: "comp_3809",
  UCL: "comp_3498",
};

/**
 * Mengambil log laga pra-pertandingan (Anti-Data Leakage)
 * Menyertakan competition_id dari matches untuk normalisasi kompetisi
 */
export function getPreMatchLogs(
  teamIdOrName: string,
  limit: number = 6,
  beforeDate?: string
): (TeamMatchLogRecord & { competition_id?: string })[] {
  const db = getTheStatsDb();
  const teamId = resolveTeamId(teamIdOrName);
  // Boundary normalization: beforeDate boleh ISO timestamp utuh, tapi kolom match_date
  // disimpan sebagai tanggal 10-digit. Tanpa slice, '2026-09-08' < '2026-09-08T16:45...' = TRUE
  // dan match T sendiri ikut masuk rolling window-nya (post-hoc leakage).
  const cutoff = beforeDate ? beforeDate.slice(0, 10) : undefined;
  if (cutoff) {
    const stmt = db.prepare(`
      SELECT l.*, m.competition_id FROM team_match_logs l
      LEFT JOIN matches m ON l.match_id = m.match_id
      WHERE l.team_id = ? AND l.match_date < ?
      ORDER BY l.match_date DESC
      LIMIT ?
    `);
    return stmt.all(teamId, cutoff, limit) as unknown as (TeamMatchLogRecord & { competition_id?: string })[];
  }

  const stmt = db.prepare(`
    SELECT l.*, m.competition_id FROM team_match_logs l
    LEFT JOIN matches m ON l.match_id = m.match_id
    WHERE l.team_id = ?
    ORDER BY l.match_date DESC
    LIMIT ?
  `);
  return stmt.all(teamId, limit) as unknown as (TeamMatchLogRecord & { competition_id?: string })[];
}

/**
 * Menghitung rolling metrics tanpa silent imputation (Zero False Assumptions)
 * Menerapkan Weighted Normalization xG lintas kompetisi jika targetDivCode disediakan.
 */
export function getTeamRollingTelemetry(
  teamId: string,
  limit: number = 6,
  beforeDate?: string,
  targetDivCode?: string
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
      observed_crosses_samples: 0,
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
      avg_duels_won_pct_for: null,
      avg_ground_duels_pct_for: null,
      avg_tackles_for: null,
      avg_corners_for: null,
      avg_fouls_committed: null,
      avg_yellow_cards: null,
      recent_logs: [],
    };
  }

  const n = logs.length;

  // Resolusi bobot target liga untuk normalisasi xG
  const targetCompId = targetDivCode ? DIV_TO_COMPETITION_ID[targetDivCode.toUpperCase()] : undefined;
  const targetAvgGoals = targetCompId ? (COMPETITION_AVG_GOALS[targetCompId] || 1.48) : 1.48;

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
  let sumDuelsWon = 0, countDuelsWon = 0;
  let sumGroundPct = 0, countGround = 0;
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

    // Weighted Normalization factor untuk xG (EPL vs UCL dll.)
    let xgWeight = 1.0;
    if (log.competition_id && targetCompId && log.competition_id !== targetCompId) {
      const logCompAvg = COMPETITION_AVG_GOALS[log.competition_id] || targetAvgGoals;
      if (logCompAvg > 0) {
        xgWeight = Number((targetAvgGoals / logCompAvg).toFixed(3));
      }
    }

    // Observed xG dengan penskalaan normalisasi kompetisi
    if (log.xg_for !== null && log.xg_for !== undefined) {
      sumXgFor += log.xg_for * xgWeight;
      sumXgAgainst += (log.xg_against ?? 0) * xgWeight;
      countXg++;
    }

    // Observed npxG dengan penskalaan normalisasi kompetisi
    if (log.npxg_for !== null && log.npxg_for !== undefined) {
      sumNpxgFor += log.npxg_for * xgWeight;
      sumNpxgAgainst += (log.npxg_against ?? 0) * xgWeight;
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

    if (log.duels_won_pct_for !== null && log.duels_won_pct_for !== undefined) {
      sumDuelsWon += log.duels_won_pct_for;
      countDuelsWon++;
    }

    if (log.ground_duels_pct_for !== null && log.ground_duels_pct_for !== undefined) {
      sumGroundPct += log.ground_duels_pct_for;
      countGround++;
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
    observed_crosses_samples: countCrosses,

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
    avg_duels_won_pct_for: countDuelsWon > 0 ? Number((sumDuelsWon / countDuelsWon).toFixed(1)) : null,
    avg_ground_duels_pct_for: countGround > 0 ? Number((sumGroundPct / countGround).toFixed(1)) : null,

    avg_tackles_for: countTackles > 0 ? Number((sumTacklesFor / countTackles).toFixed(1)) : null,
    avg_corners_for: countCorners > 0 ? Number((sumCornersFor / countCorners).toFixed(1)) : null,
    avg_fouls_committed: countFouls > 0 ? Number((sumFouls / countFouls).toFixed(1)) : null,
    avg_yellow_cards: countYellows > 0 ? Number((sumYellows / countYellows).toFixed(1)) : null,

    recent_logs: logs,

    schedule_friction: (() => {
      if (logs.length === 0 || !logs[0].match_date) return undefined;
      const lastDate = new Date(logs[0].match_date).getTime();
      const refDate = beforeDate ? new Date(beforeDate).getTime() : Date.now();
      const restDays = Math.max(0, Math.round((refDate - lastDate) / (1000 * 60 * 60 * 24)));
      const isContinental = logs[0].competition_id === "comp_3498";
      return {
        last_match_date: logs[0].match_date,
        rest_days: restDays,
        midweek_continental: isContinental && restDays <= 4,
        fatigue_risk: (isContinental && restDays <= 3) ? "HIGH" : (restDays <= 3 ? "MODERATE" : "LOW"),
      };
    })(),
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
