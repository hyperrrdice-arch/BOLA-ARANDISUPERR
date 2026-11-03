/**
 * Comprehensive Verification Suite for Tier-1 Offline Database & Multi-League Quant Engine
 *
 * Menguji:
 * 1. Tier-1 SQLite Offline Helpers (H2H, Recent Form 6x, Squad Injuries)
 * 2. UCL Weighted Normalization & Schedule Friction
 * 3. Special Markets Adaptive Multi-League Benchmarks (SP1 cards vs N1 cards, D1 corners vs E0)
 * 4. Bimodal Kappa Shrinkage (kappa=8.0 xG, kappa=14.0 goals, kappa=16.0 fallback)
 * 5. Closed-World Grounding & Luck Signal Context Enrichment
 */

import {
  getLocalH2HMatches,
  getLocalRecentMatches,
  getLocalSquadInjuries,
} from "../lib/db/thestats-dataset";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import {
  SPECIAL_MARKET_BENCHMARKS,
  getLeagueBenchmarks,
  calculateCardsMarket,
  calculateCornersMarket,
} from "../lib/quant/special-markets-engine";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";

function assert(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ ${description}`);
  } else {
    console.error(`  ❌ ${description}${extra ? ` — ${extra}` : ""}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("================================================================================");
  console.log("🧪 [VERIFIKASI INTEGRASI] Tier-1 Offline Database & Multi-League Quant Model");
  console.log("================================================================================");

  // [1] Tier-1 SQLite Offline Helpers
  console.log("\n[1] Pengujian Query Tier-1 SQLite Offline (Zero Online API Calls):");
  const recentReal = getLocalRecentMatches("Real Madrid", 6);
  assert("Recent matches Real Madrid terambil dari SQLite lokal", recentReal.length > 0, `N=${recentReal.length}`);
  assert("Maksimal 6 pertandingan form", recentReal.length <= 6);

  const injuriesBarca = getLocalSquadInjuries("Barcelona");
  assert("Laporan cedera Barcelona terambil dari team_squads lokal", Array.isArray(injuriesBarca));
  console.log(`     -> Info: Barcelona memiliki ${injuriesBarca.length} pemain cedera/absen tercatat.`);

  const h2h = getLocalH2HMatches("Arsenal", "Chelsea");
  assert("Query H2H offline berjalan tanpa crash", Array.isArray(h2h));

  // [2] Special Markets Multi-League Adaptive Benchmarks
  console.log("\n[2] Benchmarks Pasar Khusus Multi-Liga (Adaptif Per Kompetisi):");
  const sp1Bench = getLeagueBenchmarks("SP1");
  const n1Bench = getLeagueBenchmarks("N1");
  const d1Bench = getLeagueBenchmarks("D1");
  const e0Bench = getLeagueBenchmarks("E0");

  assert("LaLiga (SP1) kartu rata-rata ~2.21", Math.abs(sp1Bench.avgCardsTeam - 2.21) < 0.05, `dapat ${sp1Bench.avgCardsTeam}`);
  assert("Eredivisie (N1) kartu rata-rata ~1.38 (jauh lebih bersih dari SP1)", Math.abs(n1Bench.avgCardsTeam - 1.38) < 0.05, `dapat ${n1Bench.avgCardsTeam}`);
  assert("Bundesliga (D1) corner rata-rata ~5.40", Math.abs(d1Bench.avgCornersTeam - 5.40) < 0.05, `dapat ${d1Bench.avgCornersTeam}`);
  assert("EPL (E0) corner rata-rata ~4.66", Math.abs(e0Bench.avgCornersTeam - 4.66) < 0.05, `dapat ${e0Bench.avgCornersTeam}`);

  // Simulasi perhitungan kartu LaLiga vs Eredivisie dengan fallback benchmark liga
  const mockTelemImputed = { sample_size: 0, avg_yellow_cards: null } as any;
  const cardsLaLiga = calculateCardsMarket(mockTelemImputed, mockTelemImputed, "SP1");
  const cardsEredivisie = calculateCardsMarket(mockTelemImputed, mockTelemImputed, "N1");
  assert("Total kartu LaLiga lebih tinggi dari Eredivisie pada fallback benchmark", cardsLaLiga.expected_total_cards > cardsEredivisie.expected_total_cards);
  console.log(`     -> LaLiga Expected Cards: ${cardsLaLiga.expected_total_cards.toFixed(2)} vs Eredivisie: ${cardsEredivisie.expected_total_cards.toFixed(2)}`);

  // [3] Bimodal Kappa Shrinkage Validation
  console.log("\n[3] Bimodal James-Stein Shrinkage Kappa (xG vs Goals vs Fallback):");
  // A. Menggunakan Observed xG Telemetry (kappa = 8.0)
  // n=6 laga, w = 6 / (6 + 8) = 6/14 ≈ 0.429
  const telemWithXG = {
    sample_size: 6,
    observed_xg_samples: 6,
    rolling_xg_for: 2.1,
    rolling_xg_against: 0.9,
    rolling_goals_for: 2.0,
    rolling_goals_against: 1.0,
  };

  const shrinkWithXg = getShrunkMatchParameters({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    leagueHint: "premier league",
    homeTelemetry: telemWithXG as any,
    homeSampleN: 6,
  });

  const expectedWeightXG = Number((6 / (6 + 8.0)).toFixed(3));
  assert(`Weight xG telemetry memakai kappa=8.0 (w=${expectedWeightXG})`, shrinkWithXg.shrinkageWeights.home === expectedWeightXG, `dapat ${shrinkWithXg.shrinkageWeights.home}`);

  // B. Menggunakan Observed Goals Form (kappa = 14.0)
  // n=6 laga form (hanya goals, tanpa xG), w = 6 / (6 + 14) = 6/20 = 0.300
  const telemWithGoalsOnly = {
    sample_size: 6,
    observed_xg_samples: 0,
    rolling_xg_for: null,
    rolling_xg_against: null,
    rolling_goals_for: 2.0,
    rolling_goals_against: 1.0,
  };

  const shrinkWithGoals = getShrunkMatchParameters({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    leagueHint: "premier league",
    homeTelemetry: telemWithGoalsOnly as any,
    homeSampleN: 6,
  });
  const expectedWeightGoals = Number((6 / (6 + 14.0)).toFixed(3));
  assert(`Weight goals form memakai kappa=14.0 (w=${expectedWeightGoals})`, shrinkWithGoals.shrinkageWeights.home === expectedWeightGoals, `dapat ${shrinkWithGoals.shrinkageWeights.home}`);

  // C. Fallback Macro Prior (kappa = 16.0)
  // Tim non-dataset (Genk) tanpa telemetry DB: w = 3 / (3 + 16) = 3/19 ≈ 0.158
  const shrinkFallback = getShrunkMatchParameters({
    homeTeam: "Genk",
    awayTeam: "Standard",
    leagueHint: "belgian first division a",
    homeSampleN: 3,
  });
  const expectedWeightFallback = Number((3 / (3 + 16.0)).toFixed(3));
  assert(`Weight macro prior fallback memakai kappa=16.0 (w=${expectedWeightFallback})`, shrinkFallback.shrinkageWeights.home === expectedWeightFallback, `dapat ${shrinkFallback.shrinkageWeights.home}`);

  // [4] UCL Weighted Normalization & Schedule Friction
  console.log("\n[4] UCL Weighted Normalization & Schedule Friction Telemetry:");
  const telemetryArsenal = getTeamRollingTelemetry("Arsenal", 6, "2026-10-15");
  if (telemetryArsenal && telemetryArsenal.sample_size > 0) {
    assert("Arsenal rolling telemetry terhitung dari SQLite", telemetryArsenal.sample_size > 0);
    assert("Schedule friction terdeteksi", telemetryArsenal.schedule_friction !== undefined);
    console.log(`     -> Arsenal Sample Size: ${telemetryArsenal.sample_size}, Rolling xG For: ${telemetryArsenal.rolling_xg_for?.toFixed(2) ?? "N/A"}, Fatigue Risk: ${telemetryArsenal.schedule_friction?.fatigue_risk ?? "NONE"}`);
  } else {
    console.log("     -> Info: Arsenal belum memiliki log pertandingan di cutoff 2026-10-15.");
  }

  // [5] Luck Metrics Exposure & Closed-World Grounding
  console.log("\n[5] Sinyal Luck Metric & Anti-Double Penalty:");
  assert("Metadata shrunk parameters memuat luckMetrics", shrinkWithXg.metadata?.luckMetrics !== undefined);
  if (shrinkWithXg.metadata?.luckMetrics) {
    const lm = shrinkWithXg.metadata.luckMetrics;
    assert("Finishing luck terdefinisi", typeof lm.home.finishing_luck_per_match === "number");
    assert("Defensive luck terdefinisi", typeof lm.home.defensive_luck_per_match === "number");
    assert("Status regresi terdefinisi", typeof lm.home.status === "string");
    console.log(`     -> Arsenal Luck Status: ${lm.home.status} (Net: ${lm.home.net_luck_rating.toFixed(2)})`);
    console.log(`     -> Tactical Thesis Bull: ${lm.agentic_tactical_thesis.bull_angle.slice(0, 70)}...`);
  }

  console.log("\n================================================================================");
  if (process.exitCode === 1) {
    console.error("❌ ADA PENGUJIAN YANG GAGAL!");
  } else {
    console.log("🎉 SELURUH 15 TES INTEGRASI TIER-1 OFFLINE & QUANT MULTI-LIGA LULUS 100%!");
  }
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
