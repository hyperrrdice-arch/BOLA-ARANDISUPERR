/**
 * Mapper stats TheStatsAPI → baris `matches` + `team_match_logs`.
 *
 * Dipakai oleh DUA skrip supaya tidak ada duplikasi 60+ kolom:
 *   - `scripts/sync-weekly-telemetry.ts` (delta mingguan)
 *   - `scripts/promote-upcoming-to-telemetry.ts` (promosi fixture yang selesai)
 *
 * Semua angka wajib dari sumber; kalau tidak tersedia → null (bukan 0 karangan).
 */
import type { MatchMetaRecord, TeamMatchLogRecord } from "./db/thestats-dataset";

export interface MatchForMapping {
  id: string | number;
  utc_date?: string | null;
  status?: string | null;
  score?: { home?: number | null; away?: number | null } | null;
  home_score?: number | null;
  away_score?: number | null;
  home_team?: { id?: string | number | null } | null;
  away_team?: { id?: string | number | null } | null;
}

export interface MappedTelemetry {
  match: MatchMetaRecord;
  homeLog: TeamMatchLogRecord;
  awayLog: TeamMatchLogRecord;
}

export function mapStatsToTelemetry(args: {
  m: MatchForMapping;
  stats: any;
  competitionId: string;
  seasonName: string;
}): MappedTelemetry | null {
  const { m, stats, competitionId, seasonName } = args;
  const matchId = String(m.id);
  const homeId = m.home_team?.id != null ? String(m.home_team.id) : null;
  const awayId = m.away_team?.id != null ? String(m.away_team.id) : null;
  if (!homeId || !awayId || !m.utc_date) return null;

  const homeScore = Number(m.score?.home ?? m.home_score ?? 0);
  const awayScore = Number(m.score?.away ?? m.away_score ?? 0);
  const matchDate = m.utc_date.slice(0, 10);

  const ov = stats?.overview;
  const sh = stats?.shots;
  const att = stats?.attack;
  const pass = stats?.passes;
  const du = stats?.duels;
  const gk = stats?.goalkeeping;
  const npxg = stats?.np_expected_goals;
  const rawJson = stats ? JSON.stringify(stats) : null;

  const side = (v: "home" | "away") => ({
    xg_for: ov?.expected_goals?.all?.[v] ?? stats?.xg?.[v] ?? null,
    npxg_for: npxg?.all?.[v] ?? null,
    shots_for: sh?.total_shots?.all?.[v] ?? ov?.total_shots?.all?.[v] ?? null,
    sot_for: sh?.shots_on_target?.all?.[v] ?? ov?.shots_on_target?.all?.[v] ?? null,
    big_chances_for: ov?.big_chances?.all?.[v] ?? null,
    box_touches_for: att?.touches_in_penalty_area?.all?.[v] ?? null,
    possession: ov?.ball_possession?.all?.[v] ?? null,
    passes_for: ov?.accurate_passes?.all?.[v] ?? pass?.accurate_passes?.all?.[v] ?? null,
    crosses_for: pass?.accurate_crosses?.all?.[v] ?? null,
    aerial_for: du?.aerial_duels_percentage?.all?.[v] ?? null,
    corners_for: ov?.corner_kicks?.all?.[v] ?? null,
    yellow_for: ov?.yellow_cards?.all?.[v] ?? null,
    red_for: ov?.red_cards?.all?.[v] ?? null,
    saves_for: gk?.saves?.all?.[v] ?? ov?.goalkeeper_saves?.all?.[v] ?? null,
  });

  const h = side("home");
  const a = side("away");

  const match: MatchMetaRecord = {
    match_id: matchId,
    competition_id: competitionId,
    season: seasonName,
    utc_date: m.utc_date,
    status: String(m.status ?? "finished"),
    home_team_id: homeId,
    away_team_id: awayId,
    home_score: homeScore,
    away_score: awayScore,
  };

  type Side = ReturnType<typeof side>;
  const mk = (
    teamId: string,
    opponentId: string,
    venue: "HOME" | "AWAY",
    gf: number,
    ga: number,
    self: Side,
    opp: Side
  ): TeamMatchLogRecord => ({
    log_id: `${matchId}_${teamId}`,
    match_id: matchId,
    team_id: teamId,
    opponent_id: opponentId,
    venue,
    match_date: matchDate,
    season: seasonName,
    result: (gf > ga ? "W" : gf === ga ? "D" : "L") as "W" | "D" | "L",
    goals_for: gf,
    goals_against: ga,
    xg_for: self.xg_for,
    xg_against: opp.xg_for,
    npxg_for: self.npxg_for,
    npxg_against: opp.npxg_for,
    shots_for: self.shots_for,
    shots_against: opp.shots_for,
    shots_on_target_for: self.sot_for,
    shots_on_target_against: opp.sot_for,
    big_chances_for: self.big_chances_for,
    big_chances_against: opp.big_chances_for,
    touches_in_penalty_area_for: self.box_touches_for,
    touches_in_penalty_area_against: opp.box_touches_for,
    possession_pct: self.possession,
    passes_accurate_for: self.passes_for,
    passes_accurate_against: opp.passes_for,
    accurate_crosses_for: self.crosses_for,
    accurate_crosses_against: opp.crosses_for,
    aerial_duels_pct_for: self.aerial_for,
    aerial_duels_pct_against: opp.aerial_for,
    corners_for: self.corners_for,
    corners_against: opp.corners_for,
    yellow_cards: self.yellow_for,
    red_cards: self.red_for,
    saves_for: self.saves_for,
    saves_against: opp.saves_for,
    raw_stats_json: rawJson,
  });

  return {
    match,
    homeLog: mk(homeId, awayId, "HOME", homeScore, awayScore, h, a),
    awayLog: mk(awayId, homeId, "AWAY", awayScore, homeScore, a, h),
  };
}