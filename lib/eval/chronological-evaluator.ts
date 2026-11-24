/**
 * EVALUATOR KRONOLOGIS TUNGGAL (PR 3 — Brief Data, Akurasi & Efisiensi,
 * bab "Evaluasi Kronologis" + "Kontrak Data Point-in-Time").
 *
 * Satu-satunya jalur resmi untuk mengukur akurasi headline model:
 * walk-forward per liga mengikuti lipatan kronologis V1/V2/H, dan
 * SETIAP kuantitas yang dipakai menilai sebuah laga (fit rating,
 * rata-rata gol kompetisi, form, telemetri bergulir) dihitung HANYA
 * dari laga dengan tanggal < tanggal laga itu (kontrak point-in-time).
 * Tidak ada agregat seluruh-store di jalur mode "as-of".
 *
 * Mesin numeriknya BUKAN tulisan baru: fitIPF, applyShrinkage,
 * lambdas, blendInput, lamMuFromBlend, rollingTelem, formGoals, dan
 * indeks prefix compAvg disalin verbatim dari harness kanonik
 * (scripts/backtest-walkforward.ts, sebagaimana dibekukan di
 * scripts/experiment-k5-kappa.ts) supaya evaluator ini mereproduksi
 * angka K5 persis dalam konfigurasi K5 — lihat laporan PR 3.
 *
 * SATU penyimpangan yang disengaja dan terlabel: mode
 * `compAvgMode: "whole-store"` mereplikasi kebocoran historis
 * scripts/parlay-lab.ts, yang membaca rata-rata kompetisi dari
 * SELURUH store tanpa batas waktu (measuredCompAvg). Mode itu hanya
 * untuk diagnosis asal-usul angka lama (rekonsiliasi benchmark
 * penutupan) — BUKAN untuk pengukuran headline. Diff fungsi antara
 * harness dan parlay-lab membuktikan satu-satunya perbedaan
 * fungsional Level B di antara keduanya adalah cakupan waktu
 * compAvg ini (lampiran laporan PR 3).
 *
 * Modul ini murni: tidak membaca file, tidak menulis DB, tidak
 * memanggil Date.now/Math.random. Pemanggil (CLI
 * scripts/evaluate-chronological.ts, suite tests) menyerahkan baris
 * data dalam urutan kanonik SQL harness:
 *   matches  : ORDER BY competition_id, utc_date
 *   logs     : ORDER BY team_id, match_date
 * Urutan itu bagian dari kontrak determinisme: masukan sama →
 * keluaran identik byte-per-byte.
 */
import { calculateDixonColes } from "../quant/dixon-coles";

// ---------------------------------------------------------------------------
// Tipe data (bentuk baris sama dengan harness)
// ---------------------------------------------------------------------------

