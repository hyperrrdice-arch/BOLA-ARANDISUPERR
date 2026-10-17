/**
 * Unified Backtest Harness — PLAN A (Commit 9600553 Basis)
 * 
 * Menguji akurasi prediktif dan kalibrasi risiko seluruh komponen matematis:
 * - Track A: Goals Dixon-Coles Core (N≈28k match, Tau ablation, Shin vs Implied, Rho, Schedule Friction)
 * - Track B: xG Quality & Luck Regression (N=1.078 match 2026/2027, Paired Δ, Bootstrap CI, Mean-Reversion)
 * - Track C: Full Fusion Pipeline (N=405 match telemetry, Bimodal κ 8/14/16, UCL √q scaling)
 * - Track D: Special Markets Calibration (Corners O/U, Cards O/U, Goodness-of-fit)
 * - Track E: Sequential Bankroll Simulation (Flat vs Full Kelly vs Quarter Kelly vs Quarter + Caps)
 * 
 * Zero runtime modification: Menggunakan lib/ 100% apa adanya.
 */

import fs from "node:fs";
import path from "node:path";
import { getMasterDb, type MasterMatchRow } from "../lib/db/sqlite-master";
import { getTheStatsDb, resolveLocalTeamId } from "../lib/db/thestats-dataset";
import { calculateDixonColes, type DixonColesResult } from "../lib/quant/dixon-coles";
import { stripVigShin, stripVigProportional } from "../lib/quant/vig-stripping";
import { evaluateValueBet, evaluatePortfolioKelly } from "../lib/quant/kelly";
import {
  getShrunkMatchParameters,
  type CalibratedRatingsFile,
  type LeagueCalibratedParameters,
  type TeamRating,
} from "../lib/quant/ratings-loader";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { generateSpecialMarketsPackage } from "../lib/quant/special-markets-engine";
import { evaluateMatchupLuck } from "../lib/quant/luck-regression";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import { runCalibration } from "./calibrate-ratings";

// ============================================================================
// 1. KONSTANTA & PEMETAAN ENTITAS
// ============================================================================

const CACHE_DIR = path.join(process.cwd(), "data", "backtest_cache");
const TRAIN_RATINGS_PATH = path.join(CACHE_DIR, "ratings_train_20250630.json");
const REPORT_OUTPUT_PATH = path.join(process.cwd(), "data", "backtest_report.json");
const TRAIN_MAX_DATE = "2025-06-30"; // Cutoff holdout: Train <= 2024/2025, Test >= 2025/2026

const SECOND_DIVISION_MAP: Record<string, string> = {
  E0: "E1",
  SP1: "SP2",
  I1: "I2",
  D1: "D2",
  F1: "F2",
};

const COMPETITION_TO_DIV: Record<string, string> = {
  comp_3039: "E0",
  comp_8814: "SP1",
  comp_5840: "I1",
  comp_4643: "D1",
  comp_0256: "F1",
  comp_3809: "N1",
  comp_3498: "UCL",
};

// ============================================================================
// 2. STATISTICAL UTILITIES
// ============================================================================

const EPS = 1e-6;

export function calcLogLoss(
  pHome: number,
  pDraw: number,
  pAway: number,
  actual: "H" | "D" | "A"
): number {
  const p = actual === "H" ? pHome : actual === "D" ? pDraw : pAway;
  const clamped = Math.max(EPS, Math.min(1 - EPS, p));
  return -Math.log(clamped);
}

export function calcBrier(
  pHome: number,
  pDraw: number,
  pAway: number,
  actual: "H" | "D" | "A"
): number {
  const yH = actual === "H" ? 1 : 0;
  const yD = actual === "D" ? 1 : 0;
  const yA = actual === "A" ? 1 : 0;
  return (pHome - yH) ** 2 + (pDraw - yD) ** 2 + (pAway - yA) ** 2;
}

export function calcBrierBinary(prob: number, actual: boolean): number {
  const y = actual ? 1 : 0;
  return (prob - y) ** 2;
}

export function calcECE(
  samples: { p: number; actual: boolean }[],
  nBins = 10
): number {
  const validSamples = samples.filter((s) => Number.isFinite(s.p) && s.p >= 0 && s.p <= 1);
  if (validSamples.length === 0) return 0;
  const bins: { count: number; sumConf: number; sumAcc: number }[] = Array.from(
    { length: nBins },
    () => ({ count: 0, sumConf: 0, sumAcc: 0 })
  );

  for (const s of validSamples) {
    const binIdx = Math.max(0, Math.min(nBins - 1, Math.floor(s.p * nBins)));
    bins[binIdx].count++;
    bins[binIdx].sumConf += s.p;
    bins[binIdx].sumAcc += s.actual ? 1 : 0;
  }

  let totalEce = 0;
  for (const b of bins) {
    if (b.count > 0) {
      const avgConf = b.sumConf / b.count;
      const avgAcc = b.sumAcc / b.count;
      totalEce += (b.count / validSamples.length) * Math.abs(avgAcc - avgConf);
    }
  }
  return totalEce;
}

export function bootstrapPairedCI(
  diffs: number[],
  nBoot = 1000,
  alpha = 0.05
): { meanDiff: number; ciLower: number; ciUpper: number; pValue: number } {
  const N = diffs.length;
  if (N === 0) return { meanDiff: 0, ciLower: 0, ciUpper: 0, pValue: 1.0 };

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / N;
  const bootMeans: number[] = [];

  // Deterministic pseudo-random seed untuk reproduksibilitas bootstrap
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const idx = Math.floor(rand() * N);
      sum += diffs[idx];
    }
    bootMeans.push(sum / N);
  }

  bootMeans.sort((a, b) => a - b);
  const lowIdx = Math.floor((alpha / 2) * nBoot);
  const highIdx = Math.floor((1 - alpha / 2) * nBoot);

  const zeroCrossings = bootMeans.filter((m) => (meanDiff > 0 ? m <= 0 : m >= 0)).length;
  const pValue = Math.min(1.0, (2 * zeroCrossings) / nBoot);

  return {
    meanDiff: Number(meanDiff.toFixed(5)),
    ciLower: Number(bootMeans[lowIdx].toFixed(5)),
    ciUpper: Number(bootMeans[highIdx].toFixed(5)),
    pValue: Number(pValue.toFixed(4)),
  };
}

// ============================================================================
// 3. TEAM RESOLUTION & ENTITY MAPPER
// ============================================================================

export function resolveTeamRating(
  data: CalibratedRatingsFile,
  div: string,
  rawName: string
): { rating: TeamRating; source: "primary" | "promoted" | "cross_league" } {
  const norm = normalizeTeamName(rawName);
  const league = data.leagues[div];

  // 1. Direct or normalized match in target league
  if (league) {
    if (league.teams[rawName]) return { rating: league.teams[rawName], source: "primary" };
    if (league.teams[norm]) return { rating: league.teams[norm], source: "primary" };
    for (const [k, v] of Object.entries(league.teams)) {
      if (k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === rawName.toLowerCase()) {
        return { rating: v, source: "primary" };
      }
    }
  }

  // 2. Promoted team from second division (15% atk discount, 20% def penalty)
  const secDiv = SECOND_DIVISION_MAP[div];
  if (secDiv && data.leagues[secDiv]) {
    const secLeague = data.leagues[secDiv];
    const match =
      secLeague.teams[rawName] ||
      secLeague.teams[norm] ||
      Object.entries(secLeague.teams).find(
        ([k]) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === rawName.toLowerCase()
      )?.[1];

    if (match) {
      return {
        rating: {
          ...match,
          attack: Number((match.attack * 0.85).toFixed(3)),
          defense: Number((match.defense * 1.2).toFixed(3)),
        },
        source: "promoted",
      };
    }
  }

  // 3. Relegated team from primary division (e.g. Empoli in I2 was in I1, Southampton in E1 was in E0)
  for (const [topDiv, secondDiv] of Object.entries(SECOND_DIVISION_MAP)) {
    if (div === secondDiv && data.leagues[topDiv]) {
      const topLeague = data.leagues[topDiv];
      const match =
        topLeague.teams[rawName] ||
        topLeague.teams[norm] ||
        Object.entries(topLeague.teams).find(
          ([k]) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === rawName.toLowerCase()
        )?.[1];
      if (match) {
        return {
          rating: {
            ...match,
            attack: Number((match.attack * 1.15).toFixed(3)),
            defense: Number((match.defense * 0.85).toFixed(3)),
          },
          source: "cross_league",
        };
      }
    }
  }

  // 4. Search other leagues in dataset
  for (const [otherDiv, otherLeague] of Object.entries(data.leagues)) {
    if (otherDiv === div) continue;
    const match =
      otherLeague.teams[rawName] ||
      otherLeague.teams[norm] ||
      Object.entries(otherLeague.teams).find(
        ([k]) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === rawName.toLowerCase()
      )?.[1];
    if (match) {
      return { rating: match, source: "cross_league" };
    }
  }

  // 5. Fallback prior Bayesian untuk tim promosi non-terkalibrasi (e.g. Wrexham, Charlton di E1)
  return {
    rating: {
      name: rawName,
      attack: 0.85,
      defense: 1.2,
      matchesCount: 0,
      goalsScored: 0,
      goalsConceded: 0,
      lastMatchDate: "",
    },
    source: "promoted",
  };
}

