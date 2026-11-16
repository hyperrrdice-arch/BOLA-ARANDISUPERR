/**
 * VALIDATE TELEMETRY COMBINED ARM — Level B walk-forward: definisi
 * telemetri SM-only tervalidasi (`fixed`) vs gabungan SM ∪ football-data
 * (`combined`), semua hal lain identik (cerminan
 * scripts/backtest-walkforward.ts + scripts/validate-telemetry-oos.ts;
 * harness asli TIDAK diubah).
 *
 * ATURAN ADOPSI PRA-TERDAFTAR (tertulis di
 * tasks/telemetry-combined-arm-report.md §0 dan di-commit SEBELUM run
 * ini dieksekusi; gaya gerbang Fase C):
 *   PASS hanya bila KETIGANYA terpenuhi —
 *   (a) LL pooled (V2+H) combined − fixed ≤ +0,002;
 *   (b) |slope_combined − 1| ≤ |slope_fixed − 1| + 0,02 (pooled);
 *   (c) manfaat kesegaran nyata per tasks/telemetry-freshness.json
 *       (diukur scripts/measure-telemetry-freshness.ts; dievaluasi di
 *       laporan, bukan di sini).
 *
 * Konfigurasi tetap (tasks/oos-results.json → levelB.selected):
 *   params "hl365|rho:zero|kfit:10", blend James-Stein κ×2.
 * Populasi tetap: liga registry league_calibration calibrated/partial
 * dengan ≥120 match selesai sm:% — lipatan kronologis per liga yang sama.
 * Hanya lipatan V2 dan H yang dievaluasi (V1 dilewati — dinyatakan di
 * output).
 *
 * Lengan (satu-satunya saklar = definisi rollingTelem):
 *   fixed    : team_match_logs source='sportmonks' saja, bobot xG rasio
 *              kompetisi round3(targetAvg/logAvg) — byte-identik dengan
 *              lengan `fixed` di validate-telemetry-oos.ts.
 *   combined : SM ∪ football-data ter-pool per team_id; dedupe SEBELUM
 *              windowing, kunci tanggal(10)|opponent_id|GF|GA, baris
 *              sportmonks menang pada tabrakan; jendela 6 laga fisik
 *              berbeda terakhir strictly-before cutoff; bobot xG sama
 *              dengan fixed (kompetisi tak ter-resolve → bobot 1,0).
 *              Baris xG NULL hanya menyumbang gol; rata-rata xG per sisi
 *              dibagi COUNT sampel non-null sisi itu (NULL ≠ 0).
 *              Tanggal dinormalisasi ke 10 char untuk urutan/jendela
 *              (paritas substr saji) — satu-satunya deviasi mekanis dari
 *              fixed, hanya berdampak pada urutan intra-hari di tepi
 *              jendela.
 *   canonical: DESKRIPTIF (tidak ikut gerbang) — jendela dari
 *              team_match_logs_canonical lewat registry
 *              data/team-canonical.json (yang dibaca saji live hari
 *              ini); tim tanpa pemetaan kanonik → jendela fixed
 *              (paritas fallback saji).
 * Gol selalu tanpa bobot; form goals (matches sm:%) identik semua lengan.
 *
 * Diagnostik (deskriptif, bukan gerbang): per lipatan — jumlah laga uji
 * yang jendela combined-nya berbeda keanggotaan dari fixed (per tim),
 * dan metrik kedua lengan pada subset laga berbeda itu saja.
 *
 * Output: tasks/telemetry-combined-oos.json. Offline penuh, tanpa tulis DB.
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
// Pemuatan data (identik harness referensi)
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
type Arm = "fixed" | "combined" | "canonical";
const ARMS: Arm[] = ["fixed", "combined", "canonical"];

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

// --- fixed: SM-only, persis harness referensi -------------------------------
function loadLogsFixed(): Map<string, LogRow[]> {
  const byTeam = new Map<string, LogRow[]>();
  for (const r of ds.prepare(
    `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
     FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
  ).all() as unknown as (LogRow & { match_id: string })[]) {
    const arr = byTeam.get(r.team_id) ?? [];
    arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
    byTeam.set(r.team_id, arr);
  }
  return byTeam;
}

// --- combined: SM ∪ fd, dedupe kunci laga fisik, SM menang ------------------
interface RawLog extends LogRow { opponent_id: string; prio: number }
function loadLogsCombined(): { byTeam: Map<string, LogRow[]>; stats: { fdRows: number; collisions: number; fdKept: number } } {
  const rows = ds.prepare(
    `SELECT team_id, match_id, match_date, opponent_id, goals_for, goals_against, xg_for, xg_against, source
     FROM team_match_logs WHERE source IN ('sportmonks', 'football-data')
     ORDER BY team_id, match_date`,
  ).all() as unknown as (LogRow & { match_id: string; opponent_id: string; source: string })[];
  const perTeam = new Map<string, Map<string, RawLog>>();
  let fdRows = 0, collisions = 0, fdKept = 0;
  for (const r of rows) {
    const prio = r.source === "sportmonks" ? 0 : 1;
    if (prio === 1) fdRows++;
    const key = `${r.match_date.slice(0, 10)}|${r.opponent_id}|${r.goals_for}|${r.goals_against}`;
    let m = perTeam.get(r.team_id);
    if (!m) { m = new Map(); perTeam.set(r.team_id, m); }
    const prev = m.get(key);
    if (prev) {
      collisions++;
      if (prio < prev.prio) m.set(key, { ...r, competition_id: compOfMatch.get(r.match_id) ?? null, prio });
    } else {
      m.set(key, { ...r, competition_id: compOfMatch.get(r.match_id) ?? null, prio });
    }
  }
  const byTeam = new Map<string, LogRow[]>();
  for (const [team, m] of perTeam) {
    const arr = [...m.values()].sort((a, b) =>
      a.match_date.slice(0, 10).localeCompare(b.match_date.slice(0, 10)) ||
      a.match_date.localeCompare(b.match_date) || a.prio - b.prio);
    for (const r of arr) if (r.prio === 1) fdKept++;
    byTeam.set(team, arr.map(({ opponent_id: _o, prio: _p, ...rest }) => rest));
  }
  return { byTeam, stats: { fdRows, collisions, fdKept } };
}

// --- canonical: tabel saji live, per canonical_team_id ----------------------
const registryMember2Canon = new Map<string, string>();
{
  const reg = JSON.parse(fs.readFileSync(dataPath("team-canonical.json"), "utf8")) as {
    teams: { canonical_id: string; members: { team_id: string }[] }[];
  };
  for (const t of reg.teams) for (const m of t.members) registryMember2Canon.set(m.team_id, t.canonical_id);
}
function loadLogsCanonical(): Map<string, LogRow[]> {
  const byTeam = new Map<string, LogRow[]>();
  for (const r of ds.prepare(
    `SELECT canonical_team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
     FROM team_match_logs_canonical ORDER BY canonical_team_id, match_date`,
  ).all() as unknown as (LogRow & { match_id: string; canonical_team_id: string })[]) {
    const arr = byTeam.get(r.canonical_team_id) ?? [];
    arr.push({ ...r, team_id: r.canonical_team_id, competition_id: compOfMatch.get(r.match_id) ?? null });
    byTeam.set(r.canonical_team_id, arr);
  }
  return byTeam;
}

const logsFixed = loadLogsFixed();
const combinedLoaded = loadLogsCombined();
const logsCombined = combinedLoaded.byTeam;
const logsCanonical = loadLogsCanonical();

function datesOf(byTeam: Map<string, LogRow[]>, date10: boolean): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [t, arr] of byTeam) out.set(t, arr.map((l) => (date10 ? l.match_date.slice(0, 10) : l.match_date)));
  return out;
}
const datesFixed = datesOf(logsFixed, false);
const datesCombined = datesOf(logsCombined, true);
const datesCanonical = datesOf(logsCanonical, false);

function logsFor(arm: Arm, teamId: string): { logs: LogRow[]; dates: string[] } | null {
  if (arm === "fixed") {
    const logs = logsFixed.get(teamId); const dates = datesFixed.get(teamId);
    return logs && dates ? { logs, dates } : null;
  }
  if (arm === "combined") {
    const logs = logsCombined.get(teamId); const dates = datesCombined.get(teamId);
    return logs && dates ? { logs, dates } : null;
  }
  const canon = registryMember2Canon.get(teamId);
  if (canon) {
    const logs = logsCanonical.get(canon); const dates = datesCanonical.get(canon);
    if (logs && dates) return { logs, dates };
  }
  const logs = logsFixed.get(teamId); const dates = datesFixed.get(teamId);
  return logs && dates ? { logs, dates } : null;
}

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
// Fit IPF + shrinkage (identik harness referensi)
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
// Metrik (identik harness referensi: Acc + logitSlope)
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
// Populasi + lipatan (identik harness referensi)
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
// (compAvg/formGoals/blend identik harness referensi)
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
function windowRows(arm: Arm, teamId: string, cutoff: string): LogRow[] {
  const src = logsFor(arm, teamId);
  if (!src) return [];
  const end = upperBoundDate(src.dates, cutoff);
  return src.logs.slice(Math.max(0, end - 6), end);
}
function windowKeySet(arm: Arm, teamId: string, cutoff: string): string {
  return windowRows(arm, teamId, cutoff)
    .map((l) => `${l.match_date.slice(0, 10)}|${l.goals_for}|${l.goals_against}`)
    .join(";");
}
function rollingTelem(arm: Arm, teamId: string, cutoff: string, targetCompId: string): RollingTelem {
  const empty: RollingTelem = { sampleSize: 0, xgSamples: 0, rollingXgFor: null, rollingXgAgainst: null, rollingGoalsFor: 0, rollingGoalsAgainst: 0 };
  const win = windowRows(arm, teamId, cutoff);
  if (!win.length) return empty;
  const targetAvg = compAvgGoals(targetCompId) ?? 1.48;
  let gf = 0, ga = 0, sxf = 0, cxf = 0, sxa = 0, cxa = 0;
  for (const log of win) {
    gf += log.goals_for; ga += log.goals_against;
    let wgt = 1.0;
    if (log.competition_id && log.competition_id !== targetCompId) {
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
// MAIN — fit dihitung SEKALI per (liga, lipatan), dipakai semua lengan
// (populasi uji identik per lipatan di semua lengan, by construction).
// ---------------------------------------------------------------------------
function main(): void {
  const t0 = performance.now();
  const recorded = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "oos-results.json"), "utf8")) as {
    levelB: { selected: { label: string; params: string; kappaScale: number } };
  };
  console.log(`[oos-combined] liga populasi: ${leagues.length}; lipatan: V2 + H (V1 dilewati)`);
  console.log(`[oos-combined] combined pool: fd rows=${combinedLoaded.stats.fdRows}, tabrakan kunci=${combinedLoaded.stats.collisions}, fd tersisa sesudah dedupe=${combinedLoaded.stats.fdKept}`);
  const accFold: Record<Arm, Record<string, Acc>> = { fixed: {}, combined: {}, canonical: {} };
  const accPooled: Record<Arm, Acc> = { fixed: new Acc(), combined: new Acc(), canonical: new Acc() };
  for (const arm of ARMS) for (const f of FOLDS) accFold[arm][f.name] = new Acc();
  const diffFold: Record<string, { n: number; fixed: Acc; combined: Acc }> = {};
  const diffPooled = { n: 0, fixed: new Acc(), combined: new Acc() };
  for (const f of FOLDS) diffFold[f.name] = { n: 0, fixed: new Acc(), combined: new Acc() };

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
        const cutoff = m.utc_date.slice(0, 10);
        const differs =
          windowKeySet("fixed", m.home_team_id, cutoff) !== windowKeySet("combined", m.home_team_id, cutoff) ||
          windowKeySet("fixed", m.away_team_id, cutoff) !== windowKeySet("combined", m.away_team_id, cutoff);
        for (const arm of ARMS) {
          const bi = blendInput(arm, fit, m);
          const { lam, mu } = lamMuFromBlend(bi, KAPPA_SCALE);
          const p = probsFromLib(lam, mu, RHO);
          accFold[arm][fold.name].add(p, m.home_score, m.away_score);
          accPooled[arm].add(p, m.home_score, m.away_score);
          if (differs && (arm === "fixed" || arm === "combined")) {
            diffFold[fold.name][arm].add(p, m.home_score, m.away_score);
            diffPooled[arm].add(p, m.home_score, m.away_score);
          }
        }
        if (differs) { diffFold[fold.name].n++; diffPooled.n++; }
      }
    }
    console.log(`[oos-combined] lipatan ${fold.name} selesai (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
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

  const pf = (armsOut.fixed as { pooled_H_V2: { logloss: number; slope: number | null } }).pooled_H_V2;
  const pc = (armsOut.combined as { pooled_H_V2: { logloss: number; slope: number | null } }).pooled_H_V2;
  const llDelta = Number((pc.logloss - pf.logloss).toFixed(4));
  const slopeWorsen = pf.slope !== null && pc.slope !== null
    ? Number((Math.abs(pc.slope - 1) - Math.abs(pf.slope - 1)).toFixed(3)) : null;
  const gateA = llDelta <= 0.002;
  const gateB = slopeWorsen !== null ? slopeWorsen <= 0.02 : false;
  console.log(`[oos-combined] GATE (a) LL delta=${llDelta} (≤ +0,002) → ${gateA ? "LULUS" : "GAGAL"}`);
  console.log(`[oos-combined] GATE (b) slope worsen=${slopeWorsen} (≤ +0,02) → ${gateB ? "LULUS" : "GAGAL"}`);
  console.log(`[oos-combined] diagnostik: laga uji berjendela beda=${diffPooled.n} (V2=${diffFold.V2.n}, H=${diffFold.H.n})`);

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
    pre_registered_rule: {
      source: "tasks/telemetry-combined-arm-report.md §0 (di-commit sebelum run)",
      gate_a: "LL pooled combined − fixed ≤ +0,002",
      gate_b: "|slope_combined − 1| ≤ |slope_fixed − 1| + 0,02 (pooled)",
      gate_c: "kesegaran nyata — dievaluasi dari tasks/telemetry-freshness.json di laporan",
    },
    arms_definition: {
      fixed: "logs source='sportmonks' saja + bobot xG rasio kompetisi (definisi tervalidasi saat ini)",
      combined: "logs SM ∪ football-data, dedupe kunci tanggal(10)|opponent|GF|GA (SM menang), jendela 6 laga fisik berbeda, bobot xG sama; xG NULL = gol saja, penyebut count non-null per sisi",
      canonical: "DESKRIPTIF — jendela team_match_logs_canonical via registry (saji live); tanpa pemetaan → jendela fixed",
    },
    combined_pool_stats: combinedLoaded.stats,
    recorded_reference: {
      note: "tasks/telemetry-oos.json per 2026-11-04 (store sudah tumbuh sejak itu; reproduksi persis TIDAK diharapkan — perbandingan sah = antar-lengan satu run)",
      fixed_pooled_2026_11_04: { n: 12409, logloss: 1.0152, brier: 0.6078, slope: 0.982 },
    },
    arms: armsOut,
    diagnostics_window_differs: {
      folds: Object.fromEntries(FOLDS.map((f) => [f.name, {
        n_differs: diffFold[f.name].n,
        fixed: diffFold[f.name].fixed.metrics(),
        combined: diffFold[f.name].combined.metrics(),
      }])),
      pooled: { n_differs: diffPooled.n, fixed: diffPooled.fixed.metrics(), combined: diffPooled.combined.metrics() },
    },
    gate: {
      a_logloss: { delta: llDelta, threshold: 0.002, pass: gateA },
      b_slope: { worsen: slopeWorsen, threshold: 0.02, pass: gateB },
      c_freshness: "lihat tasks/telemetry-freshness.json + laporan §4",
    },
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "telemetry-combined-oos.json"), JSON.stringify(out, null, 2));
  console.log(`[oos-combined] selesai ${out.runtime_seconds}s → tasks/telemetry-combined-oos.json`);
}

main();
