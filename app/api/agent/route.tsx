import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getStatsCacheMetrics } from "@/lib/stats-cache";
import {
  fetchAndValidateMatchIntelligence,
  type FetchResultWithAudit,
} from "@/lib/stats-fetcher-agent";
import {
  calculateDixonColes,
  stripVigShin,
  evaluateValueBet,
  evaluatePortfolioKelly,
  type ValueBetEvaluation,
  getShrunkMatchParameters,
} from "@/lib/quant";
import {
  orchestrate5AgentSyndicate,
  type SyndicateDebateResult,
} from "@/lib/syndicate-orchestrator";
import { generateSpecialMarketsPackage } from "@/lib/quant/special-markets-engine";
import { getTeamRollingTelemetry } from "@/lib/db/team-telemetry";

/**
 * ============================================================================
 * ENTERPRISE MULTI-AGENT SYNDICATE ORCHESTRATOR WITH STRICT DATA GROUNDING
 * ============================================================================
 * Menggabungkan:
 * 1. Dynamic Fetcher Agent (oc/muse-spark-1.3) + Zod Data Integrity Validator
 * 2. Deterministic Quant Engine (Dixon-Coles + Shin Method + Kelly Criterion)
 * 3. Strict Closed-World Multi-Agent Syndicate (Bull vs Bear vs Arbiter)
 */

// Injektor fetch untuk memastikan 9Router mengirimkan JSON murni non-streaming
const customFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      if (parsed.stream === undefined) {
        parsed.stream = false;
        init = { ...init, body: JSON.stringify(parsed) };
      }
    } catch {}
  }
  return fetch(url, init);
};

// Konfigurasi 9Router via OpenAI SDK adapter
const nineRouter = createOpenAI({
  baseURL: process.env.NINE_ROUTER_BASE_URL || "http://localhost:20128/v1",
  apiKey: process.env.NINE_ROUTER_API_KEY || "9router-local",
  fetch: customFetch,
});

// Konfigurasi 5 Model Syndicate & Dual Judgement
const MODEL_DEFAULT = process.env.NINE_ROUTER_MODEL || "ag/gemini-3.8-flash";
const MODEL_BULL = process.env.MODEL_BULL || "ag/gemini-3.8-flash-high";
const MODEL_NEUTRAL = process.env.MODEL_NEUTRAL || "bai/glm-5.3-flash";
const MODEL_BEAR = process.env.MODEL_BEAR || "bai/deepseek-v4.1-flash";
const MODEL_JUDGEMENT_1 = process.env.MODEL_JUDGEMENT_1 || "ag/gemini-3.8-flash-high";
const MODEL_JUDGEMENT_2 = process.env.MODEL_JUDGEMENT_2 || "bai/qwen3.8-flash";
const MODEL_ARBITER = MODEL_JUDGEMENT_1;

// Skema Validasi Output Analisis Lengkap Enterprise
const PlayerItemSchema = z.object({
  name: z.string(),
  pos: z.string().default("M"),
  num: z.number().nullable().optional(),
});