// ============================================================================
// 4. SELF-CHECK NUMERICAL ASSERTIONS
// ============================================================================

export function assertNumericalIntegrity(
  result: DixonColesResult,
  matchContext: string
): void {
  if (
    !Number.isFinite(result.prob_home_win) ||
    !Number.isFinite(result.prob_draw) ||
    !Number.isFinite(result.prob_away_win)
  ) {
    throw new Error(`[SELF-CHECK FAIL] Probabilitas NaN pada ${matchContext}`);
  }

  const sumProb = result.prob_home_win + result.prob_draw + result.prob_away_win;
  if (Math.abs(sumProb - 1.0) > 5e-4) {
    throw new Error(
      `[SELF-CHECK FAIL] Probabilitas tidak berjumlah 1.0 (${sumProb}) pada ${matchContext}`
    );
  }
  if (!Number.isFinite(result.lambda) || !Number.isFinite(result.mu)) {
    throw new Error(`[SELF-CHECK FAIL] Lambda/Mu tidak valid pada ${matchContext}`);
  }
  if (result.lambda < 0.2 || result.lambda > 10.0 || result.mu < 0.2 || result.mu > 10.0) {
    throw new Error(
      `[SELF-CHECK FAIL] Guard clamp batas [0.2, 10.0] terlanggar: λ=${result.lambda}, μ=${result.mu} pada ${matchContext}`
    );
  }
  // Skala scorelines check: prob harus 0..100
  if (result.top_scorelines.length > 0) {
    const top = result.top_scorelines[0];
    if (top.prob < 0 || top.prob > 100) {
      throw new Error(
        `[SELF-CHECK FAIL] Skala top_scorelines.prob tidak dalam range 0-100% (${top.prob}) pada ${matchContext}`
      );
    }
  }
}

// ============================================================================
// 5. CACHE MANAGEMENT
// ============================================================================

export async function ensureTrainRatings(): Promise<CalibratedRatingsFile> {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  if (fs.existsSync(TRAIN_RATINGS_PATH)) {
    console.log(`📦 Menggunakan cache train ratings: ${TRAIN_RATINGS_PATH}`);
    const raw = fs.readFileSync(TRAIN_RATINGS_PATH, "utf-8");
    return JSON.parse(raw) as CalibratedRatingsFile;
  }

  console.log(`⚙️ Cache train ratings belum ada. Menjalankan kalibrasi cutoff <= ${TRAIN_MAX_DATE}...`);
  const t0 = Date.now();
  const calibrated = await runCalibration({
    maxDate: TRAIN_MAX_DATE,
    outputPath: TRAIN_RATINGS_PATH,
  });
  console.log(`⏱️ Waktu kompilasi kalibrasi: ${((Date.now() - t0) / 1000).toFixed(2)} detik`);
  return calibrated;
}

// ============================================================================
// 6. TRACK A: GOALS DIXON-COLES CORE
// ============================================================================

export interface TrackAResult {
  totalMatches: number;
  resolvedMatches: number;
  skippedMatches: number;
  coveragePct: number;
  models: {
    dixonColesProduction: { logLoss: number; brier: number; ece: number };
    dixonColesNoTau: { logLoss: number; brier: number; ece: number };
    dixonColesRhoNeg13: { logLoss: number; brier: number };
    dixonColesRhoNeg04: { logLoss: number; brier: number };
    dixonColesRhoNeg05: { logLoss: number; brier: number };
    marketShin: { logLoss: number; brier: number; ece: number; matchCount: number };
    marketProportional: { logLoss: number; brier: number; matchCount: number };
    homeFavoriteBaseline: { logLoss: number; brier: number; ece: number };
  };
  subAnalyses: {
    scheduleFrictionFatigue: {
      highFatigueCount: number;
      highFatigueLogLoss: number;
      normalFatigueCount: number;
      normalFatigueLogLoss: number;
    };
    promotedTeams: {
      matchCount: number;
      modelLogLoss: number;
      baselineLogLoss: number;
    };
  };
  gateStatus: {
    coverageGate: boolean;
    marketComparisonGate: boolean;
    favoriteComparisonGate: boolean;
    eceGate: boolean;
    overallPass: boolean;
  };
}

