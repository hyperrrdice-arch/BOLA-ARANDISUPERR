import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { calcLogLoss, bootstrapPairedCI } from "./backtest-dixon-coles";

const db = getTheStatsDb();
const uclMatches = db.prepare(`
  SELECT match_id, utc_date, home_team_id, away_team_id, home_score, away_score
  FROM matches
  WHERE competition_id = 'comp_3498' AND home_score IS NOT NULL AND away_score IS NOT NULL
  ORDER BY utc_date ASC
`).all() as any[];

const teamNameStmt = db.prepare("SELECT name FROM teams WHERE team_id = ?");

// Test: Production with sqrt(q) vs unscaled Q(L) = 1.0
// In getShrunkMatchParameters, if leagueHint = 'UCL', it uses uefaCoefficient.
// If leagueHint = 'UNKNOWN' or without uefaCoefficient, it does not scale ratings.
// Or in backtest-dixon-coles.ts:986: unscaledRes = calculateDixonColes({ homeAttack * 1.1, homeDefense * 0.9... })
// Let's compute bootstrap CI for both!
const diffsHarness: number[] = [];

for (const m of uclMatches) {
  const hn = (teamNameStmt.get(m.home_team_id) as any)?.name;
  const an = (teamNameStmt.get(m.away_team_id) as any)?.name;
  const actual: "H" | "D" | "A" = m.home_score > m.away_score ? "H" : (m.home_score === m.away_score ? "D" : "A");

  const homeTelem = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, "UCL");
  const awayTelem = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, "UCL");

  const pWith = getShrunkMatchParameters({
    homeTeam: hn,
    awayTeam: an,
    homeTelemetry: homeTelem,
    awayTelemetry: awayTelem,
    matchDateCutoff: m.utc_date,
    leagueHint: "UCL",
  });
  const resWith = calculateDixonColes({
    homeAttack: pWith.homeAttack,
    homeDefense: pWith.homeDefense,
    awayAttack: pWith.awayAttack,
    awayDefense: pWith.awayDefense,
    homeAdvantage: pWith.homeAdvantage,
    leagueAvgGoals: pWith.leagueAvgGoals,
    rho: pWith.rho,
  });
  const llWith = calcLogLoss(resWith.prob_home_win, resWith.prob_draw, resWith.prob_away_win, actual);

  // Unscaled harness
  const unscaledRes = calculateDixonColes({
    homeAttack: pWith.homeAttack * 1.02,
    homeDefense: pWith.homeDefense * 0.98,
    awayAttack: pWith.awayAttack * 1.02,
    awayDefense: pWith.awayDefense * 0.98,
    homeAdvantage: 1.12,
    leagueAvgGoals: 2.04,
    rho: -0.05,
  });
  const llUnscaled = calcLogLoss(unscaledRes.prob_home_win, unscaledRes.prob_draw, unscaledRes.prob_away_win, actual);
  diffsHarness.push(llWith - llUnscaled);
}

const ciHarness = bootstrapPairedCI(diffsHarness, 1000);
console.log("UCL Harness Paired CI (N=36):", ciHarness);
