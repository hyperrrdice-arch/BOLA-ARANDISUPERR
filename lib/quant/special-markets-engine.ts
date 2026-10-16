/**
 * Quantitative Special Markets Engine
 * Menghitung probabilitas pasar khusus 1xBet (Headed Goal, Corners, Cards, Passes)
 * berbasis telemetry terukur dari thestats_dataset.db.
 *
 * Menerapkan prinsip DATABASE_REVIEW_PREMIER_LEAGUE.md:
 * - Tidak ada silent imputation / keyakinan palsu
 * - Pelaporan jujur observed sample size & status is_estimated
 * - Proteksi numerik ketat terhadap pembagi nol / NaN / probabilitas negatif
 */

import { type TeamRollingTelemetry } from "../db/team-telemetry";

export interface SpecialMarketProbability {
  market_name: string;
  selection: string;
  expected_value_lambda: number;
  probability: number;
  fair_odds: number;
  observed_samples: number;
  confidence_tier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";
  is_estimated: boolean;
  model_notes: string;
}

export interface SpecialMarketsPackage {
  match: {
    home_team: string;
    away_team: string;
    cutoff_date?: string;
  };
  headed_goal: {
    expected_headers: number;
    prob_at_least_one_header: number;
    fair_odds_yes: number;
    fair_odds_no: number;
    home_expected_headers: number;
    away_expected_headers: number;
    confidence_tier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";
    is_estimated: boolean;
    observed_aerial_samples: { home: number; away: number };
    observed_crosses_samples: { home: number; away: number };
  };
  corners: {
    expected_total_corners: number;
    home_expected_corners: number;
    away_expected_corners: number;
    over_9_5_prob: number;
    under_9_5_prob: number;
    fair_odds_over_9_5: number;
    fair_odds_under_9_5: number;
    over_10_5_prob: number;
    under_10_5_prob: number;
    fair_odds_over_10_5: number;
    fair_odds_under_10_5: number;
    observed_samples: { home: number; away: number };
    confidence_tier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";
    is_estimated: boolean;
  };
  cards: {
    expected_total_cards: number;
    home_expected_cards: number;
    away_expected_cards: number;
    over_3_5_prob: number;
    under_3_5_prob: number;
    fair_odds_over_3_5: number;
    fair_odds_under_3_5: number;
    over_4_5_prob: number;
    under_4_5_prob: number;
    fair_odds_over_4_5: number;
    fair_odds_under_4_5: number;
    observed_samples: { home: number; away: number };
    confidence_tier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";
    is_estimated: boolean;
  };
  passing_dominance?: {
    home_expected_passes: number | null;
    away_expected_passes: number | null;
    expected_pass_differential: number | null;
    observed_samples: { home: number; away: number };
  };
}

/**
 * Poisson Cumulative Probability P(X <= k)
 */
function poissonCDF(k: number, lambda: number): number {
  if (lambda <= 0) return 1.0;
  let sum = 0;
  let term = Math.exp(-lambda);
  sum += term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1.0, Math.max(0.0, sum));
}

/**
 * Menghitung probabilitas pasar Headed Goal (Gol Sundulan)
 * Menggunakan korelasi antara accurate_crosses, aerial_duels_pct, dan touches_in_box
 */