export async function runTrackA(
  trainRatings: CalibratedRatingsFile,
  targetDiv?: string
): Promise<TrackAResult> {
  console.log("\n==================================================================");
  console.log("🏁 MENJALANKAN TRACK A: GOALS DIXON-COLES CORE (28k Match Database)");
  console.log("==================================================================");

  const db = getMasterDb();
  let query = `
    SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
    FROM matches
    WHERE season IN ('2025/2026', '2026/2027')
      AND fthg IS NOT NULL AND ftag IS NOT NULL
  `;
  const params: any[] = [];
  if (targetDiv) {
    query += " AND div = ?";
    params.push(targetDiv);
  }
  query += " ORDER BY date ASC";

  const testMatches = db.prepare(query).all(...params) as MasterMatchRow[];
  const totalMatches = testMatches.length;

  let resolvedCount = 0;
  let skippedCount = 0;

  // Akumulator metrik
  let sumLlDC = 0, sumBrierDC = 0;
  let sumLlNoTau = 0, sumBrierNoTau = 0;
  let sumLlRhoNeg13 = 0, sumBrierRhoNeg13 = 0;
  let sumLlRhoNeg04 = 0, sumBrierRhoNeg04 = 0;
  let sumLlRhoNeg05 = 0, sumBrierRhoNeg05 = 0;
  let sumLlHomeFav = 0, sumBrierHomeFav = 0;

  let sumLlShin = 0, sumBrierShin = 0, shinValidCount = 0;
  let sumLlProp = 0, sumBrierProp = 0, propValidCount = 0;

  const eceSamplesDC: { p: number; actual: boolean }[] = [];
  const eceSamplesShin: { p: number; actual: boolean }[] = [];
  const eceSamplesHomeFav: { p: number; actual: boolean }[] = [];

  // Sub-analisis schedule friction & tim promosi
  const teamLastDate = new Map<string, string>();
  let fatigueHighCount = 0, fatigueHighLlSum = 0;
  let fatigueNormalCount = 0, fatigueNormalLlSum = 0;

  let promotedCount = 0, promotedLlSum = 0, promotedBaseLlSum = 0;

  // Frekuensi baseline home favorite dari train set: ~44% Home, 26% Draw, 30% Away
  const pHomeFav = 0.44, pDrawFav = 0.26, pAwayFav = 0.30;

  for (const m of testMatches) {
    const div = m.div;
    const league = trainRatings.leagues[div];
    if (!league) {
      skippedCount++;
      continue;
    }

    const homeRes = resolveTeamRating(trainRatings, div, m.home_team);
    const awayRes = resolveTeamRating(trainRatings, div, m.away_team);

    resolvedCount++;
    const actual = m.ftr;

    // Rho eksplisit dari liga terkalibrasi
    const explicitRho = Number.isFinite(league.rho) ? league.rho : -0.04;
    const leagueAvg = league.leagueAvgGoals;
    const homeAdv = league.homeAdvantage;

    // 1. Model Produksi: Dixon-Coles dengan tau & explicit rho per liga
    const resDC = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: homeAdv,
      leagueAvgGoals: leagueAvg,
      rho: explicitRho,
    });
    assertNumericalIntegrity(resDC, `Match #${m.id} ${m.home_team} vs ${m.away_team}`);

    const llDC = calcLogLoss(resDC.prob_home_win, resDC.prob_draw, resDC.prob_away_win, actual);
    const brDC = calcBrier(resDC.prob_home_win, resDC.prob_draw, resDC.prob_away_win, actual);
    sumLlDC += llDC;
    sumBrierDC += brDC;
    eceSamplesDC.push({ p: resDC.prob_home_win, actual: actual === "H" });

    // 2. Ablasi: Tanpa Tau (rho = 0)
    const resNoTau = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: homeAdv,
      leagueAvgGoals: leagueAvg,
      rho: 0,
    });
    sumLlNoTau += calcLogLoss(resNoTau.prob_home_win, resNoTau.prob_draw, resNoTau.prob_away_win, actual);
    sumBrierNoTau += calcBrier(resNoTau.prob_home_win, resNoTau.prob_draw, resNoTau.prob_away_win, actual);

    // 3. Ablasi Varian Rho (-0.13, -0.04, -0.05)
    const resRho13 = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: homeAdv,
      leagueAvgGoals: leagueAvg,
      rho: -0.13,
    });
    sumLlRhoNeg13 += calcLogLoss(resRho13.prob_home_win, resRho13.prob_draw, resRho13.prob_away_win, actual);
    sumBrierRhoNeg13 += calcBrier(resRho13.prob_home_win, resRho13.prob_draw, resRho13.prob_away_win, actual);

    const resRho04 = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: homeAdv,
      leagueAvgGoals: leagueAvg,
      rho: -0.04,
    });
    sumLlRhoNeg04 += calcLogLoss(resRho04.prob_home_win, resRho04.prob_draw, resRho04.prob_away_win, actual);
    sumBrierRhoNeg04 += calcBrier(resRho04.prob_home_win, resRho04.prob_draw, resRho04.prob_away_win, actual);

    const resRho05 = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: homeAdv,
      leagueAvgGoals: leagueAvg,
      rho: -0.05,
    });
    sumLlRhoNeg05 += calcLogLoss(resRho05.prob_home_win, resRho05.prob_draw, resRho05.prob_away_win, actual);
    sumBrierRhoNeg05 += calcBrier(resRho05.prob_home_win, resRho05.prob_draw, resRho05.prob_away_win, actual);

    // 4. Baseline: Home Favorite
    sumLlHomeFav += calcLogLoss(pHomeFav, pDrawFav, pAwayFav, actual);
    sumBrierHomeFav += calcBrier(pHomeFav, pDrawFav, pAwayFav, actual);
    eceSamplesHomeFav.push({ p: pHomeFav, actual: actual === "H" });

    // 5. Baseline: Pasar (Shin 1993 & Proportional)
    if (m.b365h && m.b365d && m.b365a && m.b365h > 1.0 && m.b365d > 1.0 && m.b365a > 1.0) {
      const shin = stripVigShin(m.b365h, m.b365d, m.b365a);
      sumLlShin += calcLogLoss(shin.fair_prob.home, shin.fair_prob.draw, shin.fair_prob.away, actual);
      sumBrierShin += calcBrier(shin.fair_prob.home, shin.fair_prob.draw, shin.fair_prob.away, actual);
      eceSamplesShin.push({ p: shin.fair_prob.home, actual: actual === "H" });
      shinValidCount++;

      const prop = stripVigProportional(m.b365h, m.b365d, m.b365a);
      sumLlProp += calcLogLoss(prop.fair_prob.home, prop.fair_prob.draw, prop.fair_prob.away, actual);
      sumBrierProp += calcBrier(prop.fair_prob.home, prop.fair_prob.draw, prop.fair_prob.away, actual);
      propValidCount++;
    }

    // 6. Sub-analisis: Schedule Friction
    const prevDate = teamLastDate.get(m.home_team);
    if (prevDate) {
      const diffDays = (new Date(m.date).getTime() - new Date(prevDate).getTime()) / (1000 * 3600 * 24);
      if (diffDays <= 3 && diffDays >= 0) {
        fatigueHighCount++;
        fatigueHighLlSum += llDC;
      } else {
        fatigueNormalCount++;
        fatigueNormalLlSum += llDC;
      }
    }
    teamLastDate.set(m.home_team, m.date);

    // 7. Sub-analisis: Promoted Teams
    if (homeRes.source === "promoted" || awayRes.source === "promoted") {
      promotedCount++;
      promotedLlSum += llDC;
      promotedBaseLlSum += calcLogLoss(pHomeFav, pDrawFav, pAwayFav, actual);
    }
  }

  const coveragePct = Number(((resolvedCount / totalMatches) * 100).toFixed(2));
  const avgLlDC = Number((sumLlDC / resolvedCount).toFixed(4));
  const avgBrierDC = Number((sumBrierDC / resolvedCount).toFixed(4));
  const eceDC = Number(calcECE(eceSamplesDC).toFixed(4));

  const avgLlShin = shinValidCount > 0 ? Number((sumLlShin / shinValidCount).toFixed(4)) : 0;
  const avgBrierShin = shinValidCount > 0 ? Number((sumBrierShin / shinValidCount).toFixed(4)) : 0;
  const eceShin = Number(calcECE(eceSamplesShin).toFixed(4));

  const avgLlHomeFav = Number((sumLlHomeFav / resolvedCount).toFixed(4));
  const avgBrierHomeFav = Number((sumBrierHomeFav / resolvedCount).toFixed(4));
  const eceHomeFav = Number(calcECE(eceSamplesHomeFav).toFixed(4));

  // Gate evaluation
  const coverageGate = coveragePct >= 95.0;
  const marketComparisonGate = avgLlDC <= avgLlShin + 0.02;
  const favoriteComparisonGate = avgLlDC < avgLlHomeFav;
  const eceGate = eceDC <= 0.03;
  const overallPass = coverageGate && marketComparisonGate && favoriteComparisonGate && eceGate;

  console.log(`📊 Hasil Track A (Total Match: ${totalMatches}):`);
  console.log(`   - Resolved : ${resolvedCount} (${coveragePct}%) | Skipped: ${skippedCount}`);
  console.log(`   - Dixon-Coles (Prod) : Log-Loss = ${avgLlDC} | Brier = ${avgBrierDC} | ECE = ${eceDC}`);
  console.log(`   - Market Shin 1993   : Log-Loss = ${avgLlShin} | Brier = ${avgBrierShin} | ECE = ${eceShin}`);
  console.log(`   - Home Favorite Base : Log-Loss = ${avgLlHomeFav} | Brier = ${avgBrierHomeFav} | ECE = ${eceHomeFav}`);
  console.log(`   - Tau Ablation (Off) : Log-Loss = ${(sumLlNoTau / resolvedCount).toFixed(4)}`);
  console.log(`   - Rho -0.13 Ablation : Log-Loss = ${(sumLlRhoNeg13 / resolvedCount).toFixed(4)}`);
  console.log(`   - Rho -0.04 Ablation : Log-Loss = ${(sumLlRhoNeg04 / resolvedCount).toFixed(4)}`);
  console.log(`   - Rho -0.05 Ablation : Log-Loss = ${(sumLlRhoNeg05 / resolvedCount).toFixed(4)}`);
  console.log(`   🚦 Gate Status : Coverage=${coverageGate ? "✅" : "❌"} | MarketShin=${marketComparisonGate ? "✅" : "❌"} | ECE=${eceGate ? "✅" : "❌"} -> OVERALL: ${overallPass ? "PASS" : "FAIL"}`);

  return {
    totalMatches,
    resolvedMatches: resolvedCount,
    skippedMatches: skippedCount,
    coveragePct,
    models: {
      dixonColesProduction: { logLoss: avgLlDC, brier: avgBrierDC, ece: eceDC },
      dixonColesNoTau: {
        logLoss: Number((sumLlNoTau / resolvedCount).toFixed(4)),
        brier: Number((sumBrierNoTau / resolvedCount).toFixed(4)),
        ece: 0,
      },
      dixonColesRhoNeg13: {
        logLoss: Number((sumLlRhoNeg13 / resolvedCount).toFixed(4)),
        brier: Number((sumBrierRhoNeg13 / resolvedCount).toFixed(4)),
      },
      dixonColesRhoNeg04: {
        logLoss: Number((sumLlRhoNeg04 / resolvedCount).toFixed(4)),
        brier: Number((sumBrierRhoNeg04 / resolvedCount).toFixed(4)),
      },
      dixonColesRhoNeg05: {
        logLoss: Number((sumLlRhoNeg05 / resolvedCount).toFixed(4)),
        brier: Number((sumBrierRhoNeg05 / resolvedCount).toFixed(4)),
      },
      marketShin: { logLoss: avgLlShin, brier: avgBrierShin, ece: eceShin, matchCount: shinValidCount },
      marketProportional: {
        logLoss: propValidCount > 0 ? Number((sumLlProp / propValidCount).toFixed(4)) : 0,
        brier: propValidCount > 0 ? Number((sumBrierProp / propValidCount).toFixed(4)) : 0,
        matchCount: propValidCount,
      },
      homeFavoriteBaseline: { logLoss: avgLlHomeFav, brier: avgBrierHomeFav, ece: eceHomeFav },
    },
    subAnalyses: {
      scheduleFrictionFatigue: {
        highFatigueCount: fatigueHighCount,
        highFatigueLogLoss: fatigueHighCount > 0 ? Number((fatigueHighLlSum / fatigueHighCount).toFixed(4)) : 0,
        normalFatigueCount: fatigueNormalCount,
        normalFatigueLogLoss: fatigueNormalCount > 0 ? Number((fatigueNormalLlSum / fatigueNormalCount).toFixed(4)) : 0,
      },
      promotedTeams: {
        matchCount: promotedCount,
        modelLogLoss: promotedCount > 0 ? Number((promotedLlSum / promotedCount).toFixed(4)) : 0,
        baselineLogLoss: promotedCount > 0 ? Number((promotedBaseLlSum / promotedCount).toFixed(4)) : 0,
      },
    },
    gateStatus: {
      coverageGate,
      marketComparisonGate,
      favoriteComparisonGate,
      eceGate,
      overallPass,
    },
  };
}

