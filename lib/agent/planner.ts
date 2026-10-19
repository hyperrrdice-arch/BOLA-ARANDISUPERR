import { generateText, tool, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { PLANNER, SYNDICATE } from "@/lib/llm/models";
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
import { generateSpecialMarketsPackage } from "@/lib/quant/special-markets-engine";
import { getTeamHalfProfile, HALF_PROFILE_WINDOW, type HalfMatchup } from "@/lib/quant/half-profile";
import { getTeamMomentum, MOMENTUM_WINDOW, type MomentumMatchup } from "@/lib/quant/momentum";
import { getTeamRollingTelemetry } from "@/lib/db/team-telemetry";
import {
  orchestrate5AgentSyndicate,
  type SyndicateDebateResult,
} from "@/lib/syndicate-orchestrator";
import type { VerifiedMatchIntelligence } from "@/lib/stats-validator";
import {
  nineRouter,
  callModelWithFallback,
  buildEditorialPrompts,
  extractJSON,
} from "./llm";
import {
  VerdictInputSchema,
  type PlannerTrace,
  type VerdictInput,
} from "./schemas";
import { evaluateCoverage, type CoverageReport } from "./coverage";

/**
 * ============================================================================
 * PRE-MATCH ANALYST AGENT (PLANNER LOOP)
 * ============================================================================
 * Loop `plan -> act -> evaluate -> re-plan` di atas tool yang membungkus
 * pipeline existing. Angka 100% dari tool (lib/quant deterministik);
 * planner hanya memutuskan urutan analisis dan menyusun sintesis final.
 */

// ---------------------------------------------------------------------------
// 1. Kuantitas deterministik — dipindahkan verbatim dari app/api/agent/route.tsx
// ---------------------------------------------------------------------------

export interface QuantEngineBundle {
  quantPackage: {
    dixon_coles: Record<string, any>;
    vig_stripping: Record<string, any> | null;
    value_bets: ValueBetEvaluation[];
    special_markets: ReturnType<typeof generateSpecialMarketsPackage> | null;
    // Task 2 offline-depth: profil tempo babak 1 vs 2 — KONTEKS ONLY.
    // DILARANG dipakai mengubah dixon_coles / vig_stripping / value_bets.
    half_profile: HalfMatchup;
    // Task 3 offline-depth: momentum gol/xG last-3 vs matches 4-6 — KONTEKS ONLY.
    // DILARANG dipakai mengubah dixon_coles / vig_stripping / value_bets.
    momentum: MomentumMatchup;
    luck_metrics: any;
    calibration_metadata: Record<string, any>;
  };
  dcOutput: ReturnType<typeof calculateDixonColes>;
  vigOutput: ReturnType<typeof stripVigShin> | null;
  hLast: number | null;
  dLast: number | null;
  aLast: number | null;
  homeTelem: ReturnType<typeof getTeamRollingTelemetry>;
  awayTelem: ReturnType<typeof getTeamRollingTelemetry>;
  shrunkParams: ReturnType<typeof getShrunkMatchParameters>;
}

export function buildQuantPackage(
  intel: VerifiedMatchIntelligence,
  today: string
): QuantEngineBundle {
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

  // Odds pasar rusak/absen → null (model-only). JANGAN karang overround/margin:
  // margin fiktif mengalir ke prompt sindikat sebagai fakta pasar.
  const vigOutput: QuantEngineBundle["vigOutput"] = (() => {
    if (hLast && dLast && aLast) {
      try {
        return stripVigShin(hLast, dLast, aLast);
      } catch {
        return null;
      }
    }
    return null;
  })();

  // Value bet WAJIB membandingkan probabilitas model dengan odds pasar NYATA.
  // Tanpa odds pasar → tidak ada value bet untuk market itu. JANGAN karang odds
  // (1.95 / 1.88 / fair-odds model): EV, Kelly, dan recommended_odds yang mengalir
  // ke snapshot jadi angka yang tidak dimiliki bandar mana pun (audit 2026-10-18).
  const rawValueBets: ValueBetEvaluation[] = [];
  if (hLast && hLast > 1) {
    rawValueBets.push(evaluateValueBet(dcOutput.prob_home_win, hLast, "1X2", `${intel.pertandingan.tim_kandang} Menang`));
  }
  if (dLast && dLast > 1) {
    rawValueBets.push(evaluateValueBet(dcOutput.prob_draw, dLast, "1X2", "Hasil Imbang (Draw)"));
  }
  if (aLast && aLast > 1) {
    rawValueBets.push(evaluateValueBet(dcOutput.prob_away_win, aLast, "1X2", `${intel.pertandingan.tim_tamu} Menang`));
  }
  const o25Odds = intel.market_odds.total_goals_over_2_5;
  if (typeof o25Odds === "number" && Number.isFinite(o25Odds) && o25Odds > 1) {
    rawValueBets.push(evaluateValueBet(dcOutput.over_under.line_2_5.over, o25Odds, "Over/Under 2.5", "Over 2.5 Goals"));
  }
  // BTTS & AH DNB: intel tidak punya odds pasar untuk market ini → dilewati,
  // bukan diisi odds karangan. Bila kelak field odds-nya tersedia, tambahkan di sini.
  const valueBets = evaluatePortfolioKelly(rawValueBets, 5.0);

  // Kompilasi Pasar Khusus (Headed Goal, Corners, Cards, Passes)
  const specialMarkets = (homeTelem.sample_size > 0 || awayTelem.sample_size > 0)
    ? generateSpecialMarketsPackage({
        homeTeam: homeTeamName,
        awayTeam: awayTeamName,
        homeTelemetry: homeTelem,
        awayTelemetry: awayTelem,
        cutoffDate: today,
        divCode: shrunkParams.metadata?.div,
      })
    : null;

  // Profil tempo babak 1 vs 2 (Task 2 offline-depth, KONTEKS ONLY — angka ini
  // tidak masuk perhitungan Dixon-Coles / Shin / Kelly di bawah).
  const halfProfile: HalfMatchup = {
    home: getTeamHalfProfile(homeTeamName, HALF_PROFILE_WINDOW, today),
    away: getTeamHalfProfile(awayTeamName, HALF_PROFILE_WINDOW, today),
  };

  // Momentum gol/xG last-3 vs matches 4-6 (Task 3 offline-depth, KONTEKS ONLY —
  // angka ini tidak masuk perhitungan Dixon-Coles / Shin / Kelly di bawah).
  const momentum: MomentumMatchup = {
    home: getTeamMomentum(homeTeamName, MOMENTUM_WINDOW, today),
    away: getTeamMomentum(awayTeamName, MOMENTUM_WINDOW, today),
  };

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
    vig_stripping: vigOutput
      ? {
          overround: vigOutput.overround,
          margin_percentage: vigOutput.margin_percentage,
          fair_odds: vigOutput.fair_odds,
        }
      : null,
    value_bets: valueBets,
    special_markets: specialMarkets,
    half_profile: halfProfile,
    momentum,
    luck_metrics: shrunkParams.metadata?.luckMetrics,
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

  return { quantPackage, dcOutput, vigOutput, hLast, dLast, aLast, homeTelem, awayTelem, shrunkParams };
}

// ---------------------------------------------------------------------------
// 2. Run state + tools
// ---------------------------------------------------------------------------

export interface PlannerRunState {
  matchId: string;
  competitionIdHint?: string;
  today: string;
  fetchResult: FetchResultWithAudit | null;
  quant: QuantEngineBundle | null;
  debate: SyndicateDebateResult | null;
  editorial: Record<string, any> | null;
  verdict: VerdictInput | null;
  traceSteps: PlannerTrace["steps"];
  fetchAttempts: number;
  debateRounds: number;
}

export function createRunState(matchId: string, competitionIdHint?: string): PlannerRunState {
  return {
    matchId,
    competitionIdHint,
    today: new Date().toISOString().slice(0, 10),
    fetchResult: null,
    quant: null,
    debate: null,
    editorial: null,
    verdict: null,
    traceSteps: [],
    fetchAttempts: 0,
    debateRounds: 0,
  };
}

export interface PlannerTraceStep {
  step: number;
  action: string;
  alasan: string;
  trigger: string | null;
  coverage?: unknown;
  /** Wall-clock eksekusi tool ini (ms). Diisi oleh withCoverage(). */
  durasi_ms?: number;
  /** Pecahan durasi internal (khusus debat sindikat): stage/persona → ms. */
  stage_timings?: Record<string, number>;
}
function traceStep(state: PlannerRunState, action: string, input: { alasan?: string; trigger?: string }): PlannerTraceStep {
  const step: PlannerTraceStep = {
    step: state.traceSteps.length + 1,
    action,
    alasan: input.alasan || "(tanpa alasan)",
    trigger: input.trigger ?? null,
  };
  state.traceSteps.push(step);
  return step;
}

/** Suntikkan hasil evaluasi coverage (code) ke tool result sebagai bahan re-plan planner. */
function withCoverage(state: PlannerRunState, step: PlannerTraceStep | undefined, result: Record<string, any>, startedAt?: number): Record<string, any> {
  const coverage = evaluateCoverage(state);
  // Stempel ke step MILIK tool ini — tool call dalam satu step dieksekusi paralel,
  // menstempel "step terakhir" akan salah saat ada 2 tool dalam 1 step (audit 2026-10-18).
  if (step) {
    step.coverage = coverage;
    if (startedAt !== undefined) step.durasi_ms = Date.now() - startedAt;
  }
  return { ...result, coverage_check: coverage };
}

const StepInputSchema = z.object({
  alasan: z.string().optional().describe("Alasan singkat kenapa tool ini dipanggil"),
  trigger: z.string().optional().describe("Trigger numerik re-plan, jika ada"),
});

/**
 * Request editorial diturunkan HANYA dari intel + quant (bukan hasil debat), sehingga
 * bisa disiapkan bersamaan dengan debat sindikat. Dipakai dua jalur:
 * warm-start saat debat mulai, dan jalur normal bila planner memanggil editorial dulu.
 */
function buildEditorialRequest(state: PlannerRunState): { systemPrompt: string; userPrompt: string } {
  const intel = state.fetchResult!.intelligence;
  const q = state.quant!;
  return buildEditorialPrompts({
    intel,
    quantPackage: q.quantPackage,
    dcOutput: q.dcOutput,
    vigOutput: q.vigOutput,
    hLast: q.hLast,
    dLast: q.dLast,
    aLast: q.aLast,
    today: state.today,
  });
}

/**
 * Tool planner. Semua argumen divalidasi Zod (inputSchema) dan semua angka
 * yang dilihat planner datang dari execute di sisi server — bukan dari otak LLM.
 */
export function createPlannerTools(state: PlannerRunState): ToolSet {
  // Editorial tidak bergantung pada hasil debat → jalankan bersamaan dengan debat
  // (plan-perf Task 4: satu round-trip LLM keluar dari critical path).
  // Disimpan di closure tool set: terisolasi per run, aman untuk request bersamaan.
  let pendingEditorial: Promise<{ text: string; modelUsed: string }> | null = null;

  const takePendingEditorial = () => {
    const p = pendingEditorial;
    pendingEditorial = null;
    return p;
  };

  return {
    check_data_integrity: tool({
      description:
        "Ambil & validasi semua data intelijen match (Zod). WAJIB dipanggil pertama. " +
        "Mengembalikan ringkasan coverage + daftar field yang hilang (missing_data_registry).",
      inputSchema: StepInputSchema,
      execute: async (input, { abortSignal }) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "check_data_integrity", input);
        try {
          state.fetchResult = await fetchAndValidateMatchIntelligence(
            state.matchId,
            state.competitionIdHint,
            abortSignal
          );
          const intel = state.fetchResult.intelligence;
          return withCoverage(state, stepRef, {
            pertandingan: intel.pertandingan,
            coverage: {
              odds: intel.market_odds.is_available,
              lineups: intel.lineups.is_available,
              form_samples: intel.form_split.home_form_sample_size,
            },
            missing_data_registry: intel.missing_data_registry,
            audit: {
              dispatcher_model: state.fetchResult.audit.dispatcher_model,
              endpoints_called: state.fetchResult.audit.endpoints_called,
              endpoints_skipped: state.fetchResult.audit.endpoints_skipped,
            },
          }, t0);
        } catch (err: any) {
          return withCoverage(state, stepRef, { error: `Gagal mengumpulkan data: ${err?.message || err}` }, t0);
        }
      },
    }),

    fetch_missing_intel: tool({
      description:
        "Ambil ulang data intelijen ketika check_data_integrity melaporkan field penting kosong. " +
        "Mengembalikan delta missing sebelum vs sesudah. Jika tetap kosong, nyatakan gap eksplisit.",
      inputSchema: StepInputSchema,
      execute: async (input, { abortSignal }) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "fetch_missing_intel", input);
        state.fetchAttempts++;
        // ponytail: pengambilan ulang masih menyeluruh (cache membuatnya murah).
        // Upgrade ke fetch per-endpoint spesifik jika kuota TheStatsAPI jadi masalah.
        const before = state.fetchResult?.intelligence.missing_data_registry ?? [];
        try {
          const fresh = await fetchAndValidateMatchIntelligence(state.matchId, state.competitionIdHint, abortSignal);
          state.fetchResult = fresh;
          const after = fresh.intelligence.missing_data_registry;
          return withCoverage(state, stepRef, {
            missing_sebelum: before,
            missing_sesudah: after,
            berhasil_diisi: before.filter((m) => !after.includes(m)),
            masih_kosong: after,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, stepRef, { error: `Gagal mengambil ulang data: ${err?.message || err}` }, t0);
        }
      },
    }),

    run_quant_package: tool({
      description:
        "Jalankan quant engine deterministik (James-Stein shrinkage + Dixon-Coles + Shin vig-stripping + Kelly). " +
        "Wajib setelah data lengkap. Mengembalikan probabilitas murni, fair odds, dan value bets.",
      inputSchema: StepInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "run_quant_package", input);
        if (!state.fetchResult) {
          return withCoverage(state, stepRef, { error: "Jalankan check_data_integrity dulu sebelum run_quant_package." }, t0);
        }
        try {
          state.quant = buildQuantPackage(state.fetchResult.intelligence, state.today);
          const q = state.quant;
          return withCoverage(state, stepRef, {
            dixon_coles: q.quantPackage.dixon_coles,
            vig_stripping: q.quantPackage.vig_stripping,
            value_bets: q.quantPackage.value_bets,
            special_markets_tersedia: q.quantPackage.special_markets !== null,
            calibration_metadata: q.quantPackage.calibration_metadata,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, stepRef, { error: `Quant engine gagal: ${err?.message || err}` }, t0);
        }
      },
    }),

    run_syndicate_debate: tool({
      description:
        "Jalankan debat 5 persona multi-model (Bull/Neutral/Bear + Dual Judgement + Arbiter). " +
        "R1-only: 1 ronde saja; J2 sequential menanggapi vonis J1. " +
        "WAJIB dalam setiap analisis, setelah run_quant_package. Mengembalikan consensus_level dan verdict panel.",
      inputSchema: StepInputSchema,
      execute: async (input, { abortSignal }) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "run_syndicate_debate", input);
        if (!state.fetchResult || !state.quant) {
          return withCoverage(state, stepRef, { error: "Jalankan check_data_integrity dan run_quant_package dulu." }, t0);
        }
        if (state.debateRounds >= 1) {
          return withCoverage(state, stepRef, { error: "Debat sudah 1 ronde (R1-only). Lanjut ke stop_with_verdict." }, t0);
        }
        state.debateRounds++;
        try {
          // Warm-start editorial: tidak butuh output debat, jadi mulai sekarang dan
          // biarkan overlap. Hasilnya dipakai tool run_editorial_analysis.
          if (!pendingEditorial) {
            const request = buildEditorialRequest(state);
            pendingEditorial = callModelWithFallback(
              SYNDICATE.MODEL_JUDGEMENT_1,
              request.systemPrompt,
              request.userPrompt,
              abortSignal
            );
            // Kalau planner ternyata tidak memakainya, jangan biarkan rejection menggantung.
            void pendingEditorial.catch(() => {});
          }

          state.debate = await orchestrate5AgentSyndicate({
            matchSummary: `${state.fetchResult.intelligence.pertandingan.tim_kandang} vs ${state.fetchResult.intelligence.pertandingan.tim_tamu}`,
            intel: state.fetchResult.intelligence,
            quantPackage: state.quant.quantPackage,
            signal: abortSignal,
          });
          // Atribusi sisa durasi: pecahan stage/persona debat ikut terstempel ke step trace.
          if (state.debate.stage_timings) stepRef.stage_timings = state.debate.stage_timings;
          return withCoverage(state, stepRef, {
            ronde: state.debateRounds,
            consensus_level: state.debate.dual_judgement?.consensus_level,
            final_confidence_tier: state.debate.dual_judgement?.final_confidence_tier,
            final_recommended_market: state.debate.dual_judgement?.final_recommended_market,
            supreme_verdict: state.debate.dual_judgement?.supreme_verdict,
            bear_trap_warnings: state.debate.bear_case?.trap_warnings,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, stepRef, { error: `Syndicate debate gagal: ${err?.message || err}` }, t0);
        }
      },
    }),

    run_editorial_analysis: tool({
      description:
        "Susun analisis editorial terstruktur (wasit, taktik & lineup, form, pasar, statistik mendalam) " +
        "dengan aturan closed-world anti-halusinasi. Wajib sebelum stop_with_verdict.",
      inputSchema: StepInputSchema,
      execute: async (input, { abortSignal }) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "run_editorial_analysis", input);
        if (!state.fetchResult || !state.quant) {
          return withCoverage(state, stepRef, { error: "Jalankan check_data_integrity dan run_quant_package dulu." }, t0);
        }
        try {
          const pending = takePendingEditorial();
          const request = pending ? null : buildEditorialRequest(state);
          const { text, modelUsed } = pending
            ? await pending
            : await callModelWithFallback(
                SYNDICATE.MODEL_JUDGEMENT_1,
                request!.systemPrompt,
                request!.userPrompt,
                abortSignal
              );
          const editorial: Record<string, any> = extractJSON(text);
          state.editorial = editorial;
          return withCoverage(state, stepRef, {
            modelUsed,
            editorial_overlap: pending !== null,
            kunci_output: Object.keys(editorial),
            prediksi_editorial: editorial.prediksi ?? null,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, stepRef, { error: `Editorial analysis gagal: ${err?.message || err}` }, t0);
        }
      },
    }),

    stop_with_verdict: tool({
      description:
        "Akhiri analisis dengan sintesis final (prediksi & faktor kunci). " +
        "WAJIB dipanggil paling akhir. DILARANG memasukkan angka quant — angka sudah dihitung tool lain.",
      inputSchema: VerdictInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "stop_with_verdict", { alasan: input.ringkasan_perencanaan });
        state.verdict = input;
        return withCoverage(state, stepRef, { ok: true, catatan: "Verdict diterima. Analisis selesai." }, t0);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// 3. Loop planner
// ---------------------------------------------------------------------------

export const PLANNER_SYSTEM_PROMPT = `Kamu adalah PRE-MATCH ANALYST AGENT yang merencanakan dan mengeksekusi analisis pra-laga sepak bola.

ATURAN LOOP (plan -> act -> evaluate -> re-plan):
1. RENCANAKAN dulu: tentukan modul analisis yang dibutuhkan match ini (data integrity, quant, debat sindikat, editorial).
2. Eksekusi lewat tool dengan urutan standar: check_data_integrity -> run_quant_package -> run_syndicate_debate -> run_editorial_analysis -> stop_with_verdict.
3. Panggil fetch_missing_intel HANYA jika check_data_integrity melaporkan field penting kosong. Jika setelah pengambilan ulang masih kosong, catat sebagai gap dan tetap lanjut (degradasi eksplisit).
4. Evaluasi hasil tool. Setiap tool result berisi \`coverage_check\` yang dievaluasi oleh CODE. Re-plan hanya jika \`replan_triggers\` tidak kosong (field kosong, consensus lemah, dislocation odds). Dilarang re-plan karena spekulasi.
5. SELALU akhiri dengan stop_with_verdict.

ATURAN MUTLAK CLOSED-WORLD:
- Semua angka (probabilitas, odds, EV, stake) HANYA dari output tool. DILARANG mengarang atau menghitung ulang angka di kepalamu.
- DILARANG menyebut pemain yang tidak ada di data tool.
- Jika tool mengembalikan {error}, perbaiki urutan pemanggilan — jangan mengarang hasilnya.`;

export interface PlannerLoopStepTiming {
  /** Wall-clock satu step = panggilan model planner + eksekusi tool milik step itu. */
  ms: number;
  /** Jumlah tool yang dieksekusi di step ini (0 = step model murni, biasanya step terakhir). */
  tools: number;
}

export interface PlannerLoopResult {
  text: string;
  stepCount: number;
  /**
   * Durasi per step loop (plan-perf-2 Task 3). Menjawab pertanyaan "sisa waktu yang
   * tidak teratribusi ke tool itu ada di mana": step dengan `tools: 0` atau
   * `ms` jauh di atas durasi tool-nya = biaya model planner, bukan biaya tool.
   */
  stepTimings: PlannerLoopStepTiming[];
}

/**
 * Loop generik dengan tool yang bisa diinjeksi (dipakai test dengan mock tools).
 * Hard cap default 8 step: rantai dependensi serial minimal 5 panggilan
 * (check -> quant -> debate -> editorial -> verdict), sisa 3 sebagai headroom re-plan.
 */
export async function runPlannerLoop(params: {
  tools: ToolSet;
  systemPrompt?: string;
  userPrompt: string;
  maxSteps?: number;
  abortSignal?: AbortSignal;
}): Promise<PlannerLoopResult> {
  const maxSteps = params.maxSteps ?? (Number(process.env.PLANNER_MAX_STEPS) || 8);
  const stepTimings: PlannerLoopStepTiming[] = [];
  let stepStartedAt = 0;
  // Plafon jaring pengaman keseluruhan loop — BUKAN per model call (tool debat
  // sindikat sah memakan 5-7 menit). Model call tunggal sudah ber-timeout 180s
  // di callModelWithFallback; tanpa plafon ini, loop bisa menggantung selamanya.
  const loopTimeoutMs = Number(process.env.PLANNER_LOOP_TIMEOUT_MS) || 30 * 60_000;
  const res = await generateText({
    model: nineRouter.chat(PLANNER.MODEL_PLANNER),
    system: params.systemPrompt ?? PLANNER_SYSTEM_PROMPT,
    prompt: params.userPrompt,
    tools: params.tools,
    stopWhen: stepCountIs(maxSteps),
    temperature: 0.2,
    abortSignal: params.abortSignal
      ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(loopTimeoutMs)])
      : AbortSignal.timeout(loopTimeoutMs),
    // onStepStart jalan SEBELUM provider dipanggil, onStepFinish sesudah tool step itu selesai.
    onStepStart: () => {
      stepStartedAt = Date.now();
    },
    onStepFinish: (step) => {
      stepTimings.push({
        ms: Date.now() - (stepStartedAt || Date.now()),
        tools: step.toolCalls?.length ?? 0,
      });
    },
  });
  return { text: res.text, stepCount: res.steps.length, stepTimings };
}

