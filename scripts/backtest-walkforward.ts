/**
 * BACKTEST WALK-FORWARD — gerbang akurasi Fase 3 (overhaul backend).
 *
 * Evaluasi STRICTLY out-of-sample atas store hasil Sportmonks
 * (dataset.matches, competition sm:*): fit hanya memakai masa lalu,
 * prediksi menilai masa depan. Lipatan per liga (kronologis):
 *   V1: train [0,55%)  → uji [55%,70%)
 *   V2: train [0,70%)  → uji [70%,85%)
 *   H : train [0,85%)  → uji [85%,100%)   ← HELD-OUT FINAL
 *
 * DISIPLIN TUNING (anti-overfitting, ditegakkan oleh konstruksi skrip):
 *  - Semua kandidat hiperparameter dinilai HANYA di lipatan validasi V1+V2.
 *  - Lipatan H dihitung HANYA untuk konfigurasi baseline (produksi saat
 *    ini) dan konfigurasi pemenang validasi. Konfigurasi lain tidak
 *    pernah menyentuh H — tidak ada angka H untuk mereka di output.
 *
 * CAKUPAN TUNING = liga yang TERSAJI produksi: registry league_calibration
 * berstatus calibrated/partial. Kompetisi piala/kontinental/friendly
 * berstatus uncalibrated BY DESIGN sejak sprint (tidak pernah diklaim
 * bisa dilayani) — diukur terpisah sebagai referensi transparansi, tidak
 * dipakai tuning. Alasan terukur (run pertama harness, cakupan semua
 * kompetisi): kompetisi cangkir punya 2,8–9,2 match/tim (vs ±51 liga
 * reguler) sehingga fit IPF per-kompetisi tidak teridentifikasi; dan
 * kasus sm:274 membuktikan cacat nyata di liga reguler — tim promosi/
 * degradasi bermatch sedikit + bobot decay tinggi membuat skala IPF
 * meledak (attack terfit 16,4). Karena itu Level A juga menguji
 * SHRINKAGE FIT: attack/defense di-shrink log-space menuju 1,0 dengan
 * bobot n_tim/(n_tim+κ_fit), κ_fit ∈ {0, 5, 10, 20}.
 *
 * Level A: model ratings murni (IPF + Dixon-Coles) — menguji half-life
 *          decay × kebijakan rho × shrinkage fit.
 * Level B: jalur produksi penuh (prior + blend telemetri James-Stein) —
 *          menguji skala kappa pada subset lipatan V2 + H.
 *
 * Benchmark: (b) naive Poisson rata-rata liga (train-only) di semua
 * lipatan; (a) closing line dari match_odds_history (tangkapan pre-kickoff
 * terakhir, Shin-stripped) pada subset match yang punya odds — n kecil,
 * dilaporkan apa adanya + perbandingan berpasangan vs model.
 *
 * Output: tasks/oos-results.json (+ tasks/oos-gate.json untuk gerbang
 * status di calibrate-ratings.ts). Tidak menulis DB mana pun.
 *
 * Pakai: npx tsx scripts/backtest-walkforward.ts [--min-matches=120]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { calculateDixonColes, poissonLogProb, tauAdjustment } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";

const args = process.argv.slice(2);
const MIN_MATCHES = (() => {
  const hit = args.find((a) => a.startsWith("--min-matches="));
  return hit ? Number(hit.split("=")[1]) : 120;
})();

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

// ---------------------------------------------------------------------------
// Tipe & pemuatan data
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

const ds = new DatabaseSync(dataPath("thestats_dataset.db"), { readOnly: true });

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
{
  const rows = ds
    .prepare(
      `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
       FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`
    )
    .all() as unknown as (LogRow & { match_id: string })[];
  for (const r of rows) {
    const arr = logsByTeam.get(r.team_id) ?? [];
    arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
    logsByTeam.set(r.team_id, arr);
  }
}

// Semua match selesai per tim (untuk form proxy Level B).
const matchesByTeam = new Map<string, MatchRow[]>();
for (const m of allMatches) {
  for (const t of [m.home_team_id, m.away_team_id]) {
    const arr = matchesByTeam.get(t) ?? [];
    arr.push(m);
    matchesByTeam.set(t, arr);
  }
}

const tierByLeague = new Map<string, string>();
try {
  const tt = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "tier-table.json"), "utf8")) as {
    league_id: string;
    tier: string;
  }[];
  for (const r of tt) tierByLeague.set(r.league_id, r.tier);
} catch { /* tier kosong */ }

