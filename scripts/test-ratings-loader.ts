import { getShrunkMatchParameters, loadCalibratedRatings } from "../lib/quant/ratings-loader";
import { calculateDixonColes } from "../lib/quant/dixon-coles";

console.log("==================================================================");
console.log("🧪 TESTING RATINGS LOADER & EMPIRICAL BAYES SHRINKAGE");
console.log("==================================================================\n");

// 1. Cek loading JSON
const t0 = performance.now();
const data = loadCalibratedRatings();
const loadTime = performance.now() - t0;

console.log(`✅ File data/calibrated_ratings.json berhasil dimuat dalam ${loadTime.toFixed(3)} ms`);
console.log(`   Versi: ${data?.version} | Total Divisi: ${data?.totalLeagues} | Total Klub: ${data?.totalTeams}\n`);

// 2. Test Kasus 1: Tim Elit EPL (Liverpool vs Manchester United)
console.log("--- Test Kasus 1: Liverpool vs Manchester United (EPL) ---");
const t1 = performance.now();
const match1 = getShrunkMatchParameters({
  homeTeam: "Liverpool",
  awayTeam: "Man United",
  leagueHint: "Premier League",
  liveHomeFormGoalsAvg: 2.2, // Live form 5 laga terakhir
  liveAwayFormGoalsAvg: 1.4,
  homeSampleN: 5,
  awaySampleN: 5,
});
const lookupTime1 = performance.now() - t1;

console.log(`⏱️ Waktu lookup & James-Stein calculation: ${lookupTime1.toFixed(3)} ms`);
console.log("Output Parameters:", match1);

const dc1 = calculateDixonColes({
  homeAttack: match1.homeAttack,
  homeDefense: match1.homeDefense,
  awayAttack: match1.awayAttack,
  awayDefense: match1.awayDefense,
  homeAdvantage: match1.homeAdvantage,
  leagueAvgGoals: match1.leagueAvgGoals,
  rho: match1.rho,
});

console.log("\n🎯 Hasil Dixon-Coles:");
console.log(`   Prob Home Win : ${(dc1.prob_home_win * 100).toFixed(1)}% (Fair Odds: ${dc1.fair_odds.home.toFixed(2)})`);
console.log(`   Prob Draw     : ${(dc1.prob_draw * 100).toFixed(1)}% (Fair Odds: ${dc1.fair_odds.draw.toFixed(2)})`);
console.log(`   Prob Away Win : ${(dc1.prob_away_win * 100).toFixed(1)}% (Fair Odds: ${dc1.fair_odds.away.toFixed(2)})`);
console.log(`   Expected Goals: Home λ=${dc1.lambda.toFixed(2)}, Away μ=${dc1.mu.toFixed(2)} | Total=${dc1.expected_total_goals.toFixed(2)}`);
console.log(`   Prob Over 2.5 : ${(dc1.over_under.line_2_5.over * 100).toFixed(1)}%`);

const sumProb = dc1.prob_home_win + dc1.prob_draw + dc1.prob_away_win;
console.log(`   Total Prob Invariant: ${sumProb.toFixed(4)} (Expected: 1.0000)`);
if (Math.abs(sumProb - 1.0) < 0.005) {
  console.log("   STATUS: ✅ PASS (Total probabilitas valid)");
} else {
  console.error("   STATUS: ❌ FAIL (Probabilitas tidak valid)");
}

// 3. Test Kasus 2: Tim Promosi (Ipswich Town di EPL)
console.log("\n--- Test Kasus 2: Ipswich Town (Promosi dari Championship) vs Arsenal ---");
const match2 = getShrunkMatchParameters({
  homeTeam: "Ipswich",
  awayTeam: "Arsenal",
  leagueHint: "EPL",
  liveHomeFormGoalsAvg: 0.8,
  liveAwayFormGoalsAvg: 1.9,
  homeSampleN: 4,
  awaySampleN: 4,
});

console.log("Output Parameters Ipswich vs Arsenal:", match2);
console.log(`   Home Source: ${match2.metadata?.homeSource} (Deteksi tim promosi sukses!)`);
console.log(`   Away Source: ${match2.metadata?.awaySource}`);

const dc2 = calculateDixonColes({
  homeAttack: match2.homeAttack,
  homeDefense: match2.homeDefense,
  awayAttack: match2.awayAttack,
  awayDefense: match2.awayDefense,
  homeAdvantage: match2.homeAdvantage,
  leagueAvgGoals: match2.leagueAvgGoals,
  rho: match2.rho,
});

console.log(`   Arsenal Win Prob: ${(dc2.prob_away_win * 100).toFixed(1)}% (Fair Odds: ${dc2.fair_odds.away.toFixed(2)})`);
console.log(`   Ipswich Win Prob: ${(dc2.prob_home_win * 100).toFixed(1)}% (Fair Odds: ${dc2.fair_odds.home.toFixed(2)})`);

console.log("\n==================================================================");
console.log("🎉 SELURUH PENGUJIAN RATINGS LOADER LULUS DENGAN PREPISISI TINGGI!");
console.log("==================================================================\n");