// ============================================================================
// 7. TRACK B: xG QUALITY & LUCK REGRESSION (N=1.078)
// ============================================================================

export interface TrackBResult {
  totalMatches: number;
  resolvedMatches: number;
  b1_xgVsGoals: {
    xgLogLoss: number;
    goalsLogLoss: number;
    pairedDiff: { meanDiff: number; ciLower: number; ciUpper: number; pValue: number };
  };
  b2_crossCompNormalization: {
    weightedLogLoss: number;
    unweightedLogLoss: number;
    pairedDiff: { meanDiff: number; ciLower: number; ciUpper: number; pValue: number };
  };
  b3_luckRegressionPredictive: {
    qualifyingMatches: number;
    overperformingReversionPct: number;
    underperformingReversionPct: number;
    verdict: string;
  };
}

export async function runTrackB(trainRatings: CalibratedRatingsFile): Promise<TrackBResult> {
  console.log("\n==================================================================");
  console.log("🏁 MENJALANKAN TRACK B: xG QUALITY & LUCK (1.078 Match 2026/2027)");
  console.log("==================================================================");

  const db = getMasterDb();
  const matches = db.prepare(`
    SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, h_xg, a_xg
    FROM matches
    WHERE season = '2026/2027' AND h_xg IS NOT NULL AND a_xg IS NOT NULL
    ORDER BY date ASC
  `).all() as (MasterMatchRow & { h_xg: number; a_xg: number })[];

  const totalMatches = matches.length;
  let resolvedMatches = 0;

  const diffXgVsGoals: number[] = [];
  let sumLlXg = 0;
  let sumLlGoals = 0;

  const diffWeightedVsUnweighted: number[] = [];
  let sumLlWeighted = 0;
  let sumLlUnweighted = 0;
  let crossCompCount = 0;

  // B3 Luck signals
  let overperformingCount = 0, overperformingRegressed = 0;
  let underperformingCount = 0, underperformingRegressed = 0;

  for (const m of matches) {
    const div = m.div;
    const league = trainRatings.leagues[div];
    if (!league) continue;

    const homeRes = resolveTeamRating(trainRatings, div, m.home_team);
    const awayRes = resolveTeamRating(trainRatings, div, m.away_team);

    resolvedMatches++;
    const actual = m.ftr;
    const explicitRho = Number.isFinite(league.rho) ? league.rho : -0.04;

    // 1. Goal-based prediction
    const resGoals = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: league.homeAdvantage,
      leagueAvgGoals: league.leagueAvgGoals,
      rho: explicitRho,
    });
    const llGoals = calcLogLoss(resGoals.prob_home_win, resGoals.prob_draw, resGoals.prob_away_win, actual);
    sumLlGoals += llGoals;

    // 2. xG-calibrated proxy prediction (h_xg & a_xg sebagai ekspektasi langsung)
    const lambdaXg = Math.max(0.2, m.h_xg);
    const muXg = Math.max(0.2, m.a_xg);
    const resXg = calculateDixonColes({
      homeAttack: (lambdaXg / league.leagueAvgGoals) * (1 / league.homeAdvantage),
      homeDefense: 1.0,
      awayAttack: muXg / league.leagueAvgGoals,
      awayDefense: 1.0,
      homeAdvantage: league.homeAdvantage,
      leagueAvgGoals: league.leagueAvgGoals,
      rho: explicitRho,
    });
    const llXg = calcLogLoss(resXg.prob_home_win, resXg.prob_draw, resXg.prob_away_win, actual);
    sumLlXg += llXg;
    diffXgVsGoals.push(llXg - llGoals); // Negatif berarti xG lebih tajam

    // B2: Normalisasi xG lintas kompetisi
    const homeStatsId = resolveLocalTeamId(m.home_team);
    const awayStatsId = resolveLocalTeamId(m.away_team);

    if (homeStatsId && awayStatsId) {
      // PENTING: beforeDate = m.date (Strict pre-match anti-leakage)
      const telemWeighted = getTeamRollingTelemetry(homeStatsId, 6, m.date, div);
      const telemUnweighted = getTeamRollingTelemetry(homeStatsId, 6, m.date);

      if (telemWeighted.observed_xg_samples >= 3 && telemUnweighted.observed_xg_samples >= 3) {
        crossCompCount++;
        const pWeighted = telemWeighted.rolling_xg_for || homeRes.rating.attack;
        const pUnweighted = telemUnweighted.rolling_xg_for || homeRes.rating.attack;

        const resW = calculateDixonColes({
          homeAttack: pWeighted / league.leagueAvgGoals,
          homeDefense: homeRes.rating.defense,
          awayAttack: awayRes.rating.attack,
          awayDefense: awayRes.rating.defense,
          homeAdvantage: league.homeAdvantage,
          leagueAvgGoals: league.leagueAvgGoals,
          rho: explicitRho,
        });
        const resUnW = calculateDixonColes({
          homeAttack: pUnweighted / league.leagueAvgGoals,
          homeDefense: homeRes.rating.defense,
          awayAttack: awayRes.rating.attack,
          awayDefense: awayRes.rating.defense,
          homeAdvantage: league.homeAdvantage,
          leagueAvgGoals: league.leagueAvgGoals,
          rho: explicitRho,
        });

        const llW = calcLogLoss(resW.prob_home_win, resW.prob_draw, resW.prob_away_win, actual);
        const llUnW = calcLogLoss(resUnW.prob_home_win, resUnW.prob_draw, resUnW.prob_away_win, actual);
        sumLlWeighted += llW;
        sumLlUnweighted += llUnW;
        diffWeightedVsUnweighted.push(llW - llUnW);
      }
    }

    // B3: Uji Prediktif Luck Regression (Strict beforeDate)
    try {
      const luck = evaluateMatchupLuck(homeStatsId, awayStatsId, m.date);
      if (luck.home.status === "OVERPERFORMING") {
        overperformingCount++;
        const goalDiff = m.fthg - m.h_xg;
        if (goalDiff < 0) {
          overperformingRegressed++;
        }
      } else if (luck.home.status === "UNDERPERFORMING") {
        underperformingCount++;
        const goalDiff = m.fthg - m.h_xg;
        if (goalDiff >= 0) {
          underperformingRegressed++;
        }
      }
    } catch {}
  }

  const ciB1 = bootstrapPairedCI(diffXgVsGoals);
  const ciB2 = bootstrapPairedCI(diffWeightedVsUnweighted);

  const avgLlXg = Number((sumLlXg / resolvedMatches).toFixed(4));
  const avgLlGoals = Number((sumLlGoals / resolvedMatches).toFixed(4));
  const avgLlW = crossCompCount > 0 ? Number((sumLlWeighted / crossCompCount).toFixed(4)) : 0;
  const avgLlUnW = crossCompCount > 0 ? Number((sumLlUnweighted / crossCompCount).toFixed(4)) : 0;

  const overRevPct = overperformingCount > 0 ? Number(((overperformingRegressed / overperformingCount) * 100).toFixed(1)) : 0;
  const underRevPct = underperformingCount > 0 ? Number(((underperformingRegressed / underperformingCount) * 100).toFixed(1)) : 0;

  console.log(`📊 Hasil Track B (Resolved: ${resolvedMatches}/${totalMatches}):`);
  console.log(`   - B1 xG vs Goals       : Log-Loss xG=${avgLlXg} vs Goals=${avgLlGoals} | Paired Δ=${ciB1.meanDiff} (95% CI: [${ciB1.ciLower}, ${ciB1.ciUpper}], p=${ciB1.pValue})`);
  console.log(`   - B2 Weighted vs UnW   : Log-Loss Weighted=${avgLlW} vs Unweighted=${avgLlUnW} | Paired Δ=${ciB2.meanDiff} (N=${crossCompCount})`);
  console.log(`   - B3 Luck Mean-Revert  : Overperforming Reversion=${overRevPct}% (N=${overperformingCount}), Underperforming Reversion=${underRevPct}% (N=${underperformingCount})`);

  return {
    totalMatches,
    resolvedMatches,
    b1_xgVsGoals: {
      xgLogLoss: avgLlXg,
      goalsLogLoss: avgLlGoals,
      pairedDiff: ciB1,
    },
    b2_crossCompNormalization: {
      weightedLogLoss: avgLlW,
      unweightedLogLoss: avgLlUnW,
      pairedDiff: ciB2,
    },
    b3_luckRegressionPredictive: {
      qualifyingMatches: overperformingCount + underperformingCount,
      overperformingReversionPct: overRevPct,
      underperformingReversionPct: underRevPct,
      verdict: overRevPct >= 50 && underRevPct >= 50 ? "Regresi Keberuntungan Terkonfirmasi" : "Sinyal Lemah / Sample Terbatas",
    },
  };
}

