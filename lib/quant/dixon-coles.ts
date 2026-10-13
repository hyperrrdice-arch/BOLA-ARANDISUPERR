/**
 * Dixon-Coles Bivariate Poisson Football Modeling Engine
 * Reference: Dixon, M. J., & Coles, S. G. (1997). "Modelling Association Football
 * Scores and Inefficiencies in the Football Betting Market".
 */

export interface DixonColesInput {
  homeAttack: number; // e.g. xG per match or season goals scored per game (~1.1 - 2.5)
  homeDefense: number; // e.g. xGA per match or goals conceded per game (~0.8 - 2.2)
  awayAttack: number; // e.g. xG per match
  awayDefense: number; // e.g. xGA per match
  homeAdvantage?: number; // Home ground multiplier (default 1.20)
  rho?: number; // Low-score correlation parameter tau (standard: -0.13)
  maxGoals?: number; // Matrix dimension limit (default 7 goals per side)
}

export interface ScorelineProbability {
  homeGoals: number;
  awayGoals: number;
  prob: number;
}

export interface AsianHandicapLines {
  ah_0_0_dnb: {
    home_prob: number;
    away_prob: number;
    fair_odds_home: number;
    fair_odds_away: number;
    push_prob: number;
  };
  ah_minus_0_5: {
    home_cover: number;
    away_cover: number;
    fair_odds_home: number;
    fair_odds_away: number;
  };
  ah_minus_1_0: {
    home_cover: number;
    push_prob: number;
    away_cover: number;
    fair_odds_home: number;
    fair_odds_away: number;
  };
}

export interface CleanSheetMetrics {
  home_clean_sheet_prob: number;
  away_clean_sheet_prob: number;
  home_win_to_nil_prob: number;
  away_win_to_nil_prob: number;
}

export interface ExpectedPointsMetrics {
  home_xpts: number;
  away_xpts: number;
}

export interface DixonColesResult {
  lambda: number; // Home expected goals (xG)
  mu: number; // Away expected goals (xG)
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  fair_odds: {
    home: number;
    draw: number;
    away: number;
  };
  over_under: {
    line_1_5: { over: number; under: number };
    line_2_5: { over: number; under: number };
    line_3_5: { over: number; under: number };
  };
  btts: {
    yes: number;
    no: number;
  };
  asian_handicap: AsianHandicapLines;
  clean_sheet: CleanSheetMetrics;
  expected_points: ExpectedPointsMetrics;
  expected_total_goals: number;
  top_scorelines: ScorelineProbability[];
  score_matrix: number[][]; // [home][away]
}

// Factorial helper with memoization
const FACTORIAL_CACHE: number[] = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
function factorial(n: number): number {
  if (n <= 1) return 1;
  if (FACTORIAL_CACHE[n] !== undefined) return FACTORIAL_CACHE[n];
  let res = FACTORIAL_CACHE[FACTORIAL_CACHE.length - 1];
  for (let i = FACTORIAL_CACHE.length; i <= n; i++) {
    res *= i;
    FACTORIAL_CACHE[i] = res;
  }
  return res;
}

// Poisson probability function P(X = k) = (lambda^k * e^-lambda) / k!
function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Dixon-Coles low score adjustment factor tau(x, y, lambda, mu, rho)
 * Adjusts low-scoring correlation for (0,0), (0,1), (1,0), (1,1)
 */
function tauAdjustment(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) {
    return Math.max(0, 1 - lambda * mu * rho);
  } else if (x === 0 && y === 1) {
    return Math.max(0, 1 + lambda * rho);
  } else if (x === 1 && y === 0) {
    return Math.max(0, 1 + mu * rho);
  } else if (x === 1 && y === 1) {
    return Math.max(0, 1 - rho);
  }
  return 1.0;
}

/**
 * Compute Dixon-Coles Bivariate Goal Expectancy and Full Market Probabilities
 */
