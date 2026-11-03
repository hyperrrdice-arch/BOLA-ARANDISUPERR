/**
 * Vig Stripping (Margin Removal) Engine
 * Implements the Shin (1991, 1993) method and Power/Multiplicative methods
 * to remove bookmaker overround and uncover true market consensus probabilities.
 */

export interface VigStrippingResult {
  raw_odds: { home: number; draw: number; away: number };
  implied_prob_raw: { home: number; draw: number; away: number };
  overround: number; // e.g. 1.064 (6.4% bookmaker margin)
  margin_percentage: number; // 6.4%
  fair_prob: { home: number; draw: number; away: number }; // True probabilities summing to 1.0
  fair_odds: { home: number; draw: number; away: number }; // Fair decimal odds with 0% margin
  method_used: "shin" | "power" | "proportional";
}

export interface TwoWayVigResult {
  overround: number;
  margin_percentage: number;
  fair_prob: { optionA: number; optionB: number };
  fair_odds: { optionA: number; optionB: number };
}

/**
 * Proportional (Multiplicative) Margin Removal
 */
export function stripVigProportional(home: number, draw: number, away: number): VigStrippingResult {
  // Odds invalid = data hilang/rusak → fail-fast. DILARANG karang probabilitas seragam 0.3333,
  // downstream bakal treat itu sebagai konsensus pasar dan hitung edge +EV palsu.
  if (
    !Number.isFinite(home) || !Number.isFinite(draw) || !Number.isFinite(away) ||
    home <= 1.0 || draw <= 1.0 || away <= 1.0
  ) {
    throw new Error(`stripVigProportional: odds tidak valid (home=${home}, draw=${draw}, away=${away}) — wajib finite dan > 1.0`);
  }

  const invH = 1 / home;
  const invD = 1 / draw;
  const invA = 1 / away;
  const sumInv = invH + invD + invA;
  const safeSumInv = sumInv > 0 ? sumInv : 1.0;

  const fairH = invH / safeSumInv;
  const fairD = invD / safeSumInv;
  const fairA = invA / safeSumInv;

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const toOdds = (p: number) => (p > 0.0001 ? Math.round((1 / p) * 100) / 100 : 999);

  return {
    raw_odds: { home, draw, away },
    implied_prob_raw: {
      home: round4(invH),
      draw: round4(invD),
      away: round4(invA),
    },
    overround: round4(safeSumInv),
    margin_percentage: Math.round((safeSumInv - 1) * 1000) / 10,
    fair_prob: {
      home: round4(fairH),
      draw: round4(fairD),
      away: round4(fairA),
    },
    fair_odds: {
      home: toOdds(fairH),
      draw: toOdds(fairD),
      away: toOdds(fairA),
    },
    method_used: "proportional",
  };
}

/**
 * Shin Method (1991, 1993) Margin Removal
 * Accounts for the favorite-longshot bias by estimating the proportion of insider trading (z).
 * Solves for z via bisection search such that sum(p_i(z)) = 1.0.
 */
export function stripVigShin(home: number, draw: number, away: number): VigStrippingResult {
  // Odds invalid → fail-fast, jangan fallback ke proporsional yang ngarang angka
  if (
    !Number.isFinite(home) || !Number.isFinite(draw) || !Number.isFinite(away) ||
    home <= 1.0 || draw <= 1.0 || away <= 1.0
  ) {
    throw new Error(`stripVigShin: odds tidak valid (home=${home}, draw=${draw}, away=${away}) — wajib finite dan > 1.0`);
  }

  const p = [1 / home, 1 / draw, 1 / away];
  const sumP = p[0] + p[1] + p[2];

  // If already fair or inverted, return proportional
  if (sumP <= 1.0001 || !Number.isFinite(sumP)) {
    return stripVigProportional(home, draw, away);
  }

  // Shin probability formula for option i given z parameter:
  // pi_i(z) = (sqrt(z^2 + 4 * (1 - z) * (p_i^2 / sumP)) - z) / (2 * (1 - z))
  function calcShinProbs(z: number): number[] {
    if (Math.abs(z - 1.0) < 1e-6) {
      return [p[0] / sumP, p[1] / sumP, p[2] / sumP];
    }
    const denom = 2 * (1 - z);
    return p.map((pi) => {
      const discriminant = z * z + 4 * (1 - z) * ((pi * pi) / sumP);
      return (Math.sqrt(Math.max(0, discriminant)) - z) / denom;
    });
  }

  // Bisection search for z in [0, 0.4]
  let low = 0;
  let high = 0.4;
  let z = 0.02;

  for (let iter = 0; iter < 40; iter++) {
    z = (low + high) / 2;
    const probs = calcShinProbs(z);
    const sum = probs[0] + probs[1] + probs[2];

    if (Math.abs(sum - 1.0) < 1e-6) {
      break;
    }

    if (sum > 1.0) {
      low = z;
    } else {
      high = z;
    }
  }

  const finalProbs = calcShinProbs(z);
  const sumFinal = finalProbs[0] + finalProbs[1] + finalProbs[2];
  const safeSumFinal = sumFinal > 0 && Number.isFinite(sumFinal) ? sumFinal : 1.0;

  // Normalize final result
  const fairH = finalProbs[0] / safeSumFinal;
  const fairD = finalProbs[1] / safeSumFinal;
  const fairA = finalProbs[2] / safeSumFinal;

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const toOdds = (prob: number) => (prob > 0.0001 ? Math.round((1 / prob) * 100) / 100 : 999);

  return {
    raw_odds: { home, draw, away },
    implied_prob_raw: {
      home: round4(p[0]),
      draw: round4(p[1]),
      away: round4(p[2]),
    },
    overround: round4(sumP),
    margin_percentage: Math.round((sumP - 1) * 1000) / 10,
    fair_prob: {
      home: round4(fairH),
      draw: round4(fairD),
      away: round4(fairA),
    },
    fair_odds: {
      home: toOdds(fairH),
      draw: toOdds(fairD),
      away: toOdds(fairA),
    },
    method_used: "shin",
  };
}

/**
 * Vig Stripping for Two-Way Markets (e.g. Over/Under, BTTS, Asian Handicap)
 */
export function stripVigTwoWay(oddA: number, oddB: number): TwoWayVigResult {
  if (!Number.isFinite(oddA) || !Number.isFinite(oddB) || oddA <= 1.0 || oddB <= 1.0) {
    throw new Error(`stripVigTwoWay: odds tidak valid (A=${oddA}, B=${oddB}) — wajib finite dan > 1.0`);
  }

  const invA = 1 / oddA;
  const invB = 1 / oddB;
  const sumInv = invA + invB;
  const safeSumInv = sumInv > 0 ? sumInv : 1.0;

  const fairA = invA / safeSumInv;
  const fairB = invB / safeSumInv;

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const toOdds = (p: number) => (p > 0.0001 ? Math.round((1 / p) * 100) / 100 : 999);

  return {
    overround: round4(safeSumInv),
    margin_percentage: Math.round((safeSumInv - 1) * 1000) / 10,
    fair_prob: {
      optionA: round4(fairA),
      optionB: round4(fairB),
    },
    fair_odds: {
      optionA: toOdds(fairA),
      optionB: toOdds(fairB),
    },
  };
}
