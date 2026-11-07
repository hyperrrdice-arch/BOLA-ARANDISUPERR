/**
 * WALK-FORWARD OOS — FORM BLEND JALUR PIALA (Phase C) → tasks/cup-form-blend-oos.json.
 *
 * Varian yang diuji: prior piala = parameter fit domestik lipatan yang
 * ditransformasi offset δ lipatan (att·e^δ, def·e^−δ), lalu di-blend
 * James-Stein dengan telemetri rolling last-6 / form gol — semantik blend
 * Level B produksi (κ×2) persis seperti cerminan lab di
 * scripts/parlay-lab.ts (blendInput / lamMuFromBlend) dan blend produksi
 * lib/quant/ratings-loader.ts. Inti blend bersama ada di
 * lib/quant/cup-form-blend.ts (murni, tanpa DB); harness ini mencerminkan
 * pemuatan + perhitungan telemetri/form lab (rollingTelem, formGoals,
 * compAvgGoals, matrixFromLamMu, candidatesFromMatrix, BANDS, statOf)
 * dengan atribusi — preseden cerminan antar-skrip yang sama seperti
 * parlay-lab mencerminkan backtest-walkforward.ts.
 *
 * Protokol: dicerminkan dari scripts/backtest-cup-offsets.ts — per graf,
 * per kompetisi piala, per musim setelah musim pertama: fit domestik per
 * liga + fit δ + G/HA lipatan hanya dari data bertanggal SEBELUM musim uji
 * mulai. Lengan offset-only memakai predictMatch yang ADA (persis harness
 * piala asli); lengan blend menilai populasi ter-rate yang IDENTIK
 * (match yang sama persis — blend dihitung hanya bila prediksi offset
 * ada). Telemetri/form per match memakai cutoff tanggal laga itu sendiri
 * (utc_date dipotong 10 char, strictly-before via upperBoundDate lab) —
 * semantik "form live saat laga" yang sama seperti lab/produksi.
 * λ/μ blend dari parameter hasil blend dengan G dan cupHA lipatan;
 * matriks skor via konvensi matrixFromLamMu lab (calculateDixonColes,
 * rho=0, maxGoals=10); 1X2 blend dari jumlah sel matriks presisi penuh.
 * Baseline naive identik harness piala asli (base rate latih kompetisi).
 *
 * GERBANG SANITY (wajib): lengan offset-only harness ini HARUS
 * mereproduksi tasks/cup-oos.json — nRated per kompetisi EKSAK dan
 * log-loss dalam ±0,002. Bila tidak, hasil blend TIDAK boleh dipercaya
 * (harness tetap menulis file dengan reproductionCheck.pass=false agar
 * ketidakcocokan terdokumentasi; keputusan adopsi dipaksa REJECT).
 *
 * ATURAN ADOPSI (pra-terdaftar, ditulis sebelum hasil apa pun ada —
 * jangan diubah):
 * Adopt the blend ONLY if ALL three hold on the identical rated population:
 * (i) pooled held-out log-loss (1X2, metricsOf) of blend < offset-only;
 * (ii) pooled calibration slope does not worsen: |slope_blend − 1| ≤ |slope_offset − 1|;
 * (iii) high-band honesty does not degrade overall: pooled over all 16 matrix candidates with stated prob ≥ 0.55 (lab BANDS 55–60 … 85+), the n-weighted gap (hitRate − meanProb) of blend ≥ gap of offset-only.
 *
 * Pakai: npx tsx scripts/backtest-cup-form-blend.ts
 * Offline penuh: hanya store lokal; tidak memanggil API; tidak menulis
 * DB apa pun (analysis_snapshots.db tidak disentuh).
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  CUP_COMPETITIONS,
  buildTeamDomesticMap,
  domesticLeaguesOfGraph,
  fitDomesticFold,
  fitOffsets,
  isDomesticLeagueEntry,
  loadFinishedMatches,
  metricsOf,
  pickReference,
  predictMatch,
  resolveAnchors,
  storeIdsOf,
  type AnchorMatch,
  type GraphId,
  type MatchPrediction,
  type ResolvedTeam,
} from "../lib/quant/cup-offset-fit";
import type { CanonicalLeague } from "../lib/quant/league-identity";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import {
  CUP_BLEND_KAPPA_BASE,
  CUP_BLEND_KAPPA_SCALE,
  blendCupMatch,
  cupLamMu,
  type CupBlendBranch,
} from "../lib/quant/cup-form-blend";
import { evaluatePick } from "../lib/picks/ledger";

const ADOPTION_RULE =
  "Adopt the blend ONLY if ALL three hold on the identical rated population: " +
  "(i) pooled held-out log-loss (1X2, metricsOf) of blend < offset-only; " +
  "(ii) pooled calibration slope does not worsen: |slope_blend − 1| ≤ |slope_offset − 1|; " +
  "(iii) high-band honesty does not degrade overall: pooled over all 16 matrix candidates with stated prob ≥ 0.55 (lab BANDS 55–60 … 85+), the n-weighted gap (hitRate − meanProb) of blend ≥ gap of offset-only.";

const RHO = 0; // konvensi lab (parlay-lab RHO) & jalur piala (rho=0)

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}
const round2 = (v: number) => Number(v.toFixed(2));
const round3 = (v: number) => Number(v.toFixed(3));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

// ===========================================================================
// CERMINAN scripts/parlay-lab.ts — pemuatan store untuk telemetri/form.
// Identik dengan lab: matches sm:% finished untuk form; team_match_logs
// source='sportmonks' dengan competition_id via join matches.match_id
// untuk telemetri; rata-rata kompetisi terukur dari SELURUH store.
// ===========================================================================
interface LabMatchRow {
  match_id: string;
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
    `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
     FROM matches
     WHERE competition_id LIKE 'sm:%' AND status = 'finished'
       AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY competition_id, utc_date`,
  )
  .all() as unknown as LabMatchRow[];

const compOfMatch = new Map<string, string>();
{
  const rows = ds.prepare("SELECT match_id, competition_id FROM matches").all() as unknown as {
    match_id: string;
    competition_id: string;
  }[];
  for (const r of rows) compOfMatch.set(r.match_id, r.competition_id);
}

const logsByTeam = new Map<string, LogRow[]>();
{
  const rows = ds
    .prepare(
      `SELECT team_id, match_id, match_date, goals_for, goals_against, xg_for, xg_against
       FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
    )
    .all() as unknown as (LogRow & { match_id: string })[];
  for (const r of rows) {
    const arr = logsByTeam.get(r.team_id) ?? [];
    arr.push({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null });
    logsByTeam.set(r.team_id, arr);
  }
}

const matchesByTeam = new Map<string, LabMatchRow[]>();
for (const m of allMatches) {
  for (const t of [m.home_team_id, m.away_team_id]) {
    const arr = matchesByTeam.get(t) ?? [];
    arr.push(m);
    matchesByTeam.set(t, arr);
  }
}
for (const arr of matchesByTeam.values()) arr.sort((x, y) => x.utc_date.localeCompare(y.utc_date));

// CERMINAN lab compAvgGoals (terukur dari seluruh store + fallback legacy).
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
       GROUP BY competition_id`,
    )
    .all() as unknown as { competition_id: string; a: number }[];
  for (const r of rows) if (Number.isFinite(r.a) && r.a > 0) measuredCompAvg.set(r.competition_id, r.a);
}
function compAvgGoals(compId: string | null): number | null {
  if (!compId) return null;
  return measuredCompAvg.get(compId) ?? LEGACY_COMP_AVG[compId] ?? null;
}

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

// CERMINAN lab rollingTelem — identik (window last-6 strictly-before cutoff,
// xG tertimbang round3(targetAvg/logAvg), agregat round2).
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

// CERMINAN lab formGoals — identik (last-6 laga sm:% finished sebelum cutoff).
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

// CERMINAN lab matrixFromLamMu — konvensi rasio (leagueAvgGoals=μ,
// homeAdvantage=λ/μ, attack/defense=1, rho=0, maxGoals=10).
function matrixFromLamMu(lam: number, mu: number): number[][] | null {
  if (!(lam > 0) || !(mu > 0)) return null;
  const dc = calculateDixonColes({
    homeAttack: 1,
    homeDefense: 1,
    awayAttack: 1,
    awayDefense: 1,
    homeAdvantage: lam / mu,
    leagueAvgGoals: mu,
    rho: RHO,
    maxGoals: 10,
  });
  return dc.score_matrix;
}

function probs1x2FromMatrix(mx: number[][]): { pHome: number; pDraw: number; pAway: number } {
  let ph = 0,
    pd = 0,
    pa = 0;
  for (let x = 0; x < mx.length; x++) {
    for (let y = 0; y < mx[x].length; y++) {
      const p = mx[x][y];
      if (x > y) ph += p;
      else if (x === y) pd += p;
      else pa += p;
    }
  }
  return { pHome: ph, pDraw: pd, pAway: pa };
}

// CERMINAN lab candidatesFromMatrix — 16 kandidat per match dari matriks.
interface Candidate {
  market: string;
  selection: string;
  prob: number;
}
function candidatesFromMatrix(mx: number[][]): Candidate[] {
  const N = mx.length;
  let ph = 0,
    pd = 0,
    pa = 0,
    over15 = 0,
    under15 = 0,
    over25 = 0,
    under25 = 0,
    over35 = 0,
    under35 = 0,
    bttsYes = 0,
    bttsNo = 0,
    homeScores = 0,
    awayScores = 0;
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < mx[x].length; y++) {
      const p = mx[x][y];
      if (x > y) ph += p;
      else if (x === y) pd += p;
      else pa += p;
      const tot = x + y;
      if (tot >= 2) over15 += p;
      else under15 += p;
      if (tot >= 3) over25 += p;
      else under25 += p;
      if (tot >= 4) over35 += p;
      else under35 += p;
      if (x >= 1 && y >= 1) bttsYes += p;
      else bttsNo += p;
      if (x >= 1) homeScores += p;
      if (y >= 1) awayScores += p;
    }
  }
  return [
    { market: "1x2", selection: "1", prob: ph },
    { market: "1x2", selection: "x", prob: pd },
    { market: "1x2", selection: "2", prob: pa },
    { market: "dc", selection: "1x", prob: ph + pd },
    { market: "dc", selection: "12", prob: ph + pa },
    { market: "dc", selection: "x2", prob: pd + pa },
    { market: "ou15", selection: "over", prob: over15 },
    { market: "ou15", selection: "under", prob: under15 },
    { market: "ou25", selection: "over", prob: over25 },
    { market: "ou25", selection: "under", prob: under25 },
    { market: "ou35", selection: "over", prob: over35 },
    { market: "ou35", selection: "under", prob: under35 },
    { market: "btts", selection: "yes", prob: bttsYes },
    { market: "btts", selection: "no", prob: bttsNo },
    { market: "team_over05_home", selection: "yes", prob: homeScores },
    { market: "team_over05_away", selection: "yes", prob: awayScores },
  ];
}

// CERMINAN lab BANDS + statOf + bandStats (definisi pita satu sumber: lab).
const BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0.55, hi: 0.6, label: "55–60" },
  { lo: 0.6, hi: 0.65, label: "60–65" },
  { lo: 0.65, hi: 0.7, label: "65–70" },
  { lo: 0.7, hi: 0.75, label: "70–75" },
  { lo: 0.75, hi: 0.8, label: "75–80" },
  { lo: 0.8, hi: 0.85, label: "80–85" },
  { lo: 0.85, hi: 1.01, label: "85+" },
];
interface CandRow {
  market: string;
  prob: number;
  hit: number;
}
interface StatCell {
  n: number;
  meanProb: number | null;
  hitRate: number | null;
  gap: number | null;
}
function statOf(rows: CandRow[]): StatCell {
  if (rows.length === 0) return { n: 0, meanProb: null, hitRate: null, gap: null };
  const meanProb = rows.reduce((s, r) => s + r.prob, 0) / rows.length;
  const hitRate = rows.reduce((s, r) => s + r.hit, 0) / rows.length;
  return { n: rows.length, meanProb: round4(meanProb), hitRate: round4(hitRate), gap: round4(hitRate - meanProb) };
}
function statOfRaw(rows: CandRow[]): { n: number; meanProb: number; hitRate: number; gap: number } {
  const meanProb = rows.length ? rows.reduce((s, r) => s + r.prob, 0) / rows.length : 0;
  const hitRate = rows.length ? rows.reduce((s, r) => s + r.hit, 0) / rows.length : 0;
  return { n: rows.length, meanProb, hitRate, gap: hitRate - meanProb };
}
interface BandCell extends StatCell {
  band: string;
  lo: number;
}
function bandStats(rows: CandRow[]): BandCell[] {
  return BANDS.map((b) => ({
    band: b.label,
    lo: b.lo,
    ...statOf(rows.filter((r) => r.prob >= b.lo && r.prob < b.hi)),
  }));
}
function bandHonestyOf(rows: CandRow[]): {
  byMarket: Record<string, BandCell[]>;
  pooledPerBand: BandCell[];
  highBandAggregate: StatCell;
  highBandAggregateRaw: { n: number; meanProb: number; hitRate: number; gap: number };
} {
  const markets = [...new Set(rows.map((r) => r.market))].sort();
  const byMarket: Record<string, BandCell[]> = {};
  for (const mk of markets) byMarket[mk] = bandStats(rows.filter((r) => r.market === mk));
  const high = rows.filter((r) => r.prob >= 0.55);
  return { byMarket, pooledPerBand: bandStats(rows), highBandAggregate: statOf(high), highBandAggregateRaw: statOfRaw(high) };
}

// ===========================================================================
// WALK-FORWARD — dicerminkan dari scripts/backtest-cup-offsets.ts (konteks
// lipatan per batas musim identik), ditambah lengan blend per match ter-rate.
// ===========================================================================
interface CompFold {
  season: string;
  boundary: string;
  nTest: number;
  nRated: number;
  reference: string | null;
}
interface CompResult {
  graph: GraphId;
  kind: string;
  folds: CompFold[];
  nTest: number;
  nRated: number;
  coverage: number;
  offset: ReturnType<typeof metricsOf>;
  blend: ReturnType<typeof metricsOf>;
  naive: ReturnType<typeof metricsOf>;
  llDeltaBlendMinusOffset: number;
}

function main() {
  const startedMs = Date.now();
  const canonicals = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "league-canonical.json"), "utf8")) as { leagues: CanonicalLeague[] }).leagues;
  const matches = loadFinishedMatches();

  const domesticStoreToCanonical = new Map<string, string>();
  for (const e of canonicals) {
    if (!isDomesticLeagueEntry(e)) continue;
    for (const id of storeIdsOf(e)) domesticStoreToCanonical.set(id, e.canonical_id);
  }
  const cupStoreToCanonical = new Map<string, string>();
  for (const c of CUP_COMPETITIONS) cupStoreToCanonical.set(c.canonicalId, c.canonicalId);

  const graphs: GraphId[] = ["europe", "conmebol", "afc"];
  const compResults = new Map<string, CompResult>();
  const pooledOffset: MatchPrediction[] = [];
  const pooledBlend: MatchPrediction[] = [];
  const pooledNaive: MatchPrediction[] = [];
  const candOffset: CandRow[] = [];
  const candBlend: CandRow[] = [];
  const branchStats = {
    overall: new Map<CupBlendBranch, { sides: number; wSum: number }>(),
    byGraph: new Map<string, Map<CupBlendBranch, { sides: number; wSum: number }>>(),
  };
  const noteBranch = (graph: string, branch: CupBlendBranch, w: number) => {
    const o = branchStats.overall.get(branch) ?? { sides: 0, wSum: 0 };
    o.sides += 1;
    o.wSum += w;
    branchStats.overall.set(branch, o);
    let per = branchStats.byGraph.get(graph);
    if (!per) branchStats.byGraph.set(graph, (per = new Map()));
    const g = per.get(branch) ?? { sides: 0, wSum: 0 };
    g.sides += 1;
    g.wSum += w;
    per.set(branch, g);
  };

  for (const graph of graphs) {
    const graphLeagueEntries = domesticLeaguesOfGraph(canonicals, graph);
    const graphLeagues = new Set(graphLeagueEntries.map((e) => e.canonical_id));
    const cupStoreIds = new Set(CUP_COMPETITIONS.filter((c) => c.graph === graph).map((c) => c.canonicalId));
    const cupMatches = matches.filter((m) => cupStoreIds.has(m.competition_id));

    interface FoldContext {
      teamDomestic: ReturnType<typeof buildTeamDomesticMap>;
      foldFits: Map<string, ReturnType<typeof fitDomesticFold>>;
      offsetFit: ReturnType<typeof fitOffsets>;
      reference: string | null;
    }
    const ctxCache = new Map<string, FoldContext>();
    const getCtx = (boundary: string): FoldContext => {
      const hit = ctxCache.get(boundary);
      if (hit) return hit;
      const bMs = Date.parse(boundary);
      const trainDomestic = matches.filter((m) => domesticStoreToCanonical.has(m.competition_id) && Date.parse(m.utc_date) < bMs);
      const teamDomestic = buildTeamDomesticMap(trainDomestic, canonicals, domesticStoreToCanonical);
      const foldFits = new Map<string, ReturnType<typeof fitDomesticFold>>();
      for (const e of graphLeagueEntries) {
        const lm = trainDomestic.filter((m) => domesticStoreToCanonical.get(m.competition_id) === e.canonical_id);
        if (lm.length >= 10) foldFits.set(e.canonical_id, fitDomesticFold(lm, bMs));
      }
      const resolver = (teamId: string): ResolvedTeam | null => {
        const dom = teamDomestic.get(teamId);
        if (!dom || !graphLeagues.has(dom.canonicalId)) return null;
        const fit = foldFits.get(dom.canonicalId);
        if (!fit) return null;
        const att = fit.attack.get(teamId);
        const def = fit.defense.get(teamId);
        if (att === undefined || def === undefined) return null;
        return { domestic: dom.canonicalId, attack: att, defense: def };
      };
      const trainCup = cupMatches.filter((m) => Date.parse(m.utc_date) < bMs);
      const { anchors } = resolveAnchors(trainCup, cupStoreToCanonical, graphLeagues, resolver, bMs);
      const reference = pickReference(anchors);
      const offsetFit = reference ? fitOffsets(anchors, [...graphLeagues], reference) : null;
      const ctx: FoldContext = { teamDomestic, foldFits, offsetFit, reference };
      ctxCache.set(boundary, ctx);
      return ctx;
    };

    for (const comp of CUP_COMPETITIONS.filter((c) => c.graph === graph)) {
      const compMatches = cupMatches.filter((m) => m.competition_id === comp.canonicalId);
      const seasons = [...new Set(compMatches.map((m) => m.season))].sort();
      const folds: CompFold[] = [];
      const offsetPreds: MatchPrediction[] = [];
      const blendPreds: MatchPrediction[] = [];
      const naivePreds: MatchPrediction[] = [];
      let nTest = 0;

      for (let si = 1; si < seasons.length; si++) {
        const season = seasons[si];
        const test = compMatches.filter((m) => m.season === season);
        const boundary = test.reduce((min, m) => (m.utc_date < min ? m.utc_date : min), test[0].utc_date);
        const ctx = getCtx(boundary);
        const trainComp = compMatches.filter((m) => Date.parse(m.utc_date) < Date.parse(boundary));
        let hSum = 0,
          aSum = 0;
        for (const m of trainComp) {
          hSum += m.home_score;
          aSum += m.away_score;
        }
        const mu0 = trainComp.length > 0 ? aSum / trainComp.length : 1.2;
        const lam0 = trainComp.length > 0 ? hSum / trainComp.length : 1.5;
        const naiveDc = calculateDixonColes({
          homeAttack: 1,
          homeDefense: 1,
          awayAttack: 1,
          awayDefense: 1,
          leagueAvgGoals: Math.max(0.2, mu0),
          homeAdvantage: Math.max(0.2, lam0 / Math.max(0.2, mu0)),
          rho: 0,
        });
        let nRatedFold = 0;
        for (const m of test) {
          nTest += 1;
          const outcome: MatchPrediction["outcome"] = m.home_score > m.away_score ? "H" : m.home_score === m.away_score ? "D" : "A";
          if (!ctx.offsetFit) continue;
          const domH = ctx.teamDomestic.get(m.home_team_id);
          const domA = ctx.teamDomestic.get(m.away_team_id);
          const fitH = domH ? ctx.foldFits.get(domH.canonicalId) : null;
          const fitA = domA ? ctx.foldFits.get(domA.canonicalId) : null;
          const attH = fitH?.attack.get(m.home_team_id);
          const defH = fitH?.defense.get(m.home_team_id);
          const attA = fitA?.attack.get(m.away_team_id);
          const defA = fitA?.defense.get(m.away_team_id);
          if (!domH || !domA || attH === undefined || defH === undefined || attA === undefined || defA === undefined) continue;
          const anchorLike: AnchorMatch = {
            competition_id: comp.canonicalId,
            season: m.season,
            utc_date: m.utc_date,
            homeLeague: domH.canonicalId,
            awayLeague: domA.canonicalId,
            attH,
            defH,
            attA,
            defA,
            homeGoals: m.home_score,
            awayGoals: m.away_score,
            weight: 1,
            crossLeague: domH.canonicalId !== domA.canonicalId,
          };
          // Lengan offset-only: predictMatch yang ADA, persis harness asli.
          const pred = predictMatch(anchorLike, ctx.offsetFit.delta, ctx.offsetFit.globalAvg, ctx.offsetFit.cupHA);
          if (!pred) continue;
          nRatedFold += 1;
          const np: MatchPrediction = { pHome: naiveDc.prob_home_win, pDraw: naiveDc.prob_draw, pAway: naiveDc.prob_away_win, outcome, leg2: false };
          naivePreds.push(np);
          pooledNaive.push(np);
          const mp: MatchPrediction = { ...pred, outcome, leg2: false };
          offsetPreds.push(mp);
          pooledOffset.push(mp);

          // Matriks offset: panggilan DC yang sama seperti di dalam
          // predictMatch (diulang untuk score_matrix presisi penuh —
          // preseden parlay-lab generateCups).
          const dH = ctx.offsetFit.delta.get(domH.canonicalId)!;
          const dA = ctx.offsetFit.delta.get(domA.canonicalId)!;
          const dcOff = calculateDixonColes({
            homeAttack: attH * Math.exp(dH),
            homeDefense: defH * Math.exp(-dH),
            awayAttack: attA * Math.exp(dA),
            awayDefense: defA * Math.exp(-dA),
            homeAdvantage: ctx.offsetFit.cupHA,
            leagueAvgGoals: ctx.offsetFit.globalAvg,
            rho: 0,
          });
          for (const c of candidatesFromMatrix(dcOff.score_matrix)) {
            candOffset.push({ market: c.market, prob: c.prob, hit: evaluatePick(c.market, c.selection, m.home_score, m.away_score) });
          }

          // Lengan blend: prior = att/def lipatan tertransformasi δ;
          // avg = G lipatan; targetCompId = kompetisi piala laga ini.
          const G = ctx.offsetFit.globalAvg;
          const cutoff = m.utc_date.slice(0, 10);
          const blended = blendCupMatch({
            priorAttH: attH * Math.exp(dH),
            priorDefH: defH * Math.exp(-dH),
            priorAttA: attA * Math.exp(dA),
            priorDefA: defA * Math.exp(-dA),
            telemH: rollingTelem(m.home_team_id, cutoff, m.competition_id),
            telemA: rollingTelem(m.away_team_id, cutoff, m.competition_id),
            formH: formGoals(m.home_team_id, cutoff),
            formA: formGoals(m.away_team_id, cutoff),
            avg: G,
          });
          noteBranch(graph, blended.home.branch, blended.home.w);
          noteBranch(graph, blended.away.branch, blended.away.w);
          const { lam, mu } = cupLamMu(blended.home, blended.away, G, ctx.offsetFit.cupHA);
          const mx = matrixFromLamMu(lam, mu);
          if (!mx) throw new Error(`matrixFromLamMu null untuk laga ter-rate ${comp.canonicalId} ${m.utc_date} — populasi blend akan divergen dari offset`);
          const bp = probs1x2FromMatrix(mx);
          const bmp: MatchPrediction = { ...bp, outcome, leg2: false };
          blendPreds.push(bmp);
          pooledBlend.push(bmp);
          for (const c of candidatesFromMatrix(mx)) {
            candBlend.push({ market: c.market, prob: c.prob, hit: evaluatePick(c.market, c.selection, m.home_score, m.away_score) });
          }
        }
        folds.push({ season, boundary, nTest: test.length, nRated: nRatedFold, reference: ctx.reference });
      }

      const off = metricsOf(offsetPreds);
      const bl = metricsOf(blendPreds);
      compResults.set(comp.canonicalId, {
        graph,
        kind: comp.kind,
        folds,
        nTest,
        nRated: offsetPreds.length,
        coverage: nTest > 0 ? offsetPreds.length / nTest : 0,
        offset: off,
        blend: bl,
        naive: metricsOf(naivePreds),
        llDeltaBlendMinusOffset: round4(bl.logLoss - off.logLoss),
      });
    }
  }

  ds.close();

  // -------------------------------------------------------------------------
  // Aseri populasi identik + gerbang reproduksi cup-oos.json
  // -------------------------------------------------------------------------
  const pooled = { offset: metricsOf(pooledOffset), blend: metricsOf(pooledBlend), naive: metricsOf(pooledNaive) };
  const identicalPooled = pooled.offset.n === pooled.blend.n && pooled.blend.n === pooled.naive.n;
  let identicalPerComp = true;
  for (const r of compResults.values()) {
    if (!(r.offset.n === r.blend.n && r.blend.n === r.naive.n && r.nRated === r.offset.n)) identicalPerComp = false;
  }

  const refPath = path.join(process.cwd(), "tasks", "cup-oos.json");
  const ref = JSON.parse(fs.readFileSync(refPath, "utf8")) as {
    generated_at: string;
    competitions: Record<string, { nTest: number; nRated: number; coverage: number; model: { logLoss: number } }>;
  };
  const reproRows: {
    competition: string;
    nTestRef: number;
    nTestMine: number;
    nRatedRef: number;
    nRatedMine: number;
    llRef: number;
    llMine: number;
    llDiff: number;
    coverageRef: number;
    coverageMine: number;
    nRatedExact: boolean;
    llWithinTol: boolean;
  }[] = [];
  let reproPass = true;
  let storeGrew = false;
  for (const [id, r] of compResults) {
    const rr = ref.competitions[id];
    if (!rr) {
      reproPass = false;
      continue;
    }
    if (rr.nTest !== r.nTest) storeGrew = true;
    const llDiff = Math.abs(r.offset.logLoss - rr.model.logLoss);
    const row = {
      competition: id,
      nTestRef: rr.nTest,
      nTestMine: r.nTest,
      nRatedRef: rr.nRated,
      nRatedMine: r.nRated,
      llRef: rr.model.logLoss,
      llMine: r.offset.logLoss,
      llDiff: round4(llDiff),
      coverageRef: rr.coverage,
      coverageMine: r.coverage,
      nRatedExact: rr.nRated === r.nRated,
      llWithinTol: llDiff <= 0.002,
    };
    if (!row.nRatedExact || !row.llWithinTol) reproPass = false;
    reproRows.push(row);
  }

  // -------------------------------------------------------------------------
  // Kejujuran pita + evaluasi aturan adopsi pra-terdaftar
  // -------------------------------------------------------------------------
  const honestyOffset = bandHonestyOf(candOffset);
  const honestyBlend = bandHonestyOf(candBlend);
  const stripRaw = <T extends { highBandAggregateRaw: unknown }>(h: T): Omit<T, "highBandAggregateRaw"> => {
    const { highBandAggregateRaw: _drop, ...rest } = h;
    return rest;
  };

  const slopeOff = pooled.offset.slope;
  const slopeBlend = pooled.blend.slope;
  const crit1 = pooled.blend.logLoss < pooled.offset.logLoss;
  const crit2 =
    slopeOff !== null && slopeBlend !== null ? Math.abs(slopeBlend - 1) <= Math.abs(slopeOff - 1) : false;
  const crit3 = honestyBlend.highBandAggregateRaw.gap >= honestyOffset.highBandAggregateRaw.gap;
  const adopted = reproPass && identicalPooled && identicalPerComp && crit1 && crit2 && crit3;

  const branchSummary = (mp: Map<CupBlendBranch, { sides: number; wSum: number }>) => {
    const out: Record<string, { sides: number; meanW: number | null }> = {};
    for (const b of ["xg", "goals", "fallback"] as CupBlendBranch[]) {
      const v = mp.get(b);
      out[b] = { sides: v?.sides ?? 0, meanW: v && v.sides > 0 ? round4(v.wSum / v.sides) : null };
    }
    return out;
  };
  const byGraphSummary: Record<string, ReturnType<typeof branchSummary>> = {};
  for (const [g, mp] of branchStats.byGraph) byGraphSummary[g] = branchSummary(mp);

  const runtimeMs = Date.now() - startedMs;
  const out = {
    generated_at: new Date().toISOString(),
    protocol:
      "walk-forward per kompetisi piala dicerminkan dari scripts/backtest-cup-offsets.ts (fit domestik + δ + G/HA hanya dari data sebelum musim uji); lengan offset-only = predictMatch existing; lengan blend = prior tertransformasi δ di-blend telemetri/form last-6 (κ×2, lib/quant/cup-form-blend.ts) pada populasi ter-rate yang IDENTIK; telemetri/form cutoff = tanggal laga (strictly-before, konvensi lab); matriks blend via konvensi matrixFromLamMu lab (rho=0, maxGoals=10); naive = base rate kandang/tandang latih kompetisi",
    adoption_rule: ADOPTION_RULE,
    config: {
      kappaScale: CUP_BLEND_KAPPA_SCALE,
      kappaBase: { xg: CUP_BLEND_KAPPA_BASE.xg, goals: CUP_BLEND_KAPPA_BASE.goals, fallback: CUP_BLEND_KAPPA_BASE.fallback },
      effectiveKappa: {
        xg: CUP_BLEND_KAPPA_BASE.xg * CUP_BLEND_KAPPA_SCALE,
        goals: CUP_BLEND_KAPPA_BASE.goals * CUP_BLEND_KAPPA_SCALE,
        fallback: CUP_BLEND_KAPPA_BASE.fallback * CUP_BLEND_KAPPA_SCALE,
      },
      rho: RHO,
      maxGoals: 10,
      telemetryWindow: 6,
      telemetrySource: "team_match_logs source='sportmonks', competition_id via matches join (cerminan parlay-lab)",
      formSource: "matches finished sm:% per tim (cerminan parlay-lab formGoals)",
      priorSource: "fit domestik lipatan (fitDomesticFold) tertransformasi δ lipatan (fitOffsets)",
    },
    pooled,
    perCompetition: Object.fromEntries(compResults),
    bandHonesty: { offset: stripRaw(honestyOffset), blend: stripRaw(honestyBlend) },
    branchCoverage: { overall: branchSummary(branchStats.overall), byGraph: byGraphSummary },
    adoption: {
      criterion_i_logLoss: {
        pass: crit1,
        offsetLogLoss: pooled.offset.logLoss,
        blendLogLoss: pooled.blend.logLoss,
        delta: round4(pooled.blend.logLoss - pooled.offset.logLoss),
      },
      criterion_ii_slope: {
        pass: crit2,
        slopeOffset: slopeOff,
        slopeBlend: slopeBlend,
        distOffset: slopeOff !== null ? round4(Math.abs(slopeOff - 1)) : null,
        distBlend: slopeBlend !== null ? round4(Math.abs(slopeBlend - 1)) : null,
      },
      criterion_iii_highBandHonesty: {
        pass: crit3,
        offset: honestyOffset.highBandAggregate,
        blend: honestyBlend.highBandAggregate,
      },
      reproductionGatePass: reproPass,
      identicalPopulation: identicalPooled && identicalPerComp,
      verdict: adopted ? "ADOPT" : "REJECT",
      adopted,
    },
    assertions: {
      identicalPooledN: identicalPooled,
      identicalPerCompetitionN: identicalPerComp,
      pooledN: pooled.offset.n,
      candidatesPerVariant: { offset: candOffset.length, blend: candBlend.length },
    },
    reproductionCheck: {
      referenceFile: "tasks/cup-oos.json",
      referenceGeneratedAt: ref.generated_at,
      pass: reproPass,
      storeGrew,
      note: storeGrew
        ? "nTest berbeda dari referensi di ≥1 kompetisi (store bertambah sejak 2026-11-04); gerbang dinilai dari nRated eksak + LL lengan offset pada populasi ter-rate yang sama, sesuai catatan brief."
        : "nTest identik dengan referensi di semua kompetisi.",
      perCompetition: reproRows,
    },
    runtimeMs,
    runtimeSec: round2(runtimeMs / 1000),
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "cup-form-blend-oos.json"), JSON.stringify(out, null, 2));

  console.log("=== WALK-FORWARD OOS PIALA — FORM BLEND vs OFFSET-ONLY ===");
  for (const [id, r] of compResults) {
    console.log(
      `${id} [${r.graph}/${r.kind}] uji=${r.nTest} rated=${r.nRated} cov=${r.coverage.toFixed(2)} LL offset=${r.offset.logLoss} blend=${r.blend.logLoss} (Δ ${r.llDeltaBlendMinusOffset >= 0 ? "+" : ""}${r.llDeltaBlendMinusOffset}) naive=${r.naive.logLoss} slope offset=${r.offset.slope} blend=${r.blend.slope}`,
    );
  }
  console.log(
    `\nPOOLED n=${pooled.offset.n} LL offset=${pooled.offset.logLoss} blend=${pooled.blend.logLoss} naive=${pooled.naive.logLoss} | slope offset=${pooled.offset.slope} blend=${pooled.blend.slope} | brier offset=${pooled.offset.brier} blend=${pooled.blend.brier}`,
  );
  console.log(
    `High-band (≥0.55) gap offset=${honestyOffset.highBandAggregate.gap} (n=${honestyOffset.highBandAggregate.n}) blend=${honestyBlend.highBandAggregate.gap} (n=${honestyBlend.highBandAggregate.n})`,
  );
  console.log(`Reproduksi cup-oos.json: pass=${reproPass} storeGrew=${storeGrew}`);
  for (const row of reproRows) {
    if (!row.nRatedExact || !row.llWithinTol || row.nTestRef !== row.nTestMine) {
      console.log(`  repro ${row.competition}: nRated ref=${row.nRatedRef} mine=${row.nRatedMine} llDiff=${row.llDiff} nTest ref=${row.nTestRef} mine=${row.nTestMine}`);
    }
  }
  console.log(`Kriteria adopsi: (i)=${crit1} (ii)=${crit2} (iii)=${crit3} → ${adopted ? "ADOPT" : "REJECT"}`);
  console.log(`Runtime ${out.runtimeSec}s — ditulis: tasks/cup-form-blend-oos.json`);
}

main();
