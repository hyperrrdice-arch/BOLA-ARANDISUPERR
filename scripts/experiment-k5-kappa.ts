/**
 * RUNNER EKSPERIMEN K5 — kandidat κ-fit 20 vs champion κ-fit 10.
 *
 * Menjalankan desain BEKU di tasks/experiments/k5-kappa/DESIGN.md
 * (di-commit sebelum runner ini ada; dokumen itu sumber kebenaran
 * desainnya — bab Model Q3/Q4 + kartu K5):
 *
 *  - Sumbu tunggal κ-fit ∈ {5, 10, 15, 20}; hl365, ρ zero, blend
 *    James-Stein kappaScale 2 dibekukan untuk semua konfigurasi.
 *  - Lipatan kronologis per liga harness walk-forward: V1/V2 untuk
 *    sapuan penuh; H HANYA untuk pasangan keputusan (10, 20).
 *  - Level A = rating murni; Level B = replikasi jalur produksi
 *    (permukaan keputusan utama, di H).
 *  - Mesin evaluasi (pemuatan data, fitIPF, applyShrinkage,
 *    probsFromLib, akumulator metrik, blendInput Level B, panel
 *    closing) DISALIN VERBATIM dari scripts/backtest-walkforward.ts
 *    agar angka sebanding dengan gerbang Fase 3 — runner ini tidak
 *    menulis ulang mesin rating dan tidak menulis DB mana pun
 *    (dataset dibuka read-only; keluaran hanya artefak eksperimen).
 *  - Bootstrap blok pekan + aturan keputusan memakai fungsi murni
 *    lib/quant/experiment-stats.ts (yang diuji suite test:quant).
 *
 * Pakai:
 *   npx tsx scripts/experiment-k5-kappa.ts \
 *     --dataset-dir=/path/ke/data --out=tasks/experiments/k5-kappa
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { fitLeagueRatings } from "../lib/quant/fit";
import {
  applyKappaDecision,
  blockBootstrapDelta,
  KAPPA_DECISION_THRESHOLDS,
  type PairedDeltaRow,
} from "../lib/quant/experiment-stats";
import { dbDir } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const DATASET_DIR = argVal("dataset-dir", process.env.K5_DATASET_DIR ?? dbDir());
const OUT_DIR = argVal("out", "tasks/experiments/k5-kappa");
const MIN_MATCHES = 120;
const KFIT_SWEEP = [5, 10, 15, 20] as const;
const CHAMPION_KFIT = 10;
const CHALLENGER_KFIT = 20;
const BOOTSTRAP_RESAMPLES = 5000;
const BOOTSTRAP_SEED = 20261120;

fs.mkdirSync(OUT_DIR, { recursive: true });
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Tipe & pemuatan data (verbatim dari backtest-walkforward.ts)
// ---------------------------------------------------------------------------
interface MatchRow {
  competition_id: string;
  utc_date: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

interface LogRow {
  team_id: string;
  match_date: string;
  goals_for: number;
  goals_against: number;
  xg_for: number | null;
  xg_against: number | null;
  competition_id: string | null;
}

const datasetPath = path.join(DATASET_DIR, "thestats_dataset.db");
const ds = new DatabaseSync(datasetPath, { readOnly: true });

const allMatches = ds
  .prepare(
    `SELECT competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE competition_id LIKE 'sm:%' AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY competition_id, utc_date`
  )
  .all() as unknown as MatchRow[];

const compOfMatch = new Map<string, string>();
{
  const rows = ds
    .prepare("SELECT match_id, competition_id FROM matches")
    .all() as unknown as { match_id: string; competition_id: string }[];
  for (const r of rows) compOfMatch.set(r.match_id, r.competition_id);
}

const logsByTeam = new Map<string, LogRow[]>();
let logRowCount = 0;
{
  const rows = ds
    .prepare(
      `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
       FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`
    )
    .all() as unknown as (LogRow & { match_id: string })[];
  logRowCount = rows.length;
  for (const r of rows) {
    const arr = logsByTeam.get(r.team_id) ?? [];
    arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
    logsByTeam.set(r.team_id, arr);
  }
}

const matchesByTeam = new Map<string, MatchRow[]>();
for (const m of allMatches) {
  for (const t of [m.home_team_id, m.away_team_id]) {
    const arr = matchesByTeam.get(t) ?? [];
    arr.push(m);
    matchesByTeam.set(t, arr);
  }
}

// Checksum aliran baris masukan (manifest eksperimen).
const matchesHash = ((): string => {
  const h = createHash("sha256");
  for (const m of allMatches) {
    h.update(`${m.competition_id}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}|${m.home_score}|${m.away_score}\n`);
  }
  return `sha256:${h.digest("hex")}`;
})();
const logsHash = ((): string => {
  const h = createHash("sha256");
  for (const [team, arr] of [...logsByTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const l of arr) {
      h.update(`${team}|${l.match_date}|${l.goals_for}|${l.goals_against}|${l.xg_for}|${l.xg_against}|${l.competition_id}\n`);
    }
  }
  return `sha256:${h.digest("hex")}`;
})();

// ---------------------------------------------------------------------------
// Fit IPF + shrinkage (verbatim dari backtest-walkforward.ts)
// ---------------------------------------------------------------------------
interface Fit {
  avgAway: number;
  ha: number;
  attack: Map<string, number>;
  defense: Map<string, number>;
}

function fitIPF(matches: MatchRow[], refMs: number, halfLifeDays: number): Fit | null {
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

function lambdas(fit: Fit, homeId: string, awayId: string): { lam: number; mu: number } {
  const lam = fit.avgAway * (fit.attack.get(homeId) ?? 1) * (fit.defense.get(awayId) ?? 1) * fit.ha;
  const mu = fit.avgAway * (fit.attack.get(awayId) ?? 1) * (fit.defense.get(homeId) ?? 1);
  return { lam, mu };
}

function applyShrinkage(fit: Fit, train: MatchRow[], kappa: number): Fit {
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

/**
 * Sama dengan probsFromLib harness, tetapi mengembalikan penanda
 * fallback uniform (fit patologik) agar cakupan terukur per evaluasi.
 */