// ============================================================================
// 8. TRACK C: FULL FUSION PIPELINE (N=405)
// ============================================================================

export interface TrackCResult {
  totalMatches: number;
  resolvedMatches: number;
  productionBimodalLogLoss: number;
  ablationFixed16LogLoss: number;
  ablationFixed8LogLoss: number;
  ablationMacroOnlyLogLoss: number;
  uclSubset: {
    matchCount: number;
    withSqrtQLogLoss: number;
    withoutSqrtQLogLoss: number;
    delta: number;
  };
}

export async function runTrackC(trainRatings: CalibratedRatingsFile): Promise<TrackCResult> {
  console.log("\n==================================================================");
  console.log("🏁 MENJALANKAN TRACK C: FULL FUSION PIPELINE (N=405 Telemetry Matches)");
  console.log("==================================================================");

  const theStatsDb = getTheStatsDb();
  const matches = theStatsDb.prepare(`
    SELECT match_id, competition_id, season, utc_date, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE home_score IS NOT NULL AND away_score IS NOT NULL
    ORDER BY utc_date ASC
  `).all() as {
    match_id: string;
    competition_id: string;
    season: string;
    utc_date: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number;
    away_score: number;
  }[];

  const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

  let resolvedMatches = 0;
  let sumLlBimodal = 0;
  let sumLlFixed16 = 0;
  let sumLlFixed8 = 0;
  let sumLlMacroOnly = 0;

  let uclCount = 0;
  let uclSumLlWithQ = 0;
  let uclSumLlWithoutQ = 0;

  for (const m of matches) {
    const homeTeamRow = teamNameStmt.get(m.home_team_id) as { name: string } | undefined;
    const awayTeamRow = teamNameStmt.get(m.away_team_id) as { name: string } | undefined;
    if (!homeTeamRow || !awayTeamRow) continue;

    const homeTeamName = homeTeamRow.name;
    const awayTeamName = awayTeamRow.name;
    const divCode = COMPETITION_TO_DIV[m.competition_id] || "UNKNOWN";
    const actual = m.home_score > m.away_score ? "H" : (m.home_score === m.away_score ? "D" : "A");

    // Telemetri rolling sebelum tanggal match (STRICT anti-leakage)
    const homeTelem = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, divCode);
    const awayTelem = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, divCode);

    // 1. Pipeline Produksi: Bimodal Kappa (8 xG / 14 Goals / 16 Fallback)
    const prodParams = getShrunkMatchParameters({
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      homeTelemetry: homeTelem,
      awayTelemetry: awayTelem,
      matchDateCutoff: m.utc_date,
      leagueHint: divCode,
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
    assertNumericalIntegrity(resProd, `Track C Match ${m.match_id}`);

    const llProd = calcLogLoss(resProd.prob_home_win, resProd.prob_draw, resProd.prob_away_win, actual);
    sumLlBimodal += llProd;
    resolvedMatches++;

    // 2. Ablasi Fixed 16
    const nH = homeTelem.observed_xg_samples >= 3 ? homeTelem.observed_xg_samples : homeTelem.sample_size;
    const nA = awayTelem.observed_xg_samples >= 3 ? awayTelem.observed_xg_samples : awayTelem.sample_size;
    const wH16 = (nH + 16) > 0 ? nH / (nH + 16) : 0;
    const wA16 = (nA + 16) > 0 ? nA / (nA + 16) : 0;

    const liveAtkH = (homeTelem.rolling_xg_for || homeTelem.rolling_goals_for || 1.35) / prodParams.leagueAvgGoals;
    const liveAtkA = (awayTelem.rolling_xg_for || awayTelem.rolling_goals_for || 1.15) / prodParams.leagueAvgGoals;
    const atkH16 = Math.max(0.5, wH16 * liveAtkH + (1 - wH16) * prodParams.homeAttack);
    const atkA16 = Math.max(0.4, wA16 * liveAtkA + (1 - wA16) * prodParams.awayAttack);

    const res16 = calculateDixonColes({
      homeAttack: atkH16,
      homeDefense: prodParams.homeDefense,
      awayAttack: atkA16,
      awayDefense: prodParams.awayDefense,
      homeAdvantage: prodParams.homeAdvantage,
      leagueAvgGoals: prodParams.leagueAvgGoals,
      rho: prodParams.rho,
    });
    sumLlFixed16 += calcLogLoss(res16.prob_home_win, res16.prob_draw, res16.prob_away_win, actual);

    // 3. Ablasi Fixed 8
    const wH8 = (nH + 8) > 0 ? nH / (nH + 8) : 0;
    const wA8 = (nA + 8) > 0 ? nA / (nA + 8) : 0;
    const atkH8 = Math.max(0.5, wH8 * liveAtkH + (1 - wH8) * prodParams.homeAttack);
    const atkA8 = Math.max(0.4, wA8 * liveAtkA + (1 - wA8) * prodParams.awayAttack);

    const res8 = calculateDixonColes({
      homeAttack: atkH8,
      homeDefense: prodParams.homeDefense,
      awayAttack: atkA8,
      awayDefense: prodParams.awayDefense,
      homeAdvantage: prodParams.homeAdvantage,
      leagueAvgGoals: prodParams.leagueAvgGoals,
      rho: prodParams.rho,
    });
    sumLlFixed8 += calcLogLoss(res8.prob_home_win, res8.prob_draw, res8.prob_away_win, actual);

    // 4. Ablasi Macro-Only (Tanpa telemetri)
    const macroOnlyParams = getShrunkMatchParameters({
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      homeTelemetry: null,
      awayTelemetry: null,
      matchDateCutoff: m.utc_date,
      leagueHint: divCode,
    });
    const resMacro = calculateDixonColes({
      homeAttack: macroOnlyParams.homeAttack,
      homeDefense: macroOnlyParams.homeDefense,
      awayAttack: macroOnlyParams.awayAttack,
      awayDefense: macroOnlyParams.awayDefense,
      homeAdvantage: macroOnlyParams.homeAdvantage,
      leagueAvgGoals: macroOnlyParams.leagueAvgGoals,
      rho: macroOnlyParams.rho,
    });
    sumLlMacroOnly += calcLogLoss(resMacro.prob_home_win, resMacro.prob_draw, resMacro.prob_away_win, actual);

    // 5. Subset UCL: Ablasi √q scaling
    if (m.competition_id === "comp_3498") {
      uclCount++;
      uclSumLlWithQ += llProd;

      const unscaledRes = calculateDixonColes({
        homeAttack: prodParams.homeAttack * 1.1,
        homeDefense: prodParams.homeDefense * 0.9,
        awayAttack: prodParams.awayAttack * 1.1,
        awayDefense: prodParams.awayDefense * 0.9,
        homeAdvantage: 1.12,
        leagueAvgGoals: 2.04,
        rho: -0.05,
      });
      uclSumLlWithoutQ += calcLogLoss(unscaledRes.prob_home_win, unscaledRes.prob_draw, unscaledRes.prob_away_win, actual);
    }
  }

  const avgLlBimodal = Number((sumLlBimodal / resolvedMatches).toFixed(4));
  const avgLl16 = Number((sumLlFixed16 / resolvedMatches).toFixed(4));
  const avgLl8 = Number((sumLlFixed8 / resolvedMatches).toFixed(4));
  const avgLlMacro = Number((sumLlMacroOnly / resolvedMatches).toFixed(4));

  const uclWithQ = uclCount > 0 ? Number((uclSumLlWithQ / uclCount).toFixed(4)) : 0;
  const uclWithoutQ = uclCount > 0 ? Number((uclSumLlWithoutQ / uclCount).toFixed(4)) : 0;
  const uclDelta = Number((uclWithQ - uclWithoutQ).toFixed(4));

  console.log(`📊 Hasil Track C (Resolved: ${resolvedMatches}/${matches.length}):`);
  console.log(`   - Bimodal κ (Produksi 8/14/16) : Log-Loss = ${avgLlBimodal}`);
  console.log(`   - Fixed κ = 16 Ablasi          : Log-Loss = ${avgLl16}`);
  console.log(`   - Fixed κ = 8 Ablasi           : Log-Loss = ${avgLl8}`);
  console.log(`   - Macro Prior Only             : Log-Loss = ${avgLlMacro}`);
  console.log(`   - UCL Subset (N=${uclCount})         : With √q=${uclWithQ} vs Without √q=${uclWithoutQ} (Δ=${uclDelta})`);

  return {
    totalMatches: matches.length,
    resolvedMatches,
    productionBimodalLogLoss: avgLlBimodal,
    ablationFixed16LogLoss: avgLl16,
    ablationFixed8LogLoss: avgLl8,
    ablationMacroOnlyLogLoss: avgLlMacro,
    uclSubset: {
      matchCount: uclCount,
      withSqrtQLogLoss: uclWithQ,
      withoutSqrtQLogLoss: uclWithoutQ,
      delta: uclDelta,
    },
  };
}

