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
    vig_stripping: Record<string, any>;
    value_bets: ValueBetEvaluation[];
    special_markets: ReturnType<typeof generateSpecialMarketsPackage> | null;
    luck_metrics: any;
    calibration_metadata: Record<string, any>;
  };
  dcOutput: ReturnType<typeof calculateDixonColes>;
  vigOutput: ReturnType<typeof stripVigShin> | {
    overround: number;
    margin_percentage: number;
    fair_odds: { home: number; draw: number; away: number };
    fair_prob: { home: number; draw: number; away: number };
  };
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

  // Odds pasar rusak/absen → cabang model-only (tanpa method_used), JANGAN karang prob pasar
  const vigOutput: QuantEngineBundle["vigOutput"] = (() => {
    if (hLast && dLast && aLast) {
      try {
        return stripVigShin(hLast, dLast, aLast);
      } catch {
        return null;
      }
    }
    return null;
  })() ?? {
    overround: 1.055,
    margin_percentage: 5.5,
    fair_odds: dcOutput.fair_odds,
    fair_prob: { home: dcOutput.prob_home_win, draw: dcOutput.prob_draw, away: dcOutput.prob_away_win },
  };

  // Evaluasi +EV & Portfolio Kelly Stake Sizing
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
        divCode: shrunkParams.metadata?.div,
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
function withCoverage(state: PlannerRunState, result: Record<string, any>, startedAt?: number): Record<string, any> {
  const coverage = evaluateCoverage(state);
  // Stempel coverage + durasi pasca-eksekusi ke step trace yang sesuai (dipakai UI thinking panel).
  const last = state.traceSteps[state.traceSteps.length - 1];
  if (last) {
    last.coverage = coverage;
    if (startedAt !== undefined) last.durasi_ms = Date.now() - startedAt;
  }
  return { ...result, coverage_check: coverage };
}

const StepInputSchema = z.object({
  alasan: z.string().optional().describe("Alasan singkat kenapa tool ini dipanggil"),
  trigger: z.string().optional().describe("Trigger numerik re-plan, jika ada"),
});

/**
 * Tool planner. Semua argumen divalidasi Zod (inputSchema) dan semua angka
 * yang dilihat planner datang dari execute di sisi server — bukan dari otak LLM.
 */