function probsFromLib(lam: number, mu: number, rho: number): { p: [number, number, number]; fallback: boolean } {
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
    return { p: [1 / 3, 1 / 3, 1 / 3], fallback: true };
  }
  let ph = 0,
    pd = 0,
    pa = 0;
  const mx = dc.score_matrix;
  for (let x = 0; x < mx.length; x++) {
    for (let y = 0; y < mx[x].length; y++) {
      if (x > y) ph += mx[x][y];
      else if (x === y) pd += mx[x][y];
      else pa += mx[x][y];
    }
  }
  return { p: [ph, pd, pa], fallback: false };
}

// ---------------------------------------------------------------------------
// Akumulator metrik (verbatim dari backtest-walkforward.ts)
// ---------------------------------------------------------------------------
interface Bin {
  sumP: number;
  sumY: number;
  n: number;
}

function logitSlope(pairs: { p: number; y: number }[]): number | null {
  let a = 0,
    b = 1;
  const xs = pairs.map(({ p }) => {
    const pc = Math.min(1 - 1e-6, Math.max(1e-6, p));
    return Math.log(pc / (1 - pc));
  });
  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0,
      g1 = 0,
      h00 = 0,
      h01 = 0,
      h11 = 0;
    for (let i = 0; i < pairs.length; i++) {
      const z = a + b * xs[i];
      const mu = 1 / (1 + Math.exp(-z));
      const r = pairs[i].y - mu;
      const v = Math.max(1e-9, mu * (1 - mu));
      g0 += r;
      g1 += r * xs[i];
      h00 += v;
      h01 += v * xs[i];
      h11 += v * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }
  return Number.isFinite(b) ? b : null;
}

class Acc {
  n = 0;
  fallbacks = 0;
  private ll = 0;
  private brier = 0;
  private bins: Bin[][] = [0, 1, 2].map(() => Array.from({ length: 10 }, () => ({ sumP: 0, sumY: 0, n: 0 })));
  private pairs: { p: [number, number, number]; y: number }[] | null;
  constructor(keepPairs = false) {
    this.pairs = keepPairs ? [] : null;
  }
  add(p: [number, number, number], homeScore: number, awayScore: number, fallback = false): void {
    const y = homeScore > awayScore ? 0 : homeScore === awayScore ? 1 : 2;
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p[y]));
    this.n++;
    if (fallback) this.fallbacks++;
    this.ll += -Math.log(pc);
    this.brier += (p[0] - (y === 0 ? 1 : 0)) ** 2 + (p[1] - (y === 1 ? 1 : 0)) ** 2 + (p[2] - (y === 2 ? 1 : 0)) ** 2;
    for (let c = 0; c < 3; c++) {
      const bin = this.bins[c][Math.min(9, Math.floor(p[c] * 10))];
      bin.sumP += p[c];
      bin.sumY += c === y ? 1 : 0;
      bin.n++;
    }
    this.pairs?.push({ p, y });
  }
  metrics(): { n: number; logloss: number; brier: number; ece: number; slope: number | null; coverage: number } {
    let eceSum = 0;
    for (let c = 0; c < 3; c++) {
      let e = 0;
      for (const b of this.bins[c]) if (b.n > 0) e += b.n * Math.abs(b.sumP / b.n - b.sumY / b.n);
      eceSum += this.n > 0 ? e / this.n : 0;
    }
    let slope: number | null = null;
    if (this.pairs && this.pairs.length > 30) {
      const slopes: number[] = [];
      for (let c = 0; c < 3; c++) {
        const s = logitSlope(this.pairs.map(({ p, y }) => ({ p: p[c], y: y === c ? 1 : 0 })));
        if (s !== null) slopes.push(s);
      }
      if (slopes.length) slope = Number((slopes.reduce((s, v) => s + v, 0) / slopes.length).toFixed(3));
    }
    return {
      n: this.n,
      logloss: this.n ? Number((this.ll / this.n).toFixed(4)) : NaN,
      brier: this.n ? Number((this.brier / this.n).toFixed(4)) : NaN,
      ece: Number((eceSum / 3).toFixed(4)),
      slope,
      coverage: this.n ? Number((1 - this.fallbacks / this.n).toFixed(6)) : NaN,
    };
  }
  /** Metrik presisi penuh untuk masukan aturan keputusan. */
  rawMetrics(): { n: number; logloss: number; brier: number; coverage: number } {
    return {
      n: this.n,
      logloss: this.n ? this.ll / this.n : NaN,
      brier: this.n ? this.brier / this.n : NaN,
      coverage: this.n ? 1 - this.fallbacks / this.n : NaN,
    };
  }
}

