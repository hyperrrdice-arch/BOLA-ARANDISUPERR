import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { calcLogLoss, bootstrapPairedCI } from "./backtest-dixon-coles";

const theStatsDb = getTheStatsDb();

const uclMatches = theStatsDb.prepare(`
  SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
  FROM matches
  WHERE competition_id = 'comp_3498' AND home_score IS NOT NULL AND away_score IS NOT NULL
  ORDER BY utc_date ASC
`).all() as any[];

const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

const diffs: number[] = [];

for (const m of uclMatches) {
  const hn = (teamNameStmt.get(m.home_team_id) as any)?.name;
  const an = (teamNameStmt.get(m.away_team_id) as any)?.name;
  const actual = m.home_score > m.away_score ? "H" : (m.home_score === m.away_score ? "D" : "A");

  const homeTelem = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, "UCL");
  const awayTelem = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, "UCL");

  const prodParams = getShrunkMatchParameters({
    homeTeam: hn,
    awayTeam: an,
    homeTelemetry: homeTelem,
    awayTelemetry: awayTelem,
    matchDateCutoff: m.utc_date,
    leagueHint: "UCL",
  });

  const resProd = calculateDixonColes({
    homeAttack: prodParams.homeAttack,
    homeDefense: prodParams.homeDefense,
    awayAttack: prodParams.awayAttack,
    awayDefense: prodParams.awayDefense,
    homeAdvantage: prodParams.homeAdvantage,
    leagueAvgGoals: prodParams.leagueAvgGoals,
    rho: prodParams.rho,
  });
  const llProd = calcLogLoss(resProd.prob_home_win, resProd.prob_draw, resProd.prob_away_win, actual);

  const unscaledRes = calculateDixonColes({
    homeAttack: prodParams.homeAttack * 1.1,
    homeDefense: prodParams.homeDefense * 0.9,
    awayAttack: prodParams.awayAttack * 1.1,
    awayDefense: prodParams.awayDefense * 0.9,
    homeAdvantage: 1.12,
    leagueAvgGoals: 2.04,
    rho: -0.05,
  });
  const llUnscaled = calcLogLoss(unscaledRes.prob_home_win, unscaledRes.prob_draw, unscaledRes.prob_away_win, actual);

  diffs.push(llProd - llUnscaled);
}

const ci = bootstrapPairedCI(diffs, 1000);
console.log("Bootstrap CI for Δ -0.0029 (N=36):");
console.log(`Mean Diff = ${ci.meanDiff}`);
console.log(`95% CI    = [${ci.ciLower}, ${ci.ciUpper}]`);
console.log(`p-value   = ${ci.pValue}`);
console.log(`Crosses 0 = ${ci.ciLower <= 0 && ci.ciUpper >= 0}`);