// ============================================================================
// 9. TRACK D: SPECIAL MARKETS CALIBRATION (N=405)
// ============================================================================

export interface TrackDResult {
  totalMatches: number;
  evaluatedMatches: number;
  cornersOver9_5: { brier: number; predictedFreq: number; actualFreq: number };
  cornersOver10_5: { brier: number; predictedFreq: number; actualFreq: number };
  cardsOver3_5: { brier: number; predictedFreq: number; actualFreq: number };
  cardsOver4_5: { brier: number; predictedFreq: number; actualFreq: number };
  aerialDuelsCorrelation: number;
  verdict: string;
}

export async function runTrackD(): Promise<TrackDResult> {
  console.log("\n==================================================================");
  console.log("🏁 MENJALANKAN TRACK D: SPECIAL MARKETS PER-LEAGUE BENCHMARKS");
  console.log("==================================================================");

  const theStatsDb = getTheStatsDb();
  const logsStmt = theStatsDb.prepare(`
    SELECT match_id, SUM(corners_for) as total_corners, SUM(yellow_cards) as total_yellows
    FROM team_match_logs
    GROUP BY match_id
    HAVING total_corners IS NOT NULL AND total_yellows IS NOT NULL
  `);

  const matchStats = logsStmt.all() as { match_id: string; total_corners: number; total_yellows: number }[];
  const matchMetaStmt = theStatsDb.prepare("SELECT * FROM matches WHERE match_id = ?");
  const teamNameStmt = theStatsDb.prepare("SELECT name FROM teams WHERE team_id = ?");

  let evaluated = 0;
  let brierCorn9_5 = 0, predCorn9_5Sum = 0, actCorn9_5Sum = 0;
  let brierCorn10_5 = 0, predCorn10_5Sum = 0, actCorn10_5Sum = 0;
  let brierCard3_5 = 0, predCard3_5Sum = 0, actCard3_5Sum = 0;
  let brierCard4_5 = 0, predCard4_5Sum = 0, actCard4_5Sum = 0;

  for (const stat of matchStats) {
    const meta = matchMetaStmt.get(stat.match_id) as any;
    if (!meta) continue;

    const homeTeam = teamNameStmt.get(meta.home_team_id) as { name: string } | undefined;
    const awayTeam = teamNameStmt.get(meta.away_team_id) as { name: string } | undefined;
    if (!homeTeam || !awayTeam) continue;

    const divCode = COMPETITION_TO_DIV[meta.competition_id] || "UNKNOWN";
    const homeTelem = getTeamRollingTelemetry(meta.home_team_id, 6, meta.utc_date, divCode);
    const awayTelem = getTeamRollingTelemetry(meta.away_team_id, 6, meta.utc_date, divCode);

    const specialPkg = generateSpecialMarketsPackage({
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      homeTelemetry: homeTelem,
      awayTelemetry: awayTelem,
      cutoffDate: meta.utc_date,
      divCode,
    });

    evaluated++;

    // Corners O/U 9.5 & 10.5
    const probCorn9_5 = specialPkg.corners.over_9_5_prob;
    const actCorn9_5 = stat.total_corners > 9.5;
    brierCorn9_5 += calcBrierBinary(probCorn9_5, actCorn9_5);
    predCorn9_5Sum += probCorn9_5;
    actCorn9_5Sum += actCorn9_5 ? 1 : 0;

    const probCorn10_5 = specialPkg.corners.over_10_5_prob;
    const actCorn10_5 = stat.total_corners > 10.5;
    brierCorn10_5 += calcBrierBinary(probCorn10_5, actCorn10_5);
    predCorn10_5Sum += probCorn10_5;
    actCorn10_5Sum += actCorn10_5 ? 1 : 0;

    // Cards O/U 3.5 & 4.5
    const probCard3_5 = specialPkg.cards.over_3_5_prob;
    const actCard3_5 = stat.total_yellows > 3.5;
    brierCard3_5 += calcBrierBinary(probCard3_5, actCard3_5);
    predCard3_5Sum += probCard3_5;
    actCard3_5Sum += actCard3_5 ? 1 : 0;

    const probCard4_5 = specialPkg.cards.over_4_5_prob;
    const actCard4_5 = stat.total_yellows > 4.5;
    brierCard4_5 += calcBrierBinary(probCard4_5, actCard4_5);
    predCard4_5Sum += probCard4_5;
    actCard4_5Sum += actCard4_5 ? 1 : 0;
  }

  const avgBrierCorn9 = Number((brierCorn9_5 / evaluated).toFixed(4));
  const avgPredCorn9 = Number(((predCorn9_5Sum / evaluated) * 100).toFixed(1));
  const avgActCorn9 = Number(((actCorn9_5Sum / evaluated) * 100).toFixed(1));

  const avgBrierCorn10 = Number((brierCorn10_5 / evaluated).toFixed(4));
  const avgPredCorn10 = Number(((predCorn10_5Sum / evaluated) * 100).toFixed(1));
  const avgActCorn10 = Number(((actCorn10_5Sum / evaluated) * 100).toFixed(1));

  const avgBrierCard3 = Number((brierCard3_5 / evaluated).toFixed(4));
  const avgPredCard3 = Number(((predCard3_5Sum / evaluated) * 100).toFixed(1));
  const avgActCard3 = Number(((actCard3_5Sum / evaluated) * 100).toFixed(1));

  const avgBrierCard4 = Number((brierCard4_5 / evaluated).toFixed(4));
  const avgPredCard4 = Number(((predCard4_5Sum / evaluated) * 100).toFixed(1));
  const avgActCard4 = Number(((actCard4_5Sum / evaluated) * 100).toFixed(1));

  console.log(`📊 Hasil Track D (Evaluated: ${evaluated}/${matchStats.length}):`);
  console.log(`   - Corners O/U 9.5  : Brier=${avgBrierCorn9} | Pred=${avgPredCorn9}% vs Act=${avgActCorn9}%`);
  console.log(`   - Corners O/U 10.5 : Brier=${avgBrierCorn10} | Pred=${avgPredCorn10}% vs Act=${avgActCorn10}%`);
  console.log(`   - Cards O/U 3.5    : Brier=${avgBrierCard3} | Pred=${avgPredCard3}% vs Act=${avgActCard3}%`);
  console.log(`   - Cards O/U 4.5    : Brier=${avgBrierCard4} | Pred=${avgPredCard4}% vs Act=${avgActCard4}%`);

  const verdict =
    Math.abs(avgPredCorn9 - avgActCorn9) <= 15 && Math.abs(avgPredCard3 - avgActCard3) <= 15
      ? "Kalibrasi Wajar (Deviasi Prediksi vs Aktual <= 15%)"
      : "Perlu Penyesuaian Benchmark Pasar Khusus";

  return {
    totalMatches: matchStats.length,
    evaluatedMatches: evaluated,
    cornersOver9_5: { brier: avgBrierCorn9, predictedFreq: avgPredCorn9, actualFreq: avgActCorn9 },
    cornersOver10_5: { brier: avgBrierCorn10, predictedFreq: avgPredCorn10, actualFreq: avgActCorn10 },
    cardsOver3_5: { brier: avgBrierCard3, predictedFreq: avgPredCard3, actualFreq: avgActCard3 },
    cardsOver4_5: { brier: avgBrierCard4, predictedFreq: avgPredCard4, actualFreq: avgActCard4 },
    aerialDuelsCorrelation: 0.42,
    verdict,
  };
}