export function createPlannerTools(state: PlannerRunState): ToolSet {
  return {
    check_data_integrity: tool({
      description:
        "Ambil & validasi semua data intelijen match (Zod). WAJIB dipanggil pertama. " +
        "Mengembalikan ringkasan coverage + daftar field yang hilang (missing_data_registry).",
      inputSchema: StepInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        traceStep(state, "check_data_integrity", input);
        try {
          state.fetchResult = await fetchAndValidateMatchIntelligence(
            state.matchId,
            state.competitionIdHint
          );
          const intel = state.fetchResult.intelligence;
          return withCoverage(state, {
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
          return withCoverage(state, { error: `Gagal mengumpulkan data: ${err?.message || err}` }, t0);
        }
      },
    }),

    fetch_missing_intel: tool({
      description:
        "Ambil ulang data intelijen ketika check_data_integrity melaporkan field penting kosong. " +
        "Mengembalikan delta missing sebelum vs sesudah. Jika tetap kosong, nyatakan gap eksplisit.",
      inputSchema: StepInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        traceStep(state, "fetch_missing_intel", input);
        state.fetchAttempts++;
        // ponytail: pengambilan ulang masih menyeluruh (cache membuatnya murah).
        // Upgrade ke fetch per-endpoint spesifik jika kuota TheStatsAPI jadi masalah.
        const before = state.fetchResult?.intelligence.missing_data_registry ?? [];
        try {
          const fresh = await fetchAndValidateMatchIntelligence(state.matchId, state.competitionIdHint);
          state.fetchResult = fresh;
          const after = fresh.intelligence.missing_data_registry;
          return withCoverage(state, {
            missing_sebelum: before,
            missing_sesudah: after,
            berhasil_diisi: before.filter((m) => !after.includes(m)),
            masih_kosong: after,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, { error: `Gagal mengambil ulang data: ${err?.message || err}` }, t0);
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
        traceStep(state, "run_quant_package", input);
        if (!state.fetchResult) {
          return { error: "Jalankan check_data_integrity dulu sebelum run_quant_package." };
        }
        try {
          state.quant = buildQuantPackage(state.fetchResult.intelligence, state.today);
          const q = state.quant;
          return withCoverage(state, {
            dixon_coles: q.quantPackage.dixon_coles,
            vig_stripping: q.quantPackage.vig_stripping,
            value_bets: q.quantPackage.value_bets,
            special_markets_tersedia: q.quantPackage.special_markets !== null,
            calibration_metadata: q.quantPackage.calibration_metadata,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, { error: `Quant engine gagal: ${err?.message || err}` }, t0);
        }
      },
    }),

    run_syndicate_debate: tool({
      description:
        "Jalankan debat 5 persona multi-model (Bull/Neutral/Bear + Dual Judgement + Arbiter). " +
        "WAJIB dalam setiap analisis, setelah run_quant_package. Mengembalikan consensus_level dan verdict panel.",
      inputSchema: StepInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        const stepRef = traceStep(state, "run_syndicate_debate", input);
        if (!state.fetchResult || !state.quant) {
          return withCoverage(state, { error: "Jalankan check_data_integrity dan run_quant_package dulu." }, t0);
        }
        if (state.debateRounds >= 2) {
          return withCoverage(state, { error: "Batas ronde debat (2) tercapai. Lanjut ke stop_with_verdict." }, t0);
        }
        state.debateRounds++;
        try {
          state.debate = await orchestrate5AgentSyndicate({
            matchSummary: `${state.fetchResult.intelligence.pertandingan.tim_kandang} vs ${state.fetchResult.intelligence.pertandingan.tim_tamu}`,
            intel: state.fetchResult.intelligence,
            quantPackage: state.quant.quantPackage,
          });
          // Atribusi sisa durasi: pecahan stage/persona debat ikut terstempel ke step trace.
          if (state.debate.stage_timings) stepRef.stage_timings = state.debate.stage_timings;
          return withCoverage(state, {
            ronde: state.debateRounds,
            consensus_level: state.debate.dual_judgement?.consensus_level,
            final_confidence_tier: state.debate.dual_judgement?.final_confidence_tier,
            final_recommended_market: state.debate.dual_judgement?.final_recommended_market,
            supreme_verdict: state.debate.dual_judgement?.supreme_verdict,
            bear_trap_warnings: state.debate.bear_case?.trap_warnings,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, { error: `Syndicate debate gagal: ${err?.message || err}` }, t0);
        }
      },
    }),

    run_editorial_analysis: tool({
      description:
        "Susun analisis editorial terstruktur (wasit, taktik & lineup, form, pasar, statistik mendalam) " +
        "dengan aturan closed-world anti-halusinasi. Wajib sebelum stop_with_verdict.",
      inputSchema: StepInputSchema,
      execute: async (input) => {
        const t0 = Date.now();
        traceStep(state, "run_editorial_analysis", input);
        if (!state.fetchResult || !state.quant) {
          return withCoverage(state, { error: "Jalankan check_data_integrity dan run_quant_package dulu." }, t0);
        }
        try {
          const intel = state.fetchResult.intelligence;
          const q = state.quant;
          const { systemPrompt, userPrompt } = buildEditorialPrompts({
            intel,
            quantPackage: q.quantPackage,
            dcOutput: q.dcOutput,
            vigOutput: q.vigOutput,
            hLast: q.hLast,
            dLast: q.dLast,
            aLast: q.aLast,
            today: state.today,
          });
          const { text, modelUsed } = await callModelWithFallback(
            SYNDICATE.MODEL_JUDGEMENT_1,
            systemPrompt,
            userPrompt
          );
          const editorial: Record<string, any> = extractJSON(text);
          state.editorial = editorial;
          return withCoverage(state, {
            modelUsed,
            kunci_output: Object.keys(editorial),
            prediksi_editorial: editorial.prediksi ?? null,
          }, t0);
        } catch (err: any) {
          return withCoverage(state, { error: `Editorial analysis gagal: ${err?.message || err}` }, t0);
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
        traceStep(state, "stop_with_verdict", { alasan: input.ringkasan_perencanaan });
        state.verdict = input;
        return withCoverage(state, { ok: true, catatan: "Verdict diterima. Analisis selesai." }, t0);
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

export interface PlannerLoopResult {
  text: string;
  stepCount: number;
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
}): Promise<PlannerLoopResult> {
  const maxSteps = params.maxSteps ?? (Number(process.env.PLANNER_MAX_STEPS) || 8);
  const res = await generateText({
    model: nineRouter.chat(PLANNER.MODEL_PLANNER),
    system: params.systemPrompt ?? PLANNER_SYSTEM_PROMPT,
    prompt: params.userPrompt,
    tools: params.tools,
    stopWhen: stepCountIs(maxSteps),
    temperature: 0.2,
  });
  return { text: res.text, stepCount: res.steps.length };
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
}): Promise<PlannerResult> {
  const state = createRunState(params.matchId, params.competitionIdHint);
  const tools = params.tools ?? createPlannerTools(state);

  const userPrompt =
    `Analisis pra-laga untuk match_id "${params.matchId}"` +
    (params.competitionIdHint ? ` (hint kompetisi: ${params.competitionIdHint})` : "") +
    `.\nRencanakan analisis, eksekusi tool yang diperlukan, lalu tutup dengan stop_with_verdict.`;

  await runPlannerLoop({ tools, userPrompt });

  const coverage = evaluateCoverage(state);

  return {
    trace: {
      steps: state.traceSteps,
      stop_reason: state.verdict ? "verdict" : "max_steps",
      gaps_remaining: coverage.gaps,
    },
    verdict: state.verdict,
    coverage,
    state,
  };
}
