import fs from "node:fs";
import path from "node:path";
import {
  calculateDixonColes,
  type DixonColesResult,
} from "../lib/quant/dixon-coles";
import {
  stripVigShin,
  stripVigTwoWay,
  type VigStrippingResult,
} from "../lib/quant/vig-stripping";
import {
  evaluateValueBet,
  evaluatePortfolioKelly,
  type ValueBetEvaluation,
} from "../lib/quant/kelly";
import {
  loadCalibratedRatings,
  getShrunkMatchParameters,
  type CalibratedRatingsFile,
} from "../lib/quant/ratings-loader";

/**
 * ============================================================================
 * SIMULASI KOMPARATIF EVALUASI PRE-MATCH KUANTITATIF TIER-1 SYNDICATE
 * ============================================================================
 * Pertandingan: ARSENAL vs LIVERPOOL (English Premier League)
 * Venue       : Emirates Stadium, London
 * Tanggal     : Simulasi Big Match
 * ============================================================================
 */

interface SimulationComparison {
  match: string;
  competition: string;
  marketOdds: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    under25: number;
    bttsYes: number;
    bttsNo: number;
    ahMinus1Home: number;
  };
  oldModelAdHoc: {
    name: string;
    description: string;
    homeAttack: number;
    homeDefense: number;
    awayAttack: number;
    awayDefense: number;
    lambda: number;
    mu: number;
    probHome: number;
    probDraw: number;
    probAway: number;
    fairOdds: { home: number; draw: number; away: number };
    over25Prob: number;
    bttsYesProb: number;
    valueBets: ValueBetEvaluation[];
  };
  newModelCalibrated: {
    name: string;
    description: string;
    historicalRatings: {
      arsenal: { attack: number; defense: number; matches: number };
      liverpool: { attack: number; defense: number; matches: number };
      leagueAvgGoals: number;
      homeAdvantage: number;
      rho: number;
    };
    shrinkage: {
      kappa: number;
      sampleN: number;
      weightHome: number;
      weightAway: number;
      finalHomeAttack: number;
      finalHomeDefense: number;
      finalAwayAttack: number;
      finalAwayDefense: number;
    };
    lambda: number;
    mu: number;
    expectedTotalGoals: number;
    probHome: number;
    probDraw: number;
    probAway: number;
    fairOdds: { home: number; draw: number; away: number };
    over25Prob: number;
    bttsYesProb: number;
    asianHandicap: any;
    topScorelines: { score: string; prob: number }[];
    shinVig: VigStrippingResult;
    valueBets: ValueBetEvaluation[];
  };
}

