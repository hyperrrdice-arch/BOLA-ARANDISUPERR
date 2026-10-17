import { z } from "zod";
import type { Analysis } from "@/lib/agent/schemas";
import type { PlannerTrace } from "@/lib/agent/schemas";

/**
 * ============================================================================
 * ANALYSIS VIEW-MODEL SCHEMA (BFF LAYER)
 * ============================================================================
 * Skema data bersih yang dikirim ke frontend client.
 * Frontend bertindak sebagai dumb renderer tanpa menggali path dalam.
 * Menghilangkan redundansi data dan memotong payload mentah (rawLineups, dll).
 */

export const MatchViewSchema = z.object({
  id: z.string(),
  home: z.string(),
  away: z.string(),
  kickoff_wib: z.string(),
  competition: z.string(),
  venue: z.string().nullable().optional(),
  wasit: z.string().nullable().optional(),
});

export const RingkasanViewSchema = z.object({
  verdict: z.string(),
  prediksi: z.string(),
  keyakinan: z.string(),
  alasan: z.string(),
  faktor_kunci: z.array(z.string()),
  integrity: z.object({
    gaps: z.array(z.string()),
    status_estimasi: z.array(z.string()),
    cache_quota_saved: z.number().optional(),
    dispatcher_model: z.string().optional(),
  }),
});

export const KuantitatifHeroSchema = z.object({
  prob: z.object({
    home: z.number(),
    draw: z.number(),
    away: z.number(),
  }),
  fair_odds: z.object({
    home: z.number(),
    draw: z.number(),
    away: z.number(),
  }),
  ev_teratas: z
    .object({
      market: z.string(),
      selection: z.string(),
      ev_percentage: z.string(),
      odds: z.number(),
      fair_odds: z.number(),
    })
    .nullable(),
});

export const BuktiItemSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
});

export const ValueBetItemSchema = z.object({
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
});

export const KuantitatifDetailSchema = z.object({
  kelly: z.object({
    simulator: z.any().nullable().optional(),
    tabel: z.array(ValueBetItemSchema),
  }),
  metode: z.object({
    baseline: z.any().optional(),
    shrinkage: z.any().optional(),
    dixon_coles: z.any().optional(),
    shin_kelly: z.any().optional(),
    calibration_metadata: z.any().optional(),
  }),
  splits: z.object({
    form_kandang: z.string(),
    form_tamu: z.string(),
    rekor_kandang_spesifik: z.string(),
    rekor_tandang_spesifik: z.string(),
    npxg_kandang: z.number().nullable(),
    npxg_tamu: z.number().nullable(),
  }),
  pasar_lain: z.array(z.any()).optional(),
});

export const KuantitatifViewSchema = z.object({
  hero: KuantitatifHeroSchema,
  bukti: z.array(BuktiItemSchema).max(5),
  detail: KuantitatifDetailSchema,
});

export const OddsDislocationSchema = z.object({
  ringkasan_1x2: z.string(),
  asian_handicap: z.string().nullable().optional(),
  over_under: z.string().nullable().optional(),
  btts: z.string().nullable().optional(),
  benchmarks: z
    .object({
      home: z.number().optional(),
      draw: z.number().optional(),
      away: z.number().optional(),
      source: z.string().optional(),
    })
    .nullable()
    .optional(),
  fair: z
    .object({
      home: z.number().optional(),
      draw: z.number().optional(),
      away: z.number().optional(),
    })
    .nullable()
    .optional(),
});

export const OddsViewSchema = z.object({
  bookmakers: z.array(z.any()),
  dislocation: OddsDislocationSchema,
  smart_money: z.string(),
});

export const PersonaDebateItemSchema = z.object({
  role: z.string(),
  model: z.string(),
  ringkasan: z.string(),
  argumen: z.array(z.string()),
});

export const DebatViewSchema = z.object({
  consensus: z.string(),
  supreme: z
    .object({
      verdict: z.string(),
      recommended_market: z.string(),
      confidence_tier: z.string(),
      stake_fraction: z.string(),
    })
    .nullable(),
  persona: z.array(PersonaDebateItemSchema),
  dual_bench: z.any().nullable().optional(),
});