export function calculateHeadedGoalMarket(
  homeTelemetry: TeamRollingTelemetry,
  awayTelemetry: TeamRollingTelemetry
): SpecialMarketsPackage["headed_goal"] {
  // Baseline Liga Inggris (PL 2024-2026): ~0.38 gol sundulan per laga (0.19 per tim)
  const LEAGUE_BASE_HEADER_RATE = 0.19;
  const BENCHMARK_CROSSES = 3.5;
  // Rata-rata aerial share PL (aerial_duels / total duels_won) dari sample dataset.
  // Aerial share adalah fitur dominan gol sundulan dan memang berupa rasio 0-1,
  // jadi dipakai proporsional (exponent 1.0) tanpa damping tambahan.
  const BENCHMARK_AERIAL_SHARE = 0.3;
  const BENCHMARK_BOX_TOUCHES = 24.0;

  const homeAerialSamples = homeTelemetry.observed_aerial_samples || 0;
  const awayAerialSamples = awayTelemetry.observed_aerial_samples || 0;
  const homeCrossSamples = homeTelemetry.observed_crosses_samples || 0;
  const awayCrossSamples = awayTelemetry.observed_crosses_samples || 0;

  const minSamples = Math.min(homeAerialSamples, awayAerialSamples);

  // Aerial share = duel udara yang dimenangkan / total duel yang dimenangkan.
  // Field mentah aerial_duels_pct_for adalah JUMLAH duel udara (bukan persentase dan
  // bukan win-rate udara), jadi tidak boleh dibandingkan dengan benchmark persen.
  // Rasio inilah yang bermakna sebagai kekuatan duel udara sebuah tim.
  const aerialShare = (t: TeamRollingTelemetry): number | null => {
    const aerial = t.avg_aerial_duels_pct_for;
    const total = t.avg_duels_won_pct_for;
    if (aerial === null || total === null || total <= 0) return null;
    const share = aerial / total;
    return Number.isFinite(share) && share > 0 ? share : null;
  };

  const homeAerialShare = aerialShare(homeTelemetry);
  const awayAerialShare = aerialShare(awayTelemetry);

  // Multiplier Tim Kandang
  let homeCrossFactor = 1.0;
  if (homeTelemetry.avg_crosses_accurate_for !== null && homeTelemetry.avg_crosses_accurate_for > 0) {
    homeCrossFactor = Math.pow(homeTelemetry.avg_crosses_accurate_for / BENCHMARK_CROSSES, 0.6);
  }

  let homeAerialFactor = 1.0;
  if (homeAerialShare !== null) {
    homeAerialFactor = homeAerialShare / BENCHMARK_AERIAL_SHARE;
  }

  let homeTouchFactor = 1.0;
  if (homeTelemetry.avg_box_touches_for !== null && homeTelemetry.avg_box_touches_for > 0) {
    homeTouchFactor = Math.pow(homeTelemetry.avg_box_touches_for / BENCHMARK_BOX_TOUCHES, 0.4);
  }

  // Multiplier Tim Tamu
  let awayCrossFactor = 1.0;
  if (awayTelemetry.avg_crosses_accurate_for !== null && awayTelemetry.avg_crosses_accurate_for > 0) {
    awayCrossFactor = Math.pow(awayTelemetry.avg_crosses_accurate_for / BENCHMARK_CROSSES, 0.6);
  }

  let awayAerialFactor = 1.0;
  if (awayAerialShare !== null) {
    awayAerialFactor = awayAerialShare / BENCHMARK_AERIAL_SHARE;
  }

  let awayTouchFactor = 1.0;
  if (awayTelemetry.avg_box_touches_for !== null && awayTelemetry.avg_box_touches_for > 0) {
    awayTouchFactor = Math.pow(awayTelemetry.avg_box_touches_for / BENCHMARK_BOX_TOUCHES, 0.4);
  }

  // Batas regulasi faktor untuk mencegah overfitting dari sampel kecil.
  // Floor 0.25 (bukan 0.5): floor yang lebih tinggi memotong semua tim lemah ke
  // angka yang sama sehingga model berhenti membedakan tim sama sekali.
  const rawHomeMultiplier = homeCrossFactor * homeAerialFactor * homeTouchFactor;
  const rawAwayMultiplier = awayCrossFactor * awayAerialFactor * awayTouchFactor;
  const safeHomeMultiplier = Math.min(2.2, Math.max(0.25, rawHomeMultiplier));
  const safeAwayMultiplier = Math.min(2.2, Math.max(0.25, rawAwayMultiplier));
  // Kalau salah satu multiplier mentok clamp, metrik-nya tidak lagi diskriminatif
  // (semua tim terpotong ke angka yang sama) -> turunkan tier keyakinan.
  const homeClamped = safeHomeMultiplier !== rawHomeMultiplier;
  const awayClamped = safeAwayMultiplier !== rawAwayMultiplier;
  const anyClamped = homeClamped || awayClamped;

  // Tier keyakinan dihitung SESUDAH clamp: multiplier yang mentok batas berarti
  // metrik sudah tidak diskriminatif, jadi tidak boleh diklaim HIGH.
  let confidenceTier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA" = "MODERATE";
  let isEstimated = false;

  if (minSamples <= 0) {
    confidenceTier = "INSUFFICIENT_DATA";
    isEstimated = true;
  } else if (minSamples === 1 || anyClamped) {
    confidenceTier = "LOW";
    isEstimated = true;
  } else if (minSamples >= 4) {
    confidenceTier = "HIGH";
  } else {
    confidenceTier = "MODERATE";
  }

  // Estimasi lambda gol sundulan
  const lambdaHomeHeader = Number((LEAGUE_BASE_HEADER_RATE * safeHomeMultiplier * 1.1).toFixed(3)); // 1.1x home adv
  const lambdaAwayHeader = Number((LEAGUE_BASE_HEADER_RATE * safeAwayMultiplier * 0.9).toFixed(3));
  const totalLambda = Number((lambdaHomeHeader + lambdaAwayHeader).toFixed(3));

  // Poisson: P(X >= 1) = 1 - e^(-lambda)
  const probAtLeastOne = Number((1 - Math.exp(-totalLambda)).toFixed(3));
  const probZero = Number(Math.exp(-totalLambda).toFixed(3));

  const fairOddsYes = probAtLeastOne > 0 ? Number((1 / probAtLeastOne).toFixed(2)) : 99.0;
  const fairOddsNo = probZero > 0 ? Number((1 / probZero).toFixed(2)) : 99.0;

  return {
    expected_headers: totalLambda,
    prob_at_least_one_header: probAtLeastOne,
    fair_odds_yes: fairOddsYes,
    fair_odds_no: fairOddsNo,
    home_expected_headers: lambdaHomeHeader,
    away_expected_headers: lambdaAwayHeader,
    confidence_tier: confidenceTier,
    is_estimated: isEstimated,
    observed_aerial_samples: { home: homeAerialSamples, away: awayAerialSamples },
    observed_crosses_samples: { home: homeCrossSamples, away: awayCrossSamples },
  };
}