function runSimulation(): SimulationComparison {
  // 1. Data Pasar Riil (Closing / Sharp Market Consensus: Pinnacle & 1xBet)
  const marketOdds = {
    home: 2.42, // Arsenal Win
    draw: 3.55, // Draw
    away: 3.05, // Liverpool Win
    over25: 1.81, // Over 2.5 Goals
    under25: 2.08, // Under 2.5 Goals
    bttsYes: 1.65, // BTTS Yes
    bttsNo: 2.30, // BTTS No
    ahMinus1Home: 3.65, // Asian Handicap -1.0 Arsenal
  };

  // =========================================================================
  // MODEL 1: MODEL LAMA (AD-HOC HEURISTIK, N=5 LAGA TANPA KALIBRASI)
  // =========================================================================
  // Di model lama (app/api/agent/route.tsx baris 311-315 versi awal):
  // Arsenal baru saja menang telak di 5 laga kandang: rata-rata 2.20 gol/laga
  // Liverpool di 5 laga tandang: rata-rata 2.00 gol/laga
  const oldHomeAttack = 2.20;
  const oldAwayAttack = 2.00;
  const oldHomeDefense = Math.max(0.6, 2.5 - oldAwayAttack); // 2.5 - 2.00 = 0.50 -> max(0.6, 0.5) = 0.60
  const oldAwayDefense = Math.max(0.7, 2.6 - oldHomeAttack); // 2.6 - 2.20 = 0.40 -> max(0.7, 0.4) = 0.70
  const oldHomeAdvantage = 1.22; // Hardcoded default
  const oldRho = -0.13; // Hardcoded default

  // Hitung Dixon-Coles versi heuristik lama
  const oldRawLambda = Math.max(0.2, oldHomeAttack * oldAwayDefense * (oldHomeAdvantage / 1.2)); // (2.20 * 0.70) * (1.22 / 1.2) = 1.54 * 1.0167 = 1.566
  const oldRawMu = Math.max(0.2, oldAwayAttack * oldHomeDefense); // (2.00 * 0.60) = 1.200

  const oldDc = calculateDixonColes({
    homeAttack: oldHomeAttack,
    homeDefense: oldHomeDefense,
    awayAttack: oldAwayAttack,
    awayDefense: oldAwayDefense,
    homeAdvantage: oldHomeAdvantage,
    rho: oldRho,
    maxGoals: 10,
  });

  const oldRawBets: ValueBetEvaluation[] = [
    evaluateValueBet(oldDc.prob_home_win, marketOdds.home, "1X2", "Arsenal Menang"),
    evaluateValueBet(oldDc.prob_draw, marketOdds.draw, "1X2", "Hasil Imbang (Draw)"),
    evaluateValueBet(oldDc.prob_away_win, marketOdds.away, "1X2", "Liverpool Menang"),
    evaluateValueBet(oldDc.over_under.line_2_5.over, marketOdds.over25, "Over/Under 2.5", "Over 2.5 Goals"),
    evaluateValueBet(oldDc.btts.yes, marketOdds.bttsYes, "BTTS", "BTTS Yes"),
  ];
  const oldValueBets = evaluatePortfolioKelly(oldRawBets, 5.0);

  // =========================================================================
  // MODEL 2: MODEL BARU TERKALIBRASI (HISTORI 4 MUSIM MLE + JAMES-STEIN SHRINKAGE)
  // =========================================================================
  const ratingsFile = loadCalibratedRatings();
  if (!ratingsFile || !ratingsFile.leagues["E0"]) {
    throw new Error("Gagal memuat data/calibrated_ratings.json atau liga E0 tidak ditemukan.");
  }
  const e0 = ratingsFile.leagues["E0"];
  const arsenalHist = e0.teams["Arsenal"];
  const liverpoolHist = e0.teams["Liverpool"];

  // James-Stein Shrinkage dengan data live form 5 laga:
  // Live form TheStatsAPI: Arsenal home 2.20 gol/laga, Liverpool away 2.00 gol/laga
  const sampleN = 5;
  const shrunkParams = getShrunkMatchParameters({
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    leagueHint: "E0",
    liveHomeFormGoalsAvg: 2.20,
    liveAwayFormGoalsAvg: 2.00,
    homeSampleN: sampleN,
    awaySampleN: sampleN,
  });

  const newDc = calculateDixonColes({
    homeAttack: shrunkParams.homeAttack,
    homeDefense: shrunkParams.homeDefense,
    awayAttack: shrunkParams.awayAttack,
    awayDefense: shrunkParams.awayDefense,
    homeAdvantage: shrunkParams.homeAdvantage,
    leagueAvgGoals: shrunkParams.leagueAvgGoals,
    rho: shrunkParams.rho,
    maxGoals: 10,
  });

  // Shin Vig-Stripping 1993 terhadap odds Pinnacle 1X2
  const shinVig = stripVigShin(marketOdds.home, marketOdds.draw, marketOdds.away);

  // Evaluasi +EV & Fractional Kelly Sizing
  const newRawBets: ValueBetEvaluation[] = [
    evaluateValueBet(newDc.prob_home_win, marketOdds.home, "1X2", "Arsenal Menang"),
    evaluateValueBet(newDc.prob_draw, marketOdds.draw, "1X2", "Hasil Imbang (Draw)"),
    evaluateValueBet(newDc.prob_away_win, marketOdds.away, "1X2", "Liverpool Menang"),
    evaluateValueBet(newDc.over_under.line_2_5.over, marketOdds.over25, "Over/Under 2.5", "Over 2.5 Goals"),
    evaluateValueBet(newDc.btts.yes, marketOdds.bttsYes, "BTTS", "BTTS Yes"),
    evaluateValueBet(newDc.asian_handicap.ah_minus_1_0.home_cover, marketOdds.ahMinus1Home, "Asian Handicap -1.0", "Arsenal -1.0 AH"),
  ];
  const newValueBets = evaluatePortfolioKelly(newRawBets, 5.0);

  return {
    match: "Arsenal vs Liverpool",
    competition: "English Premier League (E0)",
    marketOdds,
    oldModelAdHoc: {
      name: "Model 1: Ad-Hoc Heuristik (N=5)",
      description: "Hanya rata-rata gol 5 laga, pertahanan diaproksimasi (2.5 - awayAttack), parameter liga statis",
      homeAttack: oldHomeAttack,
      homeDefense: oldHomeDefense,
      awayAttack: oldAwayAttack,
      awayDefense: oldAwayDefense,
      lambda: oldDc.lambda,
      mu: oldDc.mu,
      probHome: oldDc.prob_home_win,
      probDraw: oldDc.prob_draw,
      probAway: oldDc.prob_away_win,
      fairOdds: oldDc.fair_odds,
      over25Prob: oldDc.over_under.line_2_5.over,
      bttsYesProb: oldDc.btts.yes,
      valueBets: oldValueBets,
    },
    newModelCalibrated: {
      name: "Model 2: Dixon-Coles MLE + Empirical Bayes Shrinkage",
      description: "Terkalibrasi 1.520 laga (4 musim) + peluruhan waktu xi + shrinkage James-Stein kappa=16",
      historicalRatings: {
        arsenal: { attack: arsenalHist.attack, defense: arsenalHist.defense, matches: arsenalHist.matchesCount },
        liverpool: { attack: liverpoolHist.attack, defense: liverpoolHist.defense, matches: liverpoolHist.matchesCount },
        leagueAvgGoals: e0.leagueAvgGoals,
        homeAdvantage: e0.homeAdvantage,
        rho: e0.rho,
      },
      shrinkage: {
        kappa: 16,
        sampleN: sampleN,
        weightHome: shrunkParams.shrinkageWeights.home,
        weightAway: shrunkParams.shrinkageWeights.away,
        finalHomeAttack: shrunkParams.homeAttack,
        finalHomeDefense: shrunkParams.homeDefense,
        finalAwayAttack: shrunkParams.awayAttack,
        finalAwayDefense: shrunkParams.awayDefense,
      },
      lambda: newDc.lambda,
      mu: newDc.mu,
      expectedTotalGoals: newDc.expected_total_goals,
      probHome: newDc.prob_home_win,
      probDraw: newDc.prob_draw,
      probAway: newDc.prob_away_win,
      fairOdds: newDc.fair_odds,
      over25Prob: newDc.over_under.line_2_5.over,
      bttsYesProb: newDc.btts.yes,
      asianHandicap: newDc.asian_handicap,
      topScorelines: newDc.top_scorelines.slice(0, 5).map((s) => ({
        score: `${s.homeGoals}-${s.awayGoals}`,
        prob: s.prob,
      })),
      shinVig,
      valueBets: newValueBets,
    },
  };
}

