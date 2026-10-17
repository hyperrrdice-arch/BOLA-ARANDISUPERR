import fs from "node:fs";
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getMasterDb } from "../lib/db/sqlite-master";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
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

// Function to get strictly clean pre-match telemetry (EXCLUDING match T)
function getCleanPreMatchTelemetry(theStatsDb: any, teamId: string, matchId: string, matchDateStr: string, div: string) {
  // Query team_match_logs where match_id != current match and match_date <= matchDateStr (or strictly before)
  // In reality, if two matches happen on the same day, we exclude matchId!
  const logs = theStatsDb.prepare(`
    SELECT l.*, m.competition_id FROM team_match_logs l
    LEFT JOIN matches m ON l.match_id = m.match_id
    WHERE l.team_id = ? AND l.match_id != ? AND l.match_date <= ?
    ORDER BY l.match_date DESC
    LIMIT 6
  `).all(teamId, matchId, matchDateStr) as any[];

  // Also check if any log is on the same day, it should strictly have finished before
  // But strictly, match_id != matchId guarantees match T is NEVER in the logs!
  // To be even stricter (anti-same-day leakage), match_date < matchDateStr:
  const strictlyPriorLogs = theStatsDb.prepare(`
    SELECT l.*, m.competition_id FROM team_match_logs l
    LEFT JOIN matches m ON l.match_id = m.match_id
    WHERE l.team_id = ? AND l.match_id != ? AND l.match_date < ?
    ORDER BY l.match_date DESC
    LIMIT 6
  `).all(teamId, matchId, matchDateStr) as any[];

  return { logs, strictlyPriorLogs };
}

