/**
 * PREDIKTOR BERSAMA (K4 · bab Model Q2 butir 1: `predict(snapshot, config)`).
 *
 * Komposisi ini MENYALIN PERSIS langkah kuant di lib/agent/planner.ts
 * (buildQuantPackage, file read-only): getShrunkMatchParameters dengan
 * argumen yang sama, lalu calculateDixonColes dengan argumen yang sama.
 * Jalur produksi (slate lewat planner) dan jalur lab/evaluasi
 * (scripts/evaluate-model.ts) dengan demikian menghitung dari prediktor
 * yang sama; paritasnya dibuktikan suite Q03 di tests/test-model.ts —
 * bila planner suatu hari berubah, tes paritas yang menangkapnya.
 *
 * Fungsi ini murni terhadap inputnya: pemuatan artefak rating terjadi di
 * ratings-loader (singleton cwd/data), telemetri dibaca loader dari store
 * lokal dengan cutoff yang diberikan, dan snapshot fitur (form) disiapkan
 * pemanggil — untuk lab lewat pembaca as-of lib/quant/snapshot.ts.
 */
import { calculateDixonColes, type DixonColesResult } from "./dixon-coles";
import {
  getShrunkMatchParameters,
  type ShrunkMatchParameters,
} from "./ratings-loader";
import type { TeamRollingTelemetry } from "../db/team-telemetry";

export interface PredictMatchInput {
  homeTeam: string;
  awayTeam: string;
  leagueHint?: string;
  /** Rata-rata gol form pra-laga (snapshot as-of); undefined = tak tersedia. */
  homeFormGoalsAvg?: number;
  awayFormGoalsAvg?: number;
  homeSampleN?: number;
  awaySampleN?: number;
  homeTelemetry?: TeamRollingTelemetry | null;
  awayTelemetry?: TeamRollingTelemetry | null;
  /** Cutoff pra-laga (anti bocor): hanya data < tanggal ini yang terbaca. */
  cutoff?: string;
  isNeutralVenue?: boolean;
}

export interface PredictMatchResult {
  params: ShrunkMatchParameters;
  dc: DixonColesResult;
  lambda: number;
  mu: number;
  probs: { home: number; draw: number; away: number };
}

export function predictMatch(input: PredictMatchInput): PredictMatchResult {
  const params = getShrunkMatchParameters({
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    leagueHint: input.leagueHint,
    liveHomeFormGoalsAvg: input.homeFormGoalsAvg,
    liveAwayFormGoalsAvg: input.awayFormGoalsAvg,
    homeSampleN: input.homeSampleN,
    awaySampleN: input.awaySampleN,
    homeTelemetry: input.homeTelemetry,
    awayTelemetry: input.awayTelemetry,
    matchDateCutoff: input.cutoff,
    isNeutralVenue: input.isNeutralVenue,
  });
  const dc = calculateDixonColes({
    homeAttack: params.homeAttack,
    homeDefense: params.homeDefense,
    awayAttack: params.awayAttack,
    awayDefense: params.awayDefense,
    homeAdvantage: params.homeAdvantage,
    leagueAvgGoals: params.leagueAvgGoals,
    rho: params.rho,
  });
  return {
    params,
    dc,
    lambda: dc.lambda,
    mu: dc.mu,
    probs: { home: dc.prob_home_win, draw: dc.prob_draw, away: dc.prob_away_win },
  };
}