// ---------------------------------------------------------------------------
// Fit IPF — matematika identik dengan fitLeague di calibrate-ratings.ts
// (parameterisasi yang sama: leagueAvgGoals = rata-rata gol tandang
// terbobot, HA = μH/μA, normalisasi mean-1 per iterasi, 200 iter / Δ<1e-7),
// diimplementasikan dengan indeks tim + array datar: O(match) per iterasi,
// tanpa Map di loop panas (ribuan fit × ~69rb match harus tetap linear).
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
    // --- update attack: den memakai defense lawan saat ini
    for (let i = 0; i < n; i++) {
      baseH[i] = lgAvg * defense[ai[i]] * ha; // λhome / att_home
      baseA[i] = lgAvg * defense[hi[i]]; // λaway / att_away
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
    // --- update defense: den memakai attack lawan saat ini
    for (let i = 0; i < n; i++) {
      baseH[i] = lgAvg * attack[hi[i]] * ha; // λhome / def_away
      baseA[i] = lgAvg * attack[ai[i]]; // λaway / def_home
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
    // --- normalisasi mean-1 (sama seperti fitLeague)
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

/** Fit rho di TRAIN (grid, likelihood skor eksak terbobot decay) — kebijakan 'fitted'. */
function fitRhoOnTrain(matches: MatchRow[], fit: Fit, refMs: number, halfLifeDays: number): number {
  let bestRho = 0,
    bestLL = -Infinity;
  for (let rho = -0.2; rho <= 0.0501; rho += 0.01) {
    let ll = 0;
    for (const m of matches) {
      const { lam, mu } = lambdas(fit, m.home_team_id, m.away_team_id);
      const wgt = halfLifeDays === Infinity ? 1 : Math.pow(0.5, (refMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
      const tau = tauAdjustment(m.home_score, m.away_score, lam, mu, rho);
      if (tau <= 0) {
        ll = -Infinity;
        break;
      }
      ll += wgt * (poissonLogProb(lam, m.home_score) + poissonLogProb(mu, m.away_score) + Math.log(tau));
    }
    if (ll > bestLL) {
      bestLL = ll;
      bestRho = rho;
    }
  }
  return Number(bestRho.toFixed(3));
}

/**
 * Probabilitas 1X2 dari λ/μ eksplisit via implementasi KANONIS lib
 * (calculateDixonColes): λ/μ disalurkan lewat konvensi rasio lib
 * (leagueAvgGoals=μ, homeAdvantage=λ/μ, attack/defense=1) dan hasil
 * dibaca dari score_matrix ternormalisasi presisi penuh — bukan dari
 * prob_* yang dibulatkan 4 desimal. Pembulatan λ/μ 3 desimal di dalam
 * lib adalah perilaku produksi yang sama, jadi harness mengukur model
 * persis seperti yang tersaji di produksi.
 */
function probsFromLib(lam: number, mu: number, rho: number): [number, number, number] {
  const dc = calculateDixonColes({
    homeAttack: 1,
    homeDefense: 1,
    awayAttack: 1,
    awayDefense: 1,
    homeAdvantage: lam / mu,
    leagueAvgGoals: mu,
    rho,
    maxGoals: 10,
  });
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
  return [ph, pd, pa];
}

// ---------------------------------------------------------------------------
// Akumulator metrik 1X2: log-loss, Brier, ECE (10 bin per kelas), dan
// calibration slope (regresi logistik logit(p) → outcome, per kelas,
// dirata-rata) untuk konfigurasi yang pasangan probabilitasnya disimpan.
// ---------------------------------------------------------------------------
interface Bin {
  sumP: number;
  sumY: number;
  n: number;
}

function logitSlope(pairs: { p: number; y: number }[]): number | null {
  // Newton 2-parameter: y ~ a + b * logit(p). Return b.
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
  private ll = 0;
  private brier = 0;
  private bins: Bin[][] = [0, 1, 2].map(() => Array.from({ length: 10 }, () => ({ sumP: 0, sumY: 0, n: 0 })));
  private pairs: { p: [number, number, number]; y: number }[] | null;
  constructor(keepPairs = false) {
    this.pairs = keepPairs ? [] : null;
  }
  add(p: [number, number, number], homeScore: number, awayScore: number): void {
    const y = homeScore > awayScore ? 0 : homeScore === awayScore ? 1 : 2;
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p[y]));
    this.n++;
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
  metrics(): { n: number; logloss: number; brier: number; ece: number; slope: number | null } {
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
    };
  }
}

// ---------------------------------------------------------------------------
// Liga dalam cakupan + lipatan kronologis
// ---------------------------------------------------------------------------
interface LeagueData {
  leagueId: string;
  tier: string;
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
const outOfScopeLeagues: LeagueData[] = [];
{
  const byComp = new Map<string, MatchRow[]>();
  for (const m of allMatches) {
    const arr = byComp.get(m.competition_id) ?? [];
    arr.push(m);
    byComp.set(m.competition_id, arr);
  }
  for (const [leagueId, ms] of byComp) {
    if (ms.length < MIN_MATCHES) continue;
    const entry = { leagueId, tier: tierByLeague.get(leagueId) ?? "OTHER", matches: ms };
    (isServable(leagueId) ? leagues : outOfScopeLeagues).push(entry);
  }
  leagues.sort((a, b) => a.leagueId.localeCompare(b.leagueId));
  outOfScopeLeagues.sort((a, b) => a.leagueId.localeCompare(b.leagueId));
}

const FOLDS = [
  { name: "V1", trainEnd: 0.55, testStart: 0.55, testEnd: 0.7 },
  { name: "V2", trainEnd: 0.7, testStart: 0.7, testEnd: 0.85 },
  { name: "H", trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 },
] as const;
type FoldName = (typeof FOLDS)[number]["name"];

function foldSlice(lg: LeagueData, fold: (typeof FOLDS)[number]): { train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const n = lg.matches.length;
  const train = lg.matches.slice(0, Math.floor(n * fold.trainEnd));
  const test = lg.matches.slice(Math.floor(n * fold.testStart), Math.floor(n * fold.testEnd));
  const refMs = test.length ? Date.parse(test[0].utc_date) : Date.parse(train[train.length - 1].utc_date);
  return { train, test, refMs };
}

// Cache fit per (liga, lipatan, half-life) — dipakai ulang lintas kebijakan rho.
const fitCache = new Map<string, Fit | null>();
function getFit(lg: LeagueData, fold: (typeof FOLDS)[number], halfLife: number): { fit: Fit | null; train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const { train, test, refMs } = foldSlice(lg, fold);
  const key = `${lg.leagueId}|${fold.name}|${halfLife}`;
  if (!fitCache.has(key)) fitCache.set(key, fitIPF(train, refMs, halfLife));
  return { fit: fitCache.get(key)!, train, test, refMs };
}
/**
 * Shrinkage fit (kandidat perbaikan cacat IPF): attack/defense tiap tim
 * di-shrink dalam ruang log menuju 1,0 dengan bobot n/(n+κ), n = jumlah
 * match tim di train. Tim bermatch banyak hampir tak berubah; tim
 * bermatch sedikit (promosi/degradasi/pendatang) tertarik ke rata-rata
 * liga — persis titik ledak identifikasinya. Sesudah shrink, mean
 * dinormalkan lagi ke 1 agar skala λ (avgAway × HA) konsisten.
 */
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
const variantCache = new Map<string, Fit | null>();
function getFitVariant(
  lg: LeagueData,
  fold: (typeof FOLDS)[number],
  halfLife: number,
  kfit: number
): { fit: Fit | null; train: MatchRow[]; test: MatchRow[]; refMs: number } {
  const base = getFit(lg, fold, halfLife);
  if (!base.fit || kfit <= 0) return base;
  const key = `${lg.leagueId}|${fold.name}|${halfLife}|k${kfit}`;
  if (!variantCache.has(key)) variantCache.set(key, applyShrinkage(base.fit, base.train, kfit));
  return { ...base, fit: variantCache.get(key)! };
}

const rhoCache = new Map<string, number>();
function getRho(lg: LeagueData, fold: (typeof FOLDS)[number], halfLife: number, fit: Fit, train: MatchRow[], refMs: number): number {
  const key = `${lg.leagueId}|${fold.name}|${halfLife}`;
  if (!rhoCache.has(key)) rhoCache.set(key, fitRhoOnTrain(train, fit, refMs, halfLife));
  return rhoCache.get(key)!;
}

// ---------------------------------------------------------------------------
// Level A — konfigurasi: half-life × kebijakan rho
// ---------------------------------------------------------------------------
type RhoPolicy = "zero" | "g-0.03" | "g-0.08" | "fitted";
interface CfgA {
  key: string;
  halfLife: number;
  rho: RhoPolicy;
  kfit: number;
}
const HALF_LIVES: number[] = [180, 365, 730, Infinity];
const RHO_POLICIES: RhoPolicy[] = ["zero", "g-0.03", "g-0.08", "fitted"];
const KFITS: number[] = [0, 5, 10, 20];
const CONFIGS_A: CfgA[] = [];
for (const halfLife of HALF_LIVES) {
  for (const rho of RHO_POLICIES) {
    for (const kfit of KFITS) {
      CONFIGS_A.push({
        key: `hl${halfLife === Infinity ? "inf" : halfLife}|rho:${rho}|kfit:${kfit}`,
        halfLife,
        rho,
        kfit,
      });
    }
  }
}
const BASELINE_A: CfgA = CONFIGS_A.find((c) => c.halfLife === 365 && c.rho === "zero" && c.kfit === 0)!;

function rhoValue(cfg: CfgA, lg: LeagueData, fold: (typeof FOLDS)[number], fit: Fit, train: MatchRow[], refMs: number): number {
  switch (cfg.rho) {
    case "zero":
      return 0;
    case "g-0.03":
      return -0.03;
    case "g-0.08":
      return -0.08;
    case "fitted":
      return getRho(lg, fold, cfg.halfLife, fit, train, refMs);
  }
}

function evalLevelA(cfg: CfgA, fold: (typeof FOLDS)[number], acc: Acc, perLeague?: Map<string, Acc>, list: LeagueData[] = leagues): void {
  for (const lg of list) {
    const { fit, train, test, refMs } = getFitVariant(lg, fold, cfg.halfLife, cfg.kfit);
    if (!fit) continue;
    const rho = rhoValue(cfg, lg, fold, fit, train, refMs);
    const lacc = perLeague ? (perLeague.get(lg.leagueId) ?? new Acc()) : null;
    if (perLeague && lacc) perLeague.set(lg.leagueId, lacc);
    for (const m of test) {
      const { lam, mu } = lambdas(fit, m.home_team_id, m.away_team_id);
      const p = probsFromLib(lam, mu, rho);
      acc.add(p, m.home_score, m.away_score);
      lacc?.add(p, m.home_score, m.away_score);
    }
  }
}

function evalNaive(fold: (typeof FOLDS)[number], acc: Acc, perLeague?: Map<string, Acc>, list: LeagueData[] = leagues): void {
  for (const lg of list) {
    const { train, test } = foldSlice(lg, fold);
    if (!train.length || !test.length) continue;
    let h = 0,
      a = 0;
    for (const m of train) {
      h += m.home_score;
      a += m.away_score;
    }
    const lam = h / train.length;
    const mu = a / train.length;
    const p = probsFromLib(lam, mu, 0);
    const lacc = perLeague ? (perLeague.get(lg.leagueId) ?? new Acc()) : null;
    if (perLeague && lacc) perLeague.set(lg.leagueId, lacc);
    for (const m of test) {
      acc.add(p, m.home_score, m.away_score);
      lacc?.add(p, m.home_score, m.away_score);
    }
  }
}

// ---------------------------------------------------------------------------
// Level B — replikasi jalur produksi getShrunkMatchParameters:
// prior ratings + live form/telemetri rolling-6 (match_date < tanggal laga,
// anti-leakage sama seperti lib) + blend James-Stein w = n/(n+κ),
// κ = 8 (xG, ≥3 sampel) / 14 (gol) / 16 (form saja), clamp rasio produksi.
// Aproksimasi terdokumentasi: form goals avg + sample N dari intel
// direplikasi dari store matches lokal (rata-rata gol 6 laga terakhir tim),
// dan rata-rata kompetisi untuk bobot xG dihitung dari SELURUH store —
// persis seperti getCompetitionAvgGoals produksi.
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
const measuredCompAvg = new Map<string, number>();
{
  const rows = ds
    .prepare(
      `SELECT competition_id, AVG((home_score + away_score) / 2.0) AS a FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       GROUP BY competition_id`
    )
    .all() as unknown as { competition_id: string; a: number }[];
  for (const r of rows) if (Number.isFinite(r.a) && r.a > 0) measuredCompAvg.set(r.competition_id, r.a);
}
function compAvgGoals(compId: string | null): number | null {
  if (!compId) return null;
  return measuredCompAvg.get(compId) ?? LEGACY_COMP_AVG[compId] ?? null;
}
for (const arr of matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));

/** Indeks eksklusif pertama dengan tanggal >= cutoff (array terurut tanggal). */
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
  const targetAvg = compAvgGoals(targetCompId) ?? 1.48;
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
      const logAvg = compAvgGoals(log.competition_id);
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
  fixedLamMu: { lam: number; mu: number } | null; // jalur kedua-tim-tak-ditemukan (tanpa blend)
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

  // Kedua tim absen dari fit → cabang fallback loader (rasio = gol absolut
  // form; default produksi memakai semantik || — 0 dianggap absen).
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

function evalLevelB(paramsCfg: CfgA, kappaScale: number, fold: (typeof FOLDS)[number], acc: Acc): void {
  for (const lg of leagues) {
    const { fit, train, test, refMs } = getFitVariant(lg, fold, paramsCfg.halfLife, paramsCfg.kfit);
    if (!fit) continue;
    const rho = rhoValue(paramsCfg, lg, fold, fit, train, refMs);
    for (const m of test) {
      const bi = blendInput(fit, m);
      const { lam, mu } = lamMuFromBlend(bi, kappaScale);
      acc.add(probsFromLib(lam, mu, rho), m.home_score, m.away_score);
    }
  }
}

// ---------------------------------------------------------------------------
// Benchmark (a) — closing line dari match_odds_history: tangkapan
// pre-kickoff TERAKHIR per match, market 1X2, bookmaker diutamakan
// Pinnacle (20) lalu 1xBet (35), divig dengan Shin. Model dinilai pada
// subset match yang sama (berpasangan), memakai lipatan kronologisnya.
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
      // PERBAIKAN (rekalibrasi 2026-11-04): stripVigShin menerima TIGA
      // skalar (home, draw, away) dan mengembalikan fair_prob{home,draw,
      // away} — pemanggilan lama mengoper satu tuple sebagai argumen
      // tunggal dan membaca hasilnya sebagai array. Bug laten: baris ini
      // tidak pernah tereksekusi selama benchmark closing line n=0
      // (Fase 3); tangkapan odds baru membuatnya terpicu dan menghentikan
      // harness SEBELUM oos-gate.json ditulis. Payload cacat → null
      // (dihitung tak-terparse oleh pemanggil), bukan crash.
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

function modelProbsForMatch(cfg: CfgA, lg: LeagueData, matchIdx: number): [number, number, number] | null {
  const frac = matchIdx / lg.matches.length;
  const fold = FOLDS.find((f) => frac >= f.testStart && frac < f.testEnd);
  if (!fold) return null;
  const { fit, train, refMs } = getFitVariant(lg, fold, cfg.halfLife, cfg.kfit);
  if (!fit) return null;
  const m = lg.matches[matchIdx];
  const rho = rhoValue(cfg, lg, fold, fit, train, refMs);
  const { lam, mu } = lambdas(fit, m.home_team_id, m.away_team_id);
  return probsFromLib(lam, mu, rho);
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function fmt(m: { n: number; logloss: number; brier: number; ece: number; slope: number | null }): string {
  return `n=${m.n} LL=${m.logloss.toFixed(4)} Brier=${m.brier.toFixed(4)} ECE=${m.ece.toFixed(4)} slope=${m.slope ?? "-"}`;
}

function main(): void {
  const t0 = performance.now();
  const inScopeMatches = leagues.reduce((s, l) => s + l.matches.length, 0);
  console.log(`[harness] liga dalam cakupan (>=${MIN_MATCHES} match): ${leagues.length}, total match: ${inScopeMatches}`);
  console.log(
    `[harness] cakupan tuning = registry calibrated/partial: ${leagues.length} liga; di luar cakupan (uncalibrated by design): ${outOfScopeLeagues.length} liga (referensi saja)`
  );

  // --- Level A: validasi semua konfigurasi (V1+V2 saja)
  const valResults = new Map<string, ReturnType<Acc["metrics"]>>();
  for (const cfg of CONFIGS_A) {
    const acc = new Acc(true);
    for (const fold of FOLDS.slice(0, 2)) evalLevelA(cfg, fold, acc);
    valResults.set(cfg.key, acc.metrics());
  }
  const naiveVal = new Acc(true);
  for (const fold of FOLDS.slice(0, 2)) evalNaive(fold, naiveVal);
  console.log(`[harness] Level A validasi selesai (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  const sorted = [...CONFIGS_A].sort((a, b) => (valResults.get(a.key)!.logloss ?? 9) - (valResults.get(b.key)!.logloss ?? 9));
  for (const cfg of sorted) console.log(`  [val] ${cfg.key}: ${fmt(valResults.get(cfg.key)!)}`);
  console.log(`  [val] naive: ${fmt(naiveVal.metrics())}`);

  // Seleksi: LL validasi terendah. Parsimoni terstruktur — di antara semua
  // kandidat yang LL-nya dalam 0.001 dari terbaik (selisih sebesar itu =
  // derau pada n sebesar ini), pilih intervensi paling ringan:
  // κ_fit terkecil → rho zero → half-life 365. Baseline produksi adalah
  // titik paling ringan di grid, jadi ia otomatis menang pada seri.
  const prefRank = (c: CfgA): number[] => [
    c.kfit,
    c.rho === "zero" ? 0 : c.rho === "fitted" ? 2 : 1,
    c.halfLife === 365 ? 0 : c.halfLife === 180 ? 2 : 1,
  ];
  const bestLL = valResults.get(sorted[0].key)!.logloss;
  const nearBest = sorted.filter((c) => valResults.get(c.key)!.logloss - bestLL <= 0.001);
  nearBest.sort((a, b) => {
    const ra = prefRank(a),
      rb = prefRank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  const winner = nearBest[0];
  if (winner.key !== sorted[0].key) {
    console.log(`[harness] parsimoni: ${nearBest.length} kandidat dalam 0.001 dari LL terbaik → intervensi teringan dipilih`);
  }
  console.log(`[harness] pemenang Level A: ${winner.key}`);

  // --- Level A: held-out HANYA baseline + pemenang + naive
  const foldH = FOLDS[2];
  const heldAccs = new Map<string, Acc>();
  for (const [label, cfg] of [
    ["baseline", BASELINE_A],
    ["winner", winner],
  ] as const) {
    if (heldAccs.has(cfg.key)) continue;
    const acc = new Acc(true);
    evalLevelA(cfg, foldH, acc);
    heldAccs.set(cfg.key, acc);
    console.log(`  [H] Level A ${label} (${cfg.key}): ${fmt(acc.metrics())}`);
  }
  const naiveH = new Acc(true);
  evalNaive(foldH, naiveH);
  console.log(`  [H] naive: ${fmt(naiveH.metrics())}`);

  const perLeagueWinner = new Map<string, Acc>();
  const perLeagueNaive = new Map<string, Acc>();
  evalLevelA(winner, foldH, new Acc(), perLeagueWinner);
  evalNaive(foldH, new Acc(), perLeagueNaive);

  const tierHeld: Record<string, { baseline: Acc; winner: Acc; naive: Acc }> = {};
  for (const tier of [...new Set(leagues.map((l) => l.tier))]) {
    tierHeld[tier] = { baseline: new Acc(true), winner: new Acc(true), naive: new Acc(true) };
  }
  for (const lg of leagues) {
    const t = tierHeld[lg.tier];
    const { test } = foldSlice(lg, foldH);
    const testStartIdx = Math.floor(lg.matches.length * foldH.testStart);
    for (let i = 0; i < test.length; i++) {
      const m = test[i];
      const pb = modelProbsForMatch(BASELINE_A, lg, testStartIdx + i);
      const pw = modelProbsForMatch(winner, lg, testStartIdx + i);
      if (pb) t.baseline.add(pb, m.home_score, m.away_score);
      if (pw) t.winner.add(pw, m.home_score, m.away_score);
    }
    // naive per tier dari fit train H liga ini
    const { train } = foldSlice(lg, foldH);
    if (train.length) {
      let h = 0,
        a = 0;
      for (const m of train) {
        h += m.home_score;
        a += m.away_score;
      }
      const p = probsFromLib(h / train.length, a / train.length, 0);
      for (const m of test) t.naive.add(p, m.home_score, m.away_score);
    }
  }

  // --- Level B: seleksi di V2, konfirmasi di H
  const foldV2 = FOLDS[1];
  const bConfigs: { label: string; params: CfgA; ks: number }[] = [
    { label: "production(hl365,rho0,kx1)", params: BASELINE_A, ks: 1 },
    { label: "baseline kx0.5", params: BASELINE_A, ks: 0.5 },
    { label: "baseline kx2", params: BASELINE_A, ks: 2 },
  ];
  if (winner.key !== BASELINE_A.key) {
    bConfigs.push(
      { label: `winner kx1`, params: winner, ks: 1 },
      { label: `winner kx0.5`, params: winner, ks: 0.5 },
      { label: `winner kx2`, params: winner, ks: 2 }
    );
  }
  const bVal = new Map<string, ReturnType<Acc["metrics"]>>();
  for (const bc of bConfigs) {
    const acc = new Acc(true);
    evalLevelB(bc.params, bc.ks, foldV2, acc);
    bVal.set(bc.label, acc.metrics());
    console.log(`  [val-V2] Level B ${bc.label}: ${fmt(acc.metrics())}`);
  }
  let bestB = bConfigs[0];
  for (const bc of bConfigs) {
    if (bVal.get(bc.label)!.logloss < bVal.get(bestB.label)!.logloss) bestB = bc;
  }
  if (bestB.label !== bConfigs[0].label && bVal.get(bConfigs[0].label)!.logloss - bVal.get(bestB.label)!.logloss <= 0.001) {
    console.log(`[harness] parsimoni Level B: selisih <= 0.001 → produksi dipertahankan`);
    bestB = bConfigs[0];
  }
  console.log(`[harness] Level B terpilih: ${bestB.label} (params=${bestB.params.key}, kappaScale=${bestB.ks})`);
  const bHeld = new Map<string, ReturnType<Acc["metrics"]>>();
  for (const bc of [bConfigs[0], bestB]) {
    if (bHeld.has(bc.label)) continue;
    const acc = new Acc(true);
    evalLevelB(bc.params, bc.ks, foldH, acc);
    bHeld.set(bc.label, acc.metrics());
    console.log(`  [H] Level B ${bc.label}: ${fmt(acc.metrics())}`);
  }

  // --- Benchmark (a): closing line
  const clAcc = new Acc(true);
  const clBase = new Acc(true);
  const clWin = new Acc(true);
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
      if (!(Date.parse(r.captured_utc) < Date.parse(r.utc_date))) continue; // hanya pre-kickoff
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
      const pb = modelProbsForMatch(BASELINE_A, lg, idx);
      const pw = modelProbsForMatch(winner, lg, idx);
      if (pb) clBase.add(pb, r.home_score, r.away_score);
      if (pw) clWin.add(pw, r.home_score, r.away_score);
    }
  }
  console.log(
    `[harness] closing line: match pre-kickoff ${clRows}, tak terparse ${clSkippedParse}, di luar cakupan model ${clSkippedScope}`
  );
  console.log(`  [CL] closing: ${fmt(clAcc.metrics())}`);
  console.log(`  [CL] model baseline (subset sama): ${fmt(clBase.metrics())}`);
  console.log(`  [CL] model winner (subset sama): ${fmt(clWin.metrics())}`);

  // --- Analisis lantai sampel: bucket ukuran train di H
  const buckets: Record<string, { leagues: number; n: number; llModel: number; llNaive: number; lose: number }> = {};
  for (const lg of leagues) {
    const { train } = foldSlice(lg, foldH);
    const key = train.length < 250 ? "<250" : train.length < 500 ? "250-500" : train.length < 900 ? "500-900" : ">900";
    const b = (buckets[key] ??= { leagues: 0, n: 0, llModel: 0, llNaive: 0, lose: 0 });
    const am = perLeagueWinner.get(lg.leagueId);
    const an = perLeagueNaive.get(lg.leagueId);
    if (!am || !an || am.n === 0) continue;
    b.leagues++;
    b.n += am.n;
    b.llModel += am.metrics().logloss * am.n;
    b.llNaive += an.metrics().logloss * an.n;
    if (am.metrics().logloss >= an.metrics().logloss) b.lose++;
  }
  for (const [k, b] of Object.entries(buckets)) {
    console.log(
      `  [floor] train ${k}: ${b.leagues} liga, n=${b.n}, LL model=${(b.llModel / b.n).toFixed(4)} vs naive=${(b.llNaive / b.n).toFixed(4)}, liga kalah dari naive: ${b.lose}`
    );
  }

  // --- Referensi di luar cakupan tuning (transparansi, BUKAN untuk tuning):
  // konfigurasi baseline + naive di kompetisi uncalibrated-by-design.
  const oosRefBase = new Acc(true);
  const oosRefNaive = new Acc(true);
  for (const fold of FOLDS) {
    evalLevelA(BASELINE_A, fold, oosRefBase, undefined, outOfScopeLeagues);
    evalNaive(fold, oosRefNaive, undefined, outOfScopeLeagues);
  }
  console.log(`  [ref-luar-cakupan] baseline semua lipatan: ${fmt(oosRefBase.metrics())}`);
  console.log(`  [ref-luar-cakupan] naive semua lipatan: ${fmt(oosRefNaive.metrics())}`);

  // --- Output
  const oosGate: Record<string, { heldout_logloss: number; naive_logloss: number; n: number }> = {};
  for (const lg of leagues) {
    const am = perLeagueWinner.get(lg.leagueId);
    const an = perLeagueNaive.get(lg.leagueId);
    if (am && an && am.n > 0) {
      oosGate[lg.leagueId] = { heldout_logloss: am.metrics().logloss, naive_logloss: an.metrics().logloss, n: am.n };
    }
  }
  fs.writeFileSync(path.join(process.cwd(), "tasks", "oos-gate.json"), JSON.stringify(oosGate, null, 2));

  const results = {
    generated_at: new Date().toISOString(),
    scope: {
      min_matches: MIN_MATCHES,
      leagues: leagues.length,
      matches: inScopeMatches,
      definition: "liga registry league_calibration berstatus calibrated/partial dengan >= MIN_MATCHES match selesai",
      out_of_scope_leagues: outOfScopeLeagues.length,
      out_of_scope_reference_all_folds: { baseline: oosRefBase.metrics(), naive: oosRefNaive.metrics() },
    },
    folds: "V1 train[0,55%)->test[55,70%); V2 train[0,70%)->test[70,85%); H train[0,85%)->test[85,100%) — H tidak pernah dipakai tuning",
    levelA: {
      validation: Object.fromEntries(valResults),
      naive_validation: naiveVal.metrics(),
      winner: winner.key,
      baseline: BASELINE_A.key,
      heldout: {
        baseline: heldAccs.get(BASELINE_A.key)!.metrics(),
        winner: heldAccs.get(winner.key)!.metrics(),
        naive: naiveH.metrics(),
      },
      heldout_per_tier: Object.fromEntries(
        Object.entries(tierHeld).map(([t, a]) => [
          t,
          { baseline: a.baseline.metrics(), winner: a.winner.metrics(), naive: a.naive.metrics() },
        ])
      ),
      heldout_per_league: Object.fromEntries(
        leagues.map((lg) => [
          lg.leagueId,
          {
            tier: lg.tier,
            winner: perLeagueWinner.get(lg.leagueId)?.metrics() ?? null,
            naive: perLeagueNaive.get(lg.leagueId)?.metrics() ?? null,
          },
        ])
      ),
    },
    levelB: {
      validation_V2: Object.fromEntries(bVal),
      selected: { label: bestB.label, params: bestB.params.key, kappaScale: bestB.ks },
      heldout: Object.fromEntries(bHeld),
    },
    closing_line: {
      matches_pre_kickoff: clRows,
      unparseable: clSkippedParse,
      out_of_model_scope: clSkippedScope,
      closing: clAcc.metrics(),
      model_baseline_same_subset: clBase.metrics(),
      model_winner_same_subset: clWin.metrics(),
    },
    sample_floor_buckets: buckets,
    runtime_seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "oos-results.json"), JSON.stringify(results, null, 2));
  console.log(`[harness] selesai dalam ${results.runtime_seconds}s → tasks/oos-results.json + tasks/oos-gate.json`);
}

main();
