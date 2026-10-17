import { z } from "zod";

/**
 * Skema output analisis pra-laga. Dipindahkan dari `app/api/agent/route.tsx`
 * apa adanya supaya `lib/agent/planner.ts` bisa memvalidasi verdict final
 * tanpa circular import ke route.
 */

export const PlayerItemSchema = z.object({
  name: z.string(),
  pos: z.string().default("M"),
  num: z.number().nullable().optional(),
});

export const AnalysisSchema = z.object({
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

export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * Input `stop_with_verdict` — sintesis final planner. Angka TIDAK boleh diisi
 * lewat sini; angka wajib keluar dari tool (closed-world). Field yang boleh
 * ditentukan planner hanya narasi prediksi & faktor kunci.
 */
export const VerdictInputSchema = z.object({
  prediksi: z.object({
    hasil: z.string(),
    keyakinan: z.enum(["rendah", "sedang", "tinggi"]),
    alasan: z.string(),
    konsensus_panel: z.string(),
  }),
  faktor_kunci: z.array(z.string()),
  ringkasan_perencanaan: z.string(),
});

export type VerdictInput = z.infer<typeof VerdictInputSchema>;

/** Trace eksekusi planner loop — dipakai untuk audit & UI nantinya. */
export const PlannerTraceSchema = z.object({
  steps: z.array(
    z.object({
      step: z.number(),
      action: z.string(),
      alasan: z.string(),
      trigger: z.string().nullable().optional(),
      /** Hasil evaluator coverage (lib/agent/coverage.ts) per step — disalin dari tool result. */
      coverage: z.any().nullable().optional(),
    })
  ),
  stop_reason: z.enum(["verdict", "max_steps", "error"]),
  gaps_remaining: z.array(z.string()),
});

export type PlannerTrace = z.infer<typeof PlannerTraceSchema>;