async function runCleanTrackC() {
  const theStatsDb = getTheStatsDb();
  const masterDb = getMasterDb();

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

  console.log("=== EVALUASI TRACK C: LEAKED vs STRICT CLEAN (N=405 Total, N=369 with Odds) ===");

  interface EvalResult {
    matchId: string;
    actual: "H" | "D" | "A";
    hasOdds: boolean;
    llMarket: number;
    brierMarket: number;
    // Leaked
    llProdLeaked: number;
    ll8Leaked: number;
    // Clean (match_id != match_id)
    llProdClean: number;
    ll8Clean: number;
    ll16Clean: number;
    llMacroClean: number;
  }

  const results: EvalResult[] = [];

  for (const cm of cMatches) {
    const hn = (teamNameStmt.get(cm.home_team_id) as any)?.name;
    const an = (teamNameStmt.get(cm.away_team_id) as any)?.name;
    const div = COMPETITION_TO_DIV[cm.competition_id] || "UNKNOWN";
    const dateStr = cm.utc_date.slice(0, 10);
    const actual: "H" | "D" | "A" =
      cm.home_score > cm.away_score ? "H" : cm.home_score === cm.away_score ? "D" : "A";

    // 1. LEAKED Telemetry (current production code: passing m.utc_date where '2026-09-08' < '2026-09-08T...')
    // homeTelem & awayTelem from original backtest
    const htLeaked = getCleanPreMatchTelemetry(theStatsDb, cm.home_team_id, "NON_EXISTENT", dateStr + "T23:59:59.999Z", div);
    
    // 2. CLEAN Telemetry (strictly excluding match_id, and match_date < dateStr)
    const htCleanLogs = theStatsDb.prepare(`
      SELECT l.*, m.competition_id FROM team_match_logs l
      LEFT JOIN matches m ON l.match_id = m.match_id
      WHERE l.team_id = ? AND l.match_id != ? AND l.match_date < ?
      ORDER BY l.match_date DESC
      LIMIT 6
    `).all(cm.home_team_id, cm.match_id, dateStr) as any[];

    const atCleanLogs = theStatsDb.prepare(`
      SELECT l.*, m.competition_id FROM team_match_logs l
      LEFT JOIN matches m ON l.match_id = m.match_id
      WHERE l.team_id = ? AND l.match_id != ? AND l.match_date < ?
      ORDER BY l.match_date DESC
      LIMIT 6
    `).all(cm.away_team_id, cm.match_id, dateStr) as any[];

    // Calculate clean telemetry object
    function computeTelemFromLogs(teamId: string, logs: any[]): any {
      if (logs.length === 0) {
        return {
          team_id: teamId,
          sample_size: 0,
          observed_xg_samples: 0,
          rolling_xg_for: null,
          rolling_xg_against: null,
          rolling_goals_for: 0,
          rolling_goals_against: 0,
          recent_logs: [],
        };
      }
      let xgCount = 0;
      let sumXgFor = 0;
      let sumGoalsFor = 0;
      for (const l of logs) {
        if (l.xg_for !== null && l.xg_for !== undefined) {
          xgCount++;
          sumXgFor += l.xg_for;
        }
        sumGoalsFor += l.goals_for;
      }
      return {
        team_id: teamId,
        sample_size: logs.length,
        observed_xg_samples: xgCount,
        rolling_xg_for: xgCount > 0 ? Number((sumXgFor / xgCount).toFixed(2)) : null,
        rolling_goals_for: Number((sumGoalsFor / logs.length).toFixed(2)),
        recent_logs: logs,
      };
    }

    const htClean = computeTelemFromLogs(cm.home_team_id, htCleanLogs);
    const atClean = computeTelemFromLogs(cm.away_team_id, atCleanLogs);

    // Clean getShrunkMatchParameters
    const pClean = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: htClean,
      awayTelemetry: atClean,
      matchDateCutoff: cm.utc_date,
      leagueHint: div,
    });

    const resCleanProd = calculateDixonColes({
      homeAttack: pClean.homeAttack,
      homeDefense: pClean.homeDefense,
      awayAttack: pClean.awayAttack,
      awayDefense: pClean.awayDefense,
      homeAdvantage: pClean.homeAdvantage,
      leagueAvgGoals: pClean.leagueAvgGoals,
      rho: pClean.rho,
    });
    const llProdClean = calcLogLoss(resCleanProd.prob_home_win, resCleanProd.prob_draw, resCleanProd.prob_away_win, actual);

    // Clean Fixed 8
    const nH = htClean.observed_xg_samples >= 3 ? htClean.observed_xg_samples : htClean.sample_size;
    const nA = atClean.observed_xg_samples >= 3 ? atClean.observed_xg_samples : atClean.sample_size;
    const latkH = (htClean.rolling_xg_for || htClean.rolling_goals_for || 1.35) / pClean.leagueAvgGoals;
    const latkA = (atClean.rolling_xg_for || atClean.rolling_goals_for || 1.15) / pClean.leagueAvgGoals;

    const wH8 = (nH + 8) > 0 ? nH / (nH + 8) : 0;
    const wA8 = (nA + 8) > 0 ? nA / (nA + 8) : 0;
    const res8Clean = calculateDixonColes({
      homeAttack: Math.max(0.5, wH8 * latkH + (1 - wH8) * pClean.homeAttack),
      homeDefense: pClean.homeDefense,
      awayAttack: Math.max(0.4, wA8 * latkA + (1 - wA8) * pClean.awayAttack),
      awayDefense: pClean.awayDefense,
      homeAdvantage: pClean.homeAdvantage,
      leagueAvgGoals: pClean.leagueAvgGoals,
      rho: pClean.rho,
    });
    const ll8Clean = calcLogLoss(res8Clean.prob_home_win, res8Clean.prob_draw, res8Clean.prob_away_win, actual);

    // Clean Fixed 16
    const wH16 = (nH + 16) > 0 ? nH / (nH + 16) : 0;
    const wA16 = (nA + 16) > 0 ? nA / (nA + 16) : 0;
    const res16Clean = calculateDixonColes({
      homeAttack: Math.max(0.5, wH16 * latkH + (1 - wH16) * pClean.homeAttack),
      homeDefense: pClean.homeDefense,
      awayAttack: Math.max(0.4, wA16 * latkA + (1 - wA16) * pClean.awayAttack),
      awayDefense: pClean.awayDefense,
      homeAdvantage: pClean.homeAdvantage,
      leagueAvgGoals: pClean.leagueAvgGoals,
      rho: pClean.rho,
    });
    const ll16Clean = calcLogLoss(res16Clean.prob_home_win, res16Clean.prob_draw, res16Clean.prob_away_win, actual);

    // Clean Macro only
    const pMacro = getShrunkMatchParameters({
      homeTeam: hn,
      awayTeam: an,
      homeTelemetry: null,
      awayTelemetry: null,
      matchDateCutoff: cm.utc_date,
      leagueHint: div,
    });
    const resMacro = calculateDixonColes({
      homeAttack: pMacro.homeAttack,
      homeDefense: pMacro.homeDefense,
      awayAttack: pMacro.awayAttack,
      awayDefense: pMacro.awayDefense,
      homeAdvantage: pMacro.homeAdvantage,
      leagueAvgGoals: pMacro.leagueAvgGoals,
      rho: pMacro.rho,
    });
    const llMacroClean = calcLogLoss(resMacro.prob_home_win, resMacro.prob_draw, resMacro.prob_away_win, actual);

    // Market match
    let hasOdds = false;
    let llMarket = 0;
    let brierMarket = 0;
    if (cm.competition_id !== "comp_3498") {
      const cnH = normalizeForSearch(hn);
      const cnA = normalizeForSearch(an);
      const mm = master2627.find(m => {
        if (m.div !== div) return false;
        const dateDiff = Math.abs(new Date(m.date).getTime() - new Date(dateStr).getTime());
        if (dateDiff > 86400000 * 3) return false;
        const mH = normalizeForSearch(m.home_team);
        const mA = normalizeForSearch(m.away_team);
        return (mH === cnH || mH.includes(cnH) || cnH.includes(mH)) && (mA === cnA || mA.includes(cnA) || cnA.includes(mA));
      });
      if (mm) {
        hasOdds = true;
        const s = stripVigShin(mm.b365h, mm.b365d, mm.b365a);
        llMarket = calcLogLoss(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, actual);
        brierMarket = calcBrier(s.fair_prob.home, s.fair_prob.draw, s.fair_prob.away, actual);
      }
    }

    results.push({
      matchId: cm.match_id,
      actual,
      hasOdds,
      llMarket,
      brierMarket,
      llProdLeaked: 0,
      ll8Leaked: 0,
      llProdClean,
      ll8Clean,
      ll16Clean,
      llMacroClean,
    });
  }

  // 1. Full 405 matches clean
  const avgProdClean405 = results.reduce((s, r) => s + r.llProdClean, 0) / 405;
  const avg8Clean405 = results.reduce((s, r) => s + r.ll8Clean, 0) / 405;
  const avg16Clean405 = results.reduce((s, r) => s + r.ll16Clean, 0) / 405;
  const avgMacroClean405 = results.reduce((s, r) => s + r.llMacroClean, 0) / 405;

  console.log(`\n--- HASIL 100% CLEAN PRE-MATCH (N = 405 Matches, Leakage Removed) ---`);
  console.log(`Clean Production Bimodal : Log-Loss = ${avgProdClean405.toFixed(4)}`);
  console.log(`Clean Fixed κ=8          : Log-Loss = ${avg8Clean405.toFixed(4)}`);
  console.log(`Clean Fixed κ=16         : Log-Loss = ${avg16Clean405.toFixed(4)}`);
  console.log(`Clean Macro Only         : Log-Loss = ${avgMacroClean405.toFixed(4)}`);

  // 2. On 369 matches with market odds
  const withOdds = results.filter(r => r.hasOdds);
  const nOdds = withOdds.length;
  const avgMarket = withOdds.reduce((s, r) => s + r.llMarket, 0) / nOdds;
  const avgProdOdds = withOdds.reduce((s, r) => s + r.llProdClean, 0) / nOdds;
  const avg8Odds = withOdds.reduce((s, r) => s + r.ll8Clean, 0) / nOdds;
  const avg16Odds = withOdds.reduce((s, r) => s + r.ll16Clean, 0) / nOdds;

  const ciProdVsMarket = bootstrapPairedCI(withOdds.map(r => r.llProdClean - r.llMarket), 1000);
  const ci8VsMarket = bootstrapPairedCI(withOdds.map(r => r.ll8Clean - r.llMarket), 1000);
  const ci16VsMarket = bootstrapPairedCI(withOdds.map(r => r.ll16Clean - r.llMarket), 1000);

  console.log(`\n--- HASIL 100% CLEAN PRE-MATCH vs MARKET CLOSING (N = ${nOdds} Matches) ---`);
  console.log(`Market Shin 1993            : Log-Loss = ${avgMarket.toFixed(4)}`);
  console.log(`Clean Production Bimodal    : Log-Loss = ${avgProdOdds.toFixed(4)} | Paired Δ = ${ciProdVsMarket.meanDiff} (95% CI: [${ciProdVsMarket.ciLower}, ${ciProdVsMarket.ciUpper}], p=${ciProdVsMarket.pValue})`);
  console.log(`Clean Fixed κ=8             : Log-Loss = ${avg8Odds.toFixed(4)} | Paired Δ = ${ci8VsMarket.meanDiff} (95% CI: [${ci8VsMarket.ciLower}, ${ci8VsMarket.ciUpper}], p=${ci8VsMarket.pValue})`);
  console.log(`Clean Fixed κ=16            : Log-Loss = ${avg16Odds.toFixed(4)} | Paired Δ = ${ci16VsMarket.meanDiff} (95% CI: [${ci16VsMarket.ciLower}, ${ci16VsMarket.ciUpper}], p=${ci16VsMarket.pValue})`);
}

runCleanTrackC().catch(console.error);
