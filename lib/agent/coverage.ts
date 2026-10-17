import type { PlannerRunState } from "./planner";

/**
 * ============================================================================
 * COVERAGE EVALUATOR (Phase 2) — evaluasi oleh CODE, bukan self-report LLM.
 * ============================================================================
 * Hasil evaluasi disuntikkan ke tool result sebagai `coverage_check`, sehingga
 * planner hanya boleh re-plan berdasarkan temuan numerik/verifikabel dari sini.
 */

/** Trigger re-plan: field kosong baru boleh memicu fetch_missing_intel sekali. */
export const MAX_FETCH_ATTEMPTS = 2;

/** Consensus di bawah level ini dianggap lemah -> boleh 1x ronde debat tambahan. */
export const WEAK_CONSENSUS_LEVELS = ["SPLIT_DECISION", "DISSENT"] as const;

/** Dislocation odds: EV absolut di atas threshold ini wajib ditandai. */
export const DISLOCATION_EV_THRESHOLD = 0.2;

export interface CoverageItem {
  item: string;
  terpenuhi: boolean;
  detail: string;
}

export interface CoverageReport {
  checklist: CoverageItem[];
  gaps: string[];
  replan_triggers: string[];
  is_complete: boolean;
}

export function evaluateCoverage(state: PlannerRunState): CoverageReport {
  const checklist: CoverageItem[] = [
    {
      item: "check_data_integrity",
      terpenuhi: state.fetchResult !== null,
      detail: state.fetchResult ? "Data intelijen terverifikasi Zod" : "Belum dijalankan",
    },
    {
      item: "run_quant_package",
      terpenuhi: state.quant !== null,
      detail: state.quant ? "Quant engine selesai" : "Belum dijalankan",
    },
    {
      item: "run_syndicate_debate",
      terpenuhi: state.debate !== null,
      detail: state.debate ? `Debat selesai (ronde ${state.debateRounds})` : "Belum dijalankan",
    },
    {
      item: "run_editorial_analysis",
      terpenuhi: state.editorial !== null,
      detail: state.editorial ? "Editorial tersusun" : "Belum dijalankan",
    },
    {
      item: "stop_with_verdict",
      terpenuhi: state.verdict !== null,
      detail: state.verdict ? "Verdict final diterima" : "Belum dipanggil",
    },
  ];

  const gaps = state.fetchResult
    ? [...state.fetchResult.intelligence.missing_data_registry]
    : ["data_integrity belum dijalankan"];

  const replan_triggers: string[] = [];

  // Trigger 1: field kosong hasil check_data_integrity -> fetch_missing_intel (maks 1x)
  if (gaps.length > 0 && state.fetchAttempts < MAX_FETCH_ATTEMPTS && state.fetchResult) {
    replan_triggers.push(
      `FIELD_KOSONG: ${gaps.join(", ")} — jalankan fetch_missing_intel (percobaan ${state.fetchAttempts + 1}/${MAX_FETCH_ATTEMPTS - 1})`
    );
  }

  // Trigger 2: consensus lemah -> ronde debat tambahan (maks 1x)
  const consensus = state.debate?.dual_judgement?.consensus_level;
  if (
    consensus &&
    (WEAK_CONSENSUS_LEVELS as readonly string[]).includes(consensus) &&
    state.debateRounds <= 1
  ) {
    replan_triggers.push(
      `CONSENSUS_LEMAH: ${consensus} — jalankan run_syndicate_debate sekali lagi (ronde ${state.debateRounds + 1}/2)`
    );
  }

  // Trigger 3: dislocation odds numerik (EV absolut melewati threshold)
  const valueBets = state.quant?.quantPackage.value_bets ?? [];
  for (const vb of valueBets) {
    if (Math.abs(vb.expected_value) > DISLOCATION_EV_THRESHOLD) {
      replan_triggers.push(
        `ODDS_DISLOCATION: ${vb.market_name} (${vb.selection}) EV=${vb.ev_percentage} — pastikan editorial membahas gap odds ini`
      );
    }
  }

  return {
    checklist,
    gaps,
    replan_triggers,
    is_complete: checklist.every((c) => c.terpenuhi),
  };
}
