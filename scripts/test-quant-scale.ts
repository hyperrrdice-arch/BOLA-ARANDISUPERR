/**
 * Skrip verifikasi kontrak skala quant (regression guard untuk bug lambda/mu).
 *
 * Invariant yang diuji:
 *   1. Tim rata-rata vs rata-rata (attack=defense=1.0):
 *        lambda ≈ leagueAvgGoals * homeAdvantage
 *        mu     ≈ leagueAvgGoals
 *      (total ≈ leagueAvgGoals * (1 + homeAdvantage), bukan leagueAvgGoals/2)
 *   2. prob_home_win + prob_draw + prob_away_win ≈ 1
 *   3. stripVig* throw pada odds invalid (bukan karang probabilitas seragam)
 *
 * Jalankan: npx.cmd tsx scripts/test-quant-scale.ts
 */
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin, stripVigProportional, stripVigTwoWay } from "../lib/quant/vig-stripping";

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

console.log("[1] Invariant skala: tim rata-rata vs rata-rata");
{
  const leagueAvg = 1.35;
  const homeAdv = 1.15;
  const res = calculateDixonColes({
    homeAttack: 1.0,
    homeDefense: 1.0,
    awayAttack: 1.0,
    awayDefense: 1.0,
    homeAdvantage: homeAdv,
    leagueAvgGoals: leagueAvg,
  });
  assert(
    approx(res.lambda, leagueAvg * homeAdv, 0.02),
    `lambda ≈ leagueAvg*homeAdv (${(leagueAvg * homeAdv).toFixed(3)})`,
    `got ${res.lambda.toFixed(3)}`
  );
  assert(
    approx(res.mu, leagueAvg, 0.02),
    `mu ≈ leagueAvg (${leagueAvg.toFixed(3)})`,
    `got ${res.mu.toFixed(3)}`
  );
  assert(
    approx(res.expected_total_goals, leagueAvg * (1 + homeAdv), 0.05),
    `expected_total_goals ≈ leagueAvg*(1+homeAdv) (${(leagueAvg * (1 + homeAdv)).toFixed(3)})`,
    `got ${res.expected_total_goals.toFixed(3)}`
  );
}

console.log("[2] Probabilitas 1X2 berjumlah ~1");
{
  const res = calculateDixonColes({
    homeAttack: 1.2,
    homeDefense: 0.9,
    awayAttack: 1.05,
    awayDefense: 1.1,
    leagueAvgGoals: 1.35,
  });
  const sum = res.prob_home_win + res.prob_draw + res.prob_away_win;
  assert(approx(sum, 1, 1e-3), "prob_home + prob_draw + prob_away ≈ 1", `got ${sum}`);
  assert(res.lambda > 0 && res.mu > 0, "lambda & mu positif", `lambda=${res.lambda} mu=${res.mu}`);
}

console.log("[3] Vig stripping throw pada odds invalid");
{
  let threwShin = false;
  try {
    stripVigShin(0, 3.2, 3.4);
  } catch {
    threwShin = true;
  }
  assert(threwShin, "stripVigShin(0, ...) throw");

  let threwProp = false;
  try {
    stripVigProportional(1.0, 3.2, 3.4);
  } catch {
    threwProp = true;
  }
  assert(threwProp, "stripVigProportional(1.0, ...) throw");

  let threwTwoWay = false;
  try {
    stripVigTwoWay(NaN, 2.0);
  } catch {
    threwTwoWay = true;
  }
  assert(threwTwoWay, "stripVigTwoWay(NaN, ...) throw");

  // Odds valid tetap jalan normal
  const ok = stripVigShin(2.1, 3.4, 3.6);
  assert(
    approx(ok.fair_prob.home + ok.fair_prob.draw + ok.fair_prob.away, 1, 1e-6),
    "fair_prob valid berjumlah ~1",
    `got ${ok.fair_prob.home + ok.fair_prob.draw + ok.fair_prob.away}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion gagal.`);
  process.exit(1);
}
console.log("\nSemua assertion lolos.");