export interface PlannerResult {
  trace: PlannerTrace;
  verdict: VerdictInput | null;
  coverage: CoverageReport;
  state: PlannerRunState;
}

export async function runPlannerAnalysis(params: {
  matchId: string;
  competitionIdHint?: string;
  tools?: ToolSet; // override untuk test
  signal?: AbortSignal;
}): Promise<PlannerResult> {
  const state = createRunState(params.matchId, params.competitionIdHint);
  const tools = params.tools ?? createPlannerTools(state);

  const userPrompt =
    `Analisis pra-laga untuk match_id "${params.matchId}"` +
    (params.competitionIdHint ? ` (hint kompetisi: ${params.competitionIdHint})` : "") +
    `.\nRencanakan analisis, eksekusi tool yang diperlukan, lalu tutup dengan stop_with_verdict.`;

  const loopStartedAt = Date.now();
  const loop = await runPlannerLoop({ tools, userPrompt, abortSignal: params.signal });
  const loopMs = Date.now() - loopStartedAt;

  const coverage = evaluateCoverage(state);

  // Atribusi penutup (plan-perf-2 Task 3): pisahkan waktu eksekusi TOOL dari waktu
  // model planner + overhead antar-step. Sebelumnya selisih ini cuma "sisa" yang
  // tidak terjelaskan; sekarang jadi angka bernama.
  const toolMs = state.traceSteps.reduce((acc, s) => acc + (s.durasi_ms ?? 0), 0);

  return {
    trace: {
      steps: state.traceSteps,
      stop_reason: state.verdict ? "verdict" : "max_steps",
      gaps_remaining: coverage.gaps,
      planner: {
        loop_ms: loopMs,
        tool_ms: toolMs,
        planner_overhead_ms: Math.max(0, loopMs - toolMs),
        step_timings: loop.stepTimings,
      },
    },
    verdict: state.verdict,
    coverage,
    state,
  };
}