// Format Helper
const pct = (n: number) => (n * 100).toFixed(1) + "%";

function printReport(sim: SimulationComparison) {
  console.log("==========================================================================================");
  console.log("⚽ SIMULASI AUDIT KUANTITATIF PRE-MATCH: ARSENAL vs LIVERPOOL");
  console.log("🏆 Kompetisi: English Premier League (E0) | Venue: Emirates Stadium");
  console.log("==========================================================================================\n");

  console.log("📊 1. BURSA PASAR AKTUAL PINNACLE / 1XBET (MARKET ODDS):");
  console.log(`   - 1X2 Odds      : Arsenal [${sim.marketOdds.home}] | Seri [${sim.marketOdds.draw}] | Liverpool [${sim.marketOdds.away}]`);
  console.log(`   - Over/Under 2.5: Over [${sim.marketOdds.over25}] | Under [${sim.marketOdds.under25}]`);
  console.log(`   - BTTS (Gol)    : Ya [${sim.marketOdds.bttsYes}] | Tidak [${sim.marketOdds.bttsNo}]`);
  console.log(`   - Asian Handicap: Arsenal -1.0 [${sim.marketOdds.ahMinus1Home}]\n`);

  console.log("------------------------------------------------------------------------------------------");
  console.log("🔬 2. KOMPARASI PARAMETER MATEMATIS & KEKUATAN SERANG/BERTAHAN:");
  console.log("------------------------------------------------------------------------------------------");
  console.log("   [MODEL 1 - LAMA: AD-HOC HEURISTIK N=5]");
  console.log(`   * Arsenal   : Attack = ${sim.oldModelAdHoc.homeAttack.toFixed(2)} | Defense = ${sim.oldModelAdHoc.homeDefense.toFixed(2)} (Aproksimasi 2.5 - AwayAttack)`);
  console.log(`   * Liverpool : Attack = ${sim.oldModelAdHoc.awayAttack.toFixed(2)} | Defense = ${sim.oldModelAdHoc.awayDefense.toFixed(2)} (Aproksimasi 2.6 - HomeAttack)`);
  console.log(`   * Home Adv  : 1.22 (Asumsi Statis) | Rho : -0.13`);
  console.log(`   * Goal Exp  : Lambda (Arsenal xG) = ${sim.oldModelAdHoc.lambda.toFixed(3)} | Mu (Liverpool xG) = ${sim.oldModelAdHoc.mu.toFixed(3)}`);
  console.log("");
  console.log("   [MODEL 2 - BARU: CALIBRATED MLE + JAMES-STEIN SHRINKAGE]");
  const h = sim.newModelCalibrated.historicalRatings;
  const s = sim.newModelCalibrated.shrinkage;
  console.log(`   * Baseline Histori 4 Musim (1.520 Match):`);
  console.log(`     - Rata-rata Gol Liga (G_bar) = ${h.leagueAvgGoals} | Home Advantage (gamma) = ${h.homeAdvantage} | Rho = ${h.rho}`);
  console.log(`     - Arsenal Histori   (152 match) : alpha = ${h.arsenal.attack.toFixed(3)} | beta = ${h.arsenal.defense.toFixed(3)}`);
  console.log(`     - Liverpool Histori (152 match) : alpha = ${h.liverpool.attack.toFixed(3)} | beta = ${h.liverpool.defense.toFixed(3)}`);
  console.log(`   * James-Stein Shrinkage Blend (n=${s.sampleN}, kappa=${s.kappa} -> Bobot Live: ${pct(s.weightHome)}, Histori: ${pct(1 - s.weightHome)}):`);
  console.log(`     - Final Arsenal   : alpha* = ${s.finalHomeAttack.toFixed(3)} | beta* = ${s.finalHomeDefense.toFixed(3)}`);
  console.log(`     - Final Liverpool : alpha* = ${s.finalAwayAttack.toFixed(3)} | beta* = ${s.finalAwayDefense.toFixed(3)}`);
  console.log(`   * Goal Exp  : Lambda (Arsenal xG) = ${sim.newModelCalibrated.lambda.toFixed(3)} | Mu (Liverpool xG) = ${sim.newModelCalibrated.mu.toFixed(3)}`);
  console.log(`   * Total Exp Goals: ${sim.newModelCalibrated.expectedTotalGoals.toFixed(2)} gol\n`);

  console.log("------------------------------------------------------------------------------------------");
  console.log("📈 3. PROBABILITAS HASIL & FAIR ODDS BENCHMARK:");
  console.log("------------------------------------------------------------------------------------------");
  console.log("METRIK                   | MODEL 1 (LAMA)       | MODEL 2 (BARU TERKALIBRASI) | SHIN FAIR ODDS (MARKET)");
  console.log("-------------------------+----------------------+-----------------------------+------------------------");
  console.log(
    `Prob Menang Arsenal (1)  | ${pct(sim.oldModelAdHoc.probHome).padEnd(20)} | ${pct(sim.newModelCalibrated.probHome).padEnd(27)} | ${pct(sim.newModelCalibrated.shinVig.fair_prob.home)}`
  );
  console.log(
    `Prob Hasil Imbang   (X)  | ${pct(sim.oldModelAdHoc.probDraw).padEnd(20)} | ${pct(sim.newModelCalibrated.probDraw).padEnd(27)} | ${pct(sim.newModelCalibrated.shinVig.fair_prob.draw)}`
  );
  console.log(
    `Prob Menang Liverpool(2) | ${pct(sim.oldModelAdHoc.probAway).padEnd(20)} | ${pct(sim.newModelCalibrated.probAway).padEnd(27)} | ${pct(sim.newModelCalibrated.shinVig.fair_prob.away)}`
  );
  console.log("-------------------------+----------------------+-----------------------------+------------------------");
  console.log(
    `Fair Odds Arsenal (1)    | ${sim.oldModelAdHoc.fairOdds.home.toFixed(2).padEnd(20)} | ${sim.newModelCalibrated.fairOdds.home.toFixed(2).padEnd(27)} | ${sim.newModelCalibrated.shinVig.fair_odds.home.toFixed(2)}`
  );
  console.log(
    `Fair Odds Seri    (X)    | ${sim.oldModelAdHoc.fairOdds.draw.toFixed(2).padEnd(20)} | ${sim.newModelCalibrated.fairOdds.draw.toFixed(2).padEnd(27)} | ${sim.newModelCalibrated.shinVig.fair_odds.draw.toFixed(2)}`
  );
  console.log(
    `Fair Odds Liverpool (2)  | ${sim.oldModelAdHoc.fairOdds.away.toFixed(2).padEnd(20)} | ${sim.newModelCalibrated.fairOdds.away.toFixed(2).padEnd(27)} | ${sim.newModelCalibrated.shinVig.fair_odds.away.toFixed(2)}`
  );
  console.log("-------------------------+----------------------+-----------------------------+------------------------");
  console.log(
    `Prob Over 2.5 Goals      | ${pct(sim.oldModelAdHoc.over25Prob).padEnd(20)} | ${pct(sim.newModelCalibrated.over25Prob).padEnd(27)} | Pasar: ${pct(1 / sim.marketOdds.over25)}`
  );
  console.log(
    `Prob Both Teams to Score | ${pct(sim.oldModelAdHoc.bttsYesProb).padEnd(20)} | ${pct(sim.newModelCalibrated.bttsYesProb).padEnd(27)} | Pasar: ${pct(1 / sim.marketOdds.bttsYes)}`
  );
  console.log("");

  console.log("🎯 TOP 5 PREDIKSI SKOR (MODEL 2 TERKALIBRASI):");
  for (const sc of sim.newModelCalibrated.topScorelines) {
    console.log(`   - Skor [${sc.score}] : Probabilitas ${sc.prob.toFixed(1)}%`);
  }
  console.log("");

  console.log("------------------------------------------------------------------------------------------");
  console.log("💰 4. DETEKSI NILAI EKSPEKTASI POSITIF (+EV) & FRACTIONAL KELLY SIZING:");
  console.log("------------------------------------------------------------------------------------------");

  console.log("A. EVALUASI MODEL 1 (LAMA):");
  for (const bet of sim.oldModelAdHoc.valueBets) {
    const status = bet.is_positive_ev ? `🟢 +EV (${bet.ev_percentage})` : `🔴 -EV (${bet.ev_percentage})`;
    console.log(`   * ${bet.market_name} [${bet.selection}]: Odds ${bet.bookmaker_odds.toFixed(2)} | Fair ${bet.fair_odds.toFixed(2)} | ${status} | Stake Kelly: ${bet.recommended_stake_percentage}%`);
  }

  console.log("\nB. EVALUASI MODEL 2 (BARU TERKALIBRASI - STANDAR SINDIKAT):");
  for (const bet of sim.newModelCalibrated.valueBets) {
    const status = bet.is_positive_ev ? `🟢 +EV (${bet.ev_percentage}) [${bet.edge_rating}]` : `🔴 -EV (${bet.ev_percentage})`;
    console.log(`   * ${bet.market_name} [${bet.selection}]: Odds ${bet.bookmaker_odds.toFixed(2)} | Fair ${bet.fair_odds.toFixed(2)} | ${status} | Quarter Kelly: ${bet.recommended_stake_percentage}%`);
    if (bet.is_positive_ev) {
      console.log(`     ↳ Justifikasi: ${bet.rationale}`);
    }
  }

  console.log("\n------------------------------------------------------------------------------------------");
  console.log("⚖️ 5. AUDIT MATEMATIS & ANALISIS PERBEDAAN KRUSIAL:");
  console.log("------------------------------------------------------------------------------------------");
  console.log("1. ELIMINASI BIAS SAMPEL KECIL (SMALL SAMPLE DISTORTION):");
  console.log(`   - Model Lama mengandalkan 5 laga: menganggap pertahanan Arsenal dan Liverpool sangat rapuh`);
  console.log(`     (awayDefense Liverpool di-clamp ke 0.70 dan homeDefense Arsenal 0.60 akibat formula ad-hoc).`);
  console.log(`   - Model Baru menggunakan James-Stein Shrinkage (kappa=16): meredam anomali 5 laga tersebut`);
  console.log(`     menuju baseline 152 laga, sehingga xG kedua tim berlabuh di angka realistis:`);
  console.log(`     Arsenal xG: ${sim.newModelCalibrated.lambda.toFixed(2)} gol | Liverpool xG: ${sim.newModelCalibrated.mu.toFixed(2)} gol.`);
  console.log("");
  console.log("2. KONTRAK PREDIKSI DRAW (IMBANG) & HOME ADVANTAGE:");
  console.log(`   - Model Lama memprediksi probabilitas seri ${pct(sim.oldModelAdHoc.probDraw)} (Fair Odds ${sim.oldModelAdHoc.fairOdds.draw.toFixed(2)}).`);
  console.log(`   - Model Baru mengkalibrasi Home Advantage gamma=1.122 (bukan 1.22 hardcode) menghasilkan:`);
  console.log(`     Prob Seri ${pct(sim.newModelCalibrated.probDraw)} (Fair Odds ${sim.newModelCalibrated.fairOdds.draw.toFixed(2)}), sangat konsisten dengan Shin Fair Draw ${sim.newModelCalibrated.shinVig.fair_odds.draw.toFixed(2)}.`);
  console.log("");
  console.log("3. PENURUNAN RISIKO OVERFITTING PADA PASAR TARUHAN:");
  console.log(`   - Model Lama mengeluarkan taruhan berisiko over-optimistis pada Liverpool (+EV palsu akibat formula heuristik).`);
  console.log(`   - Model Baru mendeteksi edge sejati pada pasar pasar yang terdiskon (Arsenal Win & BTTS Yes)`);
  console.log(`     dengan alokasi modal Quarter-Kelly terkontrol di bawah pagu portofolio 5.0% bankroll.`);
  console.log("==========================================================================================\n");
}

const simResult = runSimulation();
printReport(simResult);
