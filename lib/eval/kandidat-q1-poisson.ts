/**
 * KANDIDAT Q1 — POISSON TERPENALTI DI ATAS CHAMPION (PR 4, SHADOW).
 *
 * Hipotesis tunggal PR 4 dari tangga kandidat brief "Data, Akurasi &
 * Efisiensi" bab P2 Model Quant:
 *
 *   log(λ_new) = log(λ_champion) + β_home · X_home
 *   log(μ_new) = log(μ_champion) + β_away · X_away
 *   loss = mean(PoissonNLL(home) + PoissonNLL(away)) + α · ‖β‖²
 *
 * Modul ini MURNI (tanpa I/O, tanpa Date.now/Math.random) dan sepenuhnya
 * terpisah dari jalur saji: ia hanya membaca baris data yang diserahkan
 * pemanggil, menghasilkan fitur point-in-time, mem-fit β, dan menghitung
 * intensitas kandidat. Ia TIDAK menulis manifest, artefak saji, atau DB
 * mana pun. Champion tetap champion apa pun hasil kandidat ini.
 *
 * Kontrak point-in-time fitur: cutoff = tanggal laga (bagian tanggal
 * utc_date), strictly-before — konvensi yang sama dengan telemetri/form
 * evaluator PR 3. Design lengkap yang dibekukan sebelum run:
 * tasks/pr4/design.md.
 */
import { calculateDixonColes } from "../quant/dixon-coles";
import type { KappaDecisionKind } from "../quant/experiment-stats";
import { LEGACY_COMP_AVG, upperBoundDate, type EvalMatchRow } from "./chronological-evaluator";

/**
 * Pemetaan putusan mesin gate repo (applyKappaDecision, ambang brief)
 * ke kosakata keputusan brief: promote → eligible_for_shadow (gate
 * LOLOS — sekadar informasi untuk keputusan pemilik; PR ini tidak
 * mempromosikan apa pun), retain → retain (gate GAGAL),
 * inconclusive → inconclusive.
 */
export function gateVocabulary(d: KappaDecisionKind): "eligible_for_shadow" | "retain" | "inconclusive" {
  return d === "promote" ? "eligible_for_shadow" : d;
}

// ---------------------------------------------------------------------------
// Fitur (sesuai design §4 — dibekukan sebelum run)
// ---------------------------------------------------------------------------

/** Urutan kolom vektor fitur per sisi. */
export const Q1_FEATURE_NAMES = ["rest_adv", "venue_neutral", "promoted", "form_resid", "miss_rest", "miss_form"] as const;
export type Q1FeatureName = (typeof Q1_FEATURE_NAMES)[number];

/**
 * Indeks kolom yang DI-FIT. `venue_neutral` (indeks 1) dikeluarkan:
 * tidak ada sumber data venue netral di repo (lihat design §4) —
 * nilainya 0 untuk semua baris dan β-nya ditetapkan 0.
 */
export const Q1_FITTED_IDX = [0, 2, 3, 4, 5] as const;

export interface Q1SideFeatures {
  /** Istirahat relatif berskala (home: +, away: −), cap ±3 satuan pekan. */
  restAdv: number;
  /** Selalu 0 — tidak teridentifikasi dari data (design §4). */
  venueNeutral: number;
  /** 1 bila tim pendatang promosi di kompetisi-musim ini. */
  promoted: number;
  /** Residual form gol vs rata-rata kompetisi as-of, cap [−2, 2]. */
  formResid: number;
  /** 1 bila rest tak terdefinisi (salah satu tim tanpa laga sebelumnya). */
  missRest: number;
  /** 1 bila form tak terdefinisi (<3 laga sebelumnya yang berkontribusi). */
  missForm: number;
}

export interface Q1MatchFeatures {
  home: Q1SideFeatures;
  away: Q1SideFeatures;
}