export const ThinkingStepSchema = z.object({
  step: z.number(),
  tool: z.string(),
  alasan: z.string(),
  trigger: z.string().nullable().optional(),
  coverage: z.any().optional(),
});

export const ThinkingViewSchema = z.object({
  steps: z.array(ThinkingStepSchema),
  stop_reason: z.string(),
  durasi_ms: z.number().nullable().optional(),
});

export const AnalysisViewSchema = z.object({
  match: MatchViewSchema,
  ringkasan: RingkasanViewSchema,
  kuantitatif: KuantitatifViewSchema,
  odds: OddsViewSchema,
  debat: DebatViewSchema,
  thinking: ThinkingViewSchema,
  markets: z.any().nullable(),
});

export type AnalysisView = z.infer<typeof AnalysisViewSchema>;

// ============================================================================
// HELPER FORMATTING
// ============================================================================

function formatKickoffWIB(utcDateStr?: string | null): string {
  if (!utcDateStr) return "-";
  try {
    const d = new Date(utcDateStr);
    if (isNaN(d.getTime())) return utcDateStr;
    return d.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB";
  } catch {
    return utcDateStr;
  }
}

function formatCapitalKeyakinan(k?: string | null): string {
  if (!k) return "Sedang";
  const lower = k.toLowerCase();
  if (lower.includes("tinggi")) return "Tinggi";
  if (lower.includes("rendah")) return "Rendah";
  return "Sedang";
}

// ============================================================================
// PURE MAPPER FUNCTION: mapPipelineToView()
// ============================================================================
/**
 * Mengubah response mentah pipeline / Analysis menjadi AnalysisView yang bersih.
 * PURE FUNCTION — nol I/O, nol kalkulasi ulang angka (angka di-copy apa adanya).
 */
