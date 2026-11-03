import { orchestrate5AgentSyndicate } from "../lib/syndicate-orchestrator";
import * as fs from "fs";
import * as path from "path";

// Load .env.local manually
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn("Could not load .env.local manually", e);
}

async function verifyRouting() {
  console.log("=== VERIFIKASI ROUTING MODEL BARU ===");
  console.log("NINE_ROUTER_BASE_URL:", process.env.NINE_ROUTER_BASE_URL);
  console.log("MODEL_FETCHER_DISPATCHER:", process.env.MODEL_FETCHER_DISPATCHER);
  console.log("MODEL_BULL:", process.env.MODEL_BULL);
  console.log("MODEL_NEUTRAL:", process.env.MODEL_NEUTRAL);
  console.log("MODEL_BEAR:", process.env.MODEL_BEAR);
  console.log("MODEL_JUDGEMENT_1:", process.env.MODEL_JUDGEMENT_1);
  console.log("MODEL_JUDGEMENT_2:", process.env.MODEL_JUDGEMENT_2);
  console.log("BETTING_MODEL_A:", process.env.BETTING_MODEL_A);
  console.log("BETTING_MODEL_B:", process.env.BETTING_MODEL_B);

  console.log("\n[TEST] Menjalankan orchestrate5AgentSyndicate dengan 5 Model...");
  const startTime = Date.now();

  try {
    const result = await orchestrate5AgentSyndicate({
      matchSummary: "Arsenal vs Chelsea di Emirates Stadium. Arsenal dominan ball possession 62%, xG 2.1 vs 0.9. Chelsea mengandalkan counter attack cepat.",
      intel: {
        pertandingan: {
          tim_kandang: "Arsenal",
          tim_tamu: "Chelsea",
          kompetisi: "Premier League",
          waktu: "2026-10-15 20:00",
          venue: "Emirates Stadium",
        },
        market_odds: {
          is_available: true,
          bookmaker: "Bet365",
          home_last: 1.95,
          draw_last: 3.60,
          away_last: 3.90,
          total_goals_over_2_5: 1.80,
        },
        lineups: {
          status_label: "Confirmed Starting XI",
        },
        form_split: {
          home_form_summary: "W-W-D-W-L (Home: 4W-1D-0L)",
          away_form_summary: "L-D-W-L-D (Away: 1W-2D-2L)",
        },
        wasit: { nama: "Michael Oliver", avg_kartu_kuning: 3.8 },
        cedera_suspensi: { absensi_kandang: [], absensi_tamu: [] },
      },
      quantPackage: {
        dixon_coles: {
          lambda_home_xg: 1.95,
          mu_away_xg: 0.85,
          prob_home_win: 0.58,
          prob_draw: 0.24,
          prob_away_win: 0.18,
          over_2_5_prob: 0.55,
          btts_yes_prob: 0.48,
          fair_odds: { home: 1.72, draw: 4.17, away: 5.55 },
          asian_handicap: {
            ah_0_0_dnb: { home_prob: 0.76, fair_odds_home: 1.32 }
          }
        },
        shin_vig: {
          fair_odds: { home: 1.88, draw: 3.75, away: 4.10 },
          margin_percentage: 4.2
        },
        value_bets: [
          {
            market_name: "Match Odds (1X2)",
            selection: "Arsenal (Home Win)",
            bookmaker_odds: 1.95,
            fair_odds: 1.72,
            ev_percentage: "+13.37%",
            recommended_stake_percentage: 2.45,
          }
        ]
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ SUKSES! Total Waktu Eksekusi: ${elapsed}s`);
    console.log("\n--- HASIL SINTESIS SYNDICATE ---");
    console.log("Bull Model:", result.bull_case.model);
    console.log("Neutral Model:", result.neutral_case.model);
    console.log("Bear Model:", result.bear_case.model);
    console.log("Judgement 1 Model:", result.dual_judgement.judgement_1.model);
    console.log("Judgement 2 Model:", result.dual_judgement.judgement_2.model);
    console.log("Consensus Level:", result.dual_judgement.consensus_level);
    console.log("Supreme Verdict:", result.dual_judgement.supreme_verdict);
    console.log("Final Market:", result.dual_judgement.final_recommended_market);
    console.log("Final Stake:", result.dual_judgement.final_stake_fraction);
  } catch (error: any) {
    console.error("❌ ERROR saat eksekusi debate:", error.message || error);
  }
}

verifyRouting();
