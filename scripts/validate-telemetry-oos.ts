/**
 * VALIDATE TELEMETRY OOS — Level B walk-forward dengan TIGA definisi
 * telemetri, semua hal lain identik (cerminan
 * scripts/backtest-walkforward.ts; harness asli TIDAK diubah).
 *
 * Konfigurasi tetap (tasks/oos-results.json → levelB.selected):
 *   params "hl365|rho:zero|kfit:10" (fit IPF half-life 365 + shrinkage
 *   log-space κfit=10, rho=0), blend James-Stein κ×2 (kappaScale=2).
 * Populasi tetap: liga registry league_calibration calibrated/partial
 * dengan ≥120 match selesai sm:% — lipatan kronologis per liga yang sama.
 * Hanya lipatan V2 dan H yang dievaluasi (V1 dilewati untuk membatasi
 * runtime — dinyatakan eksplisit di output).
 *
 * Tiga lengan (satu-satunya saklar = definisi rollingTelem):
 *   old    : team_match_logs SEMUA sumber, bobot xG = 1.0
 *            (bentuk saji pra-fix: tanpa filter sumber, tanpa pembobotan)
 *   filter : HANYA source='sportmonks', bobot xG = 1.0
 *            (mengisolasi kontribusi filter sumber + dedupe populasi log)
 *   fixed  : HANYA source='sportmonks', bobot xG rasio kompetisi
 *            round3(targetAvg/logAvg) — definisi saji pasca-fix =
 *            definisi harness saat ini.
 * Gol selalu tanpa bobot; penyebut xG = COUNT sampel non-null per sisi;
 * form goals (matches sm:%) identik di semua lengan.
 *
 * Metrik per lengan per lipatan + pooled (H+V2): n, log-loss, Brier,
 * calibration slope (regresi logistik logit(p)→outcome per kelas,
 * dirata-rata — implementasi identik harness).
 * Output: tasks/telemetry-oos.json. Offline penuh, tanpa tulis DB.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { calculateDixonColes } from "../lib/quant/dixon-coles";

const MIN_MATCHES = 120;
const HALF_LIFE = 365;
const KFIT = 10;
const RHO = 0;
const KAPPA_SCALE = 2;

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}
const round2 = (v: number) => Number(v.toFixed(2));
const round3 = (v: number) => Number(v.toFixed(3));

// ---------------------------------------------------------------------------
// Pemuatan data (identik harness)
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
type Arm = "old" | "filter" | "fixed";
const ARMS: Arm[] = ["old", "filter", "fixed"];

const ds = new DatabaseSync(dataPath("thestats_dataset.db"), { readOnly: true });
const allMatches = ds
  .prepare(
    `SELECT competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE competition_id LIKE 'sm:%' AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY competition_id, utc_date`,
  )
  .all() as unknown as MatchRow[];
const compOfMatch = new Map<string, string>();
for (const r of ds.prepare("SELECT match_id, competition_id FROM matches").all() as unknown as {
  match_id: string; competition_id: string;
}[]) compOfMatch.set(r.match_id, r.competition_id);

function loadLogs(sourceFilter: boolean): Map<string, LogRow[]> {
  const byTeam = new Map<string, LogRow[]>();
  const sql = sourceFilter
    ? `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
       FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`
    : `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
       FROM team_match_logs ORDER BY team_id, match_date`;
  for (const r of ds.prepare(sql).all() as unknown as (LogRow & { match_id: string })[]) {
    const arr = byTeam.get(r.team_id) ?? [];
    arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
    byTeam.set(r.team_id, arr);
  }
  return byTeam;
}
const logsByArm: Record<Arm, Map<string, LogRow[]>> = {
  old: loadLogs(false),
  filter: loadLogs(true),
  fixed: loadLogs(true),
};
const logDatesByArm: Record<Arm, Map<string, string[]>> = { old: new Map(), filter: new Map(), fixed: new Map() };
for (const arm of ARMS) for (const [t, arr] of logsByArm[arm]) logDatesByArm[arm].set(t, arr.map((l) => l.match_date));

const matchesByTeam = new Map<string, MatchRow[]>();
for (const m of allMatches) {
  for (const t of [m.home_team_id, m.away_team_id]) {
    const arr = matchesByTeam.get(t) ?? [];
    arr.push(m);
    matchesByTeam.set(t, arr);
  }
}
for (const arr of matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));
const matchDatesByTeam = new Map<string, string[]>();
for (const [t, arr] of matchesByTeam) matchDatesByTeam.set(t, arr.map((m) => m.utc_date.slice(0, 10)));

// ---------------------------------------------------------------------------
// Fit IPF + shrinkage (identik harness)
// ---------------------------------------------------------------------------
interface Fit { avgAway: number; ha: number; attack: Map<string, number>; defense: Map<string, number> }
function fitIPF(matches: MatchRow[], refMs: number, halfLifeDays: number): Fit | null {
  const teamIdx = new Map<string, number>();
  for (const m of matches) {
    if (!teamIdx.has(m.home_team_id)) teamIdx.set(m.home_team_id, teamIdx.size);
    if (!teamIdx.has(m.away_team_id)) teamIdx.set(m.away_team_id, teamIdx.size);
  }
  const T = teamIdx.size;
  const n = matches.length;
  if (T < 4 || n === 0) return null;
  const hi = new Int32Array(n), ai = new Int32Array(n);
  const hs = new Float64Array(n), as = new Float64Array(n), w = new Float64Array(n);
  let wSum = 0, hSum = 0, aSum = 0;
  for (let i = 0; i < n; i++) {
    const m = matches[i];
    hi[i] = teamIdx.get(m.home_team_id)!; ai[i] = teamIdx.get(m.away_team_id)!;
    hs[i] = m.home_score; as[i] = m.away_score;
    w[i] = Math.pow(0.5, (refMs - Date.parse(m.utc_date)) / (halfLifeDays * 86400_000));
    wSum += w[i]; hSum += w[i] * hs[i]; aSum += w[i] * as[i];
  }
  const muH = hSum / wSum, muA = aSum / wSum;
  if (!(muA > 0) || !(muH > 0)) return null;
  const lgAvg = muA, ha = muH / muA;
  const attack = new Float64Array(T).fill(1), defense = new Float64Array(T).fill(1);
  const baseH = new Float64Array(n), baseA = new Float64Array(n);
  const num = new Float64Array(T), den = new Float64Array(T);
  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * defense[ai[i]] * ha; baseA[i] = lgAvg * defense[hi[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) { num[hi[i]] += w[i] * hs[i]; den[hi[i]] += w[i] * baseH[i]; num[ai[i]] += w[i] * as[i]; den[ai[i]] += w[i] * baseA[i]; }
    for (let t = 0; t < T; t++) if (den[t] > 0) { const next = num[t] / den[t]; const d = Math.abs(next - attack[t]); if (d > maxDelta) maxDelta = d; attack[t] = next; }
    for (let i = 0; i < n; i++) { baseH[i] = lgAvg * attack[hi[i]] * ha; baseA[i] = lgAvg * attack[ai[i]]; }
    num.fill(0); den.fill(0);
    for (let i = 0; i < n; i++) { num[ai[i]] += w[i] * hs[i]; den[ai[i]] += w[i] * baseH[i]; num[hi[i]] += w[i] * as[i]; den[hi[i]] += w[i] * baseA[i]; }
    for (let t = 0; t < T; t++) if (den[t] > 0) { const next = num[t] / den[t]; const d = Math.abs(next - defense[t]); if (d > maxDelta) maxDelta = d; defense[t] = next; }
    let ma = 0, md = 0;
    for (let t = 0; t < T; t++) { ma += attack[t]; md += defense[t]; }
    ma /= T; md /= T;
    if (ma > 0) for (let t = 0; t < T; t++) attack[t] /= ma;
    if (md > 0) for (let t = 0; t < T; t++) defense[t] /= md;
    if (maxDelta < 1e-7) break;
  }
  const attackMap = new Map<string, number>(), defenseMap = new Map<string, number>();
  for (const [team, idx] of teamIdx) { attackMap.set(team, attack[idx]); defenseMap.set(team, defense[idx]); }
  return { avgAway: lgAvg, ha, attack: attackMap, defense: defenseMap };
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
      out.set(t, nv); sum += nv;
    }
    const mean = out.size ? sum / out.size : 1;
    if (mean > 0) for (const [t, v] of out) out.set(t, v / mean);
    return out;
  };
  return { avgAway: fit.avgAway, ha: fit.ha, attack: shrink(fit.attack), defense: shrink(fit.defense) };
}
function probsFromLib(lam: number, mu: number, rho: number): [number, number, number] {
  const dc = calculateDixonColes({ homeAttack: 1, homeDefense: 1, awayAttack: 1, awayDefense: 1, homeAdvantage: lam / mu, leagueAvgGoals: mu, rho, maxGoals: 10 });
  let ph = 0, pd = 0, pa = 0;
  const mx = dc.score_matrix;
  for (let x = 0; x < mx.length; x++) for (let y = 0; y < mx[x].length; y++) {
    if (x > y) ph += mx[x][y]; else if (x === y) pd += mx[x][y]; else pa += mx[x][y];
  }
  return [ph, pd, pa];
}

// ---------------------------------------------------------------------------
// Metrik (identik harness: Acc + logitSlope)
// ---------------------------------------------------------------------------
function logitSlope(pairs: { p: number; y: number }[]): number | null {
  let a = 0, b = 1;
  const xs = pairs.map(({ p }) => { const pc = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(pc / (1 - pc)); });
  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < pairs.length; i++) {
      const z = a + b * xs[i];
      const mu = 1 / (1 + Math.exp(-z));
      const r = pairs[i].y - mu;
      const v = Math.max(1e-9, mu * (1 - mu));
      g0 += r; g1 += r * xs[i]; h00 += v; h01 += v * xs[i]; h11 += v * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }
  return Number.isFinite(b) ? b : null;
}
class Acc {
  n = 0;
  private ll = 0;
  private brier = 0;
  private pairs: { p: [number, number, number]; y: number }[] = [];
  add(p: [number, number, number], homeScore: number, awayScore: number): void {
    const y = homeScore > awayScore ? 0 : homeScore === awayScore ? 1 : 2;
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p[y]));
    this.n++;
    this.ll += -Math.log(pc);
    this.brier += (p[0] - (y === 0 ? 1 : 0)) ** 2 + (p[1] - (y === 1 ? 1 : 0)) ** 2 + (p[2] - (y === 2 ? 1 : 0)) ** 2;
    this.pairs.push({ p, y });
  }
  metrics(): { n: number; logloss: number; brier: number; slope: number | null } {
    let slope: number | null = null;
    if (this.pairs.length > 30) {
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
      slope,
    };
  }
}

// ---------------------------------------------------------------------------
// Populasi + lipatan (identik harness)
// ---------------------------------------------------------------------------
interface LeagueData { leagueId: string; matches: MatchRow[] }
const registryStatus = new Map<string, string>();
for (const r of ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
  registryStatus.set(r.league_id, r.status);
}
const leagues: LeagueData[] = [];
{
  const byComp = new Map<string, MatchRow[]>();
  for (const m of allMatches) {
    const arr = byComp.get(m.competition_id) ?? [];
    arr.push(m); byComp.set(m.competition_id, arr);
  }
  for (const [leagueId, ms] of byComp) {
    if (ms.length < MIN_MATCHES) continue;
    const st = registryStatus.get(leagueId);
    if (st === "calibrated" || st === "partial") leagues.push({ leagueId, matches: ms });
  }
  leagues.sort((a, b) => a.leagueId.localeCompare(b.leagueId));
}
const FOLDS = [
  { name: "V2", trainEnd: 0.7, testStart: 0.7, testEnd: 0.85 },
  { name: "H", trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 },
] as const;

// ---------------------------------------------------------------------------
// Level B per lengan: compAvg + rollingTelem (saklar lengan) + blend
// ---------------------------------------------------------------------------
const LEGACY_COMP_AVG: Record<string, number> = {
  comp_3039: 1.48, comp_8814: 1.54, comp_5840: 1.43, comp_4643: 1.91,
  comp_0256: 1.45, comp_3809: 1.87, comp_3498: 2.04,
};
const measuredCompAvg = new Map<string, number>();
for (const r of ds
  .prepare(`SELECT competition_id, AVG((home_score + away_score) / 2.0) AS a FROM matches WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL GROUP BY competition_id`)
  .all() as unknown as { competition_id: string; a: number }[]) {
  if (Number.isFinite(r.a) && r.a > 0) measuredCompAvg.set(r.competition_id, r.a);
}
function compAvgGoals(compId: string | null): number | null {
  if (!compId) return null;
  return measuredCompAvg.get(compId) ?? LEGACY_COMP_AVG[compId] ?? null;
}
function upperBoundDate(dates: string[], cutoff: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < cutoff) lo = mid + 1; else hi = mid; }
  return lo;
}
interface RollingTelem { sampleSize: number; xgSamples: number; rollingXgFor: number | null; rollingXgAgainst: number | null; rollingGoalsFor: number; rollingGoalsAgainst: number }
function rollingTelem(arm: Arm, teamId: string, cutoff: string, targetCompId: string): RollingTelem {
  const empty: RollingTelem = { sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0 };
  const logs = logsByArm[arm].get(teamId);
  const dates = logDatesByArm[arm].get(teamId);
  if (!logs || !dates) return empty;
  const end = upperBoundDate(dates, cutoff);
  const win = logs.slice(Math.max(0, end - 6), end);
  if (!win.length) return empty;
  const targetAvg = compAvgGoals(targetCompId) ?? 1.48;
  let gf = 0, ga = 0, sxf = 0, cxf = 0, sxa = 0, cxa = 0;
  for (const log of win) {
    gf += log.goals_for; ga += log.goals_against;
    let wgt = 1.0;
    if (arm === "fixed" && log.competition_id && log.competition_id !== targetCompId) {
      const logAvg = compAvgGoals(log.competition_id);
      if (logAvg && logAvg > 0) wgt = round3(targetAvg / logAvg);
    }
    if (log.xg_for !== null && log.xg_for !== undefined) { sxf += log.xg_for * wgt; cxf++; }
    if (log.xg_against !== null && log.xg_against !== undefined) { sxa += log.xg_against * wgt; cxa++; }
  }
  return {
    sampleSize: win.length, xgSamples: cxf,
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
  priorAttH: number; priorDefH: number; priorAttA: number; priorDefA: number;
  liveAttH: number; liveDefH: number; liveAttA: number; liveDefA: number;
  nH: number; nA: number; kapH: number; kapA: number; avg: number; ha: number;
}
function blendInput(arm: Arm, fit: Fit, m: MatchRow): BlendInput {
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
      fixedLamMu: { lam: avg * attH * defA * fit.ha, mu: avg * attA * defH },
      priorAttH: 1, priorDefH: 1, priorAttA: 1, priorDefA: 1,
      liveAttH: 1, liveDefH: 1, liveAttA: 1, liveDefA: 1,
      nH: 0, nA: 0, kapH: 16, kapA: 16, avg, ha: fit.ha,
    };
  }
  const telemH = rollingTelem(arm, m.home_team_id, cutoff, m.competition_id);
  const telemA = rollingTelem(arm, m.away_team_id, cutoff, m.competition_id);
  let liveAttH = (formH.avg && formH.avg > 0 ? formH.avg : 1.35) / avg;
  let liveAttA = (formA.avg && formA.avg > 0 ? formA.avg : 1.15) / avg;
  let liveDefH = Math.max(0.6, 2.0 - liveAttA);
  let liveDefA = Math.max(0.7, 2.0 - liveAttH);
  let nH = formH.n > 0 ? formH.n : 5;
  let nA = formA.n > 0 ? formA.n : 5;
  let kapH = 16, kapA = 16;
  if (telemH.xgSamples >= 3 && telemH.rollingXgFor !== null) {
    liveAttH = telemH.rollingXgFor / avg;
    if (telemH.rollingXgAgainst !== null) liveDefH = telemH.rollingXgAgainst / avg;
    nH = telemH.xgSamples; kapH = 8;
  } else if (telemH.sampleSize >= 1) {
    liveAttH = telemH.rollingGoalsFor / avg;
    liveDefH = telemH.rollingGoalsAgainst / avg;
    nH = telemH.sampleSize; kapH = 14;
  }
  if (telemA.xgSamples >= 3 && telemA.rollingXgFor !== null) {
    liveAttA = telemA.rollingXgFor / avg;
    if (telemA.rollingXgAgainst !== null) liveDefA = telemA.rollingXgAgainst / avg;
    nA = telemA.xgSamples; kapA = 8;
  } else if (telemA.sampleSize >= 1) {
    liveAttA = telemA.rollingGoalsFor / avg;
    liveDefA = telemA.rollingGoalsAgainst / avg;
    nA = telemA.sampleSize; kapA = 14;
  }
  return {
    fixedLamMu: null,
    priorAttH: fit.attack.get(m.home_team_id) ?? 1,
    priorDefH: fit.defense.get(m.home_team_id) ?? 1,
    priorAttA: fit.attack.get(m.away_team_id) ?? 1,
    priorDefA: fit.defense.get(m.away_team_id) ?? 1,
    liveAttH, liveDefH, liveAttA, liveDefA, nH, nA, kapH, kapA, avg, ha: fit.ha,
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

// ---------------------------------------------------------------------------
// MAIN — fit dihitung SEKALI per (liga, lipatan) dan dipakai ketiga lengan
// (populasi uji identik per lipatan di semua lengan, by construction).
// ---------------------------------------------------------------------------
function main(): void {
  const t0 = performance.now();
  const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "oos-results.json"), "utf8")) as {
    levelB: { selected: { label: string; params: string; kappaScale: number }; heldout: Record<string, { n: number; logloss: number }> };
  };
  console.log(`[oos] liga populasi: ${leagues.length}; lipatan: V2 + H (V1 dilewati untuk membatasi runtime)`);
  const accFold: Record<Arm, Record<string, Acc>> = { old: {}, filter: {}, fixed: {} };
  const accPooled: Record<Arm, Acc> = { old: new Acc(), filter: new Acc(), fixed: new Acc() };
  for (const arm of ARMS) for (const f of FOLDS) accFold[arm][f.name] = new Acc();

  for (const fold of FOLDS) {
    for (const lg of leagues) {
      const n = lg.matches.length;
      const train = lg.matches.slice(0, Math.floor(n * fold.trainEnd));
      const test = lg.matches.slice(Math.floor(n * fold.testStart), Math.floor(n * fold.testEnd));
      if (!train.length || !test.length) continue;
      const refMs = Date.parse(test[0].utc_date);
      const raw = fitIPF(train, refMs, HALF_LIFE);
      if (!raw) continue;
      const fit = applyShrinkage(raw, train, KFIT);
      for (const m of test) {
        for (const arm of ARMS) {
          const bi = blendInput(arm, fit, m);
          const { lam, mu } = lamMuFromBlend(bi, KAPPA_SCALE);
          const p = probsFromLib(lam, mu, RHO);
          accFold[arm][fold.name].add(p, m.home_score, m.away_score);
          accPooled[arm].add(p, m.home_score, m.away_score);
        }
      }
    }
    console.log(`[oos] lipatan ${fold.name} selesai (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const armsOut: Record<string, unknown> = {};
  for (const arm of ARMS) {
    armsOut[arm] = {
      folds: Object.fromEntries(FOLDS.map((f) => [f.name, accFold[arm][f.name].metrics()])),
      pooled_H_V2: accPooled[arm].metrics(),
    };
    const a = armsOut[arm] as { folds: Record<string, { n: number; logloss: number; brier: number; slope: number | null }>; pooled_H_V2: { n: number; logloss: number; brier: number; slope: number | null } };
    for (const f of FOLDS) {
      const m = a.folds[f.name];
      console.log(`  [${arm}] ${f.name}: n=${m.n} LL=${m.logloss} Brier=${m.brier} slope=${m.slope}`);
    }
    console.log(`  [${arm}] pooled H+V2: n=${a.pooled_H_V2.n} LL=${a.pooled_H_V2.logloss} Brier=${a.pooled_H_V2.brier} slope=${a.pooled_H_V2.slope}`);
  }

  const out = {
    generated_at: new Date().toISOString(),
    runtime_seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
    config: {
      params_from_oos_results_levelB_selected: recorded.levelB.selected,
      half_life: HALF_LIFE, kfit: KFIT, rho: RHO, kappa_scale: KAPPA_SCALE,
      min_matches: MIN_MATCHES, leagues: leagues.length,
      folds_evaluated: ["V2", "H"],
      folds_skipped: ["V1 (dilewati untuk membatasi runtime)"],
    },
    arms_definition: {
      old: "logs semua sumber, bobot xG 1.0 (saji pra-fix)",
      filter: "logs source='sportmonks' saja, bobot xG 1.0",
      fixed: "logs source='sportmonks' saja + bobot xG rasio kompetisi (saji pasca-fix = harness)",
    },
    recorded_reference: {
      note: "tasks/oos-results.json per 2026-11-04 (store sudah tumbuh sejak itu via daily-refresh; lipatan % kronologis per liga → reproduksi persis TIDAK diharapkan)",
      levelB_heldout_winner_kx2: recorded.levelB.heldout["winner kx2"] ?? null,
    },
    arms: armsOut,
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "telemetry-oos.json"), JSON.stringify(out, null, 2));
  console.log(`[oos] selesai ${out.runtime_seconds}s → tasks/telemetry-oos.json`);
}

main();
