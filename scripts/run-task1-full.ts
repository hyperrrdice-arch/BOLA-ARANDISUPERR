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

// Aliases for matching between thestats teams and masterDb teams
const NAME_MAP: Record<string, string> = {
  "Fortuna Sittard": "For Sittard",
  "SV 07 Elversberg": "SV Elversberg",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "TSG Hoffenheim": "TSG 1899 Hoffenheim",
  "1. FC Köln": "1. FC Koln",
  "FC Bayern München": "Bayern Munich",
  "FC Schalke 04": "Schalke 04",
  "Willem II Tilburg": "Willem II",
  "SC Cambuur": "Cambuur",
  "ADO Den Haag": "Den Haag",
  "Bayer 04 Leverkusen": "Bayer Leverkusen",
  "Borussia M'gladbach": "Borussia Monchengladbach",
  "Inter": "Inter",
  "Internazionale": "Inter",
  "Paris Saint-Germain": "Paris SG",
  "Athletic Club": "Athletic Bilbao",
  "Atlético Madrid": "Ath Madrid",
  "Celta de Vigo": "Celta",
  "RCD Espanyol": "Espanyol",
  "RCD Mallorca": "Mallorca",
  "Real Betis": "Betis",
  "Real Sociedad": "Sociedad",
  "Real Valladolid": "Valladolid",
  "Rayo Vallecano": "Vallecano",
  "Deportivo Alavés": "Alaves",
  "Sporting CP": "Sporting",
  "Sporting Braga": "Sp Braga",
  "FC Porto": "Porto",
  "SL Benfica": "Benfica",
};

function normalizeForSearch(name: string): string {
  const mapped = NAME_MAP[name] || name;
  return normalizeTeamName(mapped).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function run() {
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

  const master2627 = masterDb.prepare(`
    SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
    FROM matches
    WHERE season = '2026/2027' AND b365h IS NOT NULL AND b365d IS NOT NULL AND b365a IS NOT NULL
  `).all() as any[];

  console.log(`Track C total: ${cMatches.length}`);
  console.log(`Master matches 26/27 with odds: ${master2627.length}`);

  let matched = 0;
  let uclSkipped = 0;
  const unmatched: any[] = [];

  const paired: any[] = [];

  for (const cm of cMatches) {
    if (cm.competition_id === "comp_3498") {
      uclSkipped++;
      continue;
    }

    const hn = (teamNameStmt.get(cm.home_team_id) as any)?.name;
    const an = (teamNameStmt.get(cm.away_team_id) as any)?.name;
    const div = COMPETITION_TO_DIV[cm.competition_id];
    const d = cm.utc_date.slice(0, 10);
    const actual: "H" | "D" | "A" =
      cm.home_score > cm.away_score ? "H" : cm.home_score === cm.away_score ? "D" : "A";

    const cnH = normalizeForSearch(hn);
    const cnA = normalizeForSearch(an);

    // Find in master2627
    const mm = master2627.find(m => {
      if (m.div !== div) return false;
      const dateDiff = Math.abs(new Date(m.date).getTime() - new Date(d).getTime());
      if (dateDiff > 86400000 * 3) return false;

      const mH = normalizeForSearch(m.home_team);
      const mA = normalizeForSearch(m.away_team);

      const hMatch = mH === cnH || mH.includes(cnH) || cnH.includes(mH);
      const aMatch = mA === cnA || mA.includes(cnA) || cnA.includes(mA);
      return hMatch && aMatch;
    });

    if (!mm) {
      unmatched.push({ hn, an, div, d, id: cm.match_id });
      continue;
    }

    matched++;

    // Calculate Model Productions
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
    const ll8 = calcLogLoss(res8.prob_home_win, res8.prob_draw, res8.prob_away_win, actual);
    const brier8 = calcBrier(res8.prob_home_win, res8.prob_draw, res8.prob_away_win, actual);

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
    const ll16 = calcLogLoss(res16.prob_home_win, res16.prob_draw, res16.prob_away_win, actual);
    const brier16 = calcBrier(res16.prob_home_win, res16.prob_draw, res16.prob_away_win, actual);

    // Market Shin
    const s = stripVigShin(mm.b365h, mm.b365d, mm.b365a);
    const llMarket = calcLogLoss(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, actual);
    const brierMarket = calcBrier(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, actual);

    paired.push({
      matchId: cm.match_id,
      div,
      actual,
      llProd,
      brierProd,
      ll8,
      brier8,
      ll16,
      brier16,
      llMarket,
      brierMarket,
      diffProdVsMarket: llProd - llMarket,
      diff8VsMarket: ll8 - llMarket,
      diff16VsMarket: ll16 - llMarket,
    });
  }

  console.log(`Matched Domestic: ${matched} / 369 (UCL skipped: ${uclSkipped})`);
  console.log(`Unmatched count: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log("Unmatched:", unmatched);
  }

  const N = paired.length;
  const avgLlMarket = paired.reduce((s, r) => s + r.llMarket, 0) / N;
  const avgBrierMarket = paired.reduce((s, r) => s + r.brierMarket, 0) / N;

  const avgLlProd = paired.reduce((s, r) => s + r.llProd, 0) / N;
  const avgBrierProd = paired.reduce((s, r) => s + r.brierProd, 0) / N;

  const avgLl8 = paired.reduce((s, r) => s + r.ll8, 0) / N;
  const avgBrier8 = paired.reduce((s, r) => s + r.brier8, 0) / N;

  const avgLl16 = paired.reduce((s, r) => s + r.ll16, 0) / N;
  const avgBrier16 = paired.reduce((s, r) => s + r.brier16, 0) / N;

  const ciProdVsMarket = bootstrapPairedCI(paired.map(r => r.diffProdVsMarket), 1000);
  const ci8VsMarket = bootstrapPairedCI(paired.map(r => r.diff8VsMarket), 1000);
  const ci16VsMarket = bootstrapPairedCI(paired.map(r => r.diff16VsMarket), 1000);

  console.log(`\n======================================================`);
  console.log(`HASIL TRACK C vs MARKET SHIN (N = ${N} Matches):`);
  console.log(`======================================================`);
  console.log(`Market Shin 1993            : Log-Loss = ${avgLlMarket.toFixed(4)} | Brier = ${avgBrierMarket.toFixed(4)}`);
  console.log(`Model Produksi Bimodal      : Log-Loss = ${avgLlProd.toFixed(4)} | Brier = ${avgBrierProd.toFixed(4)}`);
  console.log(`  -> Paired Δ (Prod - Market): ${ciProdVsMarket.meanDiff} (95% CI: [${ciProdVsMarket.ciLower}, ${ciProdVsMarket.ciUpper}], p=${ciProdVsMarket.pValue})`);
  console.log(`Ablasi Fixed κ=8            : Log-Loss = ${avgLl8.toFixed(4)} | Brier = ${avgBrier8.toFixed(4)}`);
  console.log(`  -> Paired Δ (κ=8 - Market) : ${ci8VsMarket.meanDiff} (95% CI: [${ci8VsMarket.ciLower}, ${ci8VsMarket.ciUpper}], p=${ci8VsMarket.pValue})`);
  console.log(`Ablasi Fixed κ=16           : Log-Loss = ${avgLl16.toFixed(4)} | Brier = ${avgBrier16.toFixed(4)}`);
  console.log(`  -> Paired Δ (κ=16 - Market): ${ci16VsMarket.meanDiff} (95% CI: [${ci16VsMarket.ciLower}, ${ci16VsMarket.ciUpper}], p=${ci16VsMarket.pValue})`);
}

run().catch(console.error);