export interface EvalMatchRow {
  match_id: string;
  competition_id: string;
  utc_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

export interface EvalLogRow {
  team_id: string;
  match_date: string;
  goals_for: number;
  goals_against: number;
  xg_for: number | null;
  xg_against: number | null;
  competition_id: string | null;
}

/** "as-of" = point-in-time (resmi). "whole-store" = replika kebocoran lab lama (diagnosis saja). */
export type CompAvgMode = "as-of" | "whole-store";

export interface ChronoEvalConfig {
  /** κ-fit penyusutan rating (champion produksi: 10). */
  kfit: number;
  /** Half-life pembobotan IPF dalam hari (produksi: 365). */
  halfLifeDays: number;
  /** Kebijakan rho Dixon-Coles (produksi: 0 — "rho zero"). */
  rho: number;
  /** Skala kappa blend James-Stein Level B (produksi: 2 — "js2"). */
  kappaScale: number;
  compAvgMode: CompAvgMode;
}

/** Konfigurasi champion yang sedang melayani (manifest 2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2). */
export const CHAMPION_CONFIG: ChronoEvalConfig = {
  kfit: 10,
  halfLifeDays: 365,
  rho: 0,
  kappaScale: 2,
  compAvgMode: "as-of",
};

// ---------------------------------------------------------------------------
// Lipatan kronologis (verbatim dari harness)
// ---------------------------------------------------------------------------

export const EVAL_FOLDS = [
  { name: "V1", trainEnd: 0.55, testStart: 0.55, testEnd: 0.7 },
  { name: "V2", trainEnd: 0.7, testStart: 0.7, testEnd: 0.85 },
  { name: "H", trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 },
] as const;
export type EvalFold = (typeof EVAL_FOLDS)[number];
export type EvalFoldName = EvalFold["name"];

/**
 * Lipatan pemilik indeks laga ke-i dalam daftar liga terurut waktu,
 * dengan semantik irisan yang sama seperti pembangkit ledger
 * (generateDomestic): blok uji fold = slice(floor(n*testStart),
 * floor(n*testEnd)). Indeks di wilayah latih murni (< 55%) → null
 * (laga itu tidak pernah dinilai sebagai laga uji).
 */
export function foldForIndex(n: number, idx: number): EvalFold | null {
  for (const f of EVAL_FOLDS) {
    if (idx >= Math.floor(n * f.testStart) && idx < Math.floor(n * f.testEnd)) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mesin fit (verbatim dari backtest-walkforward.ts via experiment-k5-kappa.ts)
// ---------------------------------------------------------------------------

export interface EvalFit {
  avgAway: number;
  ha: number;
  attack: Map<string, number>;
  defense: Map<string, number>;
}

export function fitIPF(matches: EvalMatchRow[], refMs: number, halfLifeDays: number): EvalFit | null {
  const teamIdx = new Map<string, number>();
  for (const m of matches) {
    if (!teamIdx.has(m.home_team_id)) teamIdx.set(m.home_team_id, teamIdx.size);
    if (!teamIdx.has(m.away_team_id)) teamIdx.set(m.away_team_id, teamIdx.size);
  }
  const T = teamIdx.size;
  const n = matches.length;
  if (T < 4 || n === 0) return null;

  const hi = new Int32Array(n);
  const ai = new Int32Array(n);
  const hs = new Float64Array(n);
  const as = new Float64Array(n);
  const w = new Float64Array(n);
  let wSum = 0,
    hSum = 0,
    aSum = 0;
  for (let i = 0; i < n; i++) {
    const m = matches[i];
    hi[i] = teamIdx.get(m.home_team_id)!;
    ai[i] = teamIdx.get(m.away_team_id)!;
    hs[i] = m.home_score;
    as[i] = m.away_score;
    w[i] = halfLifeDays === Infinity ? 1 : Math.pow(0.5, (refMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
    wSum += w[i];
    hSum += w[i] * hs[i];
    aSum += w[i] * as[i];
  }
  const muH = hSum / wSum;
  const muA = aSum / wSum;
  if (!(muA > 0) || !(muH > 0)) return null;
  const lgAvg = muA;
  const ha = muH / muA;

  const attack = new Float64Array(T).fill(1);
  const defense = new Float64Array(T).fill(1);
  const baseH = new Float64Array(n);
  const baseA = new Float64Array(n);
  const num = new Float64Array(T);
  const den = new Float64Array(T);

  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      baseH[i] = lgAvg * defense[ai[i]] * ha;
      baseA[i] = lgAvg * defense[hi[i]];
    }
    num.fill(0);
    den.fill(0);
    for (let i = 0; i < n; i++) {
      num[hi[i]] += w[i] * hs[i];
      den[hi[i]] += w[i] * baseH[i];
      num[ai[i]] += w[i] * as[i];
      den[ai[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - attack[t]);
        if (d > maxDelta) maxDelta = d;
        attack[t] = next;
      }
    }
    for (let i = 0; i < n; i++) {
      baseH[i] = lgAvg * attack[hi[i]] * ha;
      baseA[i] = lgAvg * attack[ai[i]];
    }
    num.fill(0);
    den.fill(0);
    for (let i = 0; i < n; i++) {
      num[ai[i]] += w[i] * hs[i];
      den[ai[i]] += w[i] * baseH[i];
      num[hi[i]] += w[i] * as[i];
      den[hi[i]] += w[i] * baseA[i];
    }
    for (let t = 0; t < T; t++) {
      if (den[t] > 0) {
        const next = num[t] / den[t];
        const d = Math.abs(next - defense[t]);
        if (d > maxDelta) maxDelta = d;
        defense[t] = next;
      }
    }
    let ma = 0,
      md = 0;
    for (let t = 0; t < T; t++) {
      ma += attack[t];
      md += defense[t];
    }
    ma /= T;
    md /= T;
    if (ma > 0) for (let t = 0; t < T; t++) attack[t] /= ma;
    if (md > 0) for (let t = 0; t < T; t++) defense[t] /= md;
    if (maxDelta < 1e-7) break;
  }

  const attackMap = new Map<string, number>();
  const defenseMap = new Map<string, number>();
  for (const [team, idx] of teamIdx) {
    attackMap.set(team, attack[idx]);
    defenseMap.set(team, defense[idx]);
  }
  return { avgAway: lgAvg, ha, attack: attackMap, defense: defenseMap };
}

export function fitLambdas(fit: EvalFit, homeId: string, awayId: string): { lam: number; mu: number } {
  const lam = fit.avgAway * (fit.attack.get(homeId) ?? 1) * (fit.defense.get(awayId) ?? 1) * fit.ha;
  const mu = fit.avgAway * (fit.attack.get(awayId) ?? 1) * (fit.defense.get(homeId) ?? 1);
  return { lam, mu };
}

export function applyShrinkage(fit: EvalFit, train: EvalMatchRow[], kappa: number): EvalFit {
  if (kappa <= 0) return fit;
  const counts = new Map<string, number>();
  for (const m of train) {
    counts.set(m.home_team_id, (counts.get(m.home_team_id) ?? 0) + 1);
    counts.set(m.away_team_id, (counts.get(m.away_team_id) ?? 0) + 1);
  }
  const shrink = (mp: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    let sum = 0;
    for (const [t, v] of mp) {
      const nt = counts.get(t) ?? 0;
      const wgt = nt / (nt + kappa);
      const nv = Math.exp(Math.log(Math.max(1e-6, v)) * wgt);
      out.set(t, nv);
      sum += nv;
    }
    const mean = out.size ? sum / out.size : 1;
    if (mean > 0) for (const [t, v] of out) out.set(t, v / mean);
    return out;
  };
  return { avgAway: fit.avgAway, ha: fit.ha, attack: shrink(fit.attack), defense: shrink(fit.defense) };
}

// ---------------------------------------------------------------------------
// Probabilitas dari matriks Dixon-Coles (semantik probsFromLib harness;
// penjumlahan 1X2 dalam urutan loop yang sama persis, ditambah OU2.5
// dari matriks yang sama — penjumlahan tambahan tidak mengubah
// jumlah parsial 1X2)
// ---------------------------------------------------------------------------

export interface MatrixProbs {
  /** [home, draw, away] */
  p: [number, number, number];
  pOver25: number;
  pUnder25: number;
  /** true bila matriks patologik → fallback uniform (penanda harness). */
  fallback: boolean;
}

export function matrixProbs(lam: number, mu: number, rho: number): MatrixProbs {
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
    return { p: [1 / 3, 1 / 3, 1 / 3], pOver25: 0.5, pUnder25: 0.5, fallback: true };
  }
  let ph = 0,
    pd = 0,
    pa = 0,
    over = 0;
  const mx = dc.score_matrix;
  for (let x = 0; x < mx.length; x++) {
    for (let y = 0; y < mx[x].length; y++) {
      if (x > y) ph += mx[x][y];
      else if (x === y) pd += mx[x][y];
      else pa += mx[x][y];
      if (x + y > 2.5) over += mx[x][y];
    }
  }
  return { p: [ph, pd, pa], pOver25: over, pUnder25: 1 - over, fallback: false };
}

// ---------------------------------------------------------------------------
// Rata-rata kompetisi warisan (verbatim dari harness) — dipakai HANYA
// sebagai fallback bila kompetisi belum punya laga sebelum cutoff.
// ---------------------------------------------------------------------------

export const LEGACY_COMP_AVG: Record<string, number> = {
  comp_3039: 1.48,
  comp_8814: 1.54,
  comp_5840: 1.43,
  comp_4643: 1.91,
  comp_0256: 1.45,
  comp_3809: 1.87,
  comp_3498: 2.04,
};

/** Jumlah tanggal yang strictly < cutoff (verbatim dari harness). */
export function upperBoundDate(dates: string[], cutoff: string): number {
  let lo = 0,
    hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const round2 = (v: number) => Number(v.toFixed(2));
const round3 = (v: number) => Number(v.toFixed(3));

export interface RollingTelem {
  sampleSize: number;
  xgSamples: number;
  rollingXgFor: number | null;
  rollingXgAgainst: number | null;
  rollingGoalsFor: number;
  rollingGoalsAgainst: number;
}

export interface BlendInput {
  fixedLamMu: { lam: number; mu: number } | null;
  priorAttH: number;
  priorDefH: number;
  priorAttA: number;
  priorDefA: number;
  liveAttH: number;
  liveDefH: number;
  liveAttA: number;
  liveDefA: number;
  nH: number;
  nA: number;
  kapH: number;
  kapA: number;
  avg: number;
  ha: number;
}

export interface MatchPrediction extends MatrixProbs {
  lam: number;
  mu: number;
  fold: EvalFoldName | null;
  /** Alasan fallback bila fit liga tidak tersedia (di luar fallback matriks). */
  fitFallback: boolean;
}

interface CompAvgIndex {
  dates: string[];
  prefixGoals: number[];
}

/**
 * Evaluator kronologis. Satu instans = satu konfigurasi (termasuk
 * mode compAvg). Seluruh indeks dibangun sekali dari baris masukan;
 * tidak ada state yang berubah sesudah konstruksi selain cache fit
 * (murni memoization — nilai yang sama selalu dihasilkan).
 */
export class ChronologicalEvaluator {
  readonly config: ChronoEvalConfig;
  private readonly byComp = new Map<string, EvalMatchRow[]>();
  private readonly matchesByTeam = new Map<string, EvalMatchRow[]>();
  private readonly matchDatesByTeam = new Map<string, string[]>();
  private readonly logsByTeam = new Map<string, EvalLogRow[]>();
  private readonly logDatesByTeam = new Map<string, string[]>();
  private readonly compAvgIndex = new Map<string, CompAvgIndex>();
  private readonly fitCache = new Map<string, EvalFit | null>();

  /**
   * @param universeMatches baris laga universe fit (urutan: competition_id, utc_date)
   * @param compAvgMatches  baris SEMUA laga selesai (kompetisi apa pun) untuk
   *                        indeks rata-rata kompetisi (urutan sama)
   * @param logs            baris telemetri per tim (urutan: team_id, match_date)
   */
  constructor(universeMatches: EvalMatchRow[], compAvgMatches: EvalMatchRow[], logs: EvalLogRow[], config: ChronoEvalConfig) {
    this.config = config;
    for (const m of universeMatches) {
      const arr = this.byComp.get(m.competition_id) ?? [];
      arr.push(m);
      this.byComp.set(m.competition_id, arr);
      const th = this.matchesByTeam.get(m.home_team_id) ?? [];
      th.push(m);
      this.matchesByTeam.set(m.home_team_id, th);
      const ta = this.matchesByTeam.get(m.away_team_id) ?? [];
      ta.push(m);
      this.matchesByTeam.set(m.away_team_id, ta);
    }
    for (const arr of this.matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));
    for (const [t, arr] of this.matchesByTeam) this.matchDatesByTeam.set(t, arr.map((m) => m.utc_date.slice(0, 10)));
    for (const l of logs) {
      const arr = this.logsByTeam.get(l.team_id) ?? [];
      arr.push(l);
      this.logsByTeam.set(l.team_id, arr);
    }
    for (const [t, arr] of this.logsByTeam) this.logDatesByTeam.set(t, arr.map((l) => l.match_date));
    for (const m of compAvgMatches) {
      let idx = this.compAvgIndex.get(m.competition_id);
      if (!idx) {
        idx = { dates: [], prefixGoals: [0] };
        this.compAvgIndex.set(m.competition_id, idx);
      }
      idx.dates.push(m.utc_date.slice(0, 10));
      idx.prefixGoals.push(idx.prefixGoals[idx.prefixGoals.length - 1] + m.home_score + m.away_score);
    }
  }

  /** Daftar laga satu liga dalam urutan kanonik (kosong bila tak dikenal). */
  leagueMatches(leagueId: string): EvalMatchRow[] {
    return this.byComp.get(leagueId) ?? [];
  }

  leagueIds(): string[] {
    return [...this.byComp.keys()];
  }

  /**
   * Rata-rata gol per laga kompetisi dari laga dengan tanggal < cutoff
   * (indeks prefix point-in-time, verbatim dari harness). Fallback
   * LEGACY_COMP_AVG bila belum ada riwayat; null bila keduanya kosong.
   */
  compAvgGoalsAt(compId: string | null, cutoff: string): number | null {
    if (!compId) return null;
    const idx = this.compAvgIndex.get(compId);
    if (idx) {
      const n = upperBoundDate(idx.dates, cutoff);
      if (n > 0) return idx.prefixGoals[n] / (2 * n);
    }
    return LEGACY_COMP_AVG[compId] ?? null;
  }

  /**
   * REPLIKA KEBOCORAN parlay-lab: rata-rata dari SELURUH store tanpa
   * batas waktu (measuredCompAvg). HANYA untuk diagnosis angka lama.
   * Rantai fallback sama dengan compAvgGoalsAt.
   */
  compAvgGoalsWholeStore(compId: string | null): number | null {
    if (!compId) return null;
    const idx = this.compAvgIndex.get(compId);
    if (idx && idx.dates.length > 0) {
      return idx.prefixGoals[idx.prefixGoals.length - 1] / (2 * idx.dates.length);
    }
    return LEGACY_COMP_AVG[compId] ?? null;
  }

  /** Titik dispatch satu-satunya antara mode jujur dan mode bocor. */
  private compAvg(compId: string | null, cutoff: string): number | null {
    return this.config.compAvgMode === "whole-store" ? this.compAvgGoalsWholeStore(compId) : this.compAvgGoalsAt(compId, cutoff);
  }

  /** Telemetri bergulir 6 laga strictly sebelum cutoff (verbatim dari harness). */
  rollingTelem(teamId: string, cutoff: string, targetCompId: string): RollingTelem {
    const empty: RollingTelem = { sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0 };
    const logs = this.logsByTeam.get(teamId);
    const dates = this.logDatesByTeam.get(teamId);
    if (!logs || !dates) return empty;
    const end = upperBoundDate(dates, cutoff);
    const win = logs.slice(Math.max(0, end - 6), end);
    if (!win.length) return empty;
    const targetAvg = this.compAvg(targetCompId, cutoff) ?? 1.48;
    let gf = 0,
      ga = 0,
      sxf = 0,
      cxf = 0,
      sxa = 0,
      cxa = 0;
    for (const log of win) {
      gf += log.goals_for;
      ga += log.goals_against;
      let wgt = 1.0;
      if (log.competition_id && log.competition_id !== targetCompId) {
        const logAvg = this.compAvg(log.competition_id, cutoff);
        if (logAvg && logAvg > 0) wgt = round3(targetAvg / logAvg);
      }
      if (log.xg_for !== null && log.xg_for !== undefined) {
        sxf += log.xg_for * wgt;
        cxf++;
      }
      if (log.xg_against !== null && log.xg_against !== undefined) {
        sxa += log.xg_against * wgt;
        cxa++;
      }
    }
    return {
      sampleSize: win.length,
      xgSamples: cxf,
      rollingXgFor: cxf > 0 ? round2(sxf / cxf) : null,
      rollingXgAgainst: cxa > 0 ? round2(sxa / cxa) : null,
      rollingGoalsFor: round2(gf / win.length),
      rollingGoalsAgainst: round2(ga / win.length),
    };
  }

  /** Rata-rata gol dicetak dalam 6 laga terakhir strictly sebelum cutoff (verbatim). */
  formGoals(teamId: string, cutoff: string): { avg: number | null; n: number } {
    const ms = this.matchesByTeam.get(teamId);
    const dates = this.matchDatesByTeam.get(teamId);
    if (!ms || !dates) return { avg: null, n: 0 };
    const end = upperBoundDate(dates, cutoff);
    const win = ms.slice(Math.max(0, end - 6), end);
    if (!win.length) return { avg: null, n: 0 };
    let g = 0;
    for (const m of win) g += m.home_team_id === teamId ? m.home_score : m.away_score;
    return { avg: g / win.length, n: win.length };
  }

  /** Irisan lipatan (verbatim dari harness foldSlice). */
  foldSlice(leagueId: string, fold: EvalFold): { train: EvalMatchRow[]; test: EvalMatchRow[]; refMs: number } {
    const ms = this.leagueMatches(leagueId);
    const n = ms.length;
    const train = ms.slice(0, Math.floor(n * fold.trainEnd));
    const test = ms.slice(Math.floor(n * fold.testStart), Math.floor(n * fold.testEnd));
    const refMs = test.length ? Date.parse(test[0].utc_date) : Date.parse(train[train.length - 1].utc_date);
    return { train, test, refMs };
  }

  /** Fit lipatan dengan penyusutan κ-fit konfigurasi (cache per liga|fold|kfit). */
  foldFit(leagueId: string, fold: EvalFold, kfitOverride?: number): { fit: EvalFit | null; train: EvalMatchRow[]; test: EvalMatchRow[]; refMs: number } {
    const { train, test, refMs } = this.foldSlice(leagueId, fold);
    const kfit = kfitOverride ?? this.config.kfit;
    const key = `${leagueId}|${fold.name}|${this.config.halfLifeDays}|k${kfit}`;
    if (!this.fitCache.has(key)) {
      const raw = fitIPF(train, refMs, this.config.halfLifeDays);
      this.fitCache.set(key, raw ? applyShrinkage(raw, train, kfit) : null);
    }
    return { fit: this.fitCache.get(key)!, train, test, refMs };
  }

  /** Masukan blend Level B (verbatim dari harness blendInput). */
  blendInput(fit: EvalFit, m: EvalMatchRow): BlendInput {
    const avg = fit.avgAway;
    const cutoff = m.utc_date.slice(0, 10);
    const formH = this.formGoals(m.home_team_id, cutoff);
    const formA = this.formGoals(m.away_team_id, cutoff);
    const inFitH = fit.attack.has(m.home_team_id);
    const inFitA = fit.attack.has(m.away_team_id);

    if (!inFitH && !inFitA) {
      const attH = formH.avg || 1.35;
      const attA = formA.avg || 1.15;
      const defH = Math.max(0.6, 2.5 - (formA.avg || 1.2));
      const defA = Math.max(0.7, 2.6 - (formH.avg || 1.35));
      return {
        fixedLamMu: {
          lam: avg * attH * defA * fit.ha,
          mu: avg * attA * defH,
        },
        priorAttH: 1, priorDefH: 1, priorAttA: 1, priorDefA: 1,
        liveAttH: 1, liveDefH: 1, liveAttA: 1, liveDefA: 1,
        nH: 0, nA: 0, kapH: 16, kapA: 16, avg, ha: fit.ha,
      };
    }

    const telemH = this.rollingTelem(m.home_team_id, cutoff, m.competition_id);
    const telemA = this.rollingTelem(m.away_team_id, cutoff, m.competition_id);

    let liveAttH = (formH.avg && formH.avg > 0 ? formH.avg : 1.35) / avg;
    let liveAttA = (formA.avg && formA.avg > 0 ? formA.avg : 1.15) / avg;
    let liveDefH = Math.max(0.6, 2.0 - liveAttA);
    let liveDefA = Math.max(0.7, 2.0 - liveAttH);
    let nH = formH.n > 0 ? formH.n : 5;
    let nA = formA.n > 0 ? formA.n : 5;
    let kapH = 16;
    let kapA = 16;

    if (telemH.xgSamples >= 3 && telemH.rollingXgFor !== null) {
      liveAttH = telemH.rollingXgFor / avg;
      if (telemH.rollingXgAgainst !== null) liveDefH = telemH.rollingXgAgainst / avg;
      nH = telemH.xgSamples;
      kapH = 8;
    } else if (telemH.sampleSize >= 1) {
      liveAttH = telemH.rollingGoalsFor / avg;
      liveDefH = telemH.rollingGoalsAgainst / avg;
      nH = telemH.sampleSize;
      kapH = 14;
    }
    if (telemA.xgSamples >= 3 && telemA.rollingXgFor !== null) {
      liveAttA = telemA.rollingXgFor / avg;
      if (telemA.rollingXgAgainst !== null) liveDefA = telemA.rollingXgAgainst / avg;
      nA = telemA.xgSamples;
      kapA = 8;
    } else if (telemA.sampleSize >= 1) {
      liveAttA = telemA.rollingGoalsFor / avg;
      liveDefA = telemA.rollingGoalsAgainst / avg;
      nA = telemA.sampleSize;
      kapA = 14;
    }

    return {
      fixedLamMu: null,
      priorAttH: fit.attack.get(m.home_team_id) ?? 1,
      priorDefH: fit.defense.get(m.home_team_id) ?? 1,
      priorAttA: fit.attack.get(m.away_team_id) ?? 1,
      priorDefA: fit.defense.get(m.away_team_id) ?? 1,
      liveAttH, liveDefH, liveAttA, liveDefA,
      nH, nA, kapH, kapA, avg, ha: fit.ha,
    };
  }

  /** λ/μ dari masukan blend (verbatim dari harness lamMuFromBlend). */
  lamMuFromBlend(bi: BlendInput): { lam: number; mu: number } {
    if (bi.fixedLamMu) return bi.fixedLamMu;
    const kappaScale = this.config.kappaScale;
    const wH = bi.nH / (bi.nH + bi.kapH * kappaScale);
    const wA = bi.nA / (bi.nA + bi.kapA * kappaScale);
    const attH = Math.max(0.5, round3(wH * bi.liveAttH + (1 - wH) * bi.priorAttH));
    const defH = Math.max(0.5, round3(wH * bi.liveDefH + (1 - wH) * bi.priorDefH));
    const attA = Math.max(0.4, round3(wA * bi.liveAttA + (1 - wA) * bi.priorAttA));
    const defA = Math.max(0.5, round3(wA * bi.liveDefA + (1 - wA) * bi.priorDefA));
    return { lam: bi.avg * attH * defA * bi.ha, mu: bi.avg * attA * defH };
  }

  /** Prediksi Level A (rating murni) untuk satu laga dengan fit yang diberikan. */
  predictLevelA(fit: EvalFit, m: EvalMatchRow): MatrixProbs & { lam: number; mu: number } {
    const { lam, mu } = fitLambdas(fit, m.home_team_id, m.away_team_id);
    return { ...matrixProbs(lam, mu, this.config.rho), lam, mu };
  }

  /** Prediksi Level B (rating + blend telemetri/form) — jalur produksi. */
  predictLevelB(fit: EvalFit, m: EvalMatchRow): MatrixProbs & { lam: number; mu: number } {
    const { lam, mu } = this.lamMuFromBlend(this.blendInput(fit, m));
    return { ...matrixProbs(lam, mu, this.config.rho), lam, mu };
  }

  /**
   * Prediksi Level B satu laga lewat lipatannya sendiri (semantik
   * generateDomestic). Fit null (liga terlalu kecil) → fallback
   * uniform terlabel, BUKAN angka diam-diam.
   */
  predictMatchLevelB(m: EvalMatchRow, kfitOverride?: number): MatchPrediction {
    const ms = this.leagueMatches(m.competition_id);
    const idx = ms.findIndex((x) => x.match_id === m.match_id);
    const fold = idx >= 0 ? foldForIndex(ms.length, idx) : null;
    if (!fold) {
      return { p: [1 / 3, 1 / 3, 1 / 3], pOver25: 0.5, pUnder25: 0.5, fallback: true, lam: 0, mu: 0, fold: null, fitFallback: true };
    }
    const { fit } = this.foldFit(m.competition_id, fold, kfitOverride);
    if (!fit) {
      return { p: [1 / 3, 1 / 3, 1 / 3], pOver25: 0.5, pUnder25: 0.5, fallback: true, lam: 0, mu: 0, fold: fold.name, fitFallback: true };
    }
    const pred = this.predictLevelB(fit, m);
    return { ...pred, fold: fold.name, fitFallback: false };
  }
}

// ---------------------------------------------------------------------------
// Metrik — dua konvensi log-loss yang hidup di repo, keduanya terlabel:
//  (a) konvensi harness/K5: p dijepit ke [1e-12, 1−1e-12]
//      (kelas Acc di backtest-walkforward.ts / experiment-k5-kappa.ts);
//  (b) konvensi benchmark penutupan lama: −ln(p) TANPA jepit
//      (scripts/closing-benchmark.ts).
// Brier selalu tanpa jepit: Σ_k (p[k] − 1[k=y])².
// ---------------------------------------------------------------------------

/** Indeks hasil 1X2: 0 = kandang, 1 = seri, 2 = tandang. */
export function outcomeIndex(homeScore: number, awayScore: number): 0 | 1 | 2 {
  return homeScore > awayScore ? 0 : homeScore === awayScore ? 1 : 2;
}

export function logLossClamped(p: readonly number[], y: number): number {
  const pc = Math.min(1 - 1e-12, Math.max(1e-12, p[y]));
  return -Math.log(pc);
}

export function logLossRaw(p: readonly number[], y: number): number {
  return -Math.log(p[y]);
}

export function brierScore(p: readonly number[], y: number): number {
  let s = 0;
  for (let k = 0; k < p.length; k++) s += (p[k] - (k === y ? 1 : 0)) ** 2;
  return s;
}

export interface ScoredRow {
  p: [number, number, number];
  y: 0 | 1 | 2;
  fallback?: boolean;
}

export interface MetricSummary {
  n: number;
  /** Log-loss konvensi harness (jepit 1e-12), presisi penuh. */
  logloss: number;
  /** Log-loss tanpa jepit (konvensi benchmark penutupan), presisi penuh. */
  loglossRaw: number;
  brier: number;
  /** ECE 10 bin tetap per kelas, dirata-rata 3 kelas (semantik kelas Acc harness). */
  ece: number;
  fallbacks: number;
  coverage: number;
}

export function summarizePredictions(rows: readonly ScoredRow[]): MetricSummary {
  const bins: { sumP: number; sumY: number; n: number }[][] = [0, 1, 2].map(() =>
    Array.from({ length: 10 }, () => ({ sumP: 0, sumY: 0, n: 0 })),
  );
  let ll = 0,
    llRaw = 0,
    brier = 0,
    fallbacks = 0;
  for (const r of rows) {
    ll += logLossClamped(r.p, r.y);
    llRaw += logLossRaw(r.p, r.y);
    brier += brierScore(r.p, r.y);
    if (r.fallback) fallbacks++;
    for (let c = 0; c < 3; c++) {
      const bin = bins[c][Math.min(9, Math.floor(r.p[c] * 10))];
      bin.sumP += r.p[c];
      bin.sumY += c === r.y ? 1 : 0;
      bin.n++;
    }
  }
  const n = rows.length;
  let eceSum = 0;
  for (let c = 0; c < 3; c++) {
    let e = 0;
    for (const b of bins[c]) if (b.n > 0) e += b.n * Math.abs(b.sumP / b.n - b.sumY / b.n);
    eceSum += n > 0 ? e / n : 0;
  }
  return {
    n,
    logloss: n ? ll / n : NaN,
    loglossRaw: n ? llRaw / n : NaN,
    brier: n ? brier / n : NaN,
    ece: n ? eceSum / 3 : NaN,
    fallbacks,
    coverage: n ? 1 - fallbacks / n : NaN,
  };
}

/** Kunci pekan ISO (verbatim dari experiment-k5-kappa.ts) — blok bootstrap berpasangan. */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Senin = 0
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - day + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const jan1Day = (jan1.getUTCDay() + 6) % 7;
  const firstThursday = new Date(jan1);
  firstThursday.setUTCDate(jan1.getUTCDate() - jan1Day + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
