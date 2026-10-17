/**
 * Test Task T3 — Verifikasi Pure View Mapper (BFF Layer)
 * Memastikan mapPipelineToView menghasilkan AnalysisView sesuai Zod Schema,
 * tidak ada kebocoran field mentah pipeline, durasi tercatat, dan angka
 * kuantitatif konsisten 1:1 tanpa modifikasi.
 *
 * Jalankan: npx tsx scripts/test-view-mapper.ts
 */

import { mapPipelineToView, AnalysisViewSchema } from "../lib/view/analysis-view";
import type { Analysis, PlannerTrace } from "../lib/agent/schemas";

function assert(kondisi: boolean, label: string): void {
  if (kondisi) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label}`);
    process.exitCode = 1;
    throw new Error(`Assert gagal: ${label}`);
  }
}

async function main() {
  console.log("=== TEST VIEW MAPPER (lib/view/analysis-view.ts) ===\n");

  // 1. Siapkan fixture Analysis lengkap yang valid
  const mockAnalysis: Analysis = {
    pertandingan: {
      id: "test-match-123",
      tim_kandang: "Arsenal",
      tim_tamu: "Chelsea",
      waktu: "2026-10-18T19:30:00Z",
      kompetisi: "Premier League",
      venue: "Emirates Stadium",
      wasit: "Michael Oliver",
    },
    wasit_analisis: {
      nama: "Michael Oliver",
      rata_rata_kartu: 3.8,
      total_kartu_kuning: 42,
      total_kartu_merah: 2,
      level_ketegasan: "Tegas",
      catatan: "Wasit berstandar UEFA dengan kontrol ketat.",
    },
    taktik_dan_lineup: {
      formasi_kandang: "4-3-3",
      formasi_tamu: "4-2-3-1",
      status_lineup: "Official Confirmed",
      starting_xi_kandang: [{ name: "Saka", pos: "RW" }],
      starting_xi_tamu: [{ name: "Palmer", pos: "AM" }],
      ulasan_benturan_taktik: "Adu dominasi lini tengah transisi cepat.",
    },
    coverage_liga: {
      has_xg: true,
      has_odds: true,
      has_shotmap: false,
      has_player_stats: true,
    },
    form_dan_split: {
      form_kandang: "W-W-D-W-W",
      form_tamu: "L-W-D-W-L",
      rekor_kandang_spesifik: "Home dominant",
      rekor_tandang_spesifik: "Away shaky",
    },
    klasemen: "Matchday 9",
    bursa_pasar: {
      ringkasan_1x2: "Arsenal diunggulkan bursa @ 1.85",
      asian_handicap: "Arsenal -0.75",
      over_under: "Over 2.5",
      btts: "BTTS Yes",
      pergerakan_smart_money: "Sharp flow condong ke Arsenal -0.75 awal pekan.",
    },
    probabilitas_pasar: {
      kandang: 54,
      seri: 24,
      tandang: 22,
    },
    statistik_mendalam: {
      shot_quality: {
        npxg_kandang: 1.85,
        npxg_tamu: 0.95,
        catatan: "xG dominan Arsenal.",
      },
      pemain_kunci: [
        { nama: "Saka", tim: "Arsenal", peran: "Winger", catatan: "Key threat" },
      ],
    },
    faktor_kunci: ["Keunggulan xG Kandang", "Efisiensi Transisi Arsenal", "Disiplin Taktis"],
    prediksi: {
      hasil: "Arsenal Menang Tipis",
      keyakinan: "tinggi",
      alasan: "Keunggulan struktural dan rating Dixon-Coles positif.",
      konsensus_panel: "ARSENAL_WIN",
    },
    quant_engine: {
      dixon_coles: {
        lambda: 1.85,
        mu: 0.95,
        prob_home_win: 0.582,
        prob_draw: 0.228,
        prob_away_win: 0.19,
        fair_odds: { home: 1.72, draw: 4.39, away: 5.26 },
        expected_total_goals: 2.8,
        rho_used: -0.06,
        top_scorelines: [
          { score: "2-1", prob: 0.125 },
          { score: "2-0", prob: 0.11 },
          { score: "1-1", prob: 0.095 },
        ],
      },
      shin_market: {
        z_favorite: 0.021,
        implied_margin_percentage: 4.5,
        fair_probabilities: { home: 0.53, draw: 0.24, away: 0.23 },
        fair_odds: { home: 1.88, draw: 4.17, away: 4.35 },
      },
      value_bets: [
        {
          market_name: "Match Odds 1X2",
          selection: "Arsenal (Home)",
          bookmaker_odds: 1.85,
          fair_odds: 1.72,
          expected_value: 0.075,
          ev_percentage: "+7.5%",
          kelly_stake_full: 0.088,
          kelly_stake_half: 0.044,
          is_positive_ev: true,
          model_confidence: "tinggi",
          reasoning: "Dislokasi harga bursa terhadap Dixon-Coles lambda.",
        },
      ],
      calibration_metadata: {
        calibration_tier: "A+",
        brier_score_sample: 0.185,
        is_estimated_telemetry: false,
      },
    },
    syndicate_debate: {
      bull_case: {
        model: "deepseek/deepseek-r1",
        thesis: "Arsenal unggul telak di parameter lambda xG.",
        key_drivers: ["High press sukses", "Palmer terisolasi"],
      },
      neutral_case: {
        model: "openai/o3-mini",
        thesis: "Chelsea mampu menahan imbang jika transisi Arsenal melambat.",
        empirical_drivers: ["Chelsea split tandang membaik"],
      },
      bear_case: {
        model: "meta-llama/llama-3.3-70b-instruct",
        thesis: "Bursa terlalu miring, risiko overconfidence kandang.",
        trap_warnings: ["Potensi kartu wasit tinggi", "Kelelahan UCL"],
      },
      arbiter_verdict: {
        model: "anthropic/claude-3.5-sonnet",
        chief_risk_officer_synthesis: "Value terkonfirmasi pada Arsenal dengan half-Kelly 4.4%.",
        recommended_market: "Arsenal 1X2",
        confidence_tier: "HIGH_CONVICTION",
        recommended_stake_fraction: "HALF_KELLY_4.4%",
      },
      dual_judgement: {
        judgement_1: {
          model: "gemini-3.8-flash",
          verdict: "ARSENAL_WIN",
          confidence: "HIGH",
          stake_recommendation: "4.4%",
          key_justification: "Lambda xG superior.",
        },
        judgement_2: {
          model: "claude-3.5-sonnet",
          verdict: "ARSENAL_WIN",
          confidence: "HIGH",
          stake_recommendation: "4.0%",
          key_justification: "Risk-reward terkonfirmasi positif.",
        },
        consensus_level: "FULL_CONSENSUS",
        supreme_verdict: "ARSENAL_WIN (Half-Kelly 4.4%)",
        final_confidence_tier: "HIGH_CONVICTION",
        final_recommended_market: "Match Odds: Arsenal Win",
        final_stake_fraction: "HALF_KELLY_4.4%",
      },
    },
    data_tidak_tersedia: [],
    data_integrity_audit: {
      is_strictly_grounded: true,
      dispatcher_model: "ag/gemini-3.8-flash",
      cache_quota_saved: 4,
      endpoints_called: ["match", "lineups", "odds"],
      endpoints_skipped: ["player_history"],
    },
  };

  const mockPlannerTrace: PlannerTrace = {
    steps: [
      { step: 1, action: "check_data_integrity", alasan: "Validasi data match dan coverage" },
      { step: 2, action: "run_quant_engine", alasan: "Kalkulasi Dixon-Coles dan Shin Fair Odds" },
      { step: 3, action: "run_syndicate_debate", alasan: "Debat Bull vs Bear vs Arbiter" },
      { step: 4, action: "stop_with_verdict", alasan: "Semua evidence lengkap, konsensus tercapai" },
    ],
    stop_reason: "verdict",
    gaps_remaining: [],
    coverage_score: 1.0,
  };

  const mockRawLineups = { home_starting_xi: [{ name: "Saka" }], away_starting_xi: [{ name: "Palmer" }] };
  const mockAudit = { dispatcher_model: "ag/gemini-3.8-flash", cache_metrics: { savedCalls: 4 } };
  const durationMs = 385;

  // 2. Eksekusi pure view mapper
  const view = mapPipelineToView({
    analisis: mockAnalysis,
    plannerTrace: mockPlannerTrace,
    rawLineups: mockRawLineups,
    audit: mockAudit,
    durationMs,
  });

  // 3. Verifikasi skema dengan Zod
  const parsed = AnalysisViewSchema.safeParse(view);
  assert(parsed.success, "AnalysisViewSchema.safeParse sukses memvalidasi output");

  // 4. Verifikasi zero leakage payload mentah
  const rawLeakKeys = ["analisis", "rawLineups", "isEnterpriseSyndicate", "modelUsed", "audit", "plannerTrace"];
  for (const leakKey of rawLeakKeys) {
    assert(!(leakKey in view), `Field mentah '${leakKey}' TIDAK bocor ke root AnalysisView`);
  }

  // 5. Verifikasi durasi & trace jujur
  assert(view.thinking.durasi_ms === 385, "Thinking durasi_ms tercatat persis (385 ms)");
  assert(view.thinking.steps.length === 4, "Thinking steps memuat 4 langkah planner");
  assert(view.thinking.stop_reason === "verdict", "Thinking stop_reason adalah 'verdict'");
  assert(view.thinking.steps[0].tool === "check_data_integrity", "Step 1 tool check_data_integrity");

  // 6. Verifikasi kuantitatif: hero, prob, zero modification
  assert(view.kuantitatif.hero.prob.home === 0.582, "Probabilitas home Dixon-Coles 0.582 (1:1 tanpa re-kalkulasi)");
  assert(view.kuantitatif.hero.fair_odds.home === 1.72, "Fair odds home 1.72");
  assert(view.kuantitatif.hero.ev_teratas?.selection === "Arsenal (Home)", "EV teratas teridentifikasi");
  assert(view.kuantitatif.hero.ev_teratas?.ev_percentage === "+7.5%", "EV percentage terpetakan");
  assert(view.kuantitatif.bukti.length <= 5, "Maksimal 5 baris bukti terpenting");

  // 7. Verifikasi debat: persona, consensus, supreme
  assert(view.debat.persona.length === 4, "Debat memuat 4 persona (Bull, Neutral, Bear, Arbiter)");
  assert(view.debat.consensus === "FULL_CONSENSUS", "Debat consensus terpetakan dari supreme");
  assert(view.debat.supreme?.verdict.includes("ARSENAL_WIN") === true, "Supreme verdict terisi");

  // 8. Verifikasi odds dislocation
  assert(view.odds.dislocation.ringkasan_1x2.includes("Arsenal diunggulkan"), "Dislocation ringkasan_1x2 terisi");
  assert(view.odds.smart_money.includes("Sharp flow"), "Smart money terpetakan ke view.odds");

  console.log("\n Semua pengujian mapPipelineToView LOLOS!");
}

main().catch((e) => {
  console.error("Test gagal:", e);
  process.exit(1);
});
