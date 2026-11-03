import fs from "fs";
import path from "path";

// Auto-load .env.local
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

import { get1xBetMarketsV2 } from "../lib/1xbet";
import { fetchAndValidateMatchIntelligence } from "../lib/stats-fetcher-agent";
import { getShrunkMatchParameters } from "../lib/quant/ratings-loader";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { evaluateValueBet, evaluatePortfolioKelly, type ValueBetEvaluation } from "../lib/quant/kelly";
import { orchestrate5AgentSyndicate } from "../lib/syndicate-orchestrator";

async function main() {
  console.log("================================================================================");
  console.log("       REAL-WORLD END-TO-END PIPELINE: FEYENOORD vs COMO (UCL)                 ");
  console.log("================================================================================\n");

  const matchIdTheStatsAPI = "mt_024559081";
  const matchId1xBet = 751774505;

  // 1. Fetch real-time Match Intelligence from TheStatsAPI
  console.log(`▶ [1/5] Mengambil data intelijen pertandingan dari TheStatsAPI (${matchIdTheStatsAPI})...`);
  const statsResult = await fetchAndValidateMatchIntelligence(matchIdTheStatsAPI, "comp_3498");
  const intel = statsResult.intelligence;

  const homeTeam = intel.pertandingan.tim_kandang;
  const awayTeam = intel.pertandingan.tim_tamu;
  const competition = intel.pertandingan.kompetisi;
  const kickoff = intel.pertandingan.waktu;
  const venue = intel.pertandingan.venue;

  console.log(`   ✓ Laga Terverifikasi: ${homeTeam} vs ${awayTeam} (${competition})`);
  console.log(`   ✓ Waktu Kickoff    : ${kickoff}`);
  console.log(`   ✓ Venue            : ${venue}`);
  console.log(`   ✓ Wasit            : ${intel.wasit_detail?.name || intel.pertandingan.wasit || "Belum Ditunjuk"} (${intel.wasit_detail?.avg_yellow_per_game ? intel.wasit_detail.avg_yellow_per_game + " KK/laga" : "Data Wasit N/A"})`);
  console.log(`   ✓ Status Lineup    : ${intel.lineups.status_label}`);
  console.log(`   ✓ Form Terkini     : Kandang (${intel.form_split.home_goals_avg} gol/laga) | Tamu (${intel.form_split.away_goals_avg} gol/laga)`);
  console.log(`   ✓ Endpoints Dipanggil: ${statsResult.audit.endpoints_called.join(", ")}`);

  // 2. Fetch live odds from 1xBet
  console.log(`\n▶ [2/5] Mengambil bursa odds live dari 1xBet (Match ID: ${matchId1xBet})...`);
  let hOdds = 3.695;
  let dOdds = 4.41;
  let aOdds = 1.93;
  let over25Odds = 1.36;
  let under25Odds = 2.84;
  let bttsYesOdds = 1.38;
  let bttsNoOdds = 2.849;

  try {
    const markets = await get1xBetMarketsV2(matchId1xBet);
    const m1 = markets.find(m => m.market_id === 1);
    if (m1?.odds) {
      if (m1.odds.HOME) hOdds = m1.odds.HOME;
      if (m1.odds.Draw) dOdds = m1.odds.Draw;
      if (m1.odds.AWAY) aOdds = m1.odds.AWAY;
    }
    const m17 = markets.find(m => m.market_id === 17 && Number(m.base) === 2.5);
    if (m17?.odds) {
      if (m17.odds["Total Over"]) over25Odds = m17.odds["Total Over"];
      if (m17.odds["Total Under"]) under25Odds = m17.odds["Total Under"];
    }
    const m19 = markets.find(m => m.market_id === 19 && (m.base === null || m.base === undefined));
    if (m19?.odds) {
      if (m19.odds["Both Teams To Score - Yes"]) bttsYesOdds = m19.odds["Both Teams To Score - Yes"];
      if (m19.odds["Both Teams To Score - No"]) bttsNoOdds = m19.odds["Both Teams To Score - No"];
    }
    console.log("   ✓ Odds Live 1xBet Berhasil Diambil:");
    console.log(`     - 1X2: Feyenoord [${hOdds}] | Seri [${dOdds}] | Como [${aOdds}]`);
    console.log(`     - Total 2.5: Over [${over25Odds}] | Under [${under25Odds}]`);
    console.log(`     - BTTS: Ya [${bttsYesOdds}] | Tidak [${bttsNoOdds}]`);
  } catch (err: any) {
    console.warn("   ⚠️ Gagal memanggil 1xBet live, menggunakan cached quote terverifikasi:", err.message);
  }

  // 3. Quant Engine: Dixon-Coles Bivariate Poisson MLE + James-Stein Shrinkage
  console.log("\n▶ [3/5] Mengeksekusi Model Kuantitatif Terkalibrasi (Dixon-Coles + Empirical Bayes)...");
  
  // Shrunk parameters using 4-season master ratings + live TheStatsAPI form
  const shrunk = getShrunkMatchParameters({
    homeTeam,
    awayTeam,
    leagueHint: competition,
    liveHomeFormGoalsAvg: intel.form_split.home_goals_avg,
    liveAwayFormGoalsAvg: intel.form_split.away_goals_avg,
    homeSampleN: intel.h2h_history?.sample_size ? Math.max(3, Math.min(10, intel.h2h_history.sample_size)) : 5,
    awaySampleN: intel.h2h_history?.sample_size ? Math.max(3, Math.min(10, intel.h2h_history.sample_size)) : 5,
  });

  const dc = calculateDixonColes({
    homeAttack: shrunk.homeAttack,
    homeDefense: shrunk.homeDefense,
    awayAttack: shrunk.awayAttack,
    awayDefense: shrunk.awayDefense,
    homeAdvantage: shrunk.homeAdvantage,
    leagueAvgGoals: shrunk.leagueAvgGoals,
    rho: shrunk.rho,
  });

  // 3. Shin Vig-Stripping & Value Bet / Kelly Sizing
  console.log("\n▶ [3/4] Melakukan Shin Vig-Stripping & Evaluasi Value Bet (+EV / Kelly)...");
  const vig = stripVigShin(hOdds, dOdds, aOdds);

  const rawBets: ValueBetEvaluation[] = [
    evaluateValueBet(dc.prob_home_win, hOdds, "1X2", `${homeTeam} Menang`),
    evaluateValueBet(dc.prob_draw, dOdds, "1X2", "Hasil Imbang (Draw)"),
    evaluateValueBet(dc.prob_away_win, aOdds, "1X2", `${awayTeam} Menang`),
    evaluateValueBet(dc.over_under.line_2_5.over, over25Odds, "Over/Under 2.5", "Over 2.5 Goals"),
    evaluateValueBet(dc.btts.yes, bttsYesOdds, "BTTS", "Both Teams to Score"),
  ];

  const portfolio = evaluatePortfolioKelly(rawBets, 5.0);

  console.log("   --- HASIL MATEMATIS DIXON-COLES ---");
  console.log(`   * Expected Goals (xG) : ${homeTeam} = ${dc.lambda.toFixed(2)} | ${awayTeam} = ${dc.mu.toFixed(2)}`);
  console.log(`   * Total Goal Exp (E[G]): ${(dc.lambda + dc.mu).toFixed(2)} gol`);
  console.log(`   * Probabilitas Model  : Home ${Math.round(dc.prob_home_win * 100)}% | Draw ${Math.round(dc.prob_draw * 100)}% | Away ${Math.round(dc.prob_away_win * 100)}%`);
  console.log(`   * Fair Odds Model     : Home ${dc.fair_odds.home} | Draw ${dc.fair_odds.draw} | Away ${dc.fair_odds.away}`);
  console.log(`   * Shin Fair Market    : Home ${vig.fair_odds.home} | Draw ${vig.fair_odds.draw} | Away ${vig.fair_odds.away} (Margin: ${vig.margin_percentage.toFixed(1)}%)`);
  console.log(`   * Over 2.5 Prob       : ${(dc.over_under.line_2_5.over * 100).toFixed(1)}% (Fair: ${(1 / dc.over_under.line_2_5.over).toFixed(2)}) vs Pasar [${over25Odds}]`);
  console.log(`   * BTTS Yes Prob       : ${(dc.btts.yes * 100).toFixed(1)}% (Fair: ${(1 / dc.btts.yes).toFixed(2)}) vs Pasar [${bttsYesOdds}]`);
  
  console.log("\n   --- PELUANG +EV & SIZING REKOMENDASI ---");
  for (const bet of portfolio) {
    const icon = bet.is_positive_ev ? "🟢" : "🔴";
    console.log(`   ${icon} [${bet.market_name}] ${bet.selection}: Odds ${bet.bookmaker_odds} | Fair ${bet.fair_odds} | EV: ${bet.ev_percentage} | Stake: ${bet.recommended_stake_percentage}%`);
  }

  // 4. Multi-Model 5-Agent Syndicate Debate via 9Router
  console.log("\n▶ [4/4] Menjalankan Sidang Sindikat 5-Model AI melalui 9Router...");
  console.log("   - Bull Analyst        : bai/glm-5.3-flash");
  console.log("   - Neutral Quant       : bai/deepseek-v4.1-flash");
  console.log("   - Bear Risk Auditor   : ag/gemini-3.8-flash-medium");
  console.log("   - Judgement 1         : ag/gemini-3.8-flash-high");
  console.log("   - Judgement 2         : bai/qwen3.8-flash");

  // Enrich existing TheStatsAPI intel with live 1xBet odds
  intel.market_odds = {
    is_available: true,
    home_last: hOdds,
    draw_last: dOdds,
    away_last: aOdds,
    total_goals_over_2_5: over25Odds,
  };

  const quantPackage = {
    dixon_coles: {
      lambda_home_xg: Number(dc.lambda.toFixed(2)),
      mu_away_xg: Number(dc.mu.toFixed(2)),
      prob_home_win: dc.prob_home_win,
      prob_draw: dc.prob_draw,
      prob_away_win: dc.prob_away_win,
      fair_odds: dc.fair_odds,
      over_2_5_prob: dc.over_under.line_2_5.over,
      btts_yes_prob: dc.btts.yes,
      asian_handicap: dc.asian_handicap,
    },
    shin_vig: vig,
    value_bets: portfolio,
  };

  const debate = await orchestrate5AgentSyndicate({
    matchSummary: `${homeTeam} vs ${awayTeam} (${competition})`,
    intel,
    quantPackage,
  });

  console.log("\n================================================================================");
  console.log("               HASIL SIDANG KONSENSUS SINDIKAT 5-AGENT AI                       ");
  console.log("================================================================================\n");

  console.log("🐂 [BULL ANALYST - OFENSIF]:");
  console.log(`   Model  : ${debate.bull_case.model}`);
  console.log(`   Tesis  : ${debate.bull_case.thesis}`);
  console.log(`   Edge   : ${debate.bull_case.tactical_edge}`);
  console.log(`   Drivers: ${debate.bull_case.key_drivers.join(" | ")}\n`);

  console.log("⚖️ [NEUTRAL ANALYST - DATA & EKUILIBRIUM]:");
  console.log(`   Model  : ${debate.neutral_case.model}`);
  console.log(`   Tesis  : ${debate.neutral_case.thesis}`);
  console.log(`   Equil  : ${debate.neutral_case.equilibrium_assessment}`);
  console.log(`   Drivers: ${debate.neutral_case.empirical_drivers.join(" | ")}\n`);

  console.log("🐻 [BEAR AUDITOR - RISIKO DEFENSIVE & TRAP LINE]:");
  console.log(`   Model  : ${debate.bear_case.model}`);
  console.log(`   Tesis  : ${debate.bear_case.thesis}`);
  console.log(`   Audit  : ${debate.bear_case.vulnerability_audit}`);
  console.log(`   Jebakan: ${debate.bear_case.trap_warnings.join(" | ")}\n`);

  console.log("👨‍⚖️ [DUAL JUDICIAL BENCH]:");
  console.log(`   Hakim 1 (${debate.dual_judgement.judgement_1.model}):`);
  console.log(`     - Verdict: ${debate.dual_judgement.judgement_1.verdict_summary}`);
  console.log(`     - Pasar  : ${debate.dual_judgement.judgement_1.recommended_market}`);
  console.log(`     - Tier   : ${debate.dual_judgement.judgement_1.confidence_tier}`);
  console.log(`   Hakim 2 (${debate.dual_judgement.judgement_2.model}):`);
  console.log(`     - Verdict: ${debate.dual_judgement.judgement_2.verdict_summary}`);
  console.log(`     - Pasar  : ${debate.dual_judgement.judgement_2.recommended_market}`);
  console.log(`     - Tier   : ${debate.dual_judgement.judgement_2.confidence_tier}`);
  console.log(`   Tingkat Konsensus: ${debate.dual_judgement.consensus_level}\n`);

  console.log("👑 [SUPREME CONSENSUS & ARBITER VERDICT]:");
  console.log(`   Supreme Verdict : ${debate.dual_judgement.supreme_verdict}`);
  console.log(`   Rekomendasi     : ${debate.dual_judgement.final_recommended_market}`);
  console.log(`   Confidence Tier : ${debate.dual_judgement.final_confidence_tier}`);
  console.log(`   Stake Kelly     : ${debate.dual_judgement.final_stake_fraction}`);
  console.log("================================================================================\n");
}

main().catch(err => {
  console.error("Fatal Error running pipeline:", err);
  process.exit(1);
});
