/**
 * Runnable check: mapPipelineToView() (lib/view/analysis-view.ts)
 *
 * Tujuan: membuktikan (1) angka disalin apa adanya tanpa salah skala,
 * (2) field mentah tidak bocor ke client, (3) mapper tidak mengarang nilai
 * saat field absen (null / "—", bukan 0 / "-").
 *
 * Gate realisme: fixture WAJIB lolos AnalysisSchema.parse — kalau nama field
 * fixture meleset dari schema asli, test ini gagal (insiden sebelumnya: fixture
 * memakai `lambda`/`mu`/`kelly_stake_full` sehingga assert palsu lolos).
 *
 * Jalankan: npx tsx scripts/test-view-mapper.ts
 */
import {
  mapPipelineToView,
  AnalysisViewSchema,
  type AnalysisView,
} from "../lib/view/analysis-view";
import { AnalysisSchema, PlannerTraceSchema } from "../lib/agent/schemas";
import type { z } from "zod";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

// ============================================================================
// FIXTURE — skala nilai mengikuti sumber asli:
//   - prob_*_win, over_2_5_prob, btts_yes_prob, lambda/mu = desimal
//   - top_scorelines.prob = SUDAH PERSEN (lib/quant/dixon-coles.ts:307, mis. 13.2 = 13.2%)
//   - probabilitas_pasar = persen integer (lib/agent/llm.ts, dari vig fair_prob)
//   - ev_percentage = string siap tampil ("+8.2%")
// ============================================================================

