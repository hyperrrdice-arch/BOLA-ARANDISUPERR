/**
 * Expected Value (+EV) & Fractional Kelly Criterion Portfolio Sizing Engine
 * Reference: Kelly, J. L. (1956). "A New Interpretation of Information Rate".
 */

export interface ValueBetEvaluation {
  market_name: string;
  selection: string;
  bookmaker_odds: number;
  model_probability: number; // e.g. 0.58 (58%)
  fair_odds: number; // 1 / model_probability
  expected_value: number; // e.g. 0.082 (+8.2%)
  ev_percentage: string; // e.g. "+8.2%"
  is_positive_ev: boolean;
  edge_rating: "EXCELLENT" | "GOOD" | "MODERATE" | "NEUTRAL" | "NEGATIVE";
  kelly_fraction_full: number; // Full Kelly stake %
  kelly_fraction_quarter: number; // Recommended 1/4 Kelly stake % (Conservative syndicate standard)
  recommended_stake_percentage: number; // Capped safe stake % (max 4.0%)
  rationale: string;
}

/**
 * Calculate Expected Value (+EV) and Fractional Kelly Stake
 *
 * @param modelProbability True win probability from Dixon-Coles model [0.0 - 1.0]
 * @param bookmakerOdds The decimal odds offered by the bookmaker (e.g. 1xBet / Pinnacle)
 * @param marketName Name of the market (e.g. "Match Winner (1X2)")
 * @param selection Specific pick (e.g. "Home Win", "Over 2.5")
 * @param kellyFraction Multiplier for Kelly (default 0.25 for Quarter Kelly)
 * @param maxStakeCap Maximum stake cap percentage to prevent over-exposure (default 4.0%)
 */
export function evaluateValueBet(
  modelProbability: number,
  bookmakerOdds: number,
  marketName: string,
  selection: string,
  kellyFraction: number = 0.25,
  maxStakeCap: number = 4.0
): ValueBetEvaluation {
  if (
    !Number.isFinite(modelProbability) ||
    !Number.isFinite(bookmakerOdds) ||
    modelProbability <= 0 ||
    modelProbability > 1.0 ||
    bookmakerOdds <= 1.0
  ) {
    return {
      market_name: marketName,
      selection,
      bookmaker_odds: Number.isFinite(bookmakerOdds) && bookmakerOdds > 0 ? bookmakerOdds : 1.0,
      model_probability: 0,
      fair_odds: 999,
      expected_value: -1,
      ev_percentage: "-100.0%",
      is_positive_ev: false,
      edge_rating: "NEGATIVE",
      kelly_fraction_full: 0,
      kelly_fraction_quarter: 0,
      recommended_stake_percentage: 0,
      rationale: "Odds atau probabilitas tidak valid.",
    };
  }

  // 1. Calculate Expected Value: EV = (Prob * Odds) - 1
  const ev = modelProbability * bookmakerOdds - 1;
  const evPct = Math.round(ev * 1000) / 10;
  const isPositive = ev > 0;
  const fairOdds = Math.round((1 / modelProbability) * 100) / 100;

  // 2. Kelly Criterion: f* = (P * O - 1) / (O - 1) = EV / (O - 1)
  const b = bookmakerOdds - 1;
  const fullKelly = isPositive && b > 0 ? Math.max(0, ev / b) : 0;
  const safeFraction = Number.isFinite(kellyFraction) && kellyFraction > 0 ? kellyFraction : 0.25;
  const quarterKelly = fullKelly * safeFraction;

  // Convert to percentage (e.g. 0.024 -> 2.4%) and cap
  const fullKellyPct = Math.round(fullKelly * 1000) / 10;
  const quarterKellyPct = Math.round(quarterKelly * 1000) / 10;
  const safeCap = Number.isFinite(maxStakeCap) && maxStakeCap > 0 ? maxStakeCap : 4.0;
  const recommendedStake = isPositive
    ? Math.min(quarterKellyPct, safeCap)
    : 0;

  // 3. Edge Rating
  let rating: "EXCELLENT" | "GOOD" | "MODERATE" | "NEUTRAL" | "NEGATIVE";
  if (evPct >= 8.0) rating = "EXCELLENT";
  else if (evPct >= 4.0) rating = "GOOD";
  else if (evPct > 0.0) rating = "MODERATE";
  else if (evPct >= -2.0) rating = "NEUTRAL";
  else rating = "NEGATIVE";

  let rationale = "";
  if (isPositive) {
    rationale = `Model memproyeksikan probabilitas ${(modelProbability * 100).toFixed(1)}% (Fair Odds ${fairOdds}), sedangkan bandar menawarkan ${bookmakerOdds.toFixed(2)}. Terdapat mathematical edge +${evPct}% (+EV).`;
  } else {
    rationale = `Odds bandar ${bookmakerOdds.toFixed(2)} berada di bawah Fair Odds model ${fairOdds} (Defisit EV ${evPct}%). Pasar ini memiliki ekspektasi nilai negatif.`;
  }

  return {
    market_name: marketName,
    selection,
    bookmaker_odds: bookmakerOdds,
    model_probability: Math.round(modelProbability * 1000) / 1000,
    fair_odds: fairOdds,
    expected_value: Math.round(ev * 10000) / 10000,
    ev_percentage: (evPct > 0 ? `+${evPct}%` : `${evPct}%`),
    is_positive_ev: isPositive,
    edge_rating: rating,
    kelly_fraction_full: fullKellyPct,
    kelly_fraction_quarter: quarterKellyPct,
    recommended_stake_percentage: recommendedStake,
    rationale,
  };
}

/**
 * Portfolio Kelly Normalizer
 * Scales individual Kelly stakes across multiple concurrent value bets on the same match
 * so the total match exposure never exceeds matchBankrollCap (default 5.0%).
 */
export function evaluatePortfolioKelly(
  bets: ValueBetEvaluation[],
  matchBankrollCap: number = 5.0
): ValueBetEvaluation[] {
  const safeCap = Number.isFinite(matchBankrollCap) && matchBankrollCap > 0 ? matchBankrollCap : 5.0;
  const positiveBets = bets.filter((b) => b.is_positive_ev && b.recommended_stake_percentage > 0);
  const totalRecommended = positiveBets.reduce((acc, b) => acc + b.recommended_stake_percentage, 0);

  if (totalRecommended <= safeCap || totalRecommended <= 0) {
    return bets;
  }

  // Scale down proportionally with strict cap enforcement
  const scale = safeCap / totalRecommended;
  let allocatedSoFar = 0;

  return bets.map((b) => {
    if (!b.is_positive_ev || b.recommended_stake_percentage === 0) return b;
    // Gunakan Math.floor untuk konservatisme modal agar tidak over-exposed akibat pembulatan ke atas
    const rawScaled = Math.floor(b.recommended_stake_percentage * scale * 10) / 10;
    const remainingCap = Math.max(0, Math.round((safeCap - allocatedSoFar) * 10) / 10);
    const scaledStake = Number(Math.min(rawScaled, remainingCap).toFixed(1));
    allocatedSoFar = Number((allocatedSoFar + scaledStake).toFixed(1));

    return {
      ...b,
      recommended_stake_percentage: scaledStake,
      rationale: `${b.rationale} (Alokasi disesuaikan portofolio: ${scaledStake}% dari pagu maksimal ${safeCap}%).`,
    };
  });
}