// ---------------------------------------------------------------------------
// Liga dalam cakupan + lipatan (verbatim dari backtest-walkforward.ts)
// ---------------------------------------------------------------------------
interface LeagueData {
  leagueId: string;
  matches: MatchRow[];
}
const registryStatus = new Map<string, string>();
{
  const rows = ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as {
    league_id: string;
    status: string;
  }[];
  for (const r of rows) registryStatus.set(r.league_id, r.status);
}
const isServable = (leagueId: string): boolean => {
  const st = registryStatus.get(leagueId);
  return st === "calibrated" || st === "partial";
};
const leagues: LeagueData[] = [];
{
  const byComp = new Map<string, MatchRow[]>();
  for (const m of allMatches) {
    const arr = byComp.get(m.competition_id) ?? [];
    arr.push(m);
    byComp.set(m.competition_id, arr);
  }
  for (const [leagueId, ms] of byComp) {
    if (ms.length < MIN_MATCHES) continue;
    if (isServable(leagueId)) leagues.push({ leagueId, matches: ms });
  }
  leagues.sort((a, b) => a.leagueId.localeCompare(b.leagueId));
}

const FOLDS = [
  { name: "V1", trainEnd: 0.55, testStart: 0.55, testEnd: 0.7 },
  { name: "V2", trainEnd: 0.7, testStart: 0.7, testEnd: 0.85 },
  { name: "H", trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 },
] as const;
type Fold = (typeof FOLDS)[number];
function foldSlice(lg: LeagueData, fold: Fold): { train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const n = lg.matches.length;
  const train = lg.matches.slice(0, Math.floor(n * fold.trainEnd));
  const test = lg.matches.slice(Math.floor(n * fold.testStart), Math.floor(n * fold.testEnd));
  const refMs = test.length ? Date.parse(test[0].utc_date) : Date.parse(train[train.length - 1].utc_date);
  return { train, test, refMs };
}

const fitCache = new Map<string, Fit | null>();
function getFit(lg: LeagueData, fold: Fold, halfLife: number): { fit: Fit | null; train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const { train, test, refMs } = foldSlice(lg, fold);
  const key = `${lg.leagueId}|${fold.name}|${halfLife}`;
  if (!fitCache.has(key)) fitCache.set(key, fitIPF(train, refMs, halfLife));
  return { fit: fitCache.get(key)!, train, test, refMs };
}
const variantCache = new Map<string, Fit | null>();
function getFitVariant(
  lg: LeagueData,
  fold: Fold,
  halfLife: number,
  kfit: number,
): { fit: Fit | null; train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const base = getFit(lg, fold, halfLife);
  if (!base.fit || kfit <= 0) return base;
  const key = `${lg.leagueId}|${fold.name}|${halfLife}|k${kfit}`;
  if (!variantCache.has(key)) variantCache.set(key, applyShrinkage(base.fit, base.train, kfit));
  return { ...base, fit: variantCache.get(key)! };
}

// ---------------------------------------------------------------------------
// Level B — mesin blend (verbatim dari backtest-walkforward.ts)
// ---------------------------------------------------------------------------
const LEGACY_COMP_AVG: Record<string, number> = {
  comp_3039: 1.48,
  comp_8814: 1.54,
  comp_5840: 1.43,
  comp_4643: 1.91,
  comp_0256: 1.45,
  comp_3809: 1.87,
  comp_3498: 2.04,
};
interface CompAvgIndex {
  dates: string[];
  prefixGoals: number[];
}
const compAvgIndex = new Map<string, CompAvgIndex>();
{
  const rows = ds
    .prepare(
      `SELECT competition_id, substr(utc_date, 1, 10) AS d, (home_score + away_score) AS g FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`
    )
    .all() as unknown as { competition_id: string; d: string; g: number }[];
  for (const r of rows) {
    let idx = compAvgIndex.get(r.competition_id);
    if (!idx) {
      idx = { dates: [], prefixGoals: [0] };
      compAvgIndex.set(r.competition_id, idx);
    }
    idx.dates.push(r.d);
    idx.prefixGoals.push(idx.prefixGoals[idx.prefixGoals.length - 1] + r.g);
  }
}
function compAvgGoalsAt(compId: string | null, cutoff: string): number | null {
  if (!compId) return null;
  const idx = compAvgIndex.get(compId);
  if (idx) {
    const n = upperBoundDate(idx.dates, cutoff);
    if (n > 0) return idx.prefixGoals[n] / (2 * n);
  }
  return LEGACY_COMP_AVG[compId] ?? null;
}
for (const arr of matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));