export function mapPipelineToView(input: {
  analisis: Analysis;
  plannerTrace?: PlannerTrace | null;
  rawLineups?: any;
  audit?: any;
  cacheMetrics?: any;
  durationMs?: number | null;
}): AnalysisView {
  const { analisis: a, plannerTrace, audit, durationMs } = input;
  const q = a.quant_engine;
  const dc = q?.dixon_coles;
  const d = a.syndicate_debate;

  // 1. MATCH SECTION
  const match: z.infer<typeof MatchViewSchema> = {
    id: String(a.pertandingan.id),
    home: a.pertandingan.tim_kandang,
    away: a.pertandingan.tim_tamu,
    kickoff_wib: formatKickoffWIB(a.pertandingan.waktu),
    competition: a.pertandingan.kompetisi,
    venue: a.pertandingan.venue ?? null,
    wasit: a.pertandingan.wasit ?? a.wasit_analisis?.nama ?? null,
  };

  // 2. RINGKASAN SECTION
  const supreme = d?.dual_judgement;
  const verdictText =
    supreme?.supreme_verdict ||
    d?.arbiter_verdict?.recommended_market ||
    a.prediksi.konsensus_panel ||
    a.prediksi.hasil ||
    "PASS_NO_BET";

  const ringkasan: z.infer<typeof RingkasanViewSchema> = {
    verdict: verdictText,
    prediksi: a.prediksi.hasil,
    keyakinan: formatCapitalKeyakinan(a.prediksi.keyakinan),
    alasan: a.prediksi.alasan,
    faktor_kunci: Array.isArray(a.faktor_kunci) ? a.faktor_kunci : [],
    integrity: {
      gaps: plannerTrace?.gaps_remaining || a.data_tidak_tersedia || [],
      status_estimasi: (q as any)?.calibration_metadata?.is_estimated_telemetry
        ? ["Telemetri rolling form menggunakan estimasi prior"]
        : [],
      cache_quota_saved:
        a.data_integrity_audit?.cache_quota_saved ?? audit?.cache_metrics?.savedCalls ?? 0,
      dispatcher_model:
        a.data_integrity_audit?.dispatcher_model ?? audit?.dispatcher_model ?? "ag/gemini-3.8-flash",
    },
  };

  // 3. KUANTITATIF SECTION
  const valueBets = Array.isArray(q?.value_bets) ? q.value_bets : [];
  const topEv = valueBets.find((vb) => vb.is_positive_ev) || (valueBets.length > 0 ? valueBets[0] : null);

  const hero: z.infer<typeof KuantitatifHeroSchema> = {
    prob: {
      home: dc?.prob_home_win ?? 0,
      draw: dc?.prob_draw ?? 0,
      away: dc?.prob_away_win ?? 0,
    },
    fair_odds: {
      home: dc?.fair_odds?.home ?? 0,
      draw: dc?.fair_odds?.draw ?? 0,
      away: dc?.fair_odds?.away ?? 0,
    },
    ev_teratas: topEv
      ? {
          market: topEv.market_name,
          selection: topEv.selection,
          ev_percentage: topEv.ev_percentage,
          odds: topEv.bookmaker_odds,
          fair_odds: topEv.fair_odds,
        }
      : null,
  };

  // Maksimal 5 baris bukti terpenting
  const topScore =
    Array.isArray(dc?.top_scorelines) && dc.top_scorelines.length > 0
      ? dc.top_scorelines[0]
      : null;
  const topScoreStr = topScore
    ? `${topScore.score || `${topScore.homeGoals}-${topScore.awayGoals}`} (${
        topScore.percentage || `${Math.round((topScore.probability || topScore.prob || 0) * 100)}%`
      })`
    : "-";

  const bukti: z.infer<typeof BuktiItemSchema>[] = [
    {
      label: "Proyeksi xG (Kandang vs Tamu)",
      value: `${(dc?.lambda_home_xg ?? 0).toFixed(2)} vs ${(dc?.mu_away_xg ?? 0).toFixed(2)}`,
    },
    {
      label: "Peluang Over 2.5 Gol",
      value: `${((dc?.over_2_5_prob ?? 0) * 100).toFixed(1)}%`,
    },
    {
      label: "Peluang Kedua Tim Cetak Gol (BTTS)",
      value: `${((dc?.btts_yes_prob ?? 0) * 100).toFixed(1)}%`,
    },
    {
      label: "Ekspektasi Total Gol",
      value: `${(dc?.expected_total_goals ?? 0).toFixed(2)} gol`,
    },
    {
      label: "Skor Paling Mungkin",
      value: topScoreStr,
    },
  ].slice(0, 5);

  const detail: z.infer<typeof KuantitatifDetailSchema> = {
    kelly: {
      simulator: null,
      tabel: valueBets.map((vb) => ({
        market_name: vb.market_name,
        selection: vb.selection,
        bookmaker_odds: vb.bookmaker_odds,
        fair_odds: vb.fair_odds,
        expected_value: vb.expected_value,
        ev_percentage: vb.ev_percentage,
        is_positive_ev: Boolean(vb.is_positive_ev),
        edge_rating: vb.edge_rating || "NORMAL",
        recommended_stake_percentage: vb.recommended_stake_percentage || 0,
        rationale: vb.rationale || "-",
      })),
    },
    metode: {
      baseline: {
        lambda: dc?.lambda_home_xg,
        mu: dc?.mu_away_xg,
      },
      shrinkage: (q as any)?.calibration_metadata?.shrinkage ?? null,
      dixon_coles: {
        top_scorelines: dc?.top_scorelines ?? [],
        asian_handicap: dc?.asian_handicap ?? null,
        clean_sheet: dc?.clean_sheet ?? null,
      },
      shin_kelly: q?.vig_stripping ?? null,
      calibration_metadata: (q as any)?.calibration_metadata ?? null,
    },
    splits: {
      form_kandang: a.form_dan_split?.form_kandang || "-",
      form_tamu: a.form_dan_split?.form_tamu || "-",
      rekor_kandang_spesifik: a.form_dan_split?.rekor_kandang_spesifik || "-",
      rekor_tandang_spesifik: a.form_dan_split?.rekor_tandang_spesifik || "-",
      npxg_kandang: a.statistik_mendalam?.shot_quality?.npxg_kandang ?? null,
      npxg_tamu: a.statistik_mendalam?.shot_quality?.npxg_tamu ?? null,
    },
    pasar_lain: q?.special_markets ? [q.special_markets] : [],
  };

  const kuantitatif: z.infer<typeof KuantitatifViewSchema> = {
    hero,
    bukti,
    detail,
  };

  // 4. ODDS SECTION
  let benchmarkOdds: { home?: number; draw?: number; away?: number; source?: string } | null = null;
  if (a.probabilitas_pasar && a.probabilitas_pasar.kandang > 0) {
    benchmarkOdds = {
      home: +(100 / a.probabilitas_pasar.kandang).toFixed(2),
      draw: +(100 / a.probabilitas_pasar.seri).toFixed(2),
      away: +(100 / a.probabilitas_pasar.tandang).toFixed(2),
      source: "Consensus Probabilities",
    };
  }

  const odds: z.infer<typeof OddsViewSchema> = {
    bookmakers: [], // diisi di consumer atau via /api/odds
    dislocation: {
      ringkasan_1x2: a.bursa_pasar?.ringkasan_1x2 || "-",
      asian_handicap: a.bursa_pasar?.asian_handicap ?? null,
      over_under: a.bursa_pasar?.over_under ?? null,
      btts: a.bursa_pasar?.btts ?? null,
      benchmarks: benchmarkOdds,
      fair: dc?.fair_odds ?? null,
    },
    smart_money: a.bursa_pasar?.pergerakan_smart_money || "Aliran pasar stabil dalam batas wajar.",
  };

  // 5. DEBAT SECTION
  const persona: z.infer<typeof PersonaDebateItemSchema>[] = [];
  if (d?.bull_case) {
    persona.push({
      role: "Bull Case (Skenario Positif)",
      model: d.bull_case.model,
      ringkasan: d.bull_case.thesis,
      argumen: d.bull_case.key_drivers,
    });
  }
  if (d?.neutral_case) {
    persona.push({
      role: "Neutral Case (Skenario Keseimbangan)",
      model: d.neutral_case.model,
      ringkasan: d.neutral_case.thesis,
      argumen: d.neutral_case.empirical_drivers,
    });
  }
  if (d?.bear_case) {
    persona.push({
      role: "Bear Case (Skenario Risiko / Jebakan)",
      model: d.bear_case.model,
      ringkasan: d.bear_case.thesis,
      argumen: d.bear_case.trap_warnings,
    });
  }
  if (d?.arbiter_verdict) {
    persona.push({
      role: "Arbiter Konsorsium (Chief Risk Officer)",
      model: d.arbiter_verdict.model,
      ringkasan: d.arbiter_verdict.chief_risk_officer_synthesis,
      argumen: [
        `Rekomendasi Pasar: ${d.arbiter_verdict.recommended_market}`,
        `Tingkat Keyakinan: ${d.arbiter_verdict.confidence_tier}`,
        `Ukuran Stake Disarankan: ${d.arbiter_verdict.recommended_stake_fraction}`,
      ],
    });
  }

  const debat: z.infer<typeof DebatViewSchema> = {
    consensus: supreme?.consensus_level || a.prediksi.konsensus_panel || "CONCURRING",
    supreme: supreme
      ? {
          verdict: supreme.supreme_verdict,
          recommended_market: supreme.final_recommended_market,
          confidence_tier: supreme.final_confidence_tier,
          stake_fraction: supreme.final_stake_fraction,
        }
      : null,
    persona,
    dual_bench: supreme
      ? {
          judgement_1: supreme.judgement_1,
          judgement_2: supreme.judgement_2,
          consensus_level: supreme.consensus_level,
        }
      : null,
  };

  // 6. THINKING PLANNER SECTION
  const traceSteps = plannerTrace?.steps || [];
  const thinking: z.infer<typeof ThinkingViewSchema> = {
    steps: traceSteps.map((s) => ({
      step: s.step,
      tool: s.action,
      alasan: s.alasan || "(tanpa alasan)",
      trigger: s.trigger ?? null,
      coverage: null,
    })),
    stop_reason: plannerTrace?.stop_reason || "verdict",
    durasi_ms: durationMs ?? null,
  };

  // 7. HASIL VIEW-MODEL LENGKAP
  const candidate: AnalysisView = {
    match,
    ringkasan,
    kuantitatif,
    odds,
    debat,
    thinking,
    markets: null,
  };

  // Validasi Zod fail-fast agar deterministik & tidak ada field cacat
  return AnalysisViewSchema.parse(candidate);
}