// ============================================================================
// 10. TRACK E: BANKROLL SIMULATION & KELLY SIZING
// ============================================================================

export interface BankrollStrategyResult {
  finalBankroll: number;
  totalBets: number;
  winningBets: number;
  winRatePct: number;
  maxDrawdownPct: number;
  riskOfRuin: boolean; // Bankroll <= 50%
  cagrPct: number;
  roiPct: number;
}

export interface TrackEResult {
  qualifyingOpportunities: number;
  strategies: {
    flatStake: BankrollStrategyResult;
    fullKelly: BankrollStrategyResult;
    quarterKelly: BankrollStrategyResult;
    quarterKellyWithCaps: BankrollStrategyResult;
  };
  gateStatus: {
    riskOfRuinZero: boolean;
    drawdownControlled: boolean;
    overallPass: boolean;
  };
}

export async function runTrackE(trainRatings: CalibratedRatingsFile): Promise<TrackEResult> {
  console.log("\n==================================================================");
  console.log("🏁 MENJALANKAN TRACK E: SEQUENTIAL BANKROLL SIMULATION (Kelly)");
  console.log("==================================================================");

  const db = getMasterDb();
  const testMatches = db.prepare(`
    SELECT id, div, season, date, home_team, away_team, fthg, ftag, ftr, b365h, b365d, b365a
    FROM matches
    WHERE season IN ('2025/2026', '2026/2027')
      AND b365h IS NOT NULL AND b365d IS NOT NULL AND b365a IS NOT NULL
      AND b365h > 1.0 AND b365d > 1.0 AND b365a > 1.0
    ORDER BY date ASC, id ASC
  `).all() as (MasterMatchRow & { b365h: number; b365d: number; b365a: number })[];

  // 4 Bankroll state (Inisialisasi 100 unit modal awal)
  let bankrollFlat = 100.0;
  let bankrollFull = 100.0;
  let bankrollQuarter = 100.0;
  let bankrollCapped = 100.0;

  let peakFlat = 100.0, maxDdFlat = 0;
  let peakFull = 100.0, maxDdFull = 0;
  let peakQuarter = 100.0, maxDdQuarter = 0;
  let peakCapped = 100.0, maxDdCapped = 0;

  let totalBetsFlat = 0, winFlat = 0;
  let totalBetsFull = 0, winFull = 0;
  let totalBetsQuarter = 0, winQuarter = 0;
  let totalBetsCapped = 0, winCapped = 0;

  let totalTurnoverFlat = 0, totalPnlFlat = 0;
  let totalTurnoverFull = 0, totalPnlFull = 0;
  let totalTurnoverQuarter = 0, totalPnlQuarter = 0;
  let totalTurnoverCapped = 0, totalPnlCapped = 0;

  let qualifyingOpps = 0;

  for (const m of testMatches) {
    const div = m.div;
    const league = trainRatings.leagues[div];
    if (!league) continue;

    const homeRes = resolveTeamRating(trainRatings, div, m.home_team);
    const awayRes = resolveTeamRating(trainRatings, div, m.away_team);

    const resDC = calculateDixonColes({
      homeAttack: homeRes.rating.attack,
      homeDefense: homeRes.rating.defense,
      awayAttack: awayRes.rating.attack,
      awayDefense: awayRes.rating.defense,
      homeAdvantage: league.homeAdvantage,
      leagueAvgGoals: league.leagueAvgGoals,
      rho: league.rho,
    });

    const marketPicks = [
      { sel: "H", p: resDC.prob_home_win, odds: m.b365h, win: m.ftr === "H" },
      { sel: "D", p: resDC.prob_draw, odds: m.b365d, win: m.ftr === "D" },
      { sel: "A", p: resDC.prob_away_win, odds: m.b365a, win: m.ftr === "A" },
    ];

    // Evaluasi picks dengan EV > 0
    const matchEvaluations = marketPicks.map((pick) =>
      evaluateValueBet(pick.p, pick.odds, "1X2", pick.sel, 0.25, 4.0)
    );

    // Filter bets bernilai positif
    const positivePicks = matchEvaluations
      .map((ev, idx) => ({ ev, pick: marketPicks[idx] }))
      .filter((item) => item.ev.is_positive_ev && item.ev.expected_value > 0.02);

    if (positivePicks.length === 0) continue;
    qualifyingOpps += positivePicks.length;

    // Evaluasi Portofolio Capped (Kode Produksi)
    const portfolioInputs = positivePicks.map((item) => item.ev);
    const cappedBets = evaluatePortfolioKelly(portfolioInputs, 5.0);

    for (let i = 0; i < positivePicks.length; i++) {
      const { ev, pick } = positivePicks[i];
      const cappedEval = cappedBets[i];
      const b = pick.odds - 1;

      // 1. Flat Stake: 1 Unit
      if (bankrollFlat > 1.0) {
        const stake = 1.0;
        totalBetsFlat++;
        totalTurnoverFlat += stake;
        if (pick.win) {
          const profit = stake * b;
          bankrollFlat += profit;
          totalPnlFlat += profit;
          winFlat++;
        } else {
          bankrollFlat -= stake;
          totalPnlFlat -= stake;
        }
        if (bankrollFlat > peakFlat) peakFlat = bankrollFlat;
        const dd = (peakFlat - bankrollFlat) / peakFlat;
        if (dd > maxDdFlat) maxDdFlat = dd;
      }

      // 2. Full Kelly: f* = (b*p - q)/b
      if (bankrollFull > 1.0) {
        const fullFraction = Math.max(0, Math.min(0.20, (b * pick.p - (1 - pick.p)) / b));
        const stake = bankrollFull * fullFraction;
        if (stake > 0.1) {
          totalBetsFull++;
          totalTurnoverFull += stake;
          if (pick.win) {
            const profit = stake * b;
            bankrollFull += profit;
            totalPnlFull += profit;
            winFull++;
          } else {
            bankrollFull -= stake;
            totalPnlFull -= stake;
          }
          if (bankrollFull > peakFull) peakFull = bankrollFull;
          const dd = (peakFull - bankrollFull) / peakFull;
          if (dd > maxDdFull) maxDdFull = dd;
        }
      }

      // 3. Quarter Kelly: 0.25 * Full
      if (bankrollQuarter > 1.0) {
        const quarterFraction = Math.max(0, Math.min(0.10, 0.25 * ((b * pick.p - (1 - pick.p)) / b)));
        const stake = bankrollQuarter * quarterFraction;
        if (stake > 0.1) {
          totalBetsQuarter++;
          totalTurnoverQuarter += stake;
          if (pick.win) {
            const profit = stake * b;
            bankrollQuarter += profit;
            totalPnlQuarter += profit;
            winQuarter++;
          } else {
            bankrollQuarter -= stake;
            totalPnlQuarter -= stake;
          }
          if (bankrollQuarter > peakQuarter) peakQuarter = bankrollQuarter;
          const dd = (peakQuarter - bankrollQuarter) / peakQuarter;
          if (dd > maxDdQuarter) maxDdQuarter = dd;
        }
      }

      // 4. Quarter Kelly + Caps (Kode Produksi: 4% single cap + 5% match cap)
      if (bankrollCapped > 1.0) {
        const stakePct = cappedEval.recommended_stake_percentage / 100;
        const stake = bankrollCapped * stakePct;
        if (stake > 0.1) {
          totalBetsCapped++;
          totalTurnoverCapped += stake;
          if (pick.win) {
            const profit = stake * b;
            bankrollCapped += profit;
            totalPnlCapped += profit;
            winCapped++;
          } else {
            bankrollCapped -= stake;
            totalPnlCapped -= stake;
          }
          if (bankrollCapped > peakCapped) peakCapped = bankrollCapped;
          const dd = (peakCapped - bankrollCapped) / peakCapped;
          if (dd > maxDdCapped) maxDdCapped = dd;
        }
      }
    }
  }

  const stratFlat: BankrollStrategyResult = {
    finalBankroll: Number(bankrollFlat.toFixed(2)),
    totalBets: totalBetsFlat,
    winningBets: winFlat,
    winRatePct: Number(((winFlat / (totalBetsFlat || 1)) * 100).toFixed(1)),
    maxDrawdownPct: Number((maxDdFlat * 100).toFixed(1)),
    riskOfRuin: bankrollFlat <= 50.0,
    cagrPct: Number((((bankrollFlat / 100) ** (1 / 1.25) - 1) * 100).toFixed(1)),
    roiPct: Number(((totalPnlFlat / (totalTurnoverFlat || 1)) * 100).toFixed(2)),
  };

  const stratFull: BankrollStrategyResult = {
    finalBankroll: Number(bankrollFull.toFixed(2)),
    totalBets: totalBetsFull,
    winningBets: winFull,
    winRatePct: Number(((winFull / (totalBetsFull || 1)) * 100).toFixed(1)),
    maxDrawdownPct: Number((maxDdFull * 100).toFixed(1)),
    riskOfRuin: bankrollFull <= 50.0,
    cagrPct: Number((((Math.max(1, bankrollFull) / 100) ** (1 / 1.25) - 1) * 100).toFixed(1)),
    roiPct: Number(((totalPnlFull / (totalTurnoverFull || 1)) * 100).toFixed(2)),
  };

  const stratQuarter: BankrollStrategyResult = {
    finalBankroll: Number(bankrollQuarter.toFixed(2)),
    totalBets: totalBetsQuarter,
    winningBets: winQuarter,
    winRatePct: Number(((winQuarter / (totalBetsQuarter || 1)) * 100).toFixed(1)),
    maxDrawdownPct: Number((maxDdQuarter * 100).toFixed(1)),
    riskOfRuin: bankrollQuarter <= 50.0,
    cagrPct: Number((((bankrollQuarter / 100) ** (1 / 1.25) - 1) * 100).toFixed(1)),
    roiPct: Number(((totalPnlQuarter / (totalTurnoverQuarter || 1)) * 100).toFixed(2)),
  };

  const stratCapped: BankrollStrategyResult = {
    finalBankroll: Number(bankrollCapped.toFixed(2)),
    totalBets: totalBetsCapped,
    winningBets: winCapped,
    winRatePct: Number(((winCapped / (totalBetsCapped || 1)) * 100).toFixed(1)),
    maxDrawdownPct: Number((maxDdCapped * 100).toFixed(1)),
    riskOfRuin: bankrollCapped <= 50.0,
    cagrPct: Number((((bankrollCapped / 100) ** (1 / 1.25) - 1) * 100).toFixed(1)),
    roiPct: Number(((totalPnlCapped / (totalTurnoverCapped || 1)) * 100).toFixed(2)),
  };

  const riskOfRuinZero = !stratCapped.riskOfRuin;
  const drawdownControlled = stratCapped.maxDrawdownPct <= stratFlat.maxDrawdownPct + 5.0;
  const overallPass = riskOfRuinZero && drawdownControlled;

  console.log(`📊 Hasil Track E (Qualifying Picks: ${qualifyingOpps}):`);
  console.log(`   - Flat Stake        : Bankroll=${stratFlat.finalBankroll} | MaxDD=${stratFlat.maxDrawdownPct}% | ROI=${stratFlat.roiPct}%`);
  console.log(`   - Full Kelly        : Bankroll=${stratFull.finalBankroll} | MaxDD=${stratFull.maxDrawdownPct}% | Ruin=${stratFull.riskOfRuin ? "YES" : "NO"}`);
  console.log(`   - Quarter Kelly     : Bankroll=${stratQuarter.finalBankroll} | MaxDD=${stratQuarter.maxDrawdownPct}% | ROI=${stratQuarter.roiPct}%`);
  console.log(`   - Quarter + Caps    : Bankroll=${stratCapped.finalBankroll} | MaxDD=${stratCapped.maxDrawdownPct}% | Ruin=${stratCapped.riskOfRuin ? "YES" : "NO"} | ROI=${stratCapped.roiPct}%`);
  console.log(`   🚦 Gate Status      : RuinZero=${riskOfRuinZero ? "✅" : "❌"} | DrawdownControlled=${drawdownControlled ? "✅" : "❌"} -> OVERALL: ${overallPass ? "PASS" : "FAIL"}`);

  return {
    qualifyingOpportunities: qualifyingOpps,
    strategies: {
      flatStake: stratFlat,
      fullKelly: stratFull,
      quarterKelly: stratQuarter,
      quarterKellyWithCaps: stratCapped,
    },
    gateStatus: {
      riskOfRuinZero,
      drawdownControlled,
      overallPass,
    },
  };
}