const fixtureAnalisis = {
  pertandingan: {
    id: "mt_1",
    tim_kandang: "Shimizu S-Pulse",
    tim_tamu: "Gamba Osaka",
    waktu: "2026-10-17T04:00:00Z",
    kompetisi: "Japan. J1 League",
    venue: "Nihondaira Stadium",
    wasit: "H. Sato",
  },
  wasit_analisis: {
    nama: "H. Sato",
    rata_rata_kartu: 4.2,
    total_kartu_kuning: 42,
    total_kartu_merah: 2,
    level_ketegasan: "sedang" as const,
    catatan: "Cukup tegas, rata-rata 4.2 kartu per laga.",
  },
  taktik_dan_lineup: {
    formasi_kandang: "4-2-3-1",
    formasi_tamu: "4-4-2",
    status_lineup: "prediksi" as const,
    starting_xi_kandang: [{ name: "Pemain A", pos: "FW", num: 9 }],
    starting_xi_tamu: [{ name: "Pemain B", pos: "GK", num: 1 }],
    ulasan_benturan_taktik: "Kandang menekan lewat sayap.",
  },
  coverage_liga: { has_xg: true, has_odds: true, has_shotmap: false, has_player_stats: true },
  form_dan_split: {
    form_kandang: "W-D-L-W-W",
    form_tamu: "L-L-D-W-D",
    rekor_kandang_spesifik: "Kandang: 5 menang dari 8",
    rekor_tandang_spesifik: "Tandang: 2 menang dari 8",
  },
  klasemen: "Shimizu #8 (32 poin) vs Gamba #5 (38 poin)",
  bursa_pasar: {
    ringkasan_1x2: "Kandang 2.10 / Seri 3.40 / Tamu 3.60",
    asian_handicap: "Shimizu -0.25",
    over_under: "Line 2.5",
    btts: "Ya 1.95",
    pergerakan_smart_money: "Aliran dana menguat ke pasar Under.",
  },
  probabilitas_pasar: { kandang: 46, seri: 28, tandang: 26 },
  statistik_mendalam: {
    shot_quality: { npxg_kandang: 1.32, npxg_tamu: 1.08, catatan: "npxG dari shotmap terverifikasi." },
    pemain_kunci: [
      { nama: "Pemain A", tim: "Shimizu S-Pulse", peran: "Finisher", catatan: "xG per 90 tertinggi." },
    ],
  },
  faktor_kunci: ["Rekor kandang kuat", "Lini tengah tamu rapuh"],
  prediksi: {
    hasil: "1-1",
    keyakinan: "sedang" as const,
    alasan: "Keseimbangan xG tipis; kedua tim punya peluang.",
    konsensus_panel: "DISSENT",
  },
  quant_engine: {
    dixon_coles: {
      lambda_home_xg: 1.41,
      mu_away_xg: 1.03,
      prob_home_win: 0.4516,
      prob_draw: 0.2784,
      prob_away_win: 0.27,
      fair_odds: { home: 2.21, draw: 3.59, away: 3.7 },
      over_2_5_prob: 0.439,
      btts_yes_prob: 0.49,
      expected_total_goals: 2.43,
      // SKALA ASLI: prob sudah persen (13.2 = 13.2%) — jangan dikali 100 lagi.
      top_scorelines: [{ homeGoals: 1, awayGoals: 1, prob: 13.2 }],
      asian_handicap: { ah_0_0_dnb: { home_prob: 48.2, away_prob: 51.8, push_prob: 0 } },
      clean_sheet: { home_clean_sheet_prob: 28.1, away_clean_sheet_prob: 22.4 },
      expected_points: { home: 1.48, draw: 1.02, away: 1.05 },
    },
    vig_stripping: {
      overround: 1.055,
      margin_percentage: 5.5,
      fair_odds: { home: 2.18, draw: 3.55, away: 3.66 },
    },
    value_bets: [
      {
        market_name: "Asian Handicap 0.0",
        selection: "Shimizu S-Pulse",
        bookmaker_odds: 2.05,
        fair_odds: 1.95,
        expected_value: 0.051,
        ev_percentage: "+5.1%",
        is_positive_ev: true,
        edge_rating: "B_MODERATE",
        recommended_stake_percentage: 1.6,
        rationale: "Edge tipis dari model Poisson terkalibrasi.",
      },
      {
        market_name: "Over/Under 2.5",
        selection: "Under 2.5",
        bookmaker_odds: 1.9,
        fair_odds: 2.1,
        expected_value: -0.095,
        ev_percentage: "-9.5%",
        is_positive_ev: false,
        edge_rating: "C_LEAN",
        recommended_stake_percentage: 0,
        rationale: "Tidak ada edge pada pasar ini.",
      },
    ],
    special_markets: { corners: { over_9_5: 1.88, under_9_5: 1.92 } },
    calibration_metadata: {
      is_calibrated: true,
      league_name: "Japan. J1 League",
      telemetry_source: "rolling-form",
      shrinkage_weights: { home: 0.62, away: 0.58 },
      is_estimated_telemetry: true,
    },
  },
  syndicate_debate: {
    bull_case: {
      model: "ag/gemini-3.8-flash-high",
      thesis: "Keunggulan kandang nyata.",
      key_drivers: ["xG kandang lebih tinggi", "Form 5 laga terakhir"],
      tactical_edge: "Sayap kanan menang duel.",
    },
    neutral_case: {
      model: "bai/glm-5.3-flash",
      thesis: "Keseimbangan tipis di tengah.",
      empirical_drivers: ["xG hampir imbang", "Head-to-head seimbang"],
      equilibrium_assessment: "Tidak ada sinyal dominan.",
    },
    bear_case: {
      model: "bai/deepseek-v4.1-flash",
      thesis: "Value pasar sudah efisien.",
      trap_warnings: ["Odds kandang terlalu rendah"],
      vulnerability_audit: "Risiko rotasi pemain.",
    },
    dual_judgement: {
      judgement_1: {
        model: "ag/gemini-3.8-flash-high",
        title: "Judicial Bench I",
        verdict_summary: "Cenderung kandang namun tipis.",
        confidence_tier: "C_LEAN" as const,
        recommended_market: "Asian Handicap 0.0 Home",
        key_reasoning: "Keunggulan xG kandang 0.38.",
      },
      judgement_2: {
        model: "bai/qwen3.8-flash",
        title: "Judicial Bench II",
        verdict_summary: "Risiko imbang tinggi.",
        confidence_tier: "PASS_AVOID" as const,
        recommended_market: "PASS",
        alternative_perspective: "Disiplin bertahan tamu.",
      },
      consensus_level: "DISSENT" as const,
      supreme_verdict: "DISSENT / DISAGREEMENT: Rekomendasi PASS (Hindari taruhan).",
      final_recommended_market: "PASS",
      final_confidence_tier: "PASS_AVOID" as const,
      final_stake_fraction: "0%",
    },
    arbiter_verdict: {
      model: "ag/gemini-3.8-flash-high",
      chief_risk_officer_synthesis: "Pertentangan risiko antar hakim.",
      confidence_tier: "PASS_AVOID" as const,
      recommended_market: "PASS",
      recommended_stake_fraction: "0%",
    },
  },
  data_tidak_tersedia: ["lineups", "injuries"],
  data_integrity_audit: {
    is_strictly_grounded: true,
    dispatcher_model: "bai/qwen3.8-27b (fast heuristic fallback)",
    cache_quota_saved: 12,
    endpoints_called: ["/football/matches/mt_1"],
    endpoints_skipped: ["/football/matches/mt_1/shotmap"],
  },
} as unknown as z.infer<typeof AnalysisSchema>;

