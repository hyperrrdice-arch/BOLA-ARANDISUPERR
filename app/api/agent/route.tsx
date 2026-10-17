import { getStatsCacheMetrics } from "@/lib/stats-cache";
import { runPlannerAnalysis, type PlannerResult } from "@/lib/agent/planner";
import { AnalysisSchema } from "@/lib/agent/schemas";
import { mapPipelineToView } from "@/lib/view/analysis-view";
import { checkRateLimit, clientKeyFromReq, tooManyResponse } from "@/lib/rate-limit";
import { getFreshAnalysisRun, saveAnalysisRun } from "@/lib/db/thestats-dataset";

/** Window staleness cache hasil analisis (ms). Percobaan ulang dalam window ini dilayani dari DB. */
const ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * ============================================================================
 * PRE-MATCH ANALYST AGENT — HTTP SHELL
 * ============================================================================
 * Loop planner (plan -> act -> evaluate -> re-plan) ada di `lib/agent/planner.ts`
 * dengan tool yang membungkus pipeline existing:
 *   1. Dynamic Fetcher Agent + Zod Data Integrity Validator
 *   2. Deterministic Quant Engine (Dixon-Coles + Shin + Kelly)
 *   3. Strict Closed-World Multi-Agent Syndicate (Bull vs Bear vs Arbiter)
 *
 * Route ini hanya memvalidasi input, menjalankan planner, dan mengembalikan
 * AnalysisView bersih (BFF layer) ke client. Param `?debug=1` disediakan untuk
 * inspeksi payload mentah jika diperlukan.
 */

// =========================================================================
// RIWAYAT ANALISIS (cache + korpus backtest)
// =========================================================================
/**
 * Tulis hasil analisis ke SQLite. Baris tidak pernah dihapus.
 * Gagal tulis TIDAK boleh menggagalkan response analisis yang sudah jadi.
 */
function persistAnalysisRun(args: {
  matchId: string;
  competitionIdHint: string;
  intel: { pertandingan?: { tim_kandang?: string; tim_tamu?: string } } | undefined;
  durationMs: number;
  view: unknown;
  trace: unknown;
  signal?: AbortSignal;
}): void {
  // Run yang dibatalkan client bisa saja berhenti di tengah: jangan simpan hasil separuh jadi.
  if (args.signal?.aborted) return;
  try {
    saveAnalysisRun({
      match_id: args.matchId,
      competition_id_hint: args.competitionIdHint,
      home_team: args.intel?.pertandingan?.tim_kandang ?? null,
      away_team: args.intel?.pertandingan?.tim_tamu ?? null,
      duration_ms: args.durationMs,
      view_json: JSON.stringify(args.view),
      planner_trace_json: JSON.stringify(args.trace),
    });
  } catch (err) {
    console.warn("[api/agent] Simpan riwayat analisis gagal (response tetap dikembalikan):", err);
  }
}

/** Response analisis segar + penanda cache miss untuk verifikasi. */
function freshViewResponse(view: unknown): Response {
  return Response.json(view as Record<string, unknown>, {
    headers: { "x-analysis-cache": "miss" },
  });
}

