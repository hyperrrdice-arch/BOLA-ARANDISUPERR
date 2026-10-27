import { z } from "zod";
import type { Analysis } from "@/lib/agent/schemas";
import type { PlannerTrace } from "@/lib/agent/schemas";
import { applyFallbackGuard } from "@/lib/quant/fallback-guard";
import { formatHalfEvidenceRow, type HalfMatchup } from "@/lib/quant/half-profile";
import { formatMomentumEvidenceRow, type MomentumMatchup } from "@/lib/quant/momentum";

/**
 * ============================================================================
 * ANALYSIS VIEW-MODEL SCHEMA (BFF LAYER)
 * ============================================================================
 * Skema data bersih yang dikirim ke frontend client.
 * Frontend bertindak sebagai dumb renderer tanpa menggali path dalam.
 * Menghilangkan redundansi data dan memotong payload mentah (rawLineups, dll).
 *
 * Aturan fidelitas angka (REVISI): angka di-COPY apa adanya. Konversi tampilan
 * hanya lewat helper sadar-skala di bawah (sumber desimal vs sumber persen
 * HARUS beda helper — kasus nyata: top_scorelines.prob sudah skala persen
 * dari lib/quant/dixon-coles.ts sehingga dikali 100 lagi menjadi salah 100x).
 * Tidak ada nilai default karangan saat field absen: null / "—" apa adanya.
 */

export const MatchViewSchema = z.object({
  id: z.string(),
  home: z.string(),
  away: z.string(),
  kickoff_wib: z.string(),
  competition: z.string(),
  venue: z.string().nullable().optional(),
  wasit: z.string().nullable().optional(),
  /** Kartu rata-rata wasit (salinan wasit_analisis.rata_rata_kartu) — dipakai payload /api/betting. */
  wasit_kartu: z.number().nullable().optional(),
  /** status_lineup: "resmi" | "prediksi" | "belum_tersedia". */
  status_lineup: z.string().nullable().optional(),
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
  }),
});