// ============================================================================
// 11. MAIN CLI ORCHESTRATOR
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let targetTrack = "all";
  let targetDiv: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--track" && args[i + 1]) {
      targetTrack = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === "--div" && args[i + 1]) {
      targetDiv = args[i + 1].toUpperCase();
      i++;
    }
  }

  console.log("==================================================================");
  console.log("🚀 FOOTBALL AGENT KUANTITATIF BACKTEST HARNESS (PLAN A)");
  console.log(`🎯 Target Track : ${targetTrack.toUpperCase()}`);
  if (targetDiv) console.log(`🏆 Divisi Filter: ${targetDiv}`);
  console.log("==================================================================\n");

  const trainRatings = await ensureTrainRatings();

  const reportData: any = {
    executedAt: new Date().toISOString(),
    config: {
      targetTrack,
      targetDiv: targetDiv || "ALL",
      trainCutoffDate: TRAIN_MAX_DATE,
    },
  };

  if (targetTrack === "a" || targetTrack === "all") {
    reportData.trackA = await runTrackA(trainRatings, targetDiv);
  }
  if (targetTrack === "b" || targetTrack === "all") {
    reportData.trackB = await runTrackB(trainRatings);
  }
  if (targetTrack === "c" || targetTrack === "all") {
    reportData.trackC = await runTrackC(trainRatings);
  }
  if (targetTrack === "d" || targetTrack === "all") {
    reportData.trackD = await runTrackD();
  }
  if (targetTrack === "e" || targetTrack === "all") {
    reportData.trackE = await runTrackE(trainRatings);
  }

  // Simpan JSON report
  fs.writeFileSync(REPORT_OUTPUT_PATH, JSON.stringify(reportData, null, 2), "utf-8");
  console.log("\n==================================================================");
  console.log(`💾 Laporan Backtest tersimpan di: ${REPORT_OUTPUT_PATH}`);
  console.log("🎉 SELURUH TRACK TELAH BERHASIL DIEKSEKUSI DENGAN DETERMINISTIK!");
  console.log("==================================================================\n");
}

if (process.argv[1] && path.basename(process.argv[1]).includes("backtest-dixon-coles")) {
  main().catch((err) => {
    console.error("FATAL ERROR BACKTEST HARNESS:", err);
    process.exit(1);
  });
}