function upperBoundDate(dates: string[], cutoff: string): number {
  let lo = 0,
    hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
const logDatesByTeam = new Map<string, string[]>();
for (const [t, arr] of logsByTeam) logDatesByTeam.set(t, arr.map((l) => l.match_date));
const matchDatesByTeam = new Map<string, string[]>();
for (const [t, arr] of matchesByTeam) matchDatesByTeam.set(t, arr.map((m) => m.utc_date.slice(0, 10)));

const round2 = (v: number) => Number(v.toFixed(2));
const round3 = (v: number) => Number(v.toFixed(3));

interface RollingTelem {
  sampleSize: number;
  xgSamples: number;
  rollingXgFor: number | null;
  rollingXgAgainst: number | null;
  rollingGoalsFor: number;
  rollingGoalsAgainst: number;
}
function rollingTelem(teamId: string, cutoff: string, targetCompId: string): RollingTelem {
  const empty: RollingTelem = { sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0 };
  const logs = logsByTeam.get(teamId);
  const dates = logDatesByTeam.get(teamId);
  if (!logs || !dates) return empty;
  const end = upperBoundDate(dates, cutoff);
  const win = logs.slice(Math.max(0, end - 6), end);
  if (!win.length) return empty;
  const targetAvg = compAvgGoalsAt(targetCompId, cutoff) ?? 1.48;
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
      const logAvg = compAvgGoalsAt(log.competition_id, cutoff);
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

function formGoals(teamId: string, cutoff: string): { avg: number | null; n: number } {
  const ms = matchesByTeam.get(teamId);
  const dates = matchDatesByTeam.get(teamId);
  if (!ms || !dates) return { avg: null, n: 0 };
  const end = upperBoundDate(dates, cutoff);
  const win = ms.slice(Math.max(0, end - 6), end);
  if (!win.length) return { avg: null, n: 0 };
  let g = 0;
  for (const m of win) g += m.home_team_id === teamId ? m.home_score : m.away_score;
  return { avg: g / win.length, n: win.length };
}

interface BlendInput {
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

function blendInput(fit: Fit, m: MatchRow): BlendInput {
  const avg = fit.avgAway;
  const cutoff = m.utc_date.slice(0, 10);
  const formH = formGoals(m.home_team_id, cutoff);
  const formA = formGoals(m.away_team_id, cutoff);
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

  const telemH = rollingTelem(m.home_team_id, cutoff, m.competition_id);
  const telemA = rollingTelem(m.away_team_id, cutoff, m.competition_id);

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

function lamMuFromBlend(bi: BlendInput, kappaScale: number): { lam: number; mu: number } {
  if (bi.fixedLamMu) return bi.fixedLamMu;
  const wH = bi.nH / (bi.nH + bi.kapH * kappaScale);
  const wA = bi.nA / (bi.nA + bi.kapA * kappaScale);
  const attH = Math.max(0.5, round3(wH * bi.liveAttH + (1 - wH) * bi.priorAttH));
  const defH = Math.max(0.5, round3(wH * bi.liveDefH + (1 - wH) * bi.priorDefH));
  const attA = Math.max(0.4, round3(wA * bi.liveAttA + (1 - wA) * bi.priorAttA));
  const defA = Math.max(0.5, round3(wA * bi.liveDefA + (1 - wA) * bi.priorDefA));
  return { lam: bi.avg * attH * defA * bi.ha, mu: bi.avg * attA * defH };
}

const KAPPA_SCALE = 2; // blend produksi js2, dibekukan desain §2
const RHO = 0; // kebijakan rho zero, dibekukan desain §2
const HALF_LIFE = 365;

function evalLevelA(kfit: number, fold: Fold, acc: Acc): void {
  for (const lg of leagues) {
    const { fit, test } = getFitVariant(lg, fold, HALF_LIFE, kfit);
    if (!fit) continue;
    for (const m of test) {
      const { lam, mu } = lambdas(fit, m.home_team_id, m.away_team_id);
      const { p, fallback } = probsFromLib(lam, mu, RHO);
      acc.add(p, m.home_score, m.away_score, fallback);
    }
  }
}

function evalLevelB(kfit: number, fold: Fold, acc: Acc): void {
  for (const lg of leagues) {
    const { fit, test } = getFitVariant(lg, fold, HALF_LIFE, kfit);
    if (!fit) continue;
    for (const m of test) {
      const bi = blendInput(fit, m);
      const { lam, mu } = lamMuFromBlend(bi, KAPPA_SCALE);
      const { p, fallback } = probsFromLib(lam, mu, RHO);
      acc.add(p, m.home_score, m.away_score, fallback);
    }
  }
}

function evalNaive(fold: Fold, acc: Acc): void {
  for (const lg of leagues) {
    const { train, test } = foldSlice(lg, fold);
    if (!train.length || !test.length) continue;
    let h = 0,
      a = 0;
    for (const m of train) {
      h += m.home_score;
      a += m.away_score;
    }
    const { p } = probsFromLib(h / train.length, a / train.length, 0);
    for (const m of test) acc.add(p, m.home_score, m.away_score);
  }
}

/** Baseline frekuensi liga dari latih (bab Q4): proporsi hasil 1X2 liga di blok latih. */
function evalLeagueFrequency(fold: Fold, acc: Acc): void {
  for (const lg of leagues) {
    const { train, test } = foldSlice(lg, fold);
    if (!train.length || !test.length) continue;
    const cnt = [0, 0, 0];
    for (const m of train) cnt[m.home_score > m.away_score ? 0 : m.home_score === m.away_score ? 1 : 2]++;
    const p: [number, number, number] = [cnt[0] / train.length, cnt[1] / train.length, cnt[2] / train.length];
    for (const m of test) acc.add(p, m.home_score, m.away_score);
  }
}

// ---------------------------------------------------------------------------
// Panel closing (verbatim dari backtest-walkforward.ts, pasangan K5)
// ---------------------------------------------------------------------------
interface OddsEntry {
  market_id?: number;
  market_description?: string;
  bookmaker_id?: number;
  label?: string;
  value?: string | number;
}
function closingLineProbs(payloadJson: string): [number, number, number] | null {
  let payload: { odds?: OddsEntry[] };
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const entries = (payload.odds ?? []).filter(
    (o) => o.market_description === "Match Winner" || o.market_id === 1
  );
  const labelIdx = (l: string | undefined): number =>
    l === "Home" || l === "1" ? 0 : l === "Draw" || l === "X" ? 1 : l === "Away" || l === "2" ? 2 : -1;
  const bookmakers = [...new Set(entries.map((o) => o.bookmaker_id ?? -1))].sort((a, b) => {
    const rank = (id: number) => (id === 20 ? 0 : id === 35 ? 1 : 2);
    return rank(a) - rank(b);
  });
  for (const bm of bookmakers) {
    const triple: (number | null)[] = [null, null, null];
    for (const o of entries) {
      if ((o.bookmaker_id ?? -1) !== bm) continue;
      const idx = labelIdx(o.label);
      const v = typeof o.value === "string" ? Number.parseFloat(o.value) : o.value;
      if (idx >= 0 && v !== undefined && Number.isFinite(v) && v > 1) triple[idx] = v;
    }
    if (triple.every((v) => v !== null)) {
      try {
        const fair = stripVigShin(triple[0]!, triple[1]!, triple[2]!);
        return [fair.fair_prob.home, fair.fair_prob.draw, fair.fair_prob.away];
      } catch {
        return null;
      }
    }
  }
  return null;
}

function modelProbsForMatchLevelA(kfit: number, lg: LeagueData, matchIdx: number): [number, number, number] | null {
  const frac = matchIdx / lg.matches.length;
  const fold = FOLDS.find((f) => frac >= f.testStart && frac < f.testEnd);
  if (!fold) return null;
  const { fit } = getFitVariant(lg, fold, HALF_LIFE, kfit);
  if (!fit) return null;
  const m = lg.matches[matchIdx];
  const { lam, mu } = lambdas(fit, m.home_team_id, m.away_team_id);
  return probsFromLib(lam, mu, RHO).p;
}

// ---------------------------------------------------------------------------
// Baris berpasangan H + pekan ISO
// ---------------------------------------------------------------------------
function isoWeekKey(dateStr: string): string {
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

interface HRow {
  match: string;
  league: string;
  date: string;
  week: string;
  hs: number;
  as: number;
  A10: [number, number, number];
  A20: [number, number, number];
  B10: [number, number, number];
  B20: [number, number, number];
  fbA10: boolean;
  fbA20: boolean;
  fbB10: boolean;
  fbB20: boolean;
}

function collectHRows(foldH: Fold): HRow[] {
  const rows: HRow[] = [];
  for (const lg of leagues) {
    const v10 = getFitVariant(lg, foldH, HALF_LIFE, CHAMPION_KFIT);
    const v20 = getFitVariant(lg, foldH, HALF_LIFE, CHALLENGER_KFIT);
    if (!v10.fit || !v20.fit) continue;
    for (const m of v10.test) {
      const a10 = (() => {
        const { lam, mu } = lambdas(v10.fit!, m.home_team_id, m.away_team_id);
        return probsFromLib(lam, mu, RHO);
      })();
      const a20 = (() => {
        const { lam, mu } = lambdas(v20.fit!, m.home_team_id, m.away_team_id);
        return probsFromLib(lam, mu, RHO);
      })();
      const b10 = (() => {
        const { lam, mu } = lamMuFromBlend(blendInput(v10.fit!, m), KAPPA_SCALE);
        return probsFromLib(lam, mu, RHO);
      })();
      const b20 = (() => {
        const { lam, mu } = lamMuFromBlend(blendInput(v20.fit!, m), KAPPA_SCALE);
        return probsFromLib(lam, mu, RHO);
      })();
      rows.push({
        match: `${lg.leagueId}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`,
        league: lg.leagueId,
        date: m.utc_date.slice(0, 10),
        week: isoWeekKey(m.utc_date),
        hs: m.home_score,
        as: m.away_score,
        A10: a10.p,
        A20: a20.p,
        B10: b10.p,
        B20: b20.p,
        fbA10: a10.fallback,
        fbA20: a20.fallback,
        fbB10: b10.fallback,
        fbB20: b20.fallback,
      });
    }
  }
  rows.sort((a, b) => a.match.localeCompare(b.match));
  return rows;
}

function accFromHRows(rows: HRow[], pick: (r: HRow) => [number, number, number], fb: (r: HRow) => boolean): Acc {
  const acc = new Acc(true);
  for (const r of rows) acc.add(pick(r), r.hs, r.as, fb(r));
  return acc;
}

function pairedDeltas(rows: HRow[], champ: (r: HRow) => [number, number, number], chall: (r: HRow) => [number, number, number]): PairedDeltaRow[] {
  return rows.map((r) => {
    const y = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2;
    const ll = (p: [number, number, number]) => -Math.log(Math.min(1 - 1e-12, Math.max(1e-12, p[y])));
    return { block: r.week, delta: ll(chall(r)) - ll(champ(r)) };
  });
}

// ---------------------------------------------------------------------------
// Determinisme (desain §8) + cek silang jalur fit bersama K4
// ---------------------------------------------------------------------------
function serializeFit(fit: Fit): string {
  const entries = (mp: Map<string, number>) =>
    [...mp.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v.toPrecision(17)}`).join(",");
  return `avg=${fit.avgAway.toPrecision(17)}|ha=${fit.ha.toPrecision(17)}|att=${entries(fit.attack)}|def=${entries(fit.defense)}`;
}

function determinismCheck(foldH: Fold): {
  leaguesChecked: number;
  hashRun1: string;
  hashRun2: string;
  identical: boolean;
  libCrossCheckMaxAbsDiff: number;
} {
  const h1 = createHash("sha256");
  const h2 = createHash("sha256");
  let checked = 0;
  let libMaxDiff = 0;
  for (const lg of leagues) {
    const { train, refMs } = foldSlice(lg, foldH);
    // Dua fit dari nol (tanpa cache) pada himpunan latih yang sama.
    const base1 = fitIPF(train, refMs, HALF_LIFE);
    const base2 = fitIPF(train, refMs, HALF_LIFE);
    if (!base1 || !base2) continue;
    const f1 = applyShrinkage(base1, train, CHAMPION_KFIT);
    const f2 = applyShrinkage(base2, train, CHAMPION_KFIT);
    h1.update(`${lg.leagueId}#${serializeFit(f1)}\n`);
    h2.update(`${lg.leagueId}#${serializeFit(f2)}\n`);
    checked++;
    // Cek silang: jalur fit bersama K4 (lib/quant/fit.ts) pada masukan sama.
    const libFit = fitLeagueRatings(
      train.map((m) => ({ competition_id: m.competition_id, season: "", utc_date: m.utc_date, home_team_id: m.home_team_id, away_team_id: m.away_team_id, home_score: m.home_score, away_score: m.away_score })),
      { nowMs: refMs, halfLifeDays: HALF_LIFE, shrinkKappa: CHAMPION_KFIT },
    );
    if (libFit) {
      libMaxDiff = Math.max(libMaxDiff, Math.abs(libFit.leagueAvgGoals - f1.avgAway), Math.abs(libFit.homeAdvantage - f1.ha));
      for (const [t, v] of f1.attack) libMaxDiff = Math.max(libMaxDiff, Math.abs((libFit.attack.get(t) ?? 1) - v));
      for (const [t, v] of f1.defense) libMaxDiff = Math.max(libMaxDiff, Math.abs((libFit.defense.get(t) ?? 1) - v));
    }
  }
  const hashRun1 = `sha256:${h1.digest("hex")}`;
  const hashRun2 = `sha256:${h2.digest("hex")}`;
  return { leaguesChecked: checked, hashRun1, hashRun2, identical: hashRun1 === hashRun2, libCrossCheckMaxAbsDiff: libMaxDiff };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function fmt(m: { n: number; logloss: number; brier: number; ece: number; slope: number | null; coverage: number }): string {
  return `n=${m.n} LL=${m.logloss.toFixed(4)} Brier=${m.brier.toFixed(4)} ECE=${m.ece.toFixed(4)} slope=${m.slope ?? "-"} cov=${m.coverage.toFixed(4)}`;
}

function main(): void {
  const t0 = performance.now();
  const inScopeMatches = leagues.reduce((s, l) => s + l.matches.length, 0);
  console.log(`[k5] liga dalam cakupan: ${leagues.length}, total match: ${inScopeMatches}`);
  console.log(`[k5] dataset: ${datasetPath} (matches sm selesai=${allMatches.length}, logs=${logRowCount})`);

  const foldV1 = FOLDS[0];
  const foldV2 = FOLDS[1];
  const foldH = FOLDS[2];

  // --- Sapuan validasi V1+V2 (semua κ-fit, Level A + B) ---
  const validation: Record<string, Record<string, ReturnType<Acc["metrics"]>>> = { levelA: {}, levelB: {} };
  for (const kfit of KFIT_SWEEP) {
    const accA = new Acc(true);
    const accB = new Acc(true);
    for (const fold of [foldV1, foldV2]) {
      evalLevelA(kfit, fold, accA);
      evalLevelB(kfit, fold, accB);
    }
    validation.levelA[String(kfit)] = accA.metrics();
    validation.levelB[String(kfit)] = accB.metrics();
    console.log(`  [val V1+V2] kfit=${kfit} A: ${fmt(accA.metrics())}`);
    console.log(`  [val V1+V2] kfit=${kfit} B: ${fmt(accB.metrics())}`);
  }

  // --- H: hanya pasangan keputusan, baris berpasangan disimpan ---
  const hRows = collectHRows(foldH);
  console.log(`[k5] baris H berpasangan: ${hRows.length}`);
  const accA10 = accFromHRows(hRows, (r) => r.A10, (r) => r.fbA10);
  const accA20 = accFromHRows(hRows, (r) => r.A20, (r) => r.fbA20);
  const accB10 = accFromHRows(hRows, (r) => r.B10, (r) => r.fbB10);
  const accB20 = accFromHRows(hRows, (r) => r.B20, (r) => r.fbB20);
  console.log(`  [H] Level A kfit=10: ${fmt(accA10.metrics())}`);
  console.log(`  [H] Level A kfit=20: ${fmt(accA20.metrics())}`);
  console.log(`  [H] Level B kfit=10: ${fmt(accB10.metrics())}`);
  console.log(`  [H] Level B kfit=20: ${fmt(accB20.metrics())}`);

  // --- Baseline konteks di H ---
  const accNaive = new Acc(true);
  evalNaive(foldH, accNaive);
  const accLF = new Acc(true);
  evalLeagueFrequency(foldH, accLF);
  console.log(`  [H] naive Poisson: ${fmt(accNaive.metrics())}`);
  console.log(`  [H] frekuensi liga: ${fmt(accLF.metrics())}`);

  // --- Per-liga Level B di H (audit segmen) ---
  const perLeagueB: Record<string, { n: number; ll10: number; ll20: number }> = {};
  {
    const sums = new Map<string, { n: number; s10: number; s20: number }>();
    for (const r of hRows) {
      const y = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2;
      const ll = (p: [number, number, number]) => -Math.log(Math.min(1 - 1e-12, Math.max(1e-12, p[y])));
      const s = sums.get(r.league) ?? { n: 0, s10: 0, s20: 0 };
      s.n++;
      s.s10 += ll(r.B10);
      s.s20 += ll(r.B20);
      sums.set(r.league, s);
    }
    for (const [lg, s] of sums) {
      perLeagueB[lg] = { n: s.n, ll10: Number((s.s10 / s.n).toFixed(4)), ll20: Number((s.s20 / s.n).toFixed(4)) };
    }
  }

  // --- Bootstrap + keputusan (permukaan utama: Level B di H) ---
  const bootB = blockBootstrapDelta(pairedDeltas(hRows, (r) => r.B10, (r) => r.B20), {
    resamples: BOOTSTRAP_RESAMPLES,
    seed: BOOTSTRAP_SEED,
  });
  const bootA = blockBootstrapDelta(pairedDeltas(hRows, (r) => r.A10, (r) => r.A20), {
    resamples: BOOTSTRAP_RESAMPLES,
    seed: BOOTSTRAP_SEED,
  });
  console.log(
    `[k5] bootstrap Level B: meanΔ=${bootB.meanDelta.toFixed(6)} UB95=${bootB.upperOneSided95.toFixed(6)} CI=[${bootB.ci95Low.toFixed(6)}, ${bootB.ci95High.toFixed(6)}] n=${bootB.nMatches} blok=${bootB.nBlocks}`,
  );
  console.log(
    `[k5] bootstrap Level A: meanΔ=${bootA.meanDelta.toFixed(6)} UB95=${bootA.upperOneSided95.toFixed(6)} CI=[${bootA.ci95Low.toFixed(6)}, ${bootA.ci95High.toFixed(6)}]`,
  );

  const rawB10 = accB10.rawMetrics();
  const rawB20 = accB20.rawMetrics();
  const decisionInput = {
    meanDelta: bootB.meanDelta,
    bootstrapUpperOneSided95: bootB.upperOneSided95,
    coverageChampion: rawB10.coverage,
    coverageChallenger: rawB20.coverage,
    brierChampion: rawB10.brier,
    brierChallenger: rawB20.brier,
    nMatches: bootB.nMatches,
    nBlocks: bootB.nBlocks,
  };
  const decision = applyKappaDecision(decisionInput);
  console.log(`[k5] KEPUTUSAN: ${decision.decision.toUpperCase()}`);
  for (const c of decision.checks) {
    console.log(`  cek ${c.id}: observed=${c.observed} threshold=${c.threshold} → ${c.pass ? "LOLOS" : "GAGAL"}`);
  }

  // --- Panel closing (terpisah, bukan keputusan) ---
  const clAcc = new Acc(true);
  const clChamp = new Acc(true);
  const clChall = new Acc(true);
  let clRows = 0,
    clSkippedParse = 0,
    clSkippedScope = 0;
  {
    const rows = ds
      .prepare(
        `SELECT o.match_id, o.captured_utc, o.payload_json, m.competition_id, m.utc_date,
                m.home_team_id, m.away_team_id, m.home_score, m.away_score
         FROM match_odds_history o JOIN matches m ON o.match_id = m.match_id
         WHERE o.has_odds = 1 AND m.status = 'finished' AND m.home_score IS NOT NULL`
      )
      .all() as unknown as {
      match_id: string;
      captured_utc: string;
      payload_json: string;
      competition_id: string;
      utc_date: string;
      home_team_id: string;
      away_team_id: string;
      home_score: number;
      away_score: number;
    }[];
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!(Date.parse(r.captured_utc) < Date.parse(r.utc_date))) continue;
      const cur = latest.get(r.match_id);
      if (!cur || Date.parse(r.captured_utc) > Date.parse(cur.captured_utc)) latest.set(r.match_id, r);
    }
    clRows = latest.size;
    const leagueById = new Map(leagues.map((l) => [l.leagueId, l]));
    for (const r of latest.values()) {
      const probs = closingLineProbs(r.payload_json);
      if (!probs) {
        clSkippedParse++;
        continue;
      }
      clAcc.add(probs, r.home_score, r.away_score);
      const lg = leagueById.get(r.competition_id);
      if (!lg) {
        clSkippedScope++;
        continue;
      }
      const idx = lg.matches.findIndex(
        (m) => m.utc_date === r.utc_date && m.home_team_id === r.home_team_id && m.away_team_id === r.away_team_id
      );
      if (idx < 0) {
        clSkippedScope++;
        continue;
      }
      const p10 = modelProbsForMatchLevelA(CHAMPION_KFIT, lg, idx);
      const p20 = modelProbsForMatchLevelA(CHALLENGER_KFIT, lg, idx);
      if (p10) clChamp.add(p10, r.home_score, r.away_score);
      if (p20) clChall.add(p20, r.home_score, r.away_score);
    }
  }
  console.log(`  [CL] closing: ${fmt(clAcc.metrics())} (pre-kickoff=${clRows}, tak terparse=${clSkippedParse}, luar cakupan=${clSkippedScope})`);
  console.log(`  [CL] model kfit=10 subset sama: ${fmt(clChamp.metrics())}`);
  console.log(`  [CL] model kfit=20 subset sama: ${fmt(clChall.metrics())}`);

  // --- Determinisme ---
  const det = determinismCheck(foldH);
  console.log(
    `[k5] determinisme: ${det.leaguesChecked} liga, hash sama=${det.identical}, cek silang lib fit max|Δ|=${det.libCrossCheckMaxAbsDiff}`,
  );

  // --- Artefak ---
  const hDates = hRows.map((r) => r.date).sort();
  const summary = {
    experiment: "k5-kappa",
    generated_at: new Date().toISOString(),
    champion: { kfit: CHAMPION_KFIT, halfLifeDays: HALF_LIFE, rho: RHO, kappaScale: KAPPA_SCALE },
    challenger: { kfit: CHALLENGER_KFIT, halfLifeDays: HALF_LIFE, rho: RHO, kappaScale: KAPPA_SCALE },
    scope: {
      definition: "liga registry league_calibration berstatus calibrated/partial dengan >= 120 match selesai (aturan harness walk-forward)",
      leagues: leagues.length,
      matches: inScopeMatches,
      folds: "V1 train[0,55%)->test[55,70%); V2 train[0,70%)->test[70,85%); H train[0,85%)->test[85,100%) per liga",
      heldout_date_range: hDates.length ? { start: hDates[0], end: hDates[hDates.length - 1] } : null,
    },
    validation_v1v2: validation,
    heldout: {
      levelA: { champion: accA10.metrics(), challenger: accA20.metrics() },
      levelB: { champion: accB10.metrics(), challenger: accB20.metrics() },
      levelB_raw: { champion: rawB10, challenger: rawB20 },
      naive_poisson: accNaive.metrics(),
      league_frequency: accLF.metrics(),
      per_league_levelB: perLeagueB,
    },
    bootstrap: { levelB_primary: bootB, levelA_secondary: bootA },
    closing_panel: {
      matches_pre_kickoff: clRows,
      unparseable: clSkippedParse,
      out_of_model_scope: clSkippedScope,
      closing: clAcc.metrics(),
      champion_levelA_same_subset: clChamp.metrics(),
      challenger_levelA_same_subset: clChall.metrics(),
    },
    determinism: det,
    decision: decision.decision,
    runtime_seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  const decisionDoc = {
    experiment: "k5-kappa",
    surface: "Level B (replikasi jalur produksi) pada lipatan H, baris berpasangan identik",
    champion: `kappa-fit ${CHAMPION_KFIT}`,
    challenger: `kappa-fit ${CHALLENGER_KFIT}`,
    rule_source: "docs/plans/peningkatan-aplikasi-bola/02-model-quant.md bab Q4; dibekukan di tasks/experiments/k5-kappa/DESIGN.md §7",
    thresholds: KAPPA_DECISION_THRESHOLDS,
    input: decisionInput,
    checks: decision.checks,
    decision: decision.decision,
    decided_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, "decision.json"), JSON.stringify(decisionDoc, null, 2));

  const lines = hRows.map((r) =>
    JSON.stringify({
      match: r.match,
      league: r.league,
      date: r.date,
      week: r.week,
      hs: r.hs,
      as: r.as,
      A10: r.A10,
      A20: r.A20,
      B10: r.B10,
      B20: r.B20,
      fbA10: r.fbA10,
      fbA20: r.fbA20,
      fbB10: r.fbB10,
      fbB20: r.fbB20,
    }),
  );
  fs.writeFileSync(path.join(OUT_DIR, "predictions-h.jsonl"), lines.join("\n") + "\n");

  let designCommit: string | null = null;
  try {
    designCommit = execSync("git log --format=%H -1 -- tasks/experiments/k5-kappa/DESIGN.md", { encoding: "utf8" }).trim() || null;
  } catch { /* git tak tersedia — dicatat null */ }
  const runnerSha = sha256(fs.readFileSync(new URL(import.meta.url)).toString());
  const statsSha = sha256(fs.readFileSync(path.join(process.cwd(), "lib/quant/experiment-stats.ts")).toString());
  const dsStat = fs.statSync(datasetPath);
  const manifest = {
    experiment: "k5-kappa",
    design_doc: "tasks/experiments/k5-kappa/DESIGN.md",
    design_commit: designCommit,
    generated_at: new Date().toISOString(),
    code: {
      runner: "scripts/experiment-k5-kappa.ts",
      runner_sha256: `sha256:${runnerSha}`,
      stats_lib: "lib/quant/experiment-stats.ts",
      stats_lib_sha256: `sha256:${statsSha}`,
    },
    inputs: {
      dataset_path: datasetPath,
      dataset_size_bytes: dsStat.size,
      dataset_mtime: dsStat.mtime.toISOString(),
      matches_rows: { count: allMatches.length, sha256: matchesHash },
      team_log_rows: { count: logRowCount, sha256: logsHash },
      in_scope_leagues: leagues.length,
      in_scope_matches: inScopeMatches,
      heldout_rows: hRows.length,
      heldout_date_range: summary.scope.heldout_date_range,
    },
    config: {
      sweep_kfit: [...KFIT_SWEEP],
      champion_kfit: CHAMPION_KFIT,
      challenger_kfit: CHALLENGER_KFIT,
      halfLifeDays: HALF_LIFE,
      rho: RHO,
      kappaScale: KAPPA_SCALE,
      minMatchesPerLeague: MIN_MATCHES,
    },
    bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED, block: "pekan ISO (UTC) tanggal laga, digabung lintas liga" },
    availability_assumption:
      "rekonstruksi historis harness: fitur form/telemetri point-in-time dari store hasil (hanya laga < tanggal laga); fit lipatan hanya baris < awal blok uji",
  };
  fs.writeFileSync(path.join(OUT_DIR, "experiment-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`[k5] selesai dalam ${summary.runtime_seconds}s → ${OUT_DIR}/{summary,decision,experiment-manifest}.json + predictions-h.jsonl`);
}

main();