export const KuantitatifHeroSchema = z.object({
  prob: z.object({
    home: z.number().nullable(),
    draw: z.number().nullable(),
    away: z.number().nullable(),
  }),
  fair_odds: z.object({
    home: z.number().nullable(),
    draw: z.number().nullable(),
    away: z.number().nullable(),
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
  edge_rating: z.string().nullable(),
  recommended_stake_percentage: z.number().nullable(),
  rationale: z.string().nullable(),
});

export const KuantitatifDetailSchema = z.object({
  kelly: z.object({
    tabel: z.array(ValueBetItemSchema),
  }),
  metode: z.object({
    baseline: z.any().optional(),
    shrinkage: z.any().optional(),
    /** Salinan UTUH quant_engine.dixon_coles — sumber angka bagi konsumen (OneXBet, panel metode). */
    dixon_coles: z.any().nullable().optional(),
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
    klasemen: z.string().nullable().optional(),
    pemain_kunci: z.array(z.any()).optional(),
    coverage_liga: z.any().nullable().optional(),
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
  /** Salinan probabilitas_pasar (persen, {kandang,seri,tandang}) — dikirim utuh ke /api/betting. */
  pasar_konsensus: z
    .object({
      kandang: z.number(),
      seri: z.number(),
      tandang: z.number(),
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
  coverage: z.any().nullable().optional(),
  /** Wall-clock tool ini (ms) — atribusi latensi per stage. */
  durasi_ms: z.number().nullable().optional(),
  /** Pecahan durasi internal per stage/persona debat (ms). */
  stage_timings: z.record(z.string(), z.number()).nullable().optional(),
});

export const ThinkingViewSchema = z.object({
  steps: z.array(ThinkingStepSchema),
  stop_reason: z.string(),
  durasi_ms: z.number().nullable().optional(),
  /** Atribusi waktu loop: total, waktu tool, dan sisa (model planner + overhead antar-step). */
  planner: z
    .object({
      loop_ms: z.number(),
      tool_ms: z.number(),
      planner_overhead_ms: z.number(),
      step_timings: z.array(z.object({ ms: z.number(), tools: z.number() })),
    })
    .nullable()
    .optional(),
});

export const DataQualitySchema = z.object({
  home_source: z.string().nullable(),
  away_source: z.string().nullable(),
  is_fallback_involved: z.boolean(),
});

export const FallbackGuardSchema = z.object({
  skipped: z.boolean(),
  reason: z.string(),
  edge: z.number().nullable(),
  threshold: z.number(),
  original_verdict: z.string(),
  original_pick: z
    .object({
      market_name: z.string(),
      selection: z.string(),
      bookmaker_odds: z.number(),
      fair_odds: z.number(),
      ev_percentage: z.string(),
    })
    .nullable(),
  fallback_side: z.enum(["home", "away", "both"]).nullable(),
});

export const AnalysisViewSchema = z.object({
  match: MatchViewSchema,
  ringkasan: RingkasanViewSchema,
  kuantitatif: KuantitatifViewSchema,
  odds: OddsViewSchema,
  debat: DebatViewSchema,
  thinking: ThinkingViewSchema,
  markets: z.any().nullable(),
  // Penanda jujur: false = ada bagian yang tidak grounded (fallback/template).
  // Client WAJIB bisa membedakan hasil degradasi dari analisis penuh.
  is_strictly_grounded: z.boolean(),
  // Task 1 parlay-pivot (additive): guard fallback-source + flag kualitas data.
  // Field lama (ringkasan.verdict, pick) tidak dihapus — aslinya tercatat di fallback_guard.
  data_quality: DataQualitySchema.optional(),
  fallback_guard: FallbackGuardSchema.optional(),
});

export type AnalysisView = z.infer<typeof AnalysisViewSchema>;

// Tipe bantu untuk komponen UI (tidak lagi butuh `any` di kode presentasi).
export type AnalysisKuantitatifValueBet = z.infer<typeof ValueBetItemSchema>;

// ============================================================================
// HELPER FORMATTING — SADAR SKALA, TANPA NILAI KARANGAN
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
  if (!k) return "-";
  const lower = k.toLowerCase();
  if (lower.includes("tinggi")) return "Tinggi";
  if (lower.includes("rendah")) return "Rendah";
  if (lower.includes("sedang")) return "Sedang";
  return k; // nilai tak dikenal ditampilkan apa adanya, bukan dipaksa "Sedang"
}

/** Persen dari sumber skala DESIMAL (0.439 → "43.9%"). */
function pctFromDecimal(x?: number | null, digits = 1): string {
  return x == null ? "—" : `${(x * 100).toFixed(digits)}%`;
}

/** Persen dari sumber yang SUDAH skala PERSEN (13.2 → "13.2%"). JANGAN dikali 100 lagi. */
function pctFromPercent(x?: number | null, digits = 1): string {
  return x == null ? "—" : `${x.toFixed(digits)}%`;
}

function numOrDash(x?: number | null, digits = 2): string {
  return x == null ? "—" : x.toFixed(digits);
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
  durationMs?: number | null;
}): AnalysisView {
  const { analisis: a, plannerTrace, durationMs } = input;
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
    wasit_kartu: a.wasit_analisis?.rata_rata_kartu ?? null,
    status_lineup: a.taktik_dan_lineup?.status_lineup ?? null,
  };

  // 2. RINGKASAN SECTION
  const supreme = d?.dual_judgement;
  const verdictText =
    supreme?.supreme_verdict ||
    d?.arbiter_verdict?.recommended_market ||
    a.prediksi.konsensus_panel ||
    a.prediksi.hasil ||
    "PASS_NO_BET";

  // Task 1 parlay-pivot: guard fallback-source deterministik (bukan LLM).
  // Quant frozen — guard hanya membaca calibration_metadata + value_bets,
  // tidak menghitung ulang prob/fair. Pick lama tercatat di fallback_guard.
  const guard = applyFallbackGuard({
    calibration: (q as any)?.calibration_metadata ?? null,
    valueBets: Array.isArray(q?.value_bets) ? q.value_bets : [],
    verdict: verdictText,
    homeTeam: a.pertandingan.tim_kandang,
    awayTeam: a.pertandingan.tim_tamu,
  });

  const ringkasan: z.infer<typeof RingkasanViewSchema> = {
    verdict: guard.verdict,
    prediksi: a.prediksi.hasil,
    keyakinan: formatCapitalKeyakinan(a.prediksi.keyakinan),
    alasan: a.prediksi.alasan,
    faktor_kunci: Array.isArray(a.faktor_kunci) ? a.faktor_kunci : [],
    integrity: {
      gaps: plannerTrace?.gaps_remaining || a.data_tidak_tersedia || [],
      status_estimasi: (q as any)?.calibration_metadata?.is_estimated_telemetry
        ? ["Telemetri rolling form menggunakan estimasi prior"]
        : [],
    },
  };

  // 3. KUANTITATIF SECTION
  const valueBets = Array.isArray(q?.value_bets) ? q.value_bets : [];
  const topEv = valueBets.find((vb) => vb.is_positive_ev) ?? null;

  const hero: z.infer<typeof KuantitatifHeroSchema> = {
    prob: {
      home: dc?.prob_home_win ?? null,
      draw: dc?.prob_draw ?? null,
      away: dc?.prob_away_win ?? null,
    },
    fair_odds: {
      home: dc?.fair_odds?.home ?? null,
      draw: dc?.fair_odds?.draw ?? null,
      away: dc?.fair_odds?.away ?? null,
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

  // Maksimal 5 baris bukti terpenting.
  // PERHATIAN SKALA: top_scorelines.prob dari lib/quant/dixon-coles.ts SUDAH
  // persen (mis. 13.2 = 13.2%). Field `percentage` bila ada = string siap tampil.
  const topScore =
    Array.isArray(dc?.top_scorelines) && dc.top_scorelines.length > 0
      ? dc.top_scorelines[0]
      : null;
  const topScoreStr = topScore
    ? `${topScore.score ?? `${topScore.homeGoals ?? "?"}-${topScore.awayGoals ?? "?"}`} (${
        topScore.percentage ?? pctFromPercent(topScore.prob)
      })`
    : "—";

  const bukti: z.infer<typeof BuktiItemSchema>[] = [
    {
      label: "Proyeksi xG (Kandang vs Tamu)",
      value: `${numOrDash(dc?.lambda_home_xg)} vs ${numOrDash(dc?.mu_away_xg)}`,
    },
    {
      label: "Peluang Over 2.5 Gol",
      value: pctFromDecimal(dc?.over_2_5_prob),
    },
    {
      label: "Peluang Kedua Tim Cetak Gol (BTTS)",
      value: pctFromDecimal(dc?.btts_yes_prob),
    },
    {
      label: "Ekspektasi Total Gol",
      value: dc?.expected_total_goals == null ? "—" : `${dc.expected_total_goals.toFixed(2)} gol`,
    },
    {
      label: "Skor Paling Mungkin",
      value: topScoreStr,
    },
  ].slice(0, 5);

  // Task 2 offline-depth: profil tempo babak sebagai baris bukti, TETAP ≤5.
  // Hanya saat half_profile ada + minimal satu tim cukup data; baris yang
  // diganti = "Ekspektasi Total Gol" (redundan: ≈ jumlah Proyeksi xG di baris 1,
  // angka aslinya tetap utuh di detail.metode.dixon_coles). Tanpa half_profile
  // (fixture lama) output identik seperti sebelumnya — prob/fair tak tersentuh.
  const halfProfile = (q as any)?.half_profile as HalfMatchup | undefined;
  const halfRow = halfProfile
    ? formatHalfEvidenceRow(halfProfile, a.pertandingan?.tim_kandang, a.pertandingan?.tim_tamu)
    : null;
  if (halfRow) {
    bukti[3] = halfRow;
  }

  // Task 3 offline-depth: momentum last-3 vs matches 4-6 sebagai baris bukti,
  // TETAP ≤5. Baris yang diganti = paling redundan yang tersisa: bila half
  // sudah menempati slot "Ekspektasi Total Gol", yang diganti = "Skor Paling
  // Mungkin" (probabilitas satu scoreline, paling tidak actionable); bila half
  // absen, yang diganti = "Ekspektasi Total Gol" (≅ jumlah Proyeksi xG baris 1).
  // Tanpa momentum (fixture lama / kedua tim tipis) output identik seperti
  // sebelumnya — prob/fair tak tersentuh.
  const momentum = (q as any)?.momentum as MomentumMatchup | undefined;
  const momentumRow = momentum
    ? formatMomentumEvidenceRow(momentum, a.pertandingan?.tim_kandang, a.pertandingan?.tim_tamu)
    : null;
  if (momentumRow) {
    bukti[halfRow ? 4 : 3] = momentumRow;
  }

  const detail: z.infer<typeof KuantitatifDetailSchema> = {
    kelly: {
      tabel: valueBets.map((vb) => ({
        market_name: vb.market_name,
        selection: vb.selection,
        bookmaker_odds: vb.bookmaker_odds,
        fair_odds: vb.fair_odds,
        expected_value: vb.expected_value,
        ev_percentage: vb.ev_percentage,
        is_positive_ev: Boolean(vb.is_positive_ev),
        edge_rating: vb.edge_rating ?? null,
        recommended_stake_percentage: vb.recommended_stake_percentage ?? null,
        rationale: vb.rationale ?? null,
      })),
    },
    metode: {
      baseline: {
        lambda: dc?.lambda_home_xg ?? null,
        mu: dc?.mu_away_xg ?? null,
      },
      shrinkage: (q as any)?.calibration_metadata?.shrinkage_weights ?? null,
      dixon_coles: dc ?? null,
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
      klasemen: a.klasemen ?? null,
      pemain_kunci: a.statistik_mendalam?.pemain_kunci ?? [],
      coverage_liga: a.coverage_liga ?? null,
    },
    pasar_lain: q?.special_markets ? [q.special_markets] : [],
  };

  const kuantitatif: z.infer<typeof KuantitatifViewSchema> = {
    hero,
    bukti,
    detail,
  };

  // 4. ODDS SECTION — pasar_konsensus disalin apa adanya (persen integer),
  // tanpa konversi ke implied odds di mapper (perhitungan = ranah display/UI).
  const odds: z.infer<typeof OddsViewSchema> = {
    dislocation: {
      ringkasan_1x2: a.bursa_pasar?.ringkasan_1x2 || "-",
      asian_handicap: a.bursa_pasar?.asian_handicap ?? null,
      over_under: a.bursa_pasar?.over_under ?? null,
      btts: a.bursa_pasar?.btts ?? null,
      pasar_konsensus: a.probabilitas_pasar
        ? {
            kandang: a.probabilitas_pasar.kandang,
            seri: a.probabilitas_pasar.seri,
            tandang: a.probabilitas_pasar.tandang,
          }
        : null,
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
    steps: traceSteps.map((s) => {
      const step = s as { coverage?: unknown; durasi_ms?: number; stage_timings?: Record<string, number> };
      return {
        step: s.step,
        tool: s.action,
        alasan: s.alasan || "(tanpa alasan)",
        trigger: s.trigger ?? null,
        coverage: step.coverage ?? null,
        durasi_ms: typeof step.durasi_ms === "number" ? step.durasi_ms : null,
        stage_timings: step.stage_timings ?? null,
      };
    }),
    stop_reason: plannerTrace?.stop_reason || "verdict",
    durasi_ms: durationMs ?? null,
    planner: (plannerTrace as { planner?: z.infer<typeof ThinkingViewSchema>["planner"] })?.planner ?? null,
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
    // Unknown = tidak grounded (konservatif & jujur) — jangan pernah klaim grounded tanpa bukti
    is_strictly_grounded: a.data_integrity_audit?.is_strictly_grounded === true,
    data_quality: guard.data_quality,
    fallback_guard: guard.fallback_guard,
  };

  // Validasi Zod fail-fast agar deterministik & tidak ada field cacat
  return AnalysisViewSchema.parse(candidate);
}