/**
 * Tier keyakinan bersama untuk corners/cards.
 * Tanpa telemetry terukur, output tetap ada (pakai rata-rata liga) TAPI ditandai
 * estimasi supaya tidak disajikan seolah terukur.
 */
function tierForSamples(minSamples: number): {
  confidence_tier: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_DATA";
  is_estimated: boolean;
} {
  if (minSamples <= 0) return { confidence_tier: "INSUFFICIENT_DATA", is_estimated: true };
  if (minSamples === 1) return { confidence_tier: "LOW", is_estimated: true };
  if (minSamples >= 4) return { confidence_tier: "HIGH", is_estimated: false };
  return { confidence_tier: "MODERATE", is_estimated: false };
}

/**
 * Menghitung probabilitas pasar Corners (Tendangan Sudut)
 */
export function calculateCornersMarket(
  homeTelemetry: TeamRollingTelemetry,
  awayTelemetry: TeamRollingTelemetry
): SpecialMarketsPackage["corners"] {
  const LEAGUE_AVG_CORNERS_TEAM = 5.2;

  const homeCorners = homeTelemetry.avg_corners_for !== null ? homeTelemetry.avg_corners_for : LEAGUE_AVG_CORNERS_TEAM;
  const awayCorners = awayTelemetry.avg_corners_for !== null ? awayTelemetry.avg_corners_for : LEAGUE_AVG_CORNERS_TEAM;
  const homeImputed = homeTelemetry.avg_corners_for === null;
  const awayImputed = awayTelemetry.avg_corners_for === null;

  const homeExpected = Number((homeCorners * 1.05).toFixed(2));
  const awayExpected = Number((awayCorners * 0.95).toFixed(2));
  const totalCorners = Number((homeExpected + awayExpected).toFixed(2));

  // Over 9.5 Corners -> 1 - CDF(9)
  const under9_5 = Number(poissonCDF(9, totalCorners).toFixed(3));
  const over9_5 = Number((1 - under9_5).toFixed(3));

  // Over 10.5 Corners -> 1 - CDF(10)
  const under10_5 = Number(poissonCDF(10, totalCorners).toFixed(3));
  const over10_5 = Number((1 - under10_5).toFixed(3));

  const observedHome = homeTelemetry.sample_size;
  const observedAway = awayTelemetry.sample_size;
  const tier = tierForSamples(Math.min(observedHome, observedAway));

  return {
    expected_total_corners: totalCorners,
    home_expected_corners: homeExpected,
    away_expected_corners: awayExpected,
    over_9_5_prob: over9_5,
    under_9_5_prob: under9_5,
    fair_odds_over_9_5: over9_5 > 0 ? Number((1 / over9_5).toFixed(2)) : 99.0,
    fair_odds_under_9_5: under9_5 > 0 ? Number((1 / under9_5).toFixed(2)) : 99.0,
    over_10_5_prob: over10_5,
    under_10_5_prob: under10_5,
    fair_odds_over_10_5: over10_5 > 0 ? Number((1 / over10_5).toFixed(2)) : 99.0,
    fair_odds_under_10_5: under10_5 > 0 ? Number((1 / under10_5).toFixed(2)) : 99.0,
    observed_samples: {
      home: observedHome,
      away: observedAway,
    },
    confidence_tier: tier.confidence_tier,
    is_estimated: tier.is_estimated || homeImputed || awayImputed,
  };
}