/** Vektor fitur sebagai array mengikuti Q1_FEATURE_NAMES. */
export function featureVector(f: Q1SideFeatures): number[] {
  return [f.restAdv, f.venueNeutral, f.promoted, f.formResid, f.missRest, f.missForm];
}

const DAY_MS = 86400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Ekstraktor fitur point-in-time. Semua indeks dibangun dari baris yang
 * diserahkan; setiap fitur untuk laga m hanya membaca laga dengan
 * tanggal < tanggal m (strictly-before), kecuali status `promoted`
 * yang hanya membaca data sebelum musim laga itu dimulai.
 */
export class Q1FeatureExtractor {
  private readonly matchesByTeam = new Map<string, EvalMatchRow[]>();
  private readonly datesByTeam = new Map<string, string[]>();
  private readonly compAvgDates = new Map<string, string[]>();
  private readonly compAvgPrefix = new Map<string, number[]>();
  /** comp -> musim terurut menurut tanggal minimum. */
  private readonly seasonsByComp = new Map<string, string[]>();
  /** "comp|season|team" yang hadir di data. */
  private readonly teamSeasonPresent = new Set<string>();
  /** "comp|season" -> jumlah laga. */
  private readonly compSeasonCount = new Map<string, number>();

  /**
   * @param universeMatches baris laga universe (urutan: competition_id, utc_date)
   * @param compAvgMatches  baris SEMUA laga selesai untuk indeks rata-rata
   *                        kompetisi (semantik sama dengan evaluator PR 3)
   * @param seasonByMatchId peta match_id -> label musim (kolom `season`)
   */
  constructor(universeMatches: EvalMatchRow[], compAvgMatches: EvalMatchRow[], seasonByMatchId: Map<string, string>) {
    for (const m of universeMatches) {
      const th = this.matchesByTeam.get(m.home_team_id) ?? [];
      th.push(m);
      this.matchesByTeam.set(m.home_team_id, th);
      const ta = this.matchesByTeam.get(m.away_team_id) ?? [];
      ta.push(m);
      this.matchesByTeam.set(m.away_team_id, ta);
      const season = seasonByMatchId.get(m.match_id);
      if (season) {
        this.teamSeasonPresent.add(`${m.competition_id}|${season}|${m.home_team_id}`);
        this.teamSeasonPresent.add(`${m.competition_id}|${season}|${m.away_team_id}`);
        const key = `${m.competition_id}|${season}`;
        this.compSeasonCount.set(key, (this.compSeasonCount.get(key) ?? 0) + 1);
      }
    }
    for (const arr of this.matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));
    for (const [t, arr] of this.matchesByTeam) this.datesByTeam.set(t, arr.map((m) => m.utc_date.slice(0, 10)));

    for (const m of compAvgMatches) {
      const dates = this.compAvgDates.get(m.competition_id) ?? [];
      const prefix = this.compAvgPrefix.get(m.competition_id) ?? [0];
      dates.push(m.utc_date.slice(0, 10));
      prefix.push(prefix[prefix.length - 1] + m.home_score + m.away_score);
      this.compAvgDates.set(m.competition_id, dates);
      this.compAvgPrefix.set(m.competition_id, prefix);
    }