export function calculateDixonColes(input: DixonColesInput): DixonColesResult {
  const homeAdvantage = input.homeAdvantage ?? 1.2;
  const rho = input.rho ?? -0.13;
  const maxGoals = input.maxGoals ?? 7;

  // Calculate expected goals (lambda and mu)
  // lambda = Home Attack * Away Defense Weakness * Home Advantage
  // mu = Away Attack * Home Defense Weakness
  const rawLambda = Math.max(0.2, (input.homeAttack || 1.3) * (input.awayDefense || 1.2) * (homeAdvantage / 1.2));
  const rawMu = Math.max(0.2, (input.awayAttack || 1.1) * (input.homeDefense || 1.1));

  const lambda = Math.round(rawLambda * 1000) / 1000;
  const mu = Math.round(rawMu * 1000) / 1000;

  // Build bivariate score probability matrix
  const matrix: number[][] = [];
  let sumProb = 0;

  for (let x = 0; x <= maxGoals; x++) {
    matrix[x] = [];
    const pX = poissonProb(lambda, x);
    for (let y = 0; y <= maxGoals; y++) {
      const pY = poissonProb(mu, y);
      const tau = tauAdjustment(x, y, lambda, mu, rho);
      const pXY = pX * pY * tau;
      matrix[x][y] = pXY;
      sumProb += pXY;
    }
  }

  // Normalize matrix so probabilities sum exactly to 1.0
  const scorelines: ScorelineProbability[] = [];
  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;

  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let bttsYes = 0;

  let homeCleanSheet = 0;
  let awayCleanSheet = 0;
  let homeWinToNil = 0;
  let awayWinToNil = 0;

  let ahMinus1HomeCover = 0;
  let ahMinus1Push = 0;
  let ahMinus1AwayCover = 0;

  for (let x = 0; x <= maxGoals; x++) {
    for (let y = 0; y <= maxGoals; y++) {
      const normalizedProb = matrix[x][y] / sumProb;
      matrix[x][y] = normalizedProb;

      scorelines.push({ homeGoals: x, awayGoals: y, prob: normalizedProb });

      if (x > y) homeWinProb += normalizedProb;
      else if (x === y) drawProb += normalizedProb;
      else awayWinProb += normalizedProb;

      const total = x + y;
      if (total > 1.5) over15 += normalizedProb;
      if (total > 2.5) over25 += normalizedProb;
      if (total > 3.5) over35 += normalizedProb;

      if (x > 0 && y > 0) bttsYes += normalizedProb;

      // Clean sheet & Win to Nil
      if (y === 0) homeCleanSheet += normalizedProb;
      if (x === 0) awayCleanSheet += normalizedProb;
      if (x > 0 && y === 0) homeWinToNil += normalizedProb;
      if (y > 0 && x === 0) awayWinToNil += normalizedProb;

      // Asian Handicap -1.0
      if (x - y >= 2) ahMinus1HomeCover += normalizedProb;
      else if (x - y === 1) ahMinus1Push += normalizedProb;
      else ahMinus1AwayCover += normalizedProb;
    }
  }

  // Sort scorelines by highest probability
  scorelines.sort((a, b) => b.prob - a.prob);

  // Round helper
  const roundPct = (n: number) => Math.round(n * 10000) / 10000;
  const toOdds = (p: number) => (p > 0.001 ? Math.round((1 / p) * 100) / 100 : 999);

  // Asian Handicap 0.0 (Draw No Bet)
  const dnbDenominator = homeWinProb + awayWinProb;
  const dnbHomeProb = dnbDenominator > 0 ? homeWinProb / dnbDenominator : 0.5;
  const dnbAwayProb = dnbDenominator > 0 ? awayWinProb / dnbDenominator : 0.5;

  return {
    lambda,
    mu,
    prob_home_win: roundPct(homeWinProb),
    prob_draw: roundPct(drawProb),
    prob_away_win: roundPct(awayWinProb),
    fair_odds: {
      home: toOdds(homeWinProb),
      draw: toOdds(drawProb),
      away: toOdds(awayWinProb),
    },
    over_under: {
      line_1_5: {
        over: roundPct(over15),
        under: roundPct(1 - over15),
      },
      line_2_5: {
        over: roundPct(over25),
        under: roundPct(1 - over25),
      },
      line_3_5: {
        over: roundPct(over35),
        under: roundPct(1 - over35),
      },
    },
    btts: {
      yes: roundPct(bttsYes),
      no: roundPct(1 - bttsYes),
    },
    asian_handicap: {
      ah_0_0_dnb: {
        home_prob: roundPct(dnbHomeProb),
        away_prob: roundPct(dnbAwayProb),
        fair_odds_home: toOdds(dnbHomeProb),
        fair_odds_away: toOdds(dnbAwayProb),
        push_prob: roundPct(drawProb),
      },
      ah_minus_0_5: {
        home_cover: roundPct(homeWinProb),
        away_cover: roundPct(drawProb + awayWinProb),
        fair_odds_home: toOdds(homeWinProb),
        fair_odds_away: toOdds(drawProb + awayWinProb),
      },
      ah_minus_1_0: {
        home_cover: roundPct(ahMinus1HomeCover),
        push_prob: roundPct(ahMinus1Push),
        away_cover: roundPct(ahMinus1AwayCover),
        fair_odds_home: toOdds(ahMinus1HomeCover),
        fair_odds_away: toOdds(ahMinus1AwayCover),
      },
    },
    clean_sheet: {
      home_clean_sheet_prob: roundPct(homeCleanSheet),
      away_clean_sheet_prob: roundPct(awayCleanSheet),
      home_win_to_nil_prob: roundPct(homeWinToNil),
      away_win_to_nil_prob: roundPct(awayWinToNil),
    },
    expected_points: {
      home_xpts: Math.round((3 * homeWinProb + 1 * drawProb) * 100) / 100,
      away_xpts: Math.round((3 * awayWinProb + 1 * drawProb) * 100) / 100,
    },
    expected_total_goals: Math.round((lambda + mu) * 100) / 100,
    top_scorelines: scorelines.slice(0, 6).map((s) => ({
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
      prob: Math.round(s.prob * 1000) / 10, // percentage e.g. 14.5%
    })),
    score_matrix: matrix,
  };
}