/**
 * Menghitung probabilitas pasar Kartu & Disiplin (Yellow/Red Cards)
 */
export function calculateCardsMarket(
  homeTelemetry: TeamRollingTelemetry,
  awayTelemetry: TeamRollingTelemetry
): SpecialMarketsPackage["cards"] {
  const LEAGUE_AVG_CARDS_TEAM = 2.1;

  const homeCards = homeTelemetry.avg_yellow_cards !== null ? homeTelemetry.avg_yellow_cards : LEAGUE_AVG_CARDS_TEAM;
  const awayCards = awayTelemetry.avg_yellow_cards !== null ? awayTelemetry.avg_yellow_cards : LEAGUE_AVG_CARDS_TEAM;
  const homeImputed = homeTelemetry.avg_yellow_cards === null;
  const awayImputed = awayTelemetry.avg_yellow_cards === null;

  const totalCards = Number((homeCards + awayCards).toFixed(2));

  // Over 3.5 Cards -> 1 - CDF(3)
  const under3_5 = Number(poissonCDF(3, totalCards).toFixed(3));
  const over3_5 = Number((1 - under3_5).toFixed(3));

  // Over 4.5 Cards -> 1 - CDF(4)
  const under4_5 = Number(poissonCDF(4, totalCards).toFixed(3));
  const over4_5 = Number((1 - under4_5).toFixed(3));

  const observedHome = homeTelemetry.sample_size;
  const observedAway = awayTelemetry.sample_size;
  const tier = tierForSamples(Math.min(observedHome, observedAway));

  return {
    expected_total_cards: totalCards,
    home_expected_cards: homeCards,
    away_expected_cards: awayCards,
    over_3_5_prob: over3_5,
    under_3_5_prob: under3_5,
    fair_odds_over_3_5: over3_5 > 0 ? Number((1 / over3_5).toFixed(2)) : 99.0,
    fair_odds_under_3_5: under3_5 > 0 ? Number((1 / under3_5).toFixed(2)) : 99.0,
    over_4_5_prob: over4_5,
    under_4_5_prob: under4_5,
    fair_odds_over_4_5: over4_5 > 0 ? Number((1 / over4_5).toFixed(2)) : 99.0,
    fair_odds_under_4_5: under4_5 > 0 ? Number((1 / under4_5).toFixed(2)) : 99.0,
    observed_samples: {
      home: observedHome,
      away: observedAway,
    },
    confidence_tier: tier.confidence_tier,
    is_estimated: tier.is_estimated || homeImputed || awayImputed,
  };
}

/**
 * Menghasilkan Paket Analisis Pasar Khusus Lengkap
 */
export function generateSpecialMarketsPackage(options: {
  homeTeam: string;
  awayTeam: string;
  homeTelemetry: TeamRollingTelemetry;
  awayTelemetry: TeamRollingTelemetry;
  cutoffDate?: string;
}): SpecialMarketsPackage {
  const { homeTeam, awayTeam, homeTelemetry, awayTelemetry, cutoffDate } = options;

  const headed = calculateHeadedGoalMarket(homeTelemetry, awayTelemetry);
  const corners = calculateCornersMarket(homeTelemetry, awayTelemetry);
  const cards = calculateCardsMarket(homeTelemetry, awayTelemetry);

  const homePass = homeTelemetry.avg_passes_accurate_for;
  const awayPass = awayTelemetry.avg_passes_accurate_for;
  const passDiff = homePass !== null && awayPass !== null ? homePass - awayPass : null;

  return {
    match: {
      home_team: homeTeam,
      away_team: awayTeam,
      cutoff_date: cutoffDate,
    },
    headed_goal: headed,
    corners,
    cards,
    passing_dominance: {
      home_expected_passes: homePass,
      away_expected_passes: awayPass,
      expected_pass_differential: passDiff,
      observed_samples: {
        home: homeTelemetry.observed_passes_samples,
        away: awayTelemetry.observed_passes_samples,
      },
    },
  };
}
