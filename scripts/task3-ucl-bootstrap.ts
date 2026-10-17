import fs from "node:fs";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { calcLogLoss, bootstrapPairedCI } from "./backtest-dixon-coles";

async function run() {
  const theStatsDb = getTheStatsDb();
  const trainRatings = JSON.parse(
    fs.readFileSync("data/backtest_cache/ratings_train_20250630.json", "utf-8")
  );

  const uclMatches = theStatsDb.prepare(`
    SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE competition_id = 'comp_3498' AND home_score IS NOT NULL AND away_score IS NOT NULL
    ORDER BY utc_date ASC
  `).all() as any[];

  const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

  console.log(`UCL matches count: ${uclMatches.length}`);

  const diffs: number[] = [];
  let sumWith = 0;
  let sumWithout = 0;

  for (const m of uclMatches) {
    const hn = (teamNameStmt.get(m.home_team_id) as any)?.name;
    const an = (teamNameStmt.get(m.away_team_id) as any)?.name;
    const actual: "H" | "D" | "A" =
      m.home_score > m.away_score ? "H" : m.home_score === m.away_score ? "D" : "A";

    const ht = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, "UCL");
    const at = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, "UCL");

    // 1. With UCL scaling (Production)
    const pWith = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: ht,
      awayTelemetry: at,
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
    sumWith += llWith;

    // 2. Without UCL scaling: leagueHint !== 'UCL' (e.g. UNKNOWN)
    const pWithout = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: ht,
      awayTelemetry: at,
      matchDateCutoff: m.utc_date,
      leagueHint: "UNKNOWN",
    });
    const resWithout = calculateDixonColes({
      homeAttack: pWithout.homeAttack,
      homeDefense: pWithout.homeDefense,
      awayAttack: pWithout.awayAttack,
      awayDefense: pWithout.awayDefense,
      homeAdvantage: pWithout.homeAdvantage,
      leagueAvgGoals: pWithout.leagueAvgGoals,
      rho: pWithout.rho,
    });
    const llWithout = calcLogLoss(resWithout.prob_home_win, resWithout.prob_draw, resWithout.prob_away_win, actual);
    sumWithout += llWithout;

    diffs.push(llWith - llWithout);
  }

  const N = uclMatches.length;
  const avgWith = sumWith / N;
  const avgWithout = sumWithout / N;
  const ci = bootstrapPairedCI(diffs, 1000);

  console.log(`With Sqrt Q Log-Loss    : ${avgWith.toFixed(4)}`);
  console.log(`Without Sqrt Q Log-Loss : ${avgWithout.toFixed(4)}`);
  console.log(`Paired Δ (With - Without): ${ci.meanDiff} (95% CI: [${ci.ciLower}, ${ci.ciUpper}], p=${ci.pValue})`);
}

run().catch(console.error);