    // Urutan musim per kompetisi menurut tanggal minimum musim itu.
    const seasonMinDate = new Map<string, string>();
    for (const m of universeMatches) {
      const season = seasonByMatchId.get(m.match_id);
      if (!season) continue;
      const key = `${m.competition_id}|${season}`;
      const d = m.utc_date.slice(0, 10);
      if (!seasonMinDate.has(key) || d < seasonMinDate.get(key)!) seasonMinDate.set(key, d);
    }
    const byComp = new Map<string, { season: string; minDate: string }[]>();
    for (const [key, minDate] of seasonMinDate) {
      const sep = key.indexOf("|");
      const comp = key.slice(0, sep);
      const season = key.slice(sep + 1);
      const arr = byComp.get(comp) ?? [];
      arr.push({ season, minDate });
      byComp.set(comp, arr);
    }
    for (const [comp, arr] of byComp) {
      arr.sort((a, b) => (a.minDate < b.minDate ? -1 : a.minDate > b.minDate ? 1 : a.season.localeCompare(b.season)));
      this.seasonsByComp.set(comp, arr.map((x) => x.season));
    }
    this.seasonByMatchId = seasonByMatchId;
  }

  private readonly seasonByMatchId: Map<string, string>;

  /** Rata-rata gol per tim per laga kompetisi, strictly-before cutoff (semantik evaluator). */
  compAvgAt(compId: string | null, cutoff: string): number | null {
    if (!compId) return null;
    const dates = this.compAvgDates.get(compId);
    const prefix = this.compAvgPrefix.get(compId);
    if (dates && prefix) {
      const n = upperBoundDate(dates, cutoff);
      if (n > 0) return prefix[n] / (2 * n);
    }
    return LEGACY_COMP_AVG[compId] ?? null;
  }

  /** Tanggal laga terakhir tim strictly sebelum cutoff (null bila belum ada). */
  private prevMatchDate(teamId: string, cutoff: string): string | null {
    const dates = this.datesByTeam.get(teamId);
    if (!dates) return null;
    const end = upperBoundDate(dates, cutoff);
    return end > 0 ? dates[end - 1] : null;
  }

  /** ≤6 laga terakhir tim strictly sebelum cutoff, urutan kronologis. */
  private prevMatches(teamId: string, cutoff: string): EvalMatchRow[] {
    const ms = this.matchesByTeam.get(teamId);
    const dates = this.datesByTeam.get(teamId);
    if (!ms || !dates) return [];
    const end = upperBoundDate(dates, cutoff);
    return ms.slice(Math.max(0, end - 6), end);
  }

  /** Status promosi tim di kompetisi-musim (design §4 butir 3). */
  promoted(teamId: string, compId: string, season: string | undefined): number {
    if (!season) return 0;
    const seasons = this.seasonsByComp.get(compId);
    if (!seasons) return 0;
    const idx = seasons.indexOf(season);
    if (idx <= 0) return 0; // musim pertama kompetisi di data — tak bisa dibedakan dari pendiri
    const prev = seasons[idx - 1];
    if ((this.compSeasonCount.get(`${compId}|${prev}`) ?? 0) < 50) return 0;
    return this.teamSeasonPresent.has(`${compId}|${prev}|${teamId}`) ? 0 : 1;
  }

  /** Residual form satu tim (design §4 butir 4). */
  private formResid(teamId: string, cutoff: string): { value: number; missing: number } {
    const prev = this.prevMatches(teamId, cutoff);
    if (prev.length < 3) return { value: 0, missing: 1 };
    let sum = 0;
    let n = 0;
    for (const pm of prev) {
      const avg = this.compAvgAt(pm.competition_id, pm.utc_date.slice(0, 10));
      if (avg === null) continue;
      const gf = pm.home_team_id === teamId ? pm.home_score : pm.away_score;
      sum += gf - avg;
      n++;
    }
    if (n < 3) return { value: 0, missing: 1 };
    return { value: clamp(sum / n, -2, 2), missing: 0 };
  }

  /** Fitur lengkap satu laga. Murni dari indeks yang dibangun di konstruktor. */
  featuresFor(m: EvalMatchRow): Q1MatchFeatures {
    const cutoff = m.utc_date.slice(0, 10);
    const prevH = this.prevMatchDate(m.home_team_id, cutoff);
    const prevA = this.prevMatchDate(m.away_team_id, cutoff);
    let restDiff = 0;
    let missRest = 0;
    if (prevH === null || prevA === null) {
      missRest = 1;
    } else {
      const restH = (Date.parse(cutoff) - Date.parse(prevH)) / DAY_MS;
      const restA = (Date.parse(cutoff) - Date.parse(prevA)) / DAY_MS;
      restDiff = clamp((restH - restA) / 7, -3, 3);
    }
    const season = this.seasonByMatchId.get(m.match_id);
    const formH = this.formResid(m.home_team_id, cutoff);
    const formA = this.formResid(m.away_team_id, cutoff);
    return {
      home: {
        restAdv: restDiff,
        venueNeutral: 0,
        promoted: this.promoted(m.home_team_id, m.competition_id, season),
        formResid: formH.value,
        missRest,
        missForm: formH.missing,
      },
      away: {
        restAdv: -restDiff,
        venueNeutral: 0,
        promoted: this.promoted(m.away_team_id, m.competition_id, season),
        formResid: formA.value,
        missRest,
        missForm: formA.missing,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Fit Poisson terpenalti (satu sisi) — Newton deterministik dari β = 0
// ---------------------------------------------------------------------------

export interface PoissonFitRow {
  /** log intensitas champion (offset). */
  offsetLog: number;
  /** Vektor fitur penuh (Q1_FEATURE_NAMES); kolom di luar Q1_FITTED_IDX diabaikan. */
  x: number[];
  /** Gol aktual sisi itu. */
  y: number;
}

export interface PoissonFitResult {
  /** β vektor penuh; β[venue_neutral] selalu 0. */
  beta: number[];
  iterations: number;
  gradNormInf: number;
  converged: boolean;
  /** Poisson NLL rata-rata (tanpa konstanta log(y!)) pada baris fit, sesudah penalti dikecualikan. */
  meanNll: number;
}

/** Poisson NLL tanpa konstanta log(y!): λ − y·ln λ. */
export function poissonNll(y: number, lam: number): number {
  return lam - y * Math.log(lam);
}

/** Selesaikan sistem linear kecil Ax=b (eliminasi Gauss + pivot parsial). Null bila singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Fit β satu sisi: minimalkan mean_i[ λ_i − y_i·log λ_i ] + α·‖β‖²,
 * λ_i = exp(offsetLog_i + β·x_i), hanya atas kolom Q1_FITTED_IDX.
 * Newton murni dari β=0; deterministik byte-per-byte untuk masukan sama.
 */
export function fitPoissonRidge(rows: readonly PoissonFitRow[], alpha: number): PoissonFitResult {
  const idx = [...Q1_FITTED_IDX];
  const k = idx.length;
  const beta = new Array(Q1_FEATURE_NAMES.length).fill(0);
  const n = rows.length;
  if (n === 0) return { beta, iterations: 0, gradNormInf: 0, converged: false, meanNll: NaN };

  const grad = new Array(k).fill(0);
  let iterations = 0;
  let gradNorm = Infinity;
  let converged = false;

  for (let iter = 0; iter < 100; iter++) {
    iterations = iter + 1;
    grad.fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) {
      let eta = r.offsetLog;
      for (let j = 0; j < k; j++) eta += beta[idx[j]] * r.x[idx[j]];
      const lam = Math.exp(Math.min(eta, 50));
      const resid = lam - r.y;
      for (let j = 0; j < k; j++) {
        grad[j] += resid * r.x[idx[j]];
        for (let l = 0; l < k; l++) H[j][l] += lam * r.x[idx[j]] * r.x[idx[l]];
      }
    }
    for (let j = 0; j < k; j++) {
      grad[j] = grad[j] / n + 2 * alpha * beta[idx[j]];
      for (let l = 0; l < k; l++) H[j][l] = H[j][l] / n + (j === l ? 2 * alpha : 0);
    }
    gradNorm = Math.max(...grad.map(Math.abs));
    if (gradNorm < 1e-10) {
      converged = true;
      break;
    }
    let step = solveLinear(H, grad);
    if (step === null) {
      // Hessian singular (kolom degenerat pada α kecil): jitter diagonal lalu coba sekali.
      const Hj = H.map((row, j) => row.map((v, l) => v + (j === l ? 1e-8 : 0)));
      step = solveLinear(Hj, grad);
      if (step === null) break;
    }
    for (let j = 0; j < k; j++) beta[idx[j]] -= step[j];
  }

  let nll = 0;
  for (const r of rows) {
    let eta = r.offsetLog;
    for (let j = 0; j < k; j++) eta += beta[idx[j]] * r.x[idx[j]];
    nll += poissonNll(r.y, Math.exp(Math.min(eta, 50)));
  }
  return { beta, iterations, gradNormInf: gradNorm, converged, meanNll: nll / n };
}

/** Poisson NLL rata-rata satu sisi pada baris dengan β yang diberikan (tanpa penalti). */
export function meanPoissonNll(rows: readonly PoissonFitRow[], beta: readonly number[]): number {
  if (!rows.length) return NaN;
  let s = 0;
  for (const r of rows) {
    let eta = r.offsetLog;
    for (const j of Q1_FITTED_IDX) eta += beta[j] * r.x[j];
    s += poissonNll(r.y, Math.exp(Math.min(eta, 50)));
  }
  return s / rows.length;
}

// ---------------------------------------------------------------------------
// Aplikasi kandidat + probabilitas matriks
// ---------------------------------------------------------------------------

/** Batas intensitas kandidat yang didaftarkan sebelum H (design §4). */
export const Q1_LAM_MIN = 0.05;
export const Q1_LAM_MAX = 6.0;

/** Intensitas kandidat dari intensitas champion + fitur + β beku. */
export function applyCandidate(
  lamCh: number,
  muCh: number,
  feats: Q1MatchFeatures,
  betaHome: readonly number[],
  betaAway: readonly number[],
): { lam: number; mu: number } {
  const xh = featureVector(feats.home);
  const xa = featureVector(feats.away);
  let dh = 0;
  let da = 0;
  for (const j of Q1_FITTED_IDX) {
    dh += betaHome[j] * xh[j];
    da += betaAway[j] * xa[j];
  }
  return {
    lam: clamp(lamCh * Math.exp(dh), Q1_LAM_MIN, Q1_LAM_MAX),
    mu: clamp(muCh * Math.exp(da), Q1_LAM_MIN, Q1_LAM_MAX),
  };
}

export interface FullMatrixProbs {
  p: [number, number, number];
  pOver25: number;
  pBtts: number;
  fallback: boolean;
}

/**
 * Probabilitas 1X2 + OU2.5 + BTTS dari satu matriks Dixon-Coles.
 * Parameter pemanggilan calculateDixonColes IDENTIK dengan
 * matrixProbs evaluator PR 3 (homeAdvantage = lam/mu, leagueAvgGoals =
 * mu, rho, maxGoals 10) — 1X2/OU2.5 yang dihasilkan sama dengan jalur
 * evaluator; BTTS adalah jumlah sel tambahan dari matriks yang sama.
 */
export function fullMatrixProbs(lam: number, mu: number, rho: number): FullMatrixProbs {
  let dc;
  try {
    dc = calculateDixonColes({
      homeAttack: 1,
      homeDefense: 1,
      awayAttack: 1,
      awayDefense: 1,
      homeAdvantage: lam / mu,
      leagueAvgGoals: mu,
      rho,
      maxGoals: 10,
    });
  } catch {
    return { p: [1 / 3, 1 / 3, 1 / 3], pOver25: 0.5, pBtts: NaN, fallback: true };
  }
  let ph = 0,
    pd = 0,
    pa = 0,
    over = 0,
    btts = 0;
  const mx = dc.score_matrix;
  for (let x = 0; x < mx.length; x++) {
    for (let y = 0; y < mx[x].length; y++) {
      if (x > y) ph += mx[x][y];
      else if (x === y) pd += mx[x][y];
      else pa += mx[x][y];
      if (x + y > 2.5) over += mx[x][y];
      if (x >= 1 && y >= 1) btts += mx[x][y];
    }
  }
  return { p: [ph, pd, pa], pOver25: over, pBtts: btts, fallback: false };
}