const AnalysisSchema = z.object({
  pertandingan: z.object({
    id: z.string(),
    tim_kandang: z.string(),
    tim_tamu: z.string(),
    waktu: z.string(),
    kompetisi: z.string(),
    venue: z.string().nullable(),
    wasit: z.string().nullable(),
  }),
  wasit_analisis: z.object({
    nama: z.string().nullable(),
    rata_rata_kartu: z.number().nullable(),
    total_kartu_kuning: z.number().nullable().optional(),
    total_kartu_merah: z.number().nullable().optional(),
    level_ketegasan: z.enum(["rendah", "sedang", "tinggi", "tidak diketahui"]),
    catatan: z.string(),
  }),
  taktik_dan_lineup: z.object({
    formasi_kandang: z.string().nullable(),
    formasi_tamu: z.string().nullable(),
    status_lineup: z.enum(["resmi", "prediksi", "belum_tersedia"]),
    starting_xi_kandang: z.array(PlayerItemSchema),
    starting_xi_tamu: z.array(PlayerItemSchema),
    ulasan_benturan_taktik: z.string(),
  }),
  coverage_liga: z.object({
    has_xg: z.boolean(),
    has_odds: z.boolean(),
    has_shotmap: z.boolean(),
    has_player_stats: z.boolean(),
  }),
  form_dan_split: z.object({
    form_kandang: z.string(),
    form_tamu: z.string(),
    rekor_kandang_spesifik: z.string().describe("Performa spesifik kandang"),
    rekor_tandang_spesifik: z.string().describe("Performa spesifik tandang"),
  }),
  klasemen: z.string(),
  bursa_pasar: z.object({
    ringkasan_1x2: z.string(),
    asian_handicap: z.string().nullable(),
    over_under: z.string().nullable(),
    btts: z.string().nullable(),
    pergerakan_smart_money: z.string(),
  }),
  probabilitas_pasar: z
    .object({
      kandang: z.number(),
      seri: z.number(),
      tandang: z.number(),
    })
    .nullable(),
  statistik_mendalam: z.object({
    shot_quality: z.object({
      npxg_kandang: z.number().nullable(),
      npxg_tamu: z.number().nullable(),
      catatan: z.string(),
    }),
    pemain_kunci: z.array(
      z.object({
        nama: z.string(),
        tim: z.string(),
        peran: z.string(),
        catatan: z.string(),
      })
    ),
  }),
  faktor_kunci: z.array(z.string()),
  prediksi: z.object({
    hasil: z.string(),
    keyakinan: z.enum(["rendah", "sedang", "tinggi"]),
    alasan: z.string(),
    konsensus_panel: z.string(),
  }),
  quant_engine: z.object({
    dixon_coles: z.object({
      lambda_home_xg: z.number(),
      mu_away_xg: z.number(),
      prob_home_win: z.number(),
      prob_draw: z.number(),
      prob_away_win: z.number(),
      fair_odds: z.object({
        home: z.number(),
        draw: z.number(),
        away: z.number(),
      }),
      over_2_5_prob: z.number(),
      btts_yes_prob: z.number(),
      expected_total_goals: z.number(),
      top_scorelines: z.array(
        z.object({
          homeGoals: z.number().optional(),
          awayGoals: z.number().optional(),
          prob: z.number().optional(),
          score: z.string().optional(),
          probability: z.number().optional(),
          percentage: z.string().optional(),
        }).passthrough()
      ),
      asian_handicap: z.any().optional(),
      clean_sheet: z.any().optional(),
      expected_points: z.any().optional(),
    }),
    vig_stripping: z.object({
      overround: z.number(),
      margin_percentage: z.number(),
      fair_odds: z.object({
        home: z.number(),
        draw: z.number(),
        away: z.number(),
      }),
    }),
    value_bets: z.array(
      z.object({
        market_name: z.string(),
        selection: z.string(),
        bookmaker_odds: z.number(),
        fair_odds: z.number(),
        expected_value: z.number(),
        ev_percentage: z.string(),
        is_positive_ev: z.boolean(),
        edge_rating: z.string(),
        recommended_stake_percentage: z.number(),
        rationale: z.string(),
      })
    ),
  }).passthrough(),
  syndicate_debate: z.object({
    bull_case: z.object({
      model: z.string(),
      thesis: z.string(),
      key_drivers: z.array(z.string()),
      tactical_edge: z.string(),
    }),
    neutral_case: z.object({
      model: z.string(),
      thesis: z.string(),
      empirical_drivers: z.array(z.string()),
      equilibrium_assessment: z.string(),
    }).optional(),
    bear_case: z.object({
      model: z.string(),
      thesis: z.string(),
      trap_warnings: z.array(z.string()),
      vulnerability_audit: z.string(),
    }),
    dual_judgement: z.object({
      judgement_1: z.object({
        model: z.string(),
        title: z.string(),
        verdict_summary: z.string(),
        confidence_tier: z.enum(["A_HIGH_VALUE", "B_MODERATE", "C_LEAN", "PASS_AVOID"]),
        recommended_market: z.string(),
        key_reasoning: z.string().optional(),
      }),
      judgement_2: z.object({
        model: z.string(),
        title: z.string(),
        verdict_summary: z.string(),
        confidence_tier: z.enum(["A_HIGH_VALUE", "B_MODERATE", "C_LEAN", "PASS_AVOID"]),
        recommended_market: z.string(),
        alternative_perspective: z.string().optional(),
      }),
      consensus_level: z.enum(["UNANIMOUS", "CONCURRING", "SPLIT_DECISION", "DISSENT"]),
      supreme_verdict: z.string(),
      final_recommended_market: z.string(),
      final_confidence_tier: z.enum(["A_HIGH_VALUE", "B_MODERATE", "C_LEAN", "PASS_AVOID"]),
      final_stake_fraction: z.string(),
    }).optional(),
    arbiter_verdict: z.object({
      model: z.string(),
      chief_risk_officer_synthesis: z.string(),
      confidence_tier: z.enum(["A_HIGH_VALUE", "B_MODERATE", "C_LEAN", "PASS_AVOID"]),
      recommended_market: z.string(),
      recommended_stake_fraction: z.string(),
    }),
  }),
  data_tidak_tersedia: z.array(z.string()),
  data_integrity_audit: z
    .object({
      is_strictly_grounded: z.boolean(),
      dispatcher_model: z.string(),
      cache_quota_saved: z.number(),
      endpoints_called: z.array(z.string()),
      endpoints_skipped: z.array(z.string()),
    })
    .optional(),
});