const fixtureTrace = PlannerTraceSchema.parse({
  steps: [
    {
      step: 1,
      action: "check_data_integrity",
      alasan: "Validasi coverage data intelijen pra-laga.",
      trigger: null,
      coverage: { complete: false, gaps: ["lineups"], triggers: ["FIELD_KOSONG"] },
    },
    {
      step: 2,
      action: "fetch_missing_intel",
      alasan: "Isi field kosong: lineups, cedera.",
      trigger: "FIELD_KOSONG",
      coverage: { complete: false, gaps: ["lineups"], triggers: ["FIELD_KOSONG"] },
    },
    {
      step: 3,
      action: "stop_with_verdict",
      alasan: "Pipeline lengkap dengan degradasi eksplisit.",
      trigger: null,
      coverage: { complete: true, gaps: [], triggers: [] },
    },
  ],
  stop_reason: "verdict",
  gaps_remaining: ["lineups"],
});

// ============================================================================
// GATE REALISME FIXTURE — kalau nama field fixture meleset dari schema asli,
// test harus gagal di sini, bukan lolos dengan angka palsu.
// ============================================================================
console.log("GATE: fixture wajib lolos AnalysisSchema.parse + PlannerTraceSchema.parse");
const gate = AnalysisSchema.safeParse(fixtureAnalisis);
if (!gate.success) {
  console.error("  issue schema:", gate.error.issues.slice(0, 6));
}
assert(gate.success, "fixture analisis valid terhadap AnalysisSchema asli");

// ============================================================================
// RUN
// ============================================================================
const view: AnalysisView = mapPipelineToView({
  analisis: fixtureAnalisis,
  plannerTrace: fixtureTrace,
  durationMs: 229900,
});

console.log("FIDELITAS ANGKA (sadar skala):");
assert(view.kuantitatif.bukti[0].value === "1.41 vs 1.03", "xG disalin apa adanya (1.41 vs 1.03)");
assert(view.kuantitatif.bukti[1].value === "43.9%", "over_2_5_prob desimal → 43.9%");
assert(view.kuantitatif.bukti[2].value === "49.0%", "btts_yes_prob desimal → 49.0%");
assert(view.kuantitatif.bukti[3].value === "2.43 gol", "expected_total_goals disalin");
assert(
  view.kuantitatif.bukti[4].value === "1-1 (13.2%)",
  "top_scorelines.prob SUDAH persen → '1-1 (13.2%)', BUKAN 1320%"
);
assert(view.kuantitatif.hero.prob.home === 0.4516, "prob home copy 1:1 (0.4516)");
assert(view.kuantitatif.hero.fair_odds.home === 2.21, "fair odds copy 1:1 (2.21)");
assert(view.odds.dislocation.pasar_konsensus?.kandang === 46, "pasar_konsensus copy persen (46), tanpa konversi odds");

console.log("KONTRAK BETTING (/api/betting match_context):");
assert(view.match.wasit_kartu === 4.2, "wasit_kartu terpetakan (4.2)");
assert(view.match.status_lineup === "prediksi", "status_lineup terpetakan");
assert(view.odds.dislocation.pasar_konsensus?.seri === 28, "probabilitas_pasar bentuk {kandang,seri,tandang} utuh");

