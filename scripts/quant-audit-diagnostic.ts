import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { evaluateValueBet } from "../lib/quant/kelly";

console.log("=== QUANT DIAGNOSTIC AUDIT ===");

// Scenario 1: Low sample variance shift
// Suppose true lambda = 1.5, mu = 1.2
// If team scored 3 goals in 2 games vs 0 goals in 2 games:
const baseline = calculateDixonColes({
  homeAttack: 1.5,
  homeDefense: 1.2,
  awayAttack: 1.2,
  awayDefense: 1.3,
});

const noisyHigh = calculateDixonColes({
  homeAttack: 2.2,
  homeDefense: 1.2,
  awayAttack: 1.2,
  awayDefense: 1.3,
});

const noisyLow = calculateDixonColes({
  homeAttack: 0.8,
  homeDefense: 1.2,
  awayAttack: 1.2,
  awayDefense: 1.3,
});

console.log("Baseline P(Home):", baseline.prob_home_win, "Fair Odds:", baseline.fair_odds.home);
console.log("Noisy High P(Home):", noisyHigh.prob_home_win, "Fair Odds:", noisyHigh.fair_odds.home);
console.log("Noisy Low P(Home):", noisyLow.prob_home_win, "Fair Odds:", noisyLow.fair_odds.home);

// Impact on Kelly stake at market odds 1.85:
const betBase = evaluateValueBet(baseline.prob_home_win, 1.85, "1X2", "Home");
const betHigh = evaluateValueBet(noisyHigh.prob_home_win, 1.85, "1X2", "Home");
const betLow = evaluateValueBet(noisyLow.prob_home_win, 1.85, "1X2", "Home");

console.log("Kelly Stake Base (P=" + baseline.prob_home_win + "): EV=" + betBase.ev_percentage + ", Quarter Kelly=" + betBase.recommended_stake_percentage + "%");
console.log("Kelly Stake High (P=" + noisyHigh.prob_home_win + "): EV=" + betHigh.ev_percentage + ", Quarter Kelly=" + betHigh.recommended_stake_percentage + "%");
console.log("Kelly Stake Low  (P=" + noisyLow.prob_home_win + "): EV=" + betLow.ev_percentage + ", Quarter Kelly=" + betLow.recommended_stake_percentage + "%");

console.log("\n=== 2. ASIAN HANDICAP -1.0 VERIFICATION ===");
const ah1 = baseline.asian_handicap.ah_minus_1_0;
console.log("AH -1.0 Home Cover:", ah1.home_cover);
console.log("AH -1.0 Push Prob:", ah1.push_prob);
console.log("AH -1.0 Away Cover:", ah1.away_cover);
console.log("AH -1.0 Fair Odds Home:", ah1.fair_odds_home);
console.log("AH -1.0 Fair Odds Away:", ah1.fair_odds_away);

// Mathematical invariant check:
// In conditional space, (1 / fair_odds_home) + (1 / fair_odds_away) should equal ~1.0
const impliedSum = (1 / ah1.fair_odds_home) + (1 / ah1.fair_odds_away);
console.log("Implied Probability Sum (should be ~1.00):", impliedSum.toFixed(4));
console.log("Condition:", Math.abs(impliedSum - 1.0) < 0.02 ? "PASS (Zero Arbitrage Risk)" : "FAIL");
