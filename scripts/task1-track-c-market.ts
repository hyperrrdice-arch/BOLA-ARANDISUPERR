import fs from "node:fs";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getMasterDb } from "../lib/db/sqlite-master";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import {
  calcLogLoss,
  calcBrier,
  bootstrapPairedCI,
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

async function main() {
  const theStatsDb = getTheStatsDb();
  const masterDb = getMasterDb();

  const trainRatings = JSON.parse(
    fs.readFileSync("data/backtest_cache/ratings_train_20250630.json", "utf-8")
  );

  const cMatches = theStatsDb.prepare(`
    SELECT match_id, competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
    ORDER BY utc_date ASC
  `).all() as any[];

  const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

  // Load all master matches that have B365 odds
  const masterWithOdds = masterDb.prepare(`
    SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
    FROM matches
    WHERE b365h IS NOT NULL AND b365d IS NOT NULL AND b365a IS NOT NULL
  `).all() as any[];

  console.log(`Track C total matches: ${cMatches.length}`);
  console.log(`Master DB matches with odds: ${masterWithOdds.length}`);

  // Create fast index on master matches:
  // Map of `${div}_${date}_${norm(home)}` -> match
  const indexByDateHome = new Map<string, any>();
  const indexByHomeAway = new Map<string, any[]>();

  for (const m of masterWithOdds) {
    const h = normalizeTeamName(m.home_team).toLowerCase();
    const a = normalizeTeamName(m.away_team).toLowerCase();
    const d = m.date; // YYYY-MM-DD
    indexByDateHome.set(`${m.div}_${d}_${h}`, m);
    indexByDateHome.set(`${d}_${h}`, m);

    const haKey = `${h}_${a}`;
    if (!indexByHomeAway.has(haKey)) {
      indexByHomeAway.set(haKey, []);
    }
    indexByHomeAway.get(haKey)!.push(m);
  }

  interface PairedRecord {
    matchId: string;
    div: string;
    date: string;
    homeTeam: string;
    awayTeam: string;
    actual: "H" | "D" | "A";
    llProd: number;
    brierProd: number;
    llFixed8: number;
    brierFixed8: number;
    llFixed16: number;
    brierFixed16: number;
    llMarketShin: number;
    brierMarketShin: number;
    diffProdVsMarket: number;
    diffFixed8VsMarket: number;
    diffFixed16VsMarket: number;
  }

  const pairedRecords: PairedRecord[] = [];
  let unfindable = 0;

  for (const cm of cMatches) {
    const hn = (teamNameStmt.get(cm.home_team_id) as any)?.name;
    const an = (teamNameStmt.get(cm.away_team_id) as any)?.name;
    if (!hn || !an) continue;

    const div = COMPETITION_TO_DIV[cm.competition_id] || "UNKNOWN";
    const dateStr = cm.utc_date.slice(0, 10);
    const actual: "H" | "D" | "A" =
      cm.home_score > cm.away_score ? "H" : cm.home_score === cm.away_score ? "D" : "A";

    // 1. Calculate Model Predictions
    const ht = getTeamRollingTelemetry(cm.home_team_id, 6, cm.utc_date, div);
    const at = getTeamRollingTelemetry(cm.away_team_id, 6, cm.utc_date, div);

    const pProd = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: ht,
      awayTelemetry: at,
      matchDateCutoff: cm.utc_date,
      leagueHint: div,
    });

    const resProd = calculateDixonColes({
      homeAttack: pProd.homeAttack,
      homeDefense: pProd.homeDefense,
      awayAttack: pProd.awayAttack,
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const llProd = calcLogLoss(resProd.prob_home_win, resProd.prob_draw, resProd.prob_away_win, actual);
    const brierProd = calcBrier(resProd.prob_home_win, resProd.prob_draw, resProd.prob_away_win, actual);

    // Fixed 8
    const nH = ht.observed_xg_samples >= 3 ? ht.observed_xg_samples : ht.sample_size;
    const nA = at.observed_xg_samples >= 3 ? at.observed_xg_samples : at.sample_size;
    const latkH = (ht.rolling_xg_for || ht.rolling_goals_for || 1.35) / pProd.leagueAvgGoals;
    const latkA = (at.rolling_xg_for || at.rolling_goals_for || 1.15) / pProd.leagueAvgGoals;

    const wH8 = (nH + 8) > 0 ? nH / (nH + 8) : 0;
    const wA8 = (nA + 8) > 0 ? nA / (nA + 8) : 0;
    const res8 = calculateDixonColes({
      homeAttack: Math.max(0.5, wH8 * latkH + (1 - wH8) * pProd.homeAttack),
      homeDefense: pProd.homeDefense,
      awayAttack: Math.max(0.4, wA8 * latkA + (1 - wA8) * pProd.awayAttack),
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const llFixed8 = calcLogLoss(res8.prob_home_win, res8.prob_draw, res8.prob_away_win, actual);
    const brierFixed8 = calcBrier(res8.prob_home_win, res8.prob_draw, res8.prob_away_win, actual);

    // Fixed 16
    const wH16 = (nH + 16) > 0 ? nH / (nH + 16) : 0;
    const wA16 = (nA + 16) > 0 ? nA / (nA + 16) : 0;
    const res16 = calculateDixonColes({
      homeAttack: Math.max(0.5, wH16 * latkH + (1 - wH16) * pProd.homeAttack),
      homeDefense: pProd.homeDefense,
      awayAttack: Math.max(0.4, wA16 * latkA + (1 - wA16) * pProd.awayAttack),
      awayDefense: pProd.awayDefense,
      homeAdvantage: pProd.homeAdvantage,
      leagueAvgGoals: pProd.leagueAvgGoals,
      rho: pProd.rho,
    });
    const llFixed16 = calcLogLoss(res16.prob_home_win, res16.prob_draw, res16.prob_away_win, actual);
    const brierFixed16 = calcBrier(res16.prob_home_win, res16.prob_draw, res16.prob_away_win, actual);

    // 2. Find Market Odds in Master DB
    const hNorm = normalizeTeamName(hn).toLowerCase();
    const aNorm = normalizeTeamName(an).toLowerCase();

    // Try direct keys
    let masterMatch = indexByDateHome.get(`${div}_${dateStr}_${hNorm}`) || indexByDateHome.get(`${dateStr}_${hNorm}`);

    // If not found, try +/- 1 day
    if (!masterMatch) {
      const prevDate = new Date(new Date(dateStr).getTime() - 86400000).toISOString().slice(0, 10);
      const nextDate = new Date(new Date(dateStr).getTime() + 86400000).toISOString().slice(0, 10);
      masterMatch = indexByDateHome.get(`${div}_${prevDate}_${hNorm}`) ||
                    indexByDateHome.get(`${div}_${nextDate}_${hNorm}`) ||
                    indexByDateHome.get(`${prevDate}_${hNorm}`) ||
                    indexByDateHome.get(`${nextDate}_${hNorm}`);
    }

    // If still not found, check indexByHomeAway and find closest date
    if (!masterMatch) {
      const candidates = indexByHomeAway.get(`${hNorm}_${aNorm}`) || [];
      const cDate = new Date(dateStr).getTime();
      let bestMatch = null;
      let minDiff = Infinity;
      for (const cand of candidates) {
        const diff = Math.abs(new Date(cand.date).getTime() - cDate);
        if (diff <= 86400000 * 4 && diff < minDiff) {
          minDiff = diff;
          bestMatch = cand;
        }
      }
      masterMatch = bestMatch;
    }

    if (!masterMatch) {
      unfindable++;
      continue;
    }

    const shin = stripVigShin(masterMatch.b365h, masterMatch.b365d, masterMatch.b365a);
    const llMarketShin = calcLogLoss(shin.fair_prob.home, shin.fair_prob.draw, shin.fair_prob.away, actual);
    const brierMarketShin = calcBrier(shin.fair_prob.home, shin.fair_prob.draw, shin.fair_prob.away, actual);

    pairedRecords.push({
      matchId: cm.match_id,
      div,
      date: dateStr,
      homeTeam: hn,
      awayTeam: an,
      actual,
      llProd,
      brierProd,
      llFixed8,
      brierFixed8,
      llFixed16,
      brierFixed16,
      llMarketShin,
      brierMarketShin,
      diffProdVsMarket: llProd - llMarketShin,
      diffFixed8VsMarket: llFixed8 - llMarketShin,
      diffFixed16VsMarket: llFixed16 - llMarketShin,
    });
  }

  console.log(`\n======================================================`);
  console.log(`Hasil Matching: ${pairedRecords.length} match memiliki closing line market (Unfindable: ${unfindable})`);
  console.log(`======================================================`);

  const N = pairedRecords.length;
  const avgLlProd = pairedRecords.reduce((s, r) => s + r.llProd, 0) / N;
  const avgBrierProd = pairedRecords.reduce((s, r) => s + r.brierProd, 0) / N;
  const avgLl8 = pairedRecords.reduce((s, r) => s + r.llFixed8, 0) / N;
  const avgBrier8 = pairedRecords.reduce((s, r) => s + r.brierFixed8, 0) / N;
  const avgLl16 = pairedRecords.reduce((s, r) => s + r.llFixed16, 0) / N;
  const avgBrier16 = pairedRecords.reduce((s, r) => s + r.brierFixed16, 0) / N;
  const avgLlMarket = pairedRecords.reduce((s, r) => s + r.llMarketShin, 0) / N;
  const avgBrierMarket = pairedRecords.reduce((s, r) => s + r.brierMarketShin, 0) / N;

  const diffProdVsMarketArr = pairedRecords.map(r => r.diffProdVsMarket);
  const diff8VsMarketArr = pairedRecords.map(r => r.diffFixed8VsMarket);
  const diff16VsMarketArr = pairedRecords.map(r => r.diffFixed16VsMarket);

  const ciProdVsMarket = bootstrapPairedCI(diffProdVsMarketArr, 1000);
  const ci8VsMarket = bootstrapPairedCI(diff8VsMarketArr, 1000);
  const ci16VsMarket = bootstrapPairedCI(diff16VsMarketArr, 1000);

  console.log(`\n(N = ${N}):`);
  console.log(`- Market Shin 1993            : Log-Loss = ${avgLlMarket.toFixed(4)} | Brier = ${avgBrierMarket.toFixed(4)}`);
  console.log(`- Model Produksi Bimodal      : Log-Loss = ${avgLlProd.toFixed(4)} | Brier = ${avgBrierProd.toFixed(4)}`);
  console.log(`  -> Paired Δ (Prod - Market) : ${ciProdVsMarket.meanDiff} (95% CI: [${ciProdVsMarket.ciLower}, ${ciProdVsMarket.ciUpper}], p=${ciProdVsMarket.pValue})`);
  console.log(`- Ablasi Fixed κ=8            : Log-Loss = ${avgLl8.toFixed(4)} | Brier = ${avgBrier8.toFixed(4)}`);
  console.log(`  -> Paired Δ (κ=8 - Market)  : ${ci8VsMarket.meanDiff} (95% CI: [${ci8VsMarket.ciLower}, ${ci8VsMarket.ciUpper}], p=${ci8VsMarket.pValue})`);
  console.log(`- Ablasi Fixed κ=16           : Log-Loss = ${avgLl16.toFixed(4)} | Brier = ${avgBrier16.toFixed(4)}`);
  console.log(`  -> Paired Δ (κ=16 - Market) : ${ci16VsMarket.meanDiff} (95% CI: [${ci16VsMarket.ciLower}, ${ci16VsMarket.ciUpper}], p=${ci16VsMarket.pValue})`);

  // Write results to JSON for verification
  fs.writeFileSync("data/task1_market_track_c.json", JSON.stringify({
    N,
    unfindable,
    marketShin: { logLoss: Number(avgLlMarket.toFixed(4)), brier: Number(avgBrierMarket.toFixed(4)) },
    productionBimodal: {
      logLoss: Number(avgLlProd.toFixed(4)),
      brier: Number(avgBrierProd.toFixed(4)),
      pairedDeltaVsMarket: ciProdVsMarket,
    },
    ablationFixedKappa8: {
      logLoss: Number(avgLl8.toFixed(4)),
      brier: Number(avgBrier8.toFixed(4)),
      pairedDeltaVsMarket: ci8VsMarket,
    },
    ablationFixedKappa16: {
      logLoss: Number(avgLl16.toFixed(4)),
      brier: Number(avgBrier16.toFixed(4)),
      pairedDeltaVsMarket: ci16VsMarket,
    },
  }, null, 2));
}

main().catch(console.error);