console.log("INFO YANG DULU HILANG:");
assert(view.kuantitatif.detail.splits.npxg_kandang === 1.32, "npxg_kandang dari shot_quality (1.32), bukan lambda");
assert(view.kuantitatif.detail.splits.klasemen?.includes("#8") === true, "klasemen terpetakan");
assert((view.kuantitatif.detail.splits.pemain_kunci ?? []).length === 1, "pemain_kunci terpetakan");
assert(view.kuantitatif.detail.splits.coverage_liga?.has_xg === true, "coverage_liga terpetakan");
assert(view.kuantitatif.detail.metode.dixon_coles?.expected_points?.home === 1.48, "expected_points terbawa via copy dc utuh");
assert(view.kuantitatif.detail.metode.shrinkage?.home === 0.62, "shrinkage terbaca dari calibration_metadata.shrinkage_weights (key asli)");
assert(view.kuantitatif.detail.pasar_lain?.length === 1, "special_markets terpetakan ke pasar_lain");

console.log("ANTI-KARANGAN (field absen → null / '—', bukan 0 / '-'):");
const vbMissing = mapPipelineToView({
  analisis: {
    ...fixtureAnalisis,
    quant_engine: {
      ...fixtureAnalisis.quant_engine,
      value_bets: [{ ...fixtureAnalisis.quant_engine.value_bets[1], rationale: undefined }],
    },
  } as unknown as z.infer<typeof AnalysisSchema>,
  plannerTrace: fixtureTrace,
});
assert(vbMissing.kuantitatif.detail.kelly.tabel[0].rationale === null, "rationale absen → null, bukan '-'");
assert(view.kuantitatif.detail.kelly.tabel[1].recommended_stake_percentage === 0, "stake 0 asli dipertahankan");
const partial = mapPipelineToView({
  analisis: {
    ...fixtureAnalisis,
    quant_engine: { ...fixtureAnalisis.quant_engine, dixon_coles: {} },
  } as unknown as z.infer<typeof AnalysisSchema>,
  plannerTrace: fixtureTrace,
});
assert(partial.kuantitatif.bukti[1].value === "—", "over_2_5_prob hilang → '—', bukan '0.0%'");
assert(partial.kuantitatif.bukti[0].value === "— vs —", "xG hilang → '— vs —', bukan '0.00 vs 0.00'");
assert(partial.kuantitatif.hero.prob.home === null, "prob hero hilang → null, bukan 0");

console.log("KEBOCORAN FIELD MENTAH (tidak boleh ada di root):");
const root = view as unknown as Record<string, unknown>;
for (const rawKey of ["analisis", "rawLineups", "modelUsed", "isEnterpriseSyndicate", "cacheMetrics", "audit", "plannerTrace"]) {
  assert(!(rawKey in root), `Field mentah '${rawKey}' TIDAK bocor ke root AnalysisView`);
}
assert(!("benchmarks" in view.odds.dislocation), "benchmarks (hasil kalkulasi 100/prob) sudah dihapus dari view");
assert(!("cache_quota_saved" in view.ringkasan.integrity), "cache_quota_saved (noise operator) tidak dikirim");

console.log("THINKING PLANNER:");
assert(view.thinking.durasi_ms === 229900, "durasi_ms tercatat persis");
assert(view.thinking.steps.length === 3, "steps lengkap");
assert(view.thinking.steps[0].tool === "check_data_integrity", "tool step 1 benar");
assert(view.thinking.steps[1].trigger === "FIELD_KOSONG", "trigger re-plan terpetakan");
assert(view.thinking.steps[0].coverage?.complete === false, "coverage_check terbawa dari trace (bukan hardcode null)");
assert(view.thinking.stop_reason === "verdict", "stop_reason benar");

console.log("DEBAT & RINGKASAN:");
assert(view.debat.persona.length === 4, "4 persona (Bull, Bear, Arbiter; Neutral opsional)");
assert(view.debat.supreme?.verdict.startsWith("DISSENT") === true, "supreme verdict terisi");
assert(view.debat.dual_bench?.judgement_1.verdict_summary.includes("kandang") === true, "dual_bench utuh");
assert(view.ringkasan.prediksi === "1-1", "prediksi terpetakan");
assert(view.ringkasan.keyakinan === "Sedang", "keyakinan ternormalisasi");
assert(view.ringkasan.integrity.gaps.includes("lineups"), "gaps dari trace");

// ============================================================================
// SUMMARY
// ============================================================================
console.log(`\n${passed} lulus, ${failed} gagal`);
if (failed > 0) {
  console.error("=== TEST VIEW-MAPPER GAGAL ===");
  process.exit(1);
}
console.log("=== SEMUA PENGUJIAN mapPipelineToView LOLOS ===");