// =========================================================================
// PIPELINE HANDLER UTAMA
// =========================================================================
export async function GET(req: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);
  const matchId = searchParams.get("match_id");
  const competitionIdHint = searchParams.get("competition_id") || undefined;
  const isDebug = searchParams.get("debug") === "1";

  // Rate limit anti-DoS: tiap hit bakar multi-LLM call + kuota 1xBet
  const rl = checkRateLimit(
    clientKeyFromReq(req),
    Number(process.env.RATE_LIMIT_AGENT) || 10,
    60_000
  );
  if (!rl.ok) return tooManyResponse(rl.retryAfterSec);

  if (!matchId) {
    return Response.json(
      { error: "Parameter match_id diperlukan untuk menjalankan analisis pra-laga." },
      { status: 400 }
    );
  }

  // 1a. Cache hasil analisis: satu analisis = puluhan panggilan LLM, jadi hasilnya
  // dibaca jauh lebih sering daripada ditulis ulang. `?debug=1` sengaja dilewatkan
  // (semantiknya "jalankan ulang penuh").
  const cacheKeyHint = competitionIdHint ?? "";
  if (!isDebug) {
    try {
      const cached = getFreshAnalysisRun(matchId, cacheKeyHint, ANALYSIS_CACHE_TTL_MS);
      if (cached) {
        return Response.json(JSON.parse(cached.view_json) as unknown, {
          headers: {
            "x-analysis-cache": "hit",
            "x-analysis-cached-at": cached.created_at,
          },
        });
      }
    } catch (err) {
      // Cache rusak/tidak terbaca tidak boleh menggagalkan analisis segar.
      console.warn("[api/agent] Baca cache gagal, lanjut pipeline:", err);
    }
  }

  // 1. Jalankan planner loop (tools: fetch -> quant -> debat -> editorial -> verdict)
  // `req.signal` diturunkan sampai fetch upstream + LLM: client yang pergi menghentikan
  // run, bukan meninggalkan proses 8 menit di belakang (plan-perf Task 3).
  let result: PlannerResult;
  try {
    result = await runPlannerAnalysis({ matchId, competitionIdHint, signal: req.signal });
  } catch (err) {
    if (req.signal.aborted) {
      console.log(`[Planner] Run match ${matchId} dibatalkan client — dihentikan, tidak ada hasil disimpan.`);
      return Response.json(
        { error: "Analisis dibatalkan oleh client (koneksi ditutup)." },
        { status: 499 }
      );
    }
    console.error(`[Planner] Loop gagal:`, err);
    return Response.json(
      { error: `Pipeline Enterprise Gagal: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  const { trace, verdict, coverage, state } = result;
  const fetchResult = state.fetchResult;
  const intel = fetchResult?.intelligence;

  // 2. Fail-fast eksplisit jika komponen inti tidak terpenuhi
  if (!fetchResult || !intel) {
    return Response.json(
      {
        error: `Gagal mengumpulkan data pertandingan: ${trace.gaps_remaining.join(", ") || "data intelijen tidak tersedia"}`,
        planner_trace: trace,
      },
      { status: 500 }
    );
  }
  if (!state.quant || !state.debate) {
    return Response.json(
      {
        error: `Pipeline Enterprise Gagal: komponen analisis tidak lengkap (${coverage.checklist
          .filter((c) => !c.terpenuhi)
          .map((c) => c.item)
          .join(", ")})`,
        planner_trace: trace,
      },
      { status: 500 }
    );
  }

  const quantPackage = state.quant.quantPackage;
  const dcOutput = state.quant.dcOutput;
  const vigOutput = state.quant.vigOutput;
  const { hLast, dLast, aLast } = state.quant;
  const syndicateDebate = state.debate;
  const rawObj = state.editorial ?? {};

  // is_strictly_grounded = jujur: false kalau ada bagian debat yang diisi template fallback
  const isGrounded = !syndicateDebate.is_fabricated_fallback;

  // 3. Defensif parsing & merging (kontrak response dashboard TIDAK berubah)
  const validatedAnalysis = AnalysisSchema.safeParse({
    ...rawObj,
    prediksi: verdict?.prediksi ?? rawObj.prediksi,
    faktor_kunci: verdict?.faktor_kunci ?? rawObj.faktor_kunci,
    quant_engine: quantPackage,
    syndicate_debate: syndicateDebate,
    data_tidak_tersedia: intel.missing_data_registry,
    data_integrity_audit: {
      is_strictly_grounded: isGrounded,
      dispatcher_model: fetchResult.audit.dispatcher_model,
      cache_quota_saved: fetchResult.audit.cache_metrics.savedCalls,
      endpoints_called: fetchResult.audit.endpoints_called,
      endpoints_skipped: fetchResult.audit.endpoints_skipped,
    },
  });

  if (validatedAnalysis.success) {
    if (isDebug) {
      return Response.json({
        analisis: validatedAnalysis.data,
        rawLineups: intel.lineups,
        modelUsed: `${syndicateDebate.dual_judgement.judgement_1.model} + ${syndicateDebate.dual_judgement.judgement_2.model}`,
        isEnterpriseSyndicate: true,
        cacheMetrics: getStatsCacheMetrics(),
        audit: fetchResult.audit,
        plannerTrace: trace,
      });
    }

    const durationMs = Date.now() - startTime;
    const viewData = mapPipelineToView({
      analisis: validatedAnalysis.data,
      plannerTrace: trace,
      durationMs,
    });
    persistAnalysisRun({
      matchId,
      competitionIdHint: cacheKeyHint,
      intel,
      durationMs,
      view: viewData,
      trace,
      signal: req.signal,
    });
    return freshViewResponse(viewData);
  }

  console.warn("[Planner] Schema parse fallback, merging verified intelligence");
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
    faktor_kunci: verdict?.faktor_kunci ?? (Array.isArray(rawObj?.faktor_kunci)
      ? rawObj.faktor_kunci
      : ["Efisiensi Konversi Gol", "Soliditas Pertahanan", "Disiplin Taktis"]),
    prediksi: verdict?.prediksi ?? {
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
      is_strictly_grounded: isGrounded,
      dispatcher_model: fetchResult.audit.dispatcher_model,
      cache_quota_saved: fetchResult.audit.cache_metrics.savedCalls,
      endpoints_called: fetchResult.audit.endpoints_called,
      endpoints_skipped: fetchResult.audit.endpoints_skipped,
    },
  };

  if (isDebug) {
    return Response.json({
      analisis: merged,
      rawLineups: intel.lineups,
      modelUsed: `${syndicateDebate.dual_judgement.judgement_1.model} + ${syndicateDebate.dual_judgement.judgement_2.model}`,
      isEnterpriseSyndicate: true,
      cacheMetrics: getStatsCacheMetrics(),
      audit: fetchResult.audit,
      plannerTrace: trace,
    });
  }

  const durationMs = Date.now() - startTime;
  const fallbackParsed = AnalysisSchema.safeParse(merged);
  if (!fallbackParsed.success) {
    return Response.json(
      { error: "Pipeline menghasilkan data tidak valid (schema fallback gagal)." },
      { status: 500 }
    );
  }
  const viewData = mapPipelineToView({
    analisis: fallbackParsed.data,
    plannerTrace: trace,
    durationMs,
  });
  persistAnalysisRun({
    matchId,
    competitionIdHint: cacheKeyHint,
    intel,
    durationMs,
    view: viewData,
    trace,
    signal: req.signal,
  });
  return freshViewResponse(viewData);
}
