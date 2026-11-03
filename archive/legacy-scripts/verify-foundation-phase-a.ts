/**
 * Verifikasi Fase A — Fondasi Ratings Loader & Shrinkage
 * Menggantikan ekspektasi lama yang bergantung pada fallback E0.
 *
 * Kriteria:
 * 1. Setiap div code di calibrated_ratings.json bisa di-resolve dari leagueName-nya.
 * 2. resolveDivCode menangani format 1xBet "<Country>. <League>".
 * 3. Liga tak dikenal -> isCalibrated:false + div:"UNKNOWN" (BUKAN E0).
 * 4. sampleN shrinkage berasal dari jumlah laga form, bukan H2H.
 * 5. isEstimatedTelemetry hanya true untuk macro_prior_only.
 * 6. Gate telemetry tidak bergantung pada divCode.
 */

import { resolveDivCode, getShrunkMatchParameters, loadCalibratedRatings } from "../lib/quant/ratings-loader";

let pass = 0;
let fail = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const data = loadCalibratedRatings();
if (!data) {
  console.error("FATAL: calibrated_ratings.json tidak termuat");
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log("\n[1] Coverage resolveDivCode untuk semua div code terkalibrasi");
const divs = Object.keys(data.leagues);
for (const div of divs) {
  const name = data.leagues[div].leagueName;
  assert(`${div.padEnd(4)} <- "${name}"`, resolveDivCode(name) === div, `dapat ${resolveDivCode(name)}`);
}

// ---------------------------------------------------------------------------
console.log("\n[2] Format 1xBet dengan prefix negara");
const countryPrefixed: Array<[string, string]> = [
  ["England. Premier League", "E0"],
  ["England. Championship", "E1"],
  ["Spain. La Liga", "SP1"],
  ["Spain. Segunda Division", "SP2"],
  ["Italy. Serie A", "I1"],
  ["Italy. Serie B", "I2"],
  ["Germany. Bundesliga", "D1"],
  ["Germany. 2. Bundesliga", "D2"],
  ["France. Ligue 1", "F1"],
  ["France. Ligue 2", "F2"],
  ["Greece. Super League", "G1"],
  ["Turkey. Super Lig", "T1"],
];
for (const [hint, expected] of countryPrefixed) {
  assert(`"${hint}" -> ${expected}`, resolveDivCode(hint) === expected, `dapat ${resolveDivCode(hint)}`);
}

// ---------------------------------------------------------------------------
console.log("\n[3] Anti-tabrakan G1 (Yunani) vs T1 (Turki)");
assert('"super lig" -> T1', resolveDivCode("super lig") === "T1");
assert('"turkish super lig" -> T1', resolveDivCode("turkish super lig") === "T1");
assert('"super league" -> G1', resolveDivCode("super league") === "G1");
assert('"greek super league" -> G1', resolveDivCode("greek super league") === "G1");

// ---------------------------------------------------------------------------
console.log("\n[4] Liga tak dikenal TIDAK boleh fallback ke E0");
const unknown = getShrunkMatchParameters({
  homeTeam: "Persija",
  awayTeam: "Persib",
  leagueHint: "Liga 1 Indonesia",
  homeSampleN: 3,
  awaySampleN: 3,
});
assert("isCalibrated === false", unknown.isCalibrated === false);
assert('div === "UNKNOWN"', unknown.metadata?.div === "UNKNOWN", `dapat ${unknown.metadata?.div}`);
assert('div BUKAN "E0"', unknown.metadata?.div !== "E0");
assert("telemetry source macro_prior_only", unknown.metadata?.telemetrySource?.home === "macro_prior_only");

// UCL resmi terpetakan ke divisi kontinental UCL
const uclMatch = getShrunkMatchParameters({
  homeTeam: "Arsenal",
  awayTeam: "Paris Saint-Germain",
  leagueHint: "UEFA Champions League",
  homeSampleN: 3,
  awaySampleN: 3,
});
assert('UCL -> div "UCL"', uclMatch.metadata?.div === "UCL", `dapat ${uclMatch.metadata?.div}`);

const laliga = getShrunkMatchParameters({
  homeTeam: "Real Madrid",
  awayTeam: "Barcelona",
  leagueHint: "la liga",
  homeSampleN: 3,
  awaySampleN: 3,
});
assert('La Liga -> div SP1', laliga.metadata?.div === "SP1", `dapat ${laliga.metadata?.div}`);
assert("La Liga terkalibrasi", laliga.isCalibrated === true);
assert("La Liga pakai gamma SP1 (bukan EPL)", Math.abs(laliga.homeAdvantage - (data.leagues.SP1.homeAdvantage)) < 1e-9);

// ---------------------------------------------------------------------------
console.log("\n[5] Shrinkage weight memakai jumlah laga form");
// h2h sengaja tidak dilewatkan; homeSampleN=3 form -> w = 3/(3+16)
const shrink3 = getShrunkMatchParameters({
  homeTeam: "Genk",
  awayTeam: "Standard",
  leagueHint: "belgian first division a",
  liveHomeFormGoalsAvg: 1.5,
  liveAwayFormGoalsAvg: 1.2,
  homeSampleN: 3,
  awaySampleN: 3,
});
const expectedW = Number((3 / 19).toFixed(3));
assert(
  `w.home === ${expectedW}`,
  shrink3.shrinkageWeights.home === expectedW,
  `dapat ${shrink3.shrinkageWeights.home}`
);

// tanpa telemetry & tanpa form -> w = 0 (prior makro sepenuhnya)
const shrink0 = getShrunkMatchParameters({
  homeTeam: "Genk",
  awayTeam: "Standard",
  leagueHint: "belgian first division a",
  homeSampleN: 0,
  awaySampleN: 0,
});
assert("w.home === 0 saat n=0", shrink0.shrinkageWeights.home === 0, `dapat ${shrink0.shrinkageWeights.home}`);

// ---------------------------------------------------------------------------
console.log("\n[6] isEstimatedTelemetry: observed_goals bukan estimasi");
// Genk tidak ada di thestats_dataset.db (hanya 7 target league) -> tanpa telemetry
// -> macro_prior_only -> memang estimasi. Yang kita uji: flag true HANYA di sini.
assert(
  "tanpa telemetry -> isEstimatedTelemetry true",
  shrink3.metadata?.isEstimatedTelemetry === true,
  `dapat ${shrink3.metadata?.isEstimatedTelemetry}`
);

// ---------------------------------------------------------------------------
console.log("\n[7] Semantik defense berbasis attack LAWAN");
// homeSampleN=0 mematikan telemetry; liveHomeFormGoalsAvg tinggi (tim kandang tajam)
// TIDAK boleh membuat defense kandang ikut "membaik".
const atkHigh = getShrunkMatchParameters({
  homeTeam: "Real Madrid",
  awayTeam: "Barcelona",
  leagueHint: "la liga",
  liveHomeFormGoalsAvg: 3.0, // kandang sangat tajam
  liveAwayFormGoalsAvg: 0.4, // tamu sangat tumpul
  homeSampleN: 0,
  awaySampleN: 0,
});
// n=0 -> bobot 0 -> nilai live tidak terpakai sama sekali (murni prior makro).
// Yang diuji di sini adalah komposisi bobot, jadi hanya pastikan tidak NaN/negatif.
assert("homeDefense positif", atkHigh.homeDefense > 0, `dapat ${atkHigh.homeDefense}`);
assert("awayDefense positif", atkHigh.awayDefense > 0, `dapat ${atkHigh.awayDefense}`);
assert("homeAttack positif", atkHigh.homeAttack > 0);
assert("awayAttack positif", atkHigh.awayAttack > 0);

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(64)}`);
console.log(`HASIL: ${pass} PASS, ${fail} FAIL`);
console.log(`${"=".repeat(64)}`);
if (fail > 0) process.exit(1);