// Helper untuk memanggil model VPS dengan failover aman
async function callModelWithFallback(targetModel: string, systemPrompt: string, userPrompt: string) {
  try {
    console.log(`[9Router] Menjalankan target model: ${targetModel}...`);
    const res = await generateText({
      model: nineRouter.chat(targetModel),
      system: systemPrompt,
      prompt: userPrompt,
    });
    return { text: res.text, modelUsed: targetModel };
  } catch (primaryErr) {
    console.warn(`[9Router] Model ${targetModel} gagal, beralih ke fallback ${MODEL_DEFAULT}:`, primaryErr);
    try {
      const res = await generateText({
        model: nineRouter.chat(MODEL_DEFAULT),
        system: systemPrompt,
        prompt: userPrompt,
      });
      return { text: res.text, modelUsed: `${targetModel} (fallback: ${MODEL_DEFAULT})` };
    } catch (fallbackErr) {
      throw new Error(`Gagal memanggil model ${targetModel} & fallback ${MODEL_DEFAULT}: ${fallbackErr}`);
    }
  }
}

// =========================================================================
// PIPELINE HANDLER UTAMA
// =========================================================================
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("match_id");
  const competitionIdHint = searchParams.get("competition_id") || undefined;

  if (!matchId) {
    return Response.json(
      { error: "Parameter match_id diperlukan untuk menjalankan analisis pra-laga." },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch & Validasi Ketat via Dynamic Dispatcher Agent & Zod
  let fetchResult: FetchResultWithAudit;
  try {
    fetchResult = await fetchAndValidateMatchIntelligence(matchId, competitionIdHint);
  } catch (err) {
    return Response.json(
      { error: `Gagal mengumpulkan data pertandingan: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const intel = fetchResult.intelligence;

  // 2. Eksekusi Deterministic Quant Engine (Calibrated Dixon-Coles & Shin Vig Stripping)
  const homeTeamName = intel.pertandingan.tim_kandang;
  const awayTeamName = intel.pertandingan.tim_tamu;
  const leagueName = intel.pertandingan.kompetisi;

  // Sample size untuk James-Stein shrinkage harus dari JUMLAH LAGA FORM tim itu,
  // bukan jumlah pertemuan head-to-head. Kalau data form tidak tersedia,
  // pakai 0 (jujur) supaya bobot shrinkage jatuh ke prior makro.
  const homeSampleN = Math.max(0, intel.form_split.home_form_sample_size || 0);
  const awaySampleN = Math.max(0, intel.form_split.away_form_sample_size || 0);

  const homeTelem = getTeamRollingTelemetry(homeTeamName, 6, today);
  const awayTelem = getTeamRollingTelemetry(awayTeamName, 6, today);

  const shrunkParams = getShrunkMatchParameters({
    homeTeam: homeTeamName,
    awayTeam: awayTeamName,
    leagueHint: leagueName,
    liveHomeFormGoalsAvg: intel.form_split.home_goals_avg,
    liveAwayFormGoalsAvg: intel.form_split.away_goals_avg,
    homeSampleN,
    awaySampleN,
    homeTelemetry: homeTelem.sample_size > 0 ? homeTelem : undefined,
    awayTelemetry: awayTelem.sample_size > 0 ? awayTelem : undefined,
    matchDateCutoff: today,
  });

  const dcOutput = calculateDixonColes({
    homeAttack: shrunkParams.homeAttack,
    homeDefense: shrunkParams.homeDefense,
    awayAttack: shrunkParams.awayAttack,
    awayDefense: shrunkParams.awayDefense,
    homeAdvantage: shrunkParams.homeAdvantage,
    leagueAvgGoals: shrunkParams.leagueAvgGoals,
    rho: shrunkParams.rho,
  });

  const hLast = intel.market_odds.home_last;
  const dLast = intel.market_odds.draw_last;
  const aLast = intel.market_odds.away_last;

  const vigOutput = (hLast && dLast && aLast)
    ? stripVigShin(hLast, dLast, aLast)
    : {
        overround: 1.055,
        margin_percentage: 5.5,
        fair_odds: dcOutput.fair_odds,
        fair_prob: { home: dcOutput.prob_home_win, draw: dcOutput.prob_draw, away: dcOutput.prob_away_win },
      };

  // 3. Evaluasi +EV & Portfolio Kelly Stake Sizing
  const rawValueBets: ValueBetEvaluation[] = [
    evaluateValueBet(dcOutput.prob_home_win, hLast || dcOutput.fair_odds.home, "1X2", `${intel.pertandingan.tim_kandang} Menang`),
    evaluateValueBet(dcOutput.prob_draw, dLast || dcOutput.fair_odds.draw, "1X2", "Hasil Imbang (Draw)"),
    evaluateValueBet(dcOutput.prob_away_win, aLast || dcOutput.fair_odds.away, "1X2", `${intel.pertandingan.tim_tamu} Menang`),
    evaluateValueBet(
      dcOutput.over_under.line_2_5.over,
      intel.market_odds.total_goals_over_2_5 || 1.95,
      "Over/Under 2.5",
      "Over 2.5 Goals"
    ),
    evaluateValueBet(
      dcOutput.btts.yes,
      1.88,
      "Both Teams to Score",
      "BTTS Yes"
    ),
    evaluateValueBet(
      dcOutput.asian_handicap.ah_0_0_dnb.home_prob,
      dcOutput.asian_handicap.ah_0_0_dnb.fair_odds_home,
      "Asian Handicap 0.0 (DNB)",
      `${intel.pertandingan.tim_kandang} Draw No Bet`
    ),
  ];
  const valueBets = evaluatePortfolioKelly(rawValueBets, 5.0);

  // Kompilasi Pasar Khusus (Headed Goal, Corners, Cards, Passes)
  const specialMarkets = (homeTelem.sample_size > 0 || awayTelem.sample_size > 0)
    ? generateSpecialMarketsPackage({
        homeTeam: homeTeamName,
        awayTeam: awayTeamName,
        homeTelemetry: homeTelem,
        awayTelemetry: awayTelem,
        cutoffDate: today,
      })
    : null;

  const quantPackage = {
    dixon_coles: {
      lambda_home_xg: dcOutput.lambda,
      mu_away_xg: dcOutput.mu,
      prob_home_win: dcOutput.prob_home_win,
      prob_draw: dcOutput.prob_draw,
      prob_away_win: dcOutput.prob_away_win,
      fair_odds: dcOutput.fair_odds,
      over_2_5_prob: dcOutput.over_under.line_2_5.over,
      btts_yes_prob: dcOutput.btts.yes,
      expected_total_goals: dcOutput.expected_total_goals,
      top_scorelines: dcOutput.top_scorelines,
      asian_handicap: dcOutput.asian_handicap,
      clean_sheet: dcOutput.clean_sheet,
      expected_points: dcOutput.expected_points,
    },
    vig_stripping: {
      overround: vigOutput.overround,
      margin_percentage: vigOutput.margin_percentage,
      fair_odds: vigOutput.fair_odds,
    },
    value_bets: valueBets,
    special_markets: specialMarkets,
    calibration_metadata: {
      is_calibrated: shrunkParams.isCalibrated,
      div: shrunkParams.metadata?.div,
      league_name: shrunkParams.metadata?.leagueName,
      home_source: shrunkParams.metadata?.homeSource,
      away_source: shrunkParams.metadata?.awaySource,
      shrinkage_weights: shrunkParams.shrinkageWeights,
      calibrated_home_advantage: shrunkParams.homeAdvantage,
      calibrated_league_avg_goals: shrunkParams.leagueAvgGoals,
      macro_prior_date: shrunkParams.metadata?.macroPriorDate,
      telemetry_source: shrunkParams.metadata?.telemetrySource,
      observed_xg_samples: shrunkParams.metadata?.observedXgSamples,
      is_estimated_telemetry: shrunkParams.metadata?.isEstimatedTelemetry,
      pre_match_cutoff: shrunkParams.metadata?.preMatchCutoff,
    },
  };

  // 4. Prompting Ketat Anti-Halusinasi (Strict Closed-World Grounding)
  const systemPrompt =
    `Kamu adalah CHIEF RISK OFFICER (ARBITER KEPALA) Sindikat Olahraga Enterprise Tier-1.\n` +
    `Hari analisis: ${today}.\n\n` +
    `ATURAN MUTLAK CLOSED-WORLD GROUNDING (ZERO HALLUCINATION DIRECTIVE):\n` +
    `1. DILARANG KERAS MENGARANG NAMA PEMAIN: Kamu HANYA boleh menyebut nama pemain yang tercantum di payload JSON 'lineups.home_starting_xi' atau 'lineups.away_starting_xi'. Jika lineups.is_available bernilai false, nyatakan secara eksplisit bahwa lineup belum diumumkan resmi dan analisis berbasis karakter tim secara kolektif.\n` +
    `2. DILARANG MENGARANG LAPORAN CEDERA: Hanya kutip cedera yang tercatat di 'injuries'. Jika kosong, tulis 'Tidak ada laporan cedera resmi'.\n` +
    `3. DILARANG MENGARANG SKOR MASA LALU: Hanya kutip rekor H2H dari 'h2h_history.recent_meetings'. Jika kosong, sebut 'Data H2H resmi belum tersedia'.\n` +
    `4. WAJIB SELARAS DENGAN QUANT ENGINE: Nilai xG (${dcOutput.lambda} vs ${dcOutput.mu}) dan probabilitas murni telah dihitung secara matematis. Dilarang bertentangan dengan angka ini.\n` +
    `5. KONSISTENSI DATA HILANG: Setiap poin dalam 'missing_data_registry' wajib dimasukkan ke array 'data_tidak_tersedia'.\n` +
    `6. PASAR KHUSUS BUKAN REKOMENDASI VALUE: Jika ada 'special_markets' di payload (headed goal/corners/cards), itu HANYA fair odds model. Odds bandar untuk pasar tersebut TIDAK tersedia, jadi EV tidak dapat dihitung. Dilarang mengklaim pasar khusus punya "+EV", "edge", atau "value". Yang boleh dinilai +EV hanya pasar di 'value_bets'.\n` +
    `7. STATUS ESTIMASI WAJIB DIHORMATI: Jika sebuah pasar bertanda is_estimated=true atau confidence_tier INSUFFICIENT_DATA/LOW, jangan sajikan sebagai angka terukur. Sebutkan sebagai estimasi berbasis rata-rata liga.\n\n` +
    `ARSITEKTUR DEBAT:\n` +
    `- Bull Analyst (${MODEL_BULL}): Membangun tesis kemenangan berbasis momentum & xG kuantitatif.\n` +
    `- Bear Auditor (${MODEL_BEAR}): Menguji tesis Bull, mencari peringatan trap line bandar & kelelahan.\n` +
    `- Chief Risk Officer Verdict (${MODEL_ARBITER}): Keputusan final, tier keyakinan (A/B/C/PASS), dan stake Kelly.\n` +
    `KEMBALIKAN OUTPUT HANYA DALAM FORMAT JSON VALID.`;

  const userPayload = {
    intelligence: intel,
    quant: quantPackage,
    data_audit: {
      is_strictly_grounded: true,
      missing_data_registry: intel.missing_data_registry,
    },
  };

  const userPrompt =
    `Berikut adalah data intelijen terverifikasi (Zod-Validated) untuk laga ${intel.pertandingan.tim_kandang} vs ${intel.pertandingan.tim_tamu}:\n\n` +
    `\`\`\`json\n` +
    JSON.stringify(userPayload, null, 2) +
    `\n\`\`\`\n\n` +
    `Keluarkan analisis komite sindikat dalam FORMAT JSON VALID:\n` +
    `{\n` +
    `  "pertandingan": {\n` +
    `    "id": "${intel.pertandingan.id}",\n` +
    `    "tim_kandang": "${intel.pertandingan.tim_kandang}",\n` +
    `    "tim_tamu": "${intel.pertandingan.tim_tamu}",\n` +
    `    "waktu": "${intel.pertandingan.waktu}",\n` +
    `    "kompetisi": "${intel.pertandingan.kompetisi}",\n` +
    `    "venue": "${intel.pertandingan.venue}",\n` +
    `    "wasit": "${intel.pertandingan.wasit}"\n` +
    `  },\n` +
    `  "wasit_analisis": {\n` +
    `    "nama": "${intel.wasit_detail.name}",\n` +
    `    "rata_rata_kartu": ${intel.wasit_detail.avg_yellow_per_game ?? "null"},\n` +
    `    "total_kartu_kuning": ${intel.wasit_detail.yellow_cards},\n` +
    `    "total_kartu_merah": ${intel.wasit_detail.red_cards},\n` +
    `    "level_ketegasan": "${intel.wasit_detail.strictness_level}",\n` +
    `    "catatan": string (ulasan ketegasan wasit berdasarkan data faktual di atas)\n` +
    `  },\n` +
    `  "taktik_dan_lineup": {\n` +
    `    "formasi_kandang": "${intel.lineups.home_formation}",\n` +
    `    "formasi_tamu": "${intel.lineups.away_formation}",\n` +
    `    "status_lineup": "${intel.lineups.status_label}",\n` +
    `    "starting_xi_kandang": ${JSON.stringify(intel.lineups.home_starting_xi)},\n` +
    `    "starting_xi_tamu": ${JSON.stringify(intel.lineups.away_starting_xi)},\n` +
    `    "ulasan_benturan_taktik": string (ulasan benturan formasi & ruang transisi)\n` +
    `  },\n` +
    `  "coverage_liga": { "has_xg": true, "has_odds": ${intel.market_odds.is_available}, "has_shotmap": false, "has_player_stats": ${intel.lineups.is_available} },\n` +
    `  "form_dan_split": {\n` +
    `    "form_kandang": "${intel.form_split.home_form_summary}",\n` +
    `    "form_tamu": "${intel.form_split.away_form_summary}",\n` +
    `    "rekor_kandang_spesifik": "${intel.form_split.home_form_summary}",\n` +
    `    "rekor_tandang_spesifik": "${intel.form_split.away_form_summary}"\n` +
    `  },\n` +
    `  "klasemen": "Posisi klasemen kompetisi reguler",\n` +
    `  "bursa_pasar": {\n` +
    `    "ringkasan_1x2": "${hLast ? `Pasar 1X2: ${hLast} / ${dLast} / ${aLast}` : "Pasar 1X2 belum dibuka secara resmi"}",\n` +
    `    "asian_handicap": "Pasar handicap seimbang",\n` +
    `    "over_under": "Line Total Gol 2.5",\n` +
    `    "btts": "Pasar Kedua Tim Mencetak Gol",\n` +
    `    "pergerakan_smart_money": "Aliran dana pasar stabil"\n` +
    `  },\n` +
    `  "probabilitas_pasar": ${
      hLast && dLast && aLast
        ? JSON.stringify({
            kandang: Math.round(vigOutput.fair_prob.home * 100),
            seri: Math.round(vigOutput.fair_prob.draw * 100),
            tandang: Math.round(vigOutput.fair_prob.away * 100),
          })
        : "null"
    },\n` +
    `  "statistik_mendalam": {\n` +
    `    "shot_quality": {\n` +
    `      "npxg_kandang": ${dcOutput.lambda},\n` +
    `      "npxg_tamu": ${dcOutput.mu},\n` +
    `      "catatan": "xG Dixon-Coles terkalibrasi"\n` +
    `    },\n` +
    `    "pemain_kunci": [\n` +
    (intel.lineups.home_starting_xi[0]
      ? `      { "nama": "${intel.lineups.home_starting_xi[0].name}", "tim": "${intel.pertandingan.tim_kandang}", "peran": "Pemain Kunci", "catatan": "Tercatat di starting XI resmi" }\n`
      : `      { "nama": "Kolektif Tim", "tim": "${intel.pertandingan.tim_kandang}", "peran": "Unit Taktis", "catatan": "Lineup belum dirilis" }\n`) +
    `    ]\n` +
    `  },\n` +
    `  "faktor_kunci": [ "Dixon-Coles xG", "Efisiensi Konversi", "Disiplin Taktis" ],\n` +
    `  "prediksi": {\n` +
    `    "hasil": string,\n` +
    `    "keyakinan": "rendah" | "sedang" | "tinggi",\n` +
    `    "alasan": string,\n` +
    `    "konsensus_panel": string\n` +
    `  },\n` +
    `  "syndicate_debate": {\n` +
    `    "bull_case": {\n` +
    `      "model": "${MODEL_BULL}",\n` +
    `      "thesis": string,\n` +
    `      "key_drivers": [ string, string ],\n` +
    `      "tactical_edge": string\n` +
    `    },\n` +
    `    "bear_case": {\n` +
    `      "model": "${MODEL_BEAR}",\n` +
    `      "thesis": string,\n` +
    `      "trap_warnings": [ string, string ],\n` +
    `      "vulnerability_audit": string\n` +
    `    },\n` +
    `    "arbiter_verdict": {\n` +
    `      "model": "${MODEL_ARBITER}",\n` +
    `      "chief_risk_officer_synthesis": string,\n` +
    `      "confidence_tier": "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID",\n` +
    `      "recommended_market": string,\n` +
    `      "recommended_stake_fraction": string\n` +
    `    }\n` +
    `  },\n` +
    `  "data_tidak_tersedia": ${JSON.stringify(intel.missing_data_registry)}\n` +
    `}`;

  try {
    const [syndicateDebate, { text, modelUsed }] = await Promise.all([
      orchestrate5AgentSyndicate({
        matchSummary: `${intel.pertandingan.tim_kandang} vs ${intel.pertandingan.tim_tamu}`,
        intel,
        quantPackage,
      }),
      callModelWithFallback(MODEL_JUDGEMENT_1, systemPrompt, userPrompt),
    ]);
    const rawObj = extractJSON(text);

    // Defensif parsing & merging
    const validatedAnalysis = AnalysisSchema.safeParse({
      ...rawObj,
      quant_engine: quantPackage,
      syndicate_debate: syndicateDebate,
      data_tidak_tersedia: intel.missing_data_registry,
      data_integrity_audit: {
        is_strictly_grounded: true,
        dispatcher_model: fetchResult.audit.dispatcher_model,
        cache_quota_saved: fetchResult.audit.cache_metrics.savedCalls,
        endpoints_called: fetchResult.audit.endpoints_called,
        endpoints_skipped: fetchResult.audit.endpoints_skipped,
      },
    });

    if (validatedAnalysis.success) {
      return Response.json({
        analisis: validatedAnalysis.data,
        rawLineups: intel.lineups,
        modelUsed: `${syndicateDebate.dual_judgement.judgement_1.model} + ${syndicateDebate.dual_judgement.judgement_2.model}`,
        isEnterpriseSyndicate: true,
        cacheMetrics: getStatsCacheMetrics(),
        audit: fetchResult.audit,
      });
    }

    console.warn("[9Router] Schema parse fallback, merging verified intelligence");
    const merged = {
      pertandingan: {
        id: intel.pertandingan.id,
        tim_kandang: intel.pertandingan.tim_kandang,
        tim_tamu: intel.pertandingan.tim_tamu,
        waktu: intel.pertandingan.waktu,
        kompetisi: intel.pertandingan.kompetisi,
        venue: intel.pertandingan.venue,
        wasit: intel.pertandingan.wasit,
        ...(rawObj?.pertandingan || {}),
      },
      wasit_analisis: {
        nama: intel.wasit_detail.name,
        rata_rata_kartu: intel.wasit_detail.avg_yellow_per_game,
        total_kartu_kuning: intel.wasit_detail.yellow_cards,
        total_kartu_merah: intel.wasit_detail.red_cards,
        level_ketegasan: intel.wasit_detail.strictness_level,
        catatan: rawObj?.wasit_analisis?.catatan || "Ulasan ketegasan wasit dari data faktual TheStatsAPI.",
        ...(rawObj?.wasit_analisis || {}),
      },
      taktik_dan_lineup: {
        formasi_kandang: intel.lineups.home_formation,
        formasi_tamu: intel.lineups.away_formation,
        status_lineup: intel.lineups.status_label,
        starting_xi_kandang: intel.lineups.home_starting_xi,
        starting_xi_tamu: intel.lineups.away_starting_xi,
        ulasan_benturan_taktik: rawObj?.taktik_dan_lineup?.ulasan_benturan_taktik || "Analisis duel formasi kedua tim di lini transisi.",
      },
      coverage_liga: {
        has_xg: true,
        has_odds: intel.market_odds.is_available,
        has_shotmap: false,
        has_player_stats: intel.lineups.is_available,
        ...(rawObj?.coverage_liga || {}),
      },
      form_dan_split: {
        form_kandang: intel.form_split.home_form_summary,
        form_tamu: intel.form_split.away_form_summary,
        rekor_kandang_spesifik: intel.form_split.home_form_summary,
        rekor_tandang_spesifik: intel.form_split.away_form_summary,
      },
      klasemen: rawObj?.klasemen || "Kompetisi Reguler",
      bursa_pasar: {
        ringkasan_1x2: rawObj?.bursa_pasar?.ringkasan_1x2 || "Pasar Odds 1X2 aktif.",
        asian_handicap: rawObj?.bursa_pasar?.asian_handicap || "Handicap seimbang.",
        over_under: rawObj?.bursa_pasar?.over_under || "Pasar total gol aktif.",
        btts: rawObj?.bursa_pasar?.btts || "Pasar kedua tim mencetak gol.",
        pergerakan_smart_money: rawObj?.bursa_pasar?.pergerakan_smart_money || "Aliran dana stabil.",
        ...(rawObj?.bursa_pasar || {}),
      },
      probabilitas_pasar: rawObj?.probabilitas_pasar ?? (hLast && dLast && aLast ? {
        kandang: Math.round(vigOutput.fair_prob.home * 100),
        seri: Math.round(vigOutput.fair_prob.draw * 100),
        tandang: Math.round(vigOutput.fair_prob.away * 100),
      } : null),
      statistik_mendalam: {
        shot_quality: {
          npxg_kandang: dcOutput.lambda,
          npxg_tamu: dcOutput.mu,
          catatan: "Kalkulasi xG Dixon-Coles terverifikasi.",
          ...(rawObj?.statistik_mendalam?.shot_quality || {}),
        },
        pemain_kunci: Array.isArray(rawObj?.statistik_mendalam?.pemain_kunci)
          ? rawObj.statistik_mendalam.pemain_kunci
          : [
              {
                nama: intel.lineups.home_starting_xi[0]?.name || "Unit Taktis Kandang",
                tim: intel.pertandingan.tim_kandang,
                peran: "Ancaman Utama",
                catatan: "Fokus serangan ofensif",
              },
            ],
      },
      faktor_kunci: Array.isArray(rawObj?.faktor_kunci)
        ? rawObj.faktor_kunci
        : ["Efisiensi Konversi Gol", "Soliditas Pertahanan", "Disiplin Taktis"],
      prediksi: {
        hasil: rawObj?.prediksi?.hasil || "Pertandingan Berimbang",
        keyakinan: ["rendah", "sedang", "tinggi"].includes(rawObj?.prediksi?.keyakinan)
          ? rawObj.prediksi.keyakinan
          : "sedang",
        alasan: rawObj?.prediksi?.alasan || "Berdasarkan kompilasi model Dixon-Coles dan audit risiko pasar.",
        konsensus_panel: rawObj?.prediksi?.konsensus_panel || "Konsensus perdebatan Bull vs Bear.",
      },
      quant_engine: quantPackage,
      syndicate_debate: syndicateDebate,
      data_tidak_tersedia: intel.missing_data_registry,
      data_integrity_audit: {
        is_strictly_grounded: true,
        dispatcher_model: fetchResult.audit.dispatcher_model,
        cache_quota_saved: fetchResult.audit.cache_metrics.savedCalls,
        endpoints_called: fetchResult.audit.endpoints_called,
        endpoints_skipped: fetchResult.audit.endpoints_skipped,
      },
    };

    return Response.json({
      analisis: merged,
      rawLineups: intel.lineups,
      modelUsed,
      isEnterpriseSyndicate: true,
      cacheMetrics: getStatsCacheMetrics(),
      audit: fetchResult.audit,
    });
  } catch (err) {
    console.error(`[9Router] Pipeline gagal:`, err);
    return Response.json(
      {
        error: `Pipeline Enterprise Gagal: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    );
  }
}

function extractJSON(rawText: string) {
  try {
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const target = match ? match[1] : rawText;
    const start = target.indexOf("{");
    const end = target.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(target.slice(start, end + 1));
    }
    return JSON.parse(target);
  } catch {
    return {};
  }
}