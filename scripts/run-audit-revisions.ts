import fs from "node:fs";
import { getMasterDb } from "../lib/db/sqlite-master";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import {
  calcLogLoss,
  calcBrier,
  bootstrapPairedCI,
  resolveTeamRating,
} from "./backtest-dixon-coles";

const COMPETITION_TO_DIV: Record<string, string> = {
  comp_3039: "E0",
  comp_8814: "SP1",
  comp_5840: "I1",
  comp_4643: "D1",
  comp_0256: "F1",
  comp_3809: "N1",
  comp_3498: "UCL",
};

async function run() {
  const masterDb = getMasterDb();
  const theStatsDb = getTheStatsDb();
  const trainRatings = JSON.parse(
    fs.readFileSync("data/backtest_cache/ratings_train_20250630.json", "utf-8")
  );

  console.log("=== 1. MARKET SHIN PADA 1.078 MATCH 2026/2027 (TRACK B) ===");
  const bMatches = masterDb
    .prepare(
      "SELECT id, div, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a, h_xg, a_xg FROM matches WHERE season = '2026/2027' AND h_xg IS NOT NULL AND a_xg IS NOT NULL AND b365h > 1.0 AND b365d > 1.0 AND b365a > 1.0"
    )
    .all() as any[];

  let sumLlShin1078 = 0;
  let sumBrierShin1078 = 0;
  let sumLlDc1078 = 0;
  let sumBrierDc1078 = 0;
  let sumLlLeakedXg = 0;
  const pairedDiffDcVsShin: number[] = [];

  for (const m of bMatches) {
    const act = m.ftr;
    const l = trainRatings.leagues[m.div];
    const hr = resolveTeamRating(trainRatings, m.div, m.home_team);
    const ar = resolveTeamRating(trainRatings, m.div, m.away_team);

    const rDc = calculateDixonColes({
      homeAttack: hr.rating.attack,
      homeDefense: hr.rating.defense,
      awayAttack: ar.rating.attack,
      awayDefense: ar.rating.defense,
      homeAdvantage: l.homeAdvantage,
      leagueAvgGoals: l.leagueAvgGoals,
      rho: l.rho,
    });
    const llDc = calcLogLoss(rDc.prob_home_win, rDc.prob_draw, rDc.prob_away_win, act);
    sumLlDc1078 += llDc;
    sumBrierDc1078 += calcBrier(rDc.prob_home_win, rDc.prob_draw, rDc.prob_away_win, act);

    // Leaked post-hoc xG
    const rXg = calculateDixonColes({
      homeAttack: (Math.max(0.2, m.h_xg) / l.leagueAvgGoals) * (1 / l.homeAdvantage),
      homeDefense: 1.0,
      awayAttack: Math.max(0.2, m.a_xg) / l.leagueAvgGoals,
      awayDefense: 1.0,
      homeAdvantage: l.homeAdvantage,
      leagueAvgGoals: l.leagueAvgGoals,
      rho: l.rho,
    });
    sumLlLeakedXg += calcLogLoss(rXg.prob_home_win, rXg.prob_draw, rXg.prob_away_win, act);

    // Shin closing
    const s = stripVigShin(m.b365h, m.b365d, m.b365a);
    const llShin = calcLogLoss(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, act);
    sumLlShin1078 += llShin;
    sumBrierShin1078 += calcBrier(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, act);

    pairedDiffDcVsShin.push(llDc - llShin);
  }

  const avgLlShin = sumLlShin1078 / bMatches.length;
  const avgLlDc = sumLlDc1078 / bMatches.length;
  const avgLlLeakedXg = sumLlLeakedXg / bMatches.length;
  const ciDcVsShin = bootstrapPairedCI(pairedDiffDcVsShin);

  console.log(`N = ${bMatches.length}`);
  console.log(`Goals Dixon-Coles (Sah, Out-of-Sample) : Log-Loss = ${avgLlDc.toFixed(4)} | Brier = ${(sumBrierDc1078/bMatches.length).toFixed(4)}`);
  console.log(`Market Shin 1993 (Bet365 Closing)     : Log-Loss = ${avgLlShin.toFixed(4)} | Brier = ${(sumBrierShin1078/bMatches.length).toFixed(4)}`);
  console.log(`Post-Hoc Leaked xG (Match T)          : Log-Loss = ${avgLlLeakedXg.toFixed(4)}`);
  console.log(`Paired Δ (Goals DC - Market Shin)      : ${ciDcVsShin.meanDiff} (95% CI: [${ciDcVsShin.ciLower}, ${ciDcVsShin.ciUpper}], p=${ciDcVsShin.pValue})`);

  console.log("\n=== 2. BOOTSTRAP CI ABLASI KAPPA TRACK C (N=405) ===");
  const cMatches = theStatsDb.prepare("SELECT * FROM matches WHERE home_score IS NOT NULL ORDER BY utc_date ASC").all() as any[];
  const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

  const diff8VsBimodal: number[] = [];
  const diff16VsBimodal: number[] = [];
  const diffMacroVsBimodal: number[] = [];

  for (const m of cMatches) {
    const hn = (teamNameStmt.get(m.home_team_id) as any).name;
    const an = (teamNameStmt.get(m.away_team_id) as any).name;
    const div = COMPETITION_TO_DIV[m.competition_id] || "UNKNOWN";
    const act = m.home_score > m.away_score ? "H" : m.home_score === m.away_score ? "D" : "A";

    const ht = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, div);
    const at = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, div);

    const pProd = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: ht,
      awayTelemetry: at,
      matchDateCutoff: m.utc_date,
      leagueHint: div,
    });
    const rProd = calculateDixonColes({
      homeAttack: pProd.homeAttack,
      homeDefense: pProd.homeDefense,
      awayAttack: pProd.awayAttack,
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const llProd = calcLogLoss(rProd.prob_home_win, rProd.prob_draw, rProd.prob_away_win, act);

    const nH = ht.observed_xg_samples >= 3 ? ht.observed_xg_samples : ht.sample_size;
    const nA = at.observed_xg_samples >= 3 ? at.observed_xg_samples : at.sample_size;
    const latkH = (ht.rolling_xg_for || ht.rolling_goals_for || 1.35) / pProd.leagueAvgGoals;
    const latkA = (at.rolling_xg_for || at.rolling_goals_for || 1.15) / pProd.leagueAvgGoals;

    // Fixed 8
    const wH8 = (nH + 8) > 0 ? nH / (nH + 8) : 0;
    const wA8 = (nA + 8) > 0 ? nA / (nA + 8) : 0;
    const r8 = calculateDixonColes({
      homeAttack: Math.max(0.5, wH8 * latkH + (1 - wH8) * pProd.homeAttack),
      homeDefense: pProd.homeDefense,
      awayAttack: Math.max(0.4, wA8 * latkA + (1 - wA8) * pProd.awayAttack),
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const ll8 = calcLogLoss(r8.prob_home_win, r8.prob_draw, r8.prob_away_win, act);
    diff8VsBimodal.push(ll8 - llProd);

    // Fixed 16
    const wH16 = (nH + 16) > 0 ? nH / (nH + 16) : 0;
    const wA16 = (nA + 16) > 0 ? nA / (nA + 16) : 0;
    const r16 = calculateDixonColes({
      homeAttack: Math.max(0.5, wH16 * latkH + (1 - wH16) * pProd.homeAttack),
      homeDefense: pProd.homeDefense,
      awayAttack: Math.max(0.4, wA16 * latkA + (1 - wA16) * pProd.awayAttack),
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const ll16 = calcLogLoss(r16.prob_home_win, r16.prob_draw, r16.prob_away_win, act);
    diff16VsBimodal.push(ll16 - llProd);

    // Macro only
    const pMacro = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: null,
      awayTelemetry: null,
      matchDateCutoff: m.utc_date,
      leagueHint: div,
    });
    const rMacro = calculateDixonColes({
      homeAttack: pMacro.homeAttack,
      homeDefense: pMacro.homeDefense,
      awayAttack: pMacro.awayAttack,
      awayDefense: pMacro.awayDefense,
      homeAdvantage: pMacro.homeAdvantage,
      leagueAvgGoals: pMacro.leagueAvgGoals,
      rho: pMacro.rho,
    });
    const llMacro = calcLogLoss(rMacro.prob_home_win, rMacro.prob_draw, rMacro.prob_away_win, act);
    diffMacroVsBimodal.push(llMacro - llProd);
  }

  const ci8VsBimodal = bootstrapPairedCI(diff8VsBimodal);
  const ci16VsBimodal = bootstrapPairedCI(diff16VsBimodal);
  const ciMacroVsBimodal = bootstrapPairedCI(diffMacroVsBimodal);

  console.log(`Fixed 8 vs Bimodal  : Δ = ${ci8VsBimodal.meanDiff} (95% CI: [${ci8VsBimodal.ciLower}, ${ci8VsBimodal.ciUpper}], p=${ci8VsBimodal.pValue})`);
  console.log(`Fixed 16 vs Bimodal : Δ = ${ci16VsBimodal.meanDiff} (95% CI: [${ci16VsBimodal.ciLower}, ${ci16VsBimodal.ciUpper}], p=${ci16VsBimodal.pValue})`);
  console.log(`Macro vs Bimodal    : Δ = ${ciMacroVsBimodal.meanDiff} (95% CI: [${ciMacroVsBimodal.ciLower}, ${ciMacroVsBimodal.ciUpper}], p=${ciMacroVsBimodal.pValue})`);

  console.log("\n=== 3. ABLASI TIM PROMOSI DENGAN vs TANPA DISKON (TRACK A) ===");
  const testMatches = masterDb
    .prepare("SELECT * FROM matches WHERE season IN ('2025/2026', '2026/2027') AND fthg IS NOT NULL ORDER BY date ASC")
    .all() as any[];

  let promCount = 0;
  let sumLlPromWithDiscount = 0;
  let sumLlPromWithoutDiscount = 0;
  const diffProm: number[] = [];

  for (const m of testMatches) {
    const l = trainRatings.leagues[m.div];
    if (!l) continue;
    const hr = resolveTeamRating(trainRatings, m.div, m.home_team);
    const ar = resolveTeamRating(trainRatings, m.div, m.away_team);

    if (hr.source === "promoted" || ar.source === "promoted") {
      promCount++;
      const act = m.ftr;

      // Model dengan diskon produksi (15% atk, 20% def)
      const rWith = calculateDixonColes({
        homeAttack: hr.rating.attack,
        homeDefense: hr.rating.defense,
        awayAttack: ar.rating.attack,
        awayDefense: ar.rating.defense,
        homeAdvantage: l.homeAdvantage,
        leagueAvgGoals: l.leagueAvgGoals,
        rho: l.rho,
      });
      const llWith = calcLogLoss(rWith.prob_home_win, rWith.prob_draw, rWith.prob_away_win, act);
      sumLlPromWithDiscount += llWith;

      // Model TANPA diskon promosi (pakai raw attack/defense tim tanpa penyesuaian)
      const rawAtkH = hr.source === "promoted" ? hr.rating.attack / 0.85 : hr.rating.attack;
      const rawDefH = hr.source === "promoted" ? hr.rating.defense / 1.20 : hr.rating.defense;
      const rawAtkA = ar.source === "promoted" ? ar.rating.attack / 0.85 : ar.rating.attack;
      const rawDefA = ar.source === "promoted" ? ar.rating.defense / 1.20 : ar.rating.defense;

      const rWithout = calculateDixonColes({
        homeAttack: rawAtkH,
        homeDefense: rawDefH,
        awayAttack: rawAtkA,
        awayDefense: rawDefA,
        homeAdvantage: l.homeAdvantage,
        leagueAvgGoals: l.leagueAvgGoals,
        rho: l.rho,
      });
      const llWithout = calcLogLoss(rWithout.prob_home_win, rWithout.prob_draw, rWithout.prob_away_win, act);
      sumLlPromWithoutDiscount += llWithout;
      diffProm.push(llWith - llWithout);
    }
  }

  const ciProm = bootstrapPairedCI(diffProm);
  console.log(`Promoted Matches N = ${promCount}`);
  console.log(`Log-Loss DENGAN diskon (15%/20%) : ${(sumLlPromWithDiscount/promCount).toFixed(4)}`);
  console.log(`Log-Loss TANPA diskon promosi    : ${(sumLlPromWithoutDiscount/promCount).toFixed(4)}`);
  console.log(`Paired Δ (Dengan - Tanpa)         : ${ciProm.meanDiff} (95% CI: [${ciProm.ciLower}, ${ciProm.ciUpper}], p=${ciProm.pValue})`);
}

run().catch(console.error);
