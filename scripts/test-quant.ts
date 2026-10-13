import {
  calculateDixonColes,
  stripVigShin,
  stripVigProportional,
  stripVigTwoWay,
  evaluateValueBet,
} from "../lib/quant";

console.log("=== 1. TESTING DIXON-COLES ENGINE ===");
const dcResult = calculateDixonColes({
  homeAttack: 1.85,
  homeDefense: 0.95,
  awayAttack: 1.20,
  awayDefense: 1.40,
  homeAdvantage: 1.22,
});

console.log("Lambda (Home xG):", dcResult.lambda);
console.log("Mu (Away xG):", dcResult.mu);
console.log("Prob Home Win:", (dcResult.prob_home_win * 100).toFixed(1) + "%");
console.log("Prob Draw:", (dcResult.prob_draw * 100).toFixed(1) + "%");
console.log("Prob Away Win:", (dcResult.prob_away_win * 100).toFixed(1) + "%");
console.log("Fair 1X2 Odds:", dcResult.fair_odds);
console.log("Over 2.5 Prob:", (dcResult.over_under.line_2_5.over * 100).toFixed(1) + "%");
console.log("BTTS Yes Prob:", (dcResult.btts.yes * 100).toFixed(1) + "%");
console.log("Top 3 Scorelines:", dcResult.top_scorelines.slice(0, 3));

const sumProbs = dcResult.prob_home_win + dcResult.prob_draw + dcResult.prob_away_win;
console.log("Sum of 1X2 Probs:", sumProbs, Math.abs(sumProbs - 1.0) < 0.005 ? "PASS (100%)" : "FAIL");

console.log("\n=== 2. TESTING SHIN VIG STRIPPING ===");
// Raw 1xBet odds for a typical match: e.g. 1.80 (Home), 3.60 (Draw), 4.50 (Away)
const shin = stripVigShin(1.80, 3.60, 4.50);
console.log("Raw Odds: [1.80, 3.60, 4.50]");
console.log("Raw Overround Margin:", shin.margin_percentage + "%");
console.log("Fair Odds (Shin):", shin.fair_odds);
console.log("Fair Probs (Shin):", shin.fair_prob);

console.log("\n=== 3. TESTING VALUE BET (+EV) & KELLY ===");
// Model says Home Win = 58% (Fair Odds 1.72). Bookmaker offers 1.95!
const valueBet = evaluateValueBet(0.58, 1.95, "Match Winner", "Arsenal Win");
console.log("Value Bet Evaluation:", {
  market: valueBet.market_name,
  selection: valueBet.selection,
  bookmaker_odds: valueBet.bookmaker_odds,
  fair_odds: valueBet.fair_odds,
  ev: valueBet.ev_percentage,
  isPositive: valueBet.is_positive_ev,
  edge_rating: valueBet.edge_rating,
  quarter_kelly: valueBet.recommended_stake_percentage + "%",
  rationale: valueBet.rationale,
});

// Negative EV Test: Model says Away Win = 20% (Fair Odds 5.00). Bookmaker offers 4.20.
const negBet = evaluateValueBet(0.20, 4.20, "Match Winner", "Away Win");
console.log("\nNegative Bet Evaluation:", {
  selection: negBet.selection,
  ev: negBet.ev_percentage,
  isPositive: negBet.is_positive_ev,
  recommended_stake: negBet.recommended_stake_percentage + "%",
});
