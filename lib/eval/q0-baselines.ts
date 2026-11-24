/**
 * Q0 — BASELINE PEMBANDING MURAH (Item 1, Sprint A+B; design beku di
 * tasks/sprint-ab/q0-design.md).
 *
 * Tiga model lantai yang dinilai lewat evaluator kronologis PR 3 pada
 * irisan lipatan yang sama dengan champion:
 *  - Freq: frekuensi empiris H/D/A per liga dari irisan latih lipatan.
 *  - NaivePoisson: Poisson independen dari rerata gol venue per tim
 *    (latih saja), fallback rerata venue liga, tanpa shrinkage.
 *  - Elo: Elo sekuensial per liga (1500/K=20/HFA 65/skala 400) dengan
 *    mapper gap→1X2 terbin yang dikalibrasi hanya pada irisan latih.
 *
 * Semua point-in-time: tidak ada fungsi di sini yang membaca laga sesudah
 * batas yang diberikan pemanggil (irisan latih lipatan, atau — untuk Elo —
 * laga yang sedang diprediksi itu sendiri sebelum update).
 */
import {
  matrixProbs,
  outcomeIndex,
  type EvalMatchRow,
} from "./chronological-evaluator";

export type Probs3 = [number, number, number];

// ---------------------------------------------------------------------------
// Q0-Freq
// ---------------------------------------------------------------------------

/** Frekuensi empiris H/D/A irisan latih (tanpa penghalusan). */
export function leagueFrequencies(train: readonly EvalMatchRow[]): Probs3 {
  if (train.length === 0) return [1 / 3, 1 / 3, 1 / 3];
  const counts = [0, 0, 0];
  for (const m of train) counts[outcomeIndex(m.home_score, m.away_score)]++;
  return [
    counts[0] / train.length,
    counts[1] / train.length,
    counts[2] / train.length,
  ];
}

// ---------------------------------------------------------------------------
// Q0-NaivePoisson
// ---------------------------------------------------------------------------

export interface NaivePoissonModel {
  leagueHomeMean: number;
  leagueAwayMean: number;
  homeMeanByTeam: Map<string, number>;
  awayMeanByTeam: Map<string, number>;
}

export function fitNaivePoisson(train: readonly EvalMatchRow[]): NaivePoissonModel {
  let homeGoals = 0;
  let awayGoals = 0;
  const homeSum = new Map<string, number>();
  const homeN = new Map<string, number>();
  const awaySum = new Map<string, number>();
  const awayN = new Map<string, number>();
  for (const m of train) {
    homeGoals += m.home_score;
    awayGoals += m.away_score;
    homeSum.set(m.home_team_id, (homeSum.get(m.home_team_id) ?? 0) + m.home_score);
    homeN.set(m.home_team_id, (homeN.get(m.home_team_id) ?? 0) + 1);
    awaySum.set(m.away_team_id, (awaySum.get(m.away_team_id) ?? 0) + m.away_score);
    awayN.set(m.away_team_id, (awayN.get(m.away_team_id) ?? 0) + 1);
  }
  const n = Math.max(1, train.length);
  const homeMeanByTeam = new Map<string, number>();
  for (const [t, s] of homeSum) homeMeanByTeam.set(t, s / (homeN.get(t) ?? 1));
  const awayMeanByTeam = new Map<string, number>();
  for (const [t, s] of awaySum) awayMeanByTeam.set(t, s / (awayN.get(t) ?? 1));
  return {
    leagueHomeMean: homeGoals / n,
    leagueAwayMean: awayGoals / n,
    homeMeanByTeam,
    awayMeanByTeam,
  };
}

export function predictNaivePoisson(
  model: NaivePoissonModel,
  m: EvalMatchRow,
): { lam: number; mu: number; p: Probs3; pOver25: number; fallback: boolean } {
  const lam = model.homeMeanByTeam.get(m.home_team_id) ?? model.leagueHomeMean;
  const mu = model.awayMeanByTeam.get(m.away_team_id) ?? model.leagueAwayMean;
  const mp = matrixProbs(lam, mu, 0);
  return { lam, mu, p: mp.p, pOver25: mp.pOver25, fallback: mp.fallback };
}

// ---------------------------------------------------------------------------
// Q0-Elo
// ---------------------------------------------------------------------------

export const ELO_START = 1500;
export const ELO_K = 20;
export const ELO_HFA = 65;
export const ELO_SCALE = 400;
export const ELO_BIN_WIDTH = 50;
export const ELO_BIN_MIN = -600;
export const ELO_BIN_MAX = 600;

export function eloExpected(gap: number): number {
  return 1 / (1 + Math.pow(10, -gap / ELO_SCALE));
}

export function eloBinIndex(gap: number): number {
  const nBins = Math.round((ELO_BIN_MAX - ELO_BIN_MIN) / ELO_BIN_WIDTH);
  const idx = Math.floor((gap - ELO_BIN_MIN) / ELO_BIN_WIDTH);
  return Math.min(nBins - 1, Math.max(0, idx));
}

export interface EloMapper {
  bins: Probs3[];
  overall: Probs3;
}

/** Mapper gap→1X2 dari catatan latih (gap pra-laga, hasil) + Laplace +1.
 *  Bin tanpa catatan latih → frekuensi keseluruhan latih (design beku). */
export function fitEloMapper(records: readonly { gap: number; y: 0 | 1 | 2 }[]): EloMapper {
  const nBins = Math.round((ELO_BIN_MAX - ELO_BIN_MIN) / ELO_BIN_WIDTH);
  const counts: number[][] = Array.from({ length: nBins }, () => [1, 1, 1]);
  const seen: number[] = Array.from({ length: nBins }, () => 0);
  const overall = [1, 1, 1];
  for (const r of records) {
    counts[eloBinIndex(r.gap)][r.y]++;
    seen[eloBinIndex(r.gap)]++;
    overall[r.y]++;
  }
  const norm = (c: number[]): Probs3 => {
    const s = c[0] + c[1] + c[2];
    return [c[0] / s, c[1] / s, c[2] / s];
  };
  const overallP = norm(overall);
  return {
    bins: counts.map((c, i) => (seen[i] > 0 ? norm(c) : overallP)),
    overall: overallP,
  };
}

export function eloMapProbs(mapper: EloMapper, gap: number): Probs3 {
  return mapper.bins[eloBinIndex(gap)];
}

/**
 * Jalankan Elo sekuensial atas seluruh laga liga (urutan waktu). Untuk
 * setiap laga: kembalikan gap pra-laga; rating diperbarui SESUDAH
 * pemanggil membaca gap (predict-then-update ditegakkan oleh urutan
 * pemakaian di fungsi ini: gap dihitung dari rating sebelum laga).
 */
export function eloGapsSequential(
  matches: readonly EvalMatchRow[],
): { match: EvalMatchRow; gap: number }[] {
  const ratings = new Map<string, number>();
  const rating = (t: string): number => ratings.get(t) ?? ELO_START;
  const out: { match: EvalMatchRow; gap: number }[] = [];
  for (const m of matches) {
    const rh = rating(m.home_team_id);
    const ra = rating(m.away_team_id);
    const gap = rh + ELO_HFA - ra;
    out.push({ match: m, gap });
    const y = outcomeIndex(m.home_score, m.away_score);
    const actual = y === 0 ? 1 : y === 1 ? 0.5 : 0;
    const delta = ELO_K * (actual - eloExpected(gap));
    ratings.set(m.home_team_id, rh + delta);
    ratings.set(m.away_team_id, ra - delta);
  }
  return out;
}
