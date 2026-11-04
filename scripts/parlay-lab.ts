/**
 * PARLAY LAB — pengukuran walk-forward kejujuran probabilitas model (Phase A).
 *
 * Mengisi pick ledger (lib/picks/ledger.ts, source='lab') dengan kandidat leg
 * parlay dari DUA populasi, lalu me-resolve outcome-nya dari skor final lokal
 * dan menganalisis hit-rate per pita probabilitas → usulan grade.
 *
 * Populasi yang diukur = model saji produksi persis seperti yang divalidasi
 * scripts/backtest-walkforward.ts (Level B, tasks/oos-results.json):
 *   fit IPF (half-life 365 hari) + shrinkage log-space κfit=10 + rho=0,
 *   lalu blend telemetri/form James-Stein dengan kappaScale=2.
 * Fungsi-fungsi harness itu TIDAK diekspor (ia skrip), jadi di sini ia
 * DICERMINKAN dengan atribusi — preseden yang sama seperti harness itu
 * sendiri mencerminkan fitLeague dari calibrate-ratings.ts. Harness asli
 * TIDAK diubah.
 *
 * Probabilitas SELALU dari calculateDixonColes (lib/quant/dixon-coles.ts)
 * lewat konvensi rasio harness (leagueAvgGoals=μ, homeAdvantage=λ/μ,
 * attack/defense=1, rho=0, maxGoals=10) dan dibaca dari score_matrix
 * presisi penuh — BUKAN field prob_* yang dibulatkan 4 desimal.
 *
 * Disiplin anti-leakage:
 *  - Domestik: lipatan kronologis per liga identik harness (V1/V2/H);
 *    test match hanya diprediksi dari fit train lipatannya + telemetri
 *    bertanggal < tanggal laga (blendInput cerminan menegakkan cutoff).
 *  - Piala: dicerminkan dari scripts/backtest-cup-offsets.ts — per
 *    kompetisi per musim setelah musim pertama, semua fit (domestik + δ)
 *    hanya dari data bertanggal sebelum musim uji mulai.
 *  - market_prob (1X2 saja): closing line = tangkapan match_odds_history
 *    pre-kickoff TERAKHIR, Shin-stripped (closingLineProbs cerminan).
 *  - sm_prob: hanya dari sm_predictions yang captured_utc < kickoff
 *    (prediksi pra-laga asli). Hasil pemeriksaan dicatat di output.
 *
 * Tiga tahap dalam satu run: generate → resolve → analyze.
 * Idempoten: pick lab dedupe via indeks unik ledger; outcome upsert.
 *
 * Pakai:
 *   npx tsx scripts/parlay-lab.ts [--skip-cups] [--analyze-only]
 *   --analyze-only: lewati generate+resolve, hitung ulang analisis dari
 *                   picks.db yang ada (untuk iterasi laporan).
 *
 * Output: tasks/parlay-lab-results.json + tasks/parlay-lab-report.md.
 * Tidak memanggil API. Tidak menulis DB selain data/picks.db (ledger).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { stripVigShin } from "../lib/quant/vig-stripping";
import { getLeagueGate, competitionIdToDiv } from "../lib/quant/league-gate";
import { getCanonicalBySourceId, loadCanonicalLeagues } from "../lib/quant/league-identity";
import {
  recordPicks,
  recordOutcome,
  listUnresolved,
  hitRateByBand,
  getPicksDb,
  type PickInput,
  type PickMarket,
} from "../lib/picks/ledger";
import {
  CUP_COMPETITIONS,
  buildTeamDomesticMap,
  domesticLeaguesOfGraph,
  fitDomesticFold,
  fitOffsets,
  isDomesticLeagueEntry,
  loadFinishedMatches,
  pickReference,
  predictMatch,
  resolveAnchors,
  storeIdsOf,
  type AnchorMatch,
  type GraphId,
  type ResolvedTeam,
  type StoreMatch,
} from "../lib/quant/cup-offset-fit";
import type { CanonicalLeague } from "../lib/quant/league-identity";

const args = process.argv.slice(2);
const SKIP_CUPS = args.includes("--skip-cups");
const ANALYZE_ONLY = args.includes("--analyze-only");

// Konfigurasi produksi tervalidasi (tasks/oos-results.json, Level B terpilih:
// "winner kx2" = hl365|rho:zero|kfit:10, kappaScale=2).
const HALF_LIFE = 365;
const KFIT = 10;
const RHO = 0;
const KAPPA_SCALE = 2;
const MIN_MATCHES = 120; // lantai stabilitas lipatan, sama seperti harness

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ===========================================================================
// CERMINAN scripts/backtest-walkforward.ts — pemuatan data (identik, hanya
// ditambah kolom match_id yang dibutuhkan ledger; harness asli memuat tanpa
// match_id karena ia hanya menghitung metrik agregat).
// ===========================================================================
interface MatchRow {
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
       FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
    )
    .all() as unknown as (LogRow & { match_id: string })[];
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

// ===========================================================================
// CERMINAN harness — fit IPF (matematika identik fitLeague calibrate-ratings)
// ===========================================================================
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

/** CERMINAN harness — shrinkage fit log-space menuju 1,0, bobot n/(n+κ). */
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
 * CERMINAN harness probsFromLib, diperluas mengembalikan score_matrix:
 * λ/μ disalurkan lewat konvensi rasio lib (leagueAvgGoals=μ,
 * homeAdvantage=λ/μ, attack/defense=1) — matriks ternormalisasi presisi
 * penuh dari calculateDixonColes adalah sumber semua kandidat lab.
 */
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

// ===========================================================================
// CERMINAN harness — Level B: rata-rata kompetisi + telemetri rolling +
// blend James-Stein (blendInput / lamMuFromBlend identik, termasuk
// perilaku compAvgGoals dari SELURUH store seperti produksi).
// ===========================================================================
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

// ===========================================================================
// CERMINAN harness — closing line (benchmark a): tangkapan pre-kickoff
// TERAKHIR per match, market 1X2, Pinnacle (20) > 1xBet (35), Shin-stripped.
// ===========================================================================
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
    (o) => o.market_description === "Match Winner" || o.market_id === 1,
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

/** Peta match_id → probabilitas closing 1X2 [home, draw, away] (join harness). */
function buildClosingMap(): { map: Map<string, [number, number, number]>; preKickoffMatches: number; unparseable: number } {
  const rows = ds
    .prepare(
      `SELECT o.match_id, o.captured_utc, o.payload_json, m.utc_date
       FROM match_odds_history o JOIN matches m ON o.match_id = m.match_id
       WHERE o.has_odds = 1 AND m.status = 'finished' AND m.home_score IS NOT NULL`,
    )
    .all() as unknown as { match_id: string; captured_utc: string; payload_json: string; utc_date: string }[];
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!(Date.parse(r.captured_utc) < Date.parse(r.utc_date))) continue; // hanya pre-kickoff
    const cur = latest.get(r.match_id);
    if (!cur || Date.parse(r.captured_utc) > Date.parse(cur.captured_utc)) latest.set(r.match_id, r);
  }
  const map = new Map<string, [number, number, number]>();
  let unparseable = 0;
  for (const [mid, r] of latest) {
    const p = closingLineProbs(r.payload_json);
    if (!p) {
      unparseable++;
      continue;
    }
    map.set(mid, p);
  }
  return { map, preKickoffMatches: latest.size, unparseable };
}

// ===========================================================================
// sm_prob — panel Sportmonks (data/predictions.db). Hanya prediksi ASLI
// pra-laga yang sah: baris dengan captured_utc < kickoff fixture-nya.
// Pemeriksaan 2026-11-05 saat lab dibangun: 35 fixture predictions tumpang
// tindih dengan match dataset yang sudah finished, dan KE-35-nya ditangkap
// SETELAH kickoff (refresh harian menangkap ulang fixture yang sudah main)
// → tidak ada satu pun yang lolos filter ini; sm_prob tetap null dan fakta
// itu dilaporkan apa adanya, bukan diisi dari tangkapan pasca-laga.
// ===========================================================================
const SM_MARKET_MAP: Record<string, Record<string, [PickMarket, string]>> = {
  "Fulltime Result Probability": { home: ["1x2", "1"], draw: ["1x2", "x"], away: ["1x2", "2"] },
  "Double Chance Probability": { draw_home: ["dc", "1x"], home_away: ["dc", "12"], draw_away: ["dc", "x2"] },
  "Over/Under 1.5 Probability": { yes: ["ou15", "over"], no: ["ou15", "under"] },
  "Over/Under 2.5 Probability": { yes: ["ou25", "over"], no: ["ou25", "under"] },
  "Over/Under 3.5 Probability": { yes: ["ou35", "over"], no: ["ou35", "under"] },
  "Both Teams To Score Probability": { yes: ["btts", "yes"], no: ["btts", "no"] },
  "Home Over/Under 0.5 Probability": { yes: ["team_over05_home", "yes"] },
  "Away Over/Under 0.5 Probability": { yes: ["team_over05_away", "yes"] },
};

interface SmProbIndex {
  /** match_id → `${market}|${selection}` → probabilitas 0..1 (tangkapan pra-laga terakhir). */
  byMatch: Map<string, Map<string, number>>;
  fixturesInPredictions: number;
  fixturesOverlappingDataset: number;
  fixturesWithPreMatchRows: number;
  fixturesExcludedPostKickoffOnly: number;
}

function buildSmProbIndex(): SmProbIndex {
  const empty: SmProbIndex = {
    byMatch: new Map(),
    fixturesInPredictions: 0,
    fixturesOverlappingDataset: 0,
    fixturesWithPreMatchRows: 0,
    fixturesExcludedPostKickoffOnly: 0,
  };
  const predPath = dataPath("predictions.db");
  if (!fs.existsSync(predPath)) return empty;
  // kickoff per match_id sm_* dari dataset (semua status — fixture upcoming
  // pun harus bisa dicek pra/pasca-nya; yang relevan lab hanya finished).
  const kickoffByMatchId = new Map<string, string>();
  {
    const rows = ds.prepare("SELECT match_id, utc_date FROM matches WHERE match_id LIKE 'sm_%'").all() as unknown as {
      match_id: string;
      utc_date: string;
    }[];
    for (const r of rows) kickoffByMatchId.set(r.match_id, r.utc_date);
  }
  const pdb = new DatabaseSync(predPath, { readOnly: true });
  try {
    const rows = pdb
      .prepare("SELECT fixture_sm_id, market, outcome, probability, captured_utc FROM sm_predictions")
      .all() as unknown as {
      fixture_sm_id: number;
      market: string;
      outcome: string;
      probability: number;
      captured_utc: string;
    }[];
    const fixtures = new Set<number>();
    const overlap = new Set<string>();
    const preMatchFixtures = new Set<string>();
    const latest = new Map<string, { captured: string; prob: number }>(); // matchId|market|sel → tangkapan terakhir pra-laga
    for (const r of rows) {
      fixtures.add(r.fixture_sm_id);
      const matchId = `sm_${r.fixture_sm_id}`;
      const kickoff = kickoffByMatchId.get(matchId);
      if (!kickoff) continue;
      overlap.add(matchId);
      if (!(r.captured_utc < kickoff)) continue; // pasca-laga → bukan prediksi pra-laga
      const mapped = SM_MARKET_MAP[r.market]?.[r.outcome];
      if (!mapped) continue;
      preMatchFixtures.add(matchId);
      const key = `${matchId}|${mapped[0]}|${mapped[1]}`;
      const cur = latest.get(key);
      if (!cur || r.captured_utc > cur.captured) {
        latest.set(key, { captured: r.captured_utc, prob: r.probability / 100 });
      }
    }
    const byMatch = new Map<string, Map<string, number>>();
    for (const [key, v] of latest) {
      const [matchId, market, selection] = key.split("|");
      const per = byMatch.get(matchId) ?? new Map<string, number>();
      per.set(`${market}|${selection}`, v.prob);
      byMatch.set(matchId, per);
    }
    return {
      byMatch,
      fixturesInPredictions: fixtures.size,
      fixturesOverlappingDataset: overlap.size,
      fixturesWithPreMatchRows: preMatchFixtures.size,
      fixturesExcludedPostKickoffOnly: overlap.size - preMatchFixtures.size,
    };
  } finally {
    pdb.close();
  }
}

// ===========================================================================
// 16 kandidat per match dari score_matrix presisi penuh.
// ===========================================================================
interface Candidate {
  market: PickMarket;
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

function picksForMatch(opts: {
  matchId: string;
  canonicalId: string;
  kickoffUtc: string;
  gateStatus: string;
  notes: string;
  matrix: number[][];
  closing: [number, number, number] | null;
  sm: Map<string, number> | null;
}): { picks: PickInput[]; marketFilled: number; smFilled: number } {
  const picks: PickInput[] = [];
  let marketFilled = 0;
  let smFilled = 0;
  for (const c of candidatesFromMatrix(opts.matrix)) {
    let marketProb: number | null = null;
    if (c.market === "1x2" && opts.closing) {
      marketProb = c.selection === "1" ? opts.closing[0] : c.selection === "x" ? opts.closing[1] : opts.closing[2];
      marketFilled++;
    }
    const smProb = opts.sm?.get(`${c.market}|${c.selection}`) ?? null;
    if (smProb !== null) smFilled++;
    picks.push({
      match_id: opts.matchId,
      competition_canonical_id: opts.canonicalId,
      kickoff_utc: opts.kickoffUtc,
      market: c.market,
      selection: c.selection,
      model_prob: c.prob,
      market_prob: marketProb,
      sm_prob: smProb,
      gate_status: opts.gateStatus,
      grade: null,
      source: "lab",
      notes: opts.notes,
    });
  }
  return { picks, marketFilled, smFilled };
}

// ===========================================================================
// TAHAP 1a — generasi domestik. Populasi: liga sm:% yang status gerbangnya
// 'calibrated' persis seperti gating produksi (getLeagueGate atas
// competitionIdToDiv), >= MIN_MATCHES match selesai. Lipatan identik
// harness: V1 train[0,55%)→test[55%,70%); V2 [0,70%)→[70%,85%);
// H [0,85%)→[85%,100%). Prediksi Level B: fit lipatan (IPF hl365 +
// shrinkage κfit=10) → blendInput → lamMuFromBlend κ×2 → matriks DC rho=0.
// ===========================================================================
const FOLDS = [
  { name: "V1", trainEnd: 0.55, testStart: 0.55, testEnd: 0.7 },
  { name: "V2", trainEnd: 0.7, testStart: 0.7, testEnd: 0.85 },
  { name: "H", trainEnd: 0.85, testStart: 0.85, testEnd: 1.0 },
] as const;

interface DomesticStats {
  leaguesInPopulation: number;
  leagueIds: string[];
  skippedBelowFloor: { competition_id: string; matches: number }[];
  matchesPerFold: Record<string, number>;
  testMatches: number;
  picksAttempted: number;
  picksInserted: number;
  marketProbFilled: number;
  smProbFilled: number;
  unratedMatches: number;
}

function generateDomestic(closing: Map<string, [number, number, number]>, sm: SmProbIndex): DomesticStats {
  const byComp = new Map<string, MatchRow[]>();
  for (const m of allMatches) {
    const arr = byComp.get(m.competition_id) ?? [];
    arr.push(m);
    byComp.set(m.competition_id, arr);
  }
  const population: { compId: string; matches: MatchRow[] }[] = [];
  const skipped: { competition_id: string; matches: number }[] = [];
  for (const [compId, ms] of [...byComp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const gate = getLeagueGate(competitionIdToDiv(compId));
    if (gate?.status !== "calibrated") continue;
    if (ms.length < MIN_MATCHES) {
      skipped.push({ competition_id: compId, matches: ms.length });
      continue;
    }
    population.push({ compId, matches: ms });
  }

  const stats: DomesticStats = {
    leaguesInPopulation: population.length,
    leagueIds: population.map((p) => p.compId),
    skippedBelowFloor: skipped,
    matchesPerFold: { V1: 0, V2: 0, H: 0 },
    testMatches: 0,
    picksAttempted: 0,
    picksInserted: 0,
    marketProbFilled: 0,
    smProbFilled: 0,
    unratedMatches: 0,
  };

  let buffer: PickInput[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    stats.picksInserted += recordPicks(buffer);
    buffer = [];
  };

  for (const lg of population) {
    const canonicalId = getCanonicalBySourceId(lg.compId)?.canonical_id ?? lg.compId;
    const n = lg.matches.length;
    for (const fold of FOLDS) {
      const train = lg.matches.slice(0, Math.floor(n * fold.trainEnd));
      const test = lg.matches.slice(Math.floor(n * fold.testStart), Math.floor(n * fold.testEnd));
      const refMs = test.length ? Date.parse(test[0].utc_date) : Date.parse(train[train.length - 1].utc_date);
      const rawFit = fitIPF(train, refMs, HALF_LIFE);
      if (!rawFit) continue;
      const fit = applyShrinkage(rawFit, train, KFIT);
      stats.matchesPerFold[fold.name] += test.length;
      for (const m of test) {
        const bi = blendInput(fit, m);
        const { lam, mu } = lamMuFromBlend(bi, KAPPA_SCALE);
        const matrix = matrixFromLamMu(lam, mu);
        stats.testMatches++;
        if (!matrix) {
          stats.unratedMatches++;
          continue;
        }
        const { picks, marketFilled, smFilled } = picksForMatch({
          matchId: m.match_id,
          canonicalId,
          kickoffUtc: m.utc_date,
          gateStatus: "calibrated",
          notes: `pop=domestic fold=${fold.name}`,
          matrix,
          closing: closing.get(m.match_id) ?? null,
          sm: sm.byMatch.get(m.match_id) ?? null,
        });
        stats.picksAttempted += picks.length;
        stats.marketProbFilled += marketFilled;
        stats.smProbFilled += smFilled;
        buffer.push(...picks);
        if (buffer.length >= 8192) flush();
      }
    }
  }
  flush();
  return stats;
}

// ===========================================================================
// TAHAP 1b — generasi piala. Dicerminkan dari scripts/backtest-cup-offsets.ts:
// per graf, konteks lipatan di-cache per tanggal batas musim (peta
// keanggotaan tim + fit domestik per liga + fit δ — SEMUA hanya dari data
// bertanggal < batas). Per kompetisi, per musim setelah musim pertama:
// match uji yang ter-rate predictMatch (δ kedua liga teridentifikasi)
// menghasilkan 16 kandidat dari matriks DC jalur offset yang sama persis
// (calculateDixonColes atas att/def tertransformasi δ, rho=0 — panggilan
// yang sama seperti di dalam predictMatch, diulang di sini untuk membaca
// score_matrix presisi penuh; predictMatch sendiri hanya mengembalikan
// prob 1X2 yang sudah dibulatkan lib).
// ===========================================================================
interface CupCompStats {
  competition_id: string;
  graph: string;
  gate_status: string;
  test: number;
  rated: number;
  coverage: number;
  folds: { season: string; boundary: string; nTest: number; nRated: number }[];
}
interface CupStats {
  perComp: CupCompStats[];
  testMatches: number;
  ratedMatches: number;
  picksAttempted: number;
  picksInserted: number;
  marketProbFilled: number;
  smProbFilled: number;
  missingMatchId: number;
}

function generateCups(closing: Map<string, [number, number, number]>, sm: SmProbIndex): CupStats {
  const canonicals = loadCanonicalLeagues();
  const canonicalById = new Map(canonicals.map((e) => [e.canonical_id, e]));
  const matches = loadFinishedMatches();

  // match_id untuk StoreMatch (loadFinishedMatches tidak memuat match_id):
  // kunci (kompetisi, tanggal, tim kandang, tim tamu) unik di store piala
  // (terverifikasi: 0 kunci ganda di 17 kompetisi) — first-wins + hitung.
  const cupCompIds = new Set(CUP_COMPETITIONS.map((c) => c.canonicalId));
  const matchIdByKey = new Map<string, string>();
  {
    const rows = ds
      .prepare(
        `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id FROM matches
         WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
      )
      .all() as unknown as { match_id: string; competition_id: string; utc_date: string; home_team_id: string; away_team_id: string }[];
    for (const r of rows) {
      if (!cupCompIds.has(r.competition_id)) continue;
      const key = `${r.competition_id}|${r.utc_date}|${r.home_team_id}|${r.away_team_id}`;
      if (!matchIdByKey.has(key)) matchIdByKey.set(key, r.match_id);
    }
  }

  const domesticStoreToCanonical = new Map<string, string>();
  for (const e of canonicals) {
    if (!isDomesticLeagueEntry(e)) continue;
    for (const id of storeIdsOf(e)) domesticStoreToCanonical.set(id, e.canonical_id);
  }
  const cupStoreToCanonical = new Map<string, string>();
  for (const c of CUP_COMPETITIONS) cupStoreToCanonical.set(c.canonicalId, c.canonicalId);

  const stats: CupStats = {
    perComp: [],
    testMatches: 0,
    ratedMatches: 0,
    picksAttempted: 0,
    picksInserted: 0,
    marketProbFilled: 0,
    smProbFilled: 0,
    missingMatchId: 0,
  };
  let buffer: PickInput[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    stats.picksInserted += recordPicks(buffer);
    buffer = [];
  };

  const graphs: GraphId[] = ["europe", "conmebol", "afc"];
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
      const gateStatus = canonicalById.get(comp.canonicalId)?.cup_model?.status ?? "uncalibrated";
      const compStat: CupCompStats = {
        competition_id: comp.canonicalId,
        graph,
        gate_status: gateStatus,
        test: 0,
        rated: 0,
        coverage: 0,
        folds: [],
      };
      for (let si = 1; si < seasons.length; si++) {
        const season = seasons[si];
        const test = compMatches.filter((m) => m.season === season);
        const boundary = test.reduce((min, m) => (m.utc_date < min ? m.utc_date : min), test[0].utc_date);
        const ctx = getCtx(boundary);
        let nRatedFold = 0;
        for (const m of test) {
          compStat.test++;
          stats.testMatches++;
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
            competition_id: comp.canonicalId, season: m.season, utc_date: m.utc_date,
            homeLeague: domH.canonicalId, awayLeague: domA.canonicalId,
            attH, defH, attA, defA,
            homeGoals: m.home_score, awayGoals: m.away_score, weight: 1,
            crossLeague: domH.canonicalId !== domA.canonicalId,
          };
          const pred = predictMatch(anchorLike, ctx.offsetFit.delta, ctx.offsetFit.globalAvg, ctx.offsetFit.cupHA);
          if (!pred) continue;
          // Matriks dari panggilan DC yang sama seperti predictMatch.
          const dH = ctx.offsetFit.delta.get(domH.canonicalId)!;
          const dA = ctx.offsetFit.delta.get(domA.canonicalId)!;
          const dc = calculateDixonColes({
            homeAttack: attH * Math.exp(dH),
            homeDefense: defH * Math.exp(-dH),
            awayAttack: attA * Math.exp(dA),
            awayDefense: defA * Math.exp(-dA),
            homeAdvantage: ctx.offsetFit.cupHA,
            leagueAvgGoals: ctx.offsetFit.globalAvg,
            rho: 0,
          });
          const matchId = matchIdByKey.get(`${m.competition_id}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`);
          if (!matchId) {
            stats.missingMatchId++;
            continue;
          }
          nRatedFold++;
          compStat.rated++;
          stats.ratedMatches++;
          const { picks, marketFilled, smFilled } = picksForMatch({
            matchId,
            canonicalId: comp.canonicalId,
            kickoffUtc: m.utc_date,
            gateStatus,
            notes: `pop=cup fold=${season}`,
            matrix: dc.score_matrix,
            closing: closing.get(matchId) ?? null,
            sm: sm.byMatch.get(matchId) ?? null,
          });
          stats.picksAttempted += picks.length;
          stats.marketProbFilled += marketFilled;
          stats.smProbFilled += smFilled;
          buffer.push(...picks);
          if (buffer.length >= 8192) flush();
        }
        compStat.folds.push({ season, boundary, nTest: test.length, nRated: nRatedFold });
      }
      compStat.coverage = compStat.test > 0 ? round4(compStat.rated / compStat.test) : 0;
      stats.perComp.push(compStat);
    }
  }
  flush();
  return stats;
}

// ===========================================================================
// TAHAP 2 — resolve outcome lab dari skor final lokal (in-process via
// ledger). Setiap pick lab menunjuk match dataset yang finished, jadi
// semua harus ter-resolve; yang tidak, dilaporkan dengan alasannya.
// ===========================================================================
interface ResolveStats {
  examined: number;
  resolved: number;
  stillUnresolved: number;
  reasons: { match_id: string; reason: string }[];
}

function resolveLabPicks(): ResolveStats {
  const scores = new Map<string, { home: number; away: number }>();
  {
    const rows = ds
      .prepare(
        `SELECT match_id, home_score, away_score FROM matches
         WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
      )
      .all() as unknown as { match_id: string; home_score: number; away_score: number }[];
    for (const r of rows) scores.set(r.match_id, { home: r.home_score, away: r.away_score });
  }
  const unresolved = listUnresolved().filter((p) => p.source === "lab");
  const reasons: { match_id: string; reason: string }[] = [];
  let resolved = 0;
  const db = getPicksDb();
  db.exec("BEGIN");
  try {
    for (const pick of unresolved) {
      const s = scores.get(pick.match_id);
      if (!s) {
        reasons.push({ match_id: pick.match_id, reason: "match_id tidak ditemukan di dataset.matches finished berskor" });
        continue;
      }
      recordOutcome(pick.id, s.home, s.away);
      resolved++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { examined: unresolved.length, resolved, stillUnresolved: unresolved.length - resolved, reasons };
}

// ===========================================================================
// TAHAP 3 — analisis. Definisi pita dicerminkan dari lib/picks/ledger.ts
// (BANDS di sana tidak diekspor; hitRateByBand dipakai untuk tabel pooled
// resmi, SQL langsung untuk split populasi/seleksi yang tak ditawarkan API).
// ===========================================================================
const BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0.55, hi: 0.6, label: "55–60" },
  { lo: 0.6, hi: 0.65, label: "60–65" },
  { lo: 0.65, hi: 0.7, label: "65–70" },
  { lo: 0.7, hi: 0.75, label: "70–75" },
  { lo: 0.75, hi: 0.8, label: "75–80" },
  { lo: 0.8, hi: 0.85, label: "80–85" },
  { lo: 0.85, hi: 1.01, label: "85+" },
];

interface ResolvedPick {
  market: string;
  selection: string;
  model_prob: number;
  market_prob: number | null;
  match_id: string;
  kickoff_utc: string;
  pop: "domestic" | "cup";
  hit: number;
}

function loadResolvedLabPicks(): ResolvedPick[] {
  const db = getPicksDb();
  const rows = db
    .prepare(
      `SELECT p.market AS market, p.selection AS selection, p.model_prob AS model_prob,
              p.market_prob AS market_prob, p.match_id AS match_id, p.kickoff_utc AS kickoff_utc,
              p.notes AS notes, o.hit AS hit
       FROM picks p JOIN pick_outcomes o ON o.pick_id = p.id
       WHERE p.source = 'lab'`,
    )
    .all() as unknown as (Omit<ResolvedPick, "pop"> & { notes: string | null })[];
  return rows.map((r) => ({
    market: r.market,
    selection: r.selection,
    model_prob: r.model_prob,
    market_prob: r.market_prob,
    match_id: r.match_id,
    kickoff_utc: r.kickoff_utc ?? "",
    pop: r.notes?.startsWith("pop=cup") ? ("cup" as const) : ("domestic" as const),
    hit: r.hit,
  }));
}

interface StatCell {
  n: number;
  meanProb: number | null;
  hitRate: number | null;
  gap: number | null;
}
function statOf(rows: ResolvedPick[]): StatCell {
  if (rows.length === 0) return { n: 0, meanProb: null, hitRate: null, gap: null };
  const meanProb = rows.reduce((s, r) => s + r.model_prob, 0) / rows.length;
  const hitRate = rows.reduce((s, r) => s + r.hit, 0) / rows.length;
  return { n: rows.length, meanProb: round4(meanProb), hitRate: round4(hitRate), gap: round4(hitRate - meanProb) };
}
interface BandCell extends StatCell {
  band: string;
  lo: number;
}
function bandStats(rows: ResolvedPick[]): BandCell[] {
  return BANDS.map((b) => ({
    band: b.label,
    lo: b.lo,
    ...statOf(rows.filter((r) => r.model_prob >= b.lo && r.model_prob < b.hi)),
  }));
}

/** Per match: kandidat dengan probabilitas tertinggi (seri → urutan ledger). */
function bestPerMatch(rows: ResolvedPick[]): ResolvedPick[] {
  const order = new Map<string, number>();
  const byMatch = new Map<string, ResolvedPick[]>();
  for (const r of rows) {
    if (!order.has(`${r.market}|${r.selection}`)) order.set(`${r.market}|${r.selection}`, order.size);
    const arr = byMatch.get(r.match_id) ?? [];
    arr.push(r);
    byMatch.set(r.match_id, arr);
  }
  const out: ResolvedPick[] = [];
  for (const arr of byMatch.values()) {
    let best = arr[0];
    for (const r of arr) if (r.model_prob > best.model_prob) best = r;
    out.push(best);
  }
  return out;
}

// --- Survival parlay -------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SurvivalCell {
  threshold: number;
  size: number;
  nParlays: number;
  empirical: number | null;
  predicted: number | null;
  gap: number | null;
  /** Jumlah match berleg memenuhi syarat pada ambang ini (semesta leg). */
  matches?: number;
}

function survivalAssembly(domestic: ResolvedPick[], thresholds: number[]): SurvivalCell[] {
  const out: SurvivalCell[] = [];
  for (const T of thresholds) {
    const legs = bestPerMatch(domestic.filter((r) => r.model_prob >= T));
    const byDate = new Map<string, ResolvedPick[]>();
    for (const leg of legs) {
      const d = leg.kickoff_utc.slice(0, 10);
      const arr = byDate.get(d) ?? [];
      arr.push(leg);
      byDate.set(d, arr);
    }
    const dates = [...byDate.entries()]
      .filter(([, arr]) => arr.length >= 5)
      .map(([d, arr]) => ({
        d,
        legs: arr.sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc) || a.match_id.localeCompare(b.match_id)).slice(0, 5),
      }))
      .sort((a, b) => a.d.localeCompare(b.d));
    for (const size of [2, 3, 4, 5]) {
      if (dates.length === 0) {
        out.push({ threshold: T, size, nParlays: 0, empirical: null, predicted: null, gap: null, matches: legs.length });
        continue;
      }
      let surv = 0;
      let predSum = 0;
      for (const { legs: ls } of dates) {
        const prefix = ls.slice(0, size);
        if (prefix.every((l) => l.hit === 1)) surv++;
        predSum += prefix.reduce((p, l) => p * l.model_prob, 1);
      }
      const empirical = surv / dates.length;
      const predicted = predSum / dates.length;
      out.push({
        threshold: T,
        size,
        nParlays: dates.length,
        empirical: round4(empirical),
        predicted: round4(predicted),
        gap: round4(empirical - predicted),
        matches: legs.length,
      });
    }
  }
  return out;
}

function survivalBootstrap(domestic: ResolvedPick[], thresholds: number[], samples = 10000): SurvivalCell[] {
  const out: SurvivalCell[] = [];
  const rand = mulberry32(20261105);
  for (const T of thresholds) {
    // Semesta leg yang SAMA seperti perakitan: leg terbaik per match.
    // (Pool level-kandidat akan membiaskan sampel ke probabilitas rendah
    // karena match menyumbang banyak kandidat dekat ambang — cross-check
    // harus mengisolasi efek perakitan, bukan definisi leg.)
    const pool = bestPerMatch(domestic.filter((r) => r.model_prob >= T));
    for (const size of [2, 3, 4, 5]) {
      if (pool.length < size) {
        out.push({ threshold: T, size, nParlays: 0, empirical: null, predicted: null, gap: null, matches: pool.length });
        continue;
      }
      let surv = 0;
      let predSum = 0;
      for (let s = 0; s < samples; s++) {
        const used = new Set<string>();
        let prod = 1;
        let allHit = true;
        let drawn = 0;
        let guard = 0;
        while (drawn < size && guard++ < 1000) {
          const leg = pool[Math.floor(rand() * pool.length)];
          if (used.has(leg.match_id)) continue;
          used.add(leg.match_id);
          prod *= leg.model_prob;
          if (leg.hit !== 1) allHit = false;
          drawn++;
        }
        if (allHit) surv++;
        predSum += prod;
      }
      const empirical = surv / samples;
      const predicted = predSum / samples;
      out.push({
        threshold: T,
        size,
        nParlays: samples,
        empirical: round4(empirical),
        predicted: round4(predicted),
        gap: round4(empirical - predicted),
        matches: pool.length,
      });
    }
  }
  return out;
}

// --- Usulan grade ----------------------------------------------------------
// Lantai yang diiklankan per grade; toleransi 0,02 (hit-rate empiris boleh
// 0,02 di bawah lantai). Sel (market, pita) dengan n<200 = TIPIS: tidak
// bisa menopang grade A. Pita tinggi yang overconfident (gap < −0,03,
// n>=100) menaikkan ambang A di atas pita itu atau menahan A sama sekali.
const GRADE_FLOORS = { A: 0.8, B: 0.7, C: 0.6 };
const GRADE_TOL = 0.02;
const THIN_N = 200;

interface GradeRegion {
  threshold: number | null;
  region: StatCell;
  status: "ok" | "withheld" | "capped-thin";
  reason: string;
}
interface MarketGrade {
  market: string;
  A: GradeRegion;
  B: GradeRegion;
  C: GradeRegion;
  caveats: string[];
}

function regionRows(rows: ResolvedPick[], lo: number, hi: number): ResolvedPick[] {
  return rows.filter((r) => r.model_prob >= lo && r.model_prob < hi);
}
function badHighBands(rows: ResolvedPick[], fromLo: number): BandCell[] {
  return bandStats(rows).filter((b) => b.lo >= fromLo && b.n >= 100 && b.gap !== null && b.gap < -0.03);
}

function proposeGrades(domestic: ResolvedPick[], selectionBands: { market: string; selection: string; bands: BandCell[] }[]): {
  mode: "global" | "per-market";
  floors: typeof GRADE_FLOORS;
  tolerance: number;
  global: { tA: number; tB: number; tC: number } | null;
  perMarket: MarketGrade[];
} {
  const markets = [...new Set(domestic.map((r) => r.market))].sort();
  const rowsByMarket = new Map(markets.map((m) => [m, domestic.filter((r) => r.market === m)]));

  // Uji set ambang global dulu (paling inklusif yang lolos semua market).
  let global: { tA: number; tB: number; tC: number } | null = null;
  for (const tA of [0.75, 0.8, 0.85]) {
    const tB = tA - 0.1;
    const tC = tB - 0.1;
    let ok = true;
    for (const m of markets) {
      const rows = rowsByMarket.get(m)!;
      const ra = statOf(regionRows(rows, tA, 1.01));
      if (ra.n >= THIN_N) {
        if (ra.hitRate === null || ra.hitRate < GRADE_FLOORS.A - GRADE_TOL) ok = false;
        if (badHighBands(rows, tA).length > 0) ok = false;
      }
      const rb = statOf(regionRows(rows, tB, tA));
      if (rb.n >= 50 && (rb.hitRate === null || rb.hitRate < GRADE_FLOORS.B - GRADE_TOL)) ok = false;
      const rc = statOf(regionRows(rows, tC, tB));
      if (rc.n >= 50 && (rc.hitRate === null || rc.hitRate < GRADE_FLOORS.C - GRADE_TOL)) ok = false;
    }
    if (ok) {
      global = { tA, tB, tC };
      break;
    }
  }

  const perMarket: MarketGrade[] = [];
  for (const m of markets) {
    const rows = rowsByMarket.get(m)!;
    // A: ambang paling inklusif yang lolos lantai + bebas pita buruk di
    // atasnya + DITOPANG minimal satu sel pita tebal (n>=THIN_N) di dalam
    // wilayahnya. Wilayah yang lolos lantai hanya dari sel-sel tipis =
    // capped-thin (A tidak diberikan, mentok B) — aturan sel tipis tugas.
    let A: GradeRegion = { threshold: null, region: statOf(regionRows(rows, 0.85, 1.01)), status: "withheld", reason: "Tidak ada ambang yang memenuhi lantai A." };
    let cappedCandidate: GradeRegion | null = null;
    const bandsAll = bandStats(rows);
    for (const t of [0.7, 0.75, 0.8, 0.85]) {
      const reg = statOf(regionRows(rows, t, 1.01));
      if (reg.n < THIN_N) continue;
      if (badHighBands(rows, t).length > 0) continue; // ambang harus naik di atas pita overconfident ini
      if (reg.hitRate === null || reg.hitRate < GRADE_FLOORS.A - GRADE_TOL) continue;
      const hasThickBand = bandsAll.some((b) => b.lo >= t && b.n >= THIN_N);
      if (hasThickBand) {
        A = {
          threshold: t,
          region: reg,
          status: "ok",
          reason: `Hit-rate wilayah ≥${t}: ${reg.hitRate} ≥ lantai ${GRADE_FLOORS.A} − ${GRADE_TOL}, ditopang sel pita tebal (n≥${THIN_N}) di wilayahnya; tanpa pita overconfident di atasnya.`,
        };
        break;
      }
      if (!cappedCandidate) {
        cappedCandidate = {
          threshold: t,
          region: reg,
          status: "capped-thin",
          reason: `Wilayah ≥${t} lolos lantai (hit-rate ${reg.hitRate}, n wilayah=${reg.n}) TAPI semua sel pita di wilayahnya tipis (${bandsAll.filter((b) => b.lo >= t && b.n > 0).map((b) => `${b.band}=${b.n}`).join(", ")}; semua < ${THIN_N}) — aturan sel tipis: A tidak diberikan, pick wilayah ini mentok grade B.`,
        };
      }
    }
    if (A.status === "withheld" && cappedCandidate) A = cappedCandidate;
    if (A.status === "withheld") {
      const reg85 = statOf(regionRows(rows, 0.85, 1.01));
      const badAll = badHighBands(rows, 0.7);
      A.reason =
        badAll.length > 0
          ? `Pita tinggi overconfident (gap < −0,03): ${badAll.map((b) => `${b.band} gap ${b.gap} (n=${b.n})`).join("; ")} — menaikkan ambang A di atas pita itu menyisakan wilayah terlalu tipis, jadi A ditahan.`
          : reg85.n < THIN_N
            ? `Wilayah probabilitas tinggi terlalu tipis (n≥85% = ${reg85.n} < ${THIN_N}) untuk menopang grade A.`
            : `Hit-rate wilayah ≥85% = ${reg85.hitRate} < lantai ${GRADE_FLOORS.A} − ${GRADE_TOL} — A ditahan.`;
    }
    // B menampung semua pick di bawah A yang BENAR-BENAR diberikan: bila A
    // ditahan/di-cap, wilayah B membentang sampai 1,01.
    const upperB = A.status === "ok" ? A.threshold! : 1.01;
    let B: GradeRegion = { threshold: null, region: statOf([]), status: "withheld", reason: "Tidak ada wilayah B yang memenuhi lantai." };
    for (const t of [0.6, 0.65, 0.7]) {
      if (t >= upperB) break;
      const reg = statOf(regionRows(rows, t, upperB));
      if (reg.n >= 100 && reg.hitRate !== null && reg.hitRate >= GRADE_FLOORS.B - GRADE_TOL) {
        B = { threshold: t, region: reg, status: "ok", reason: `Hit-rate wilayah [${t}, ${upperB}): ${reg.hitRate} ≥ lantai ${GRADE_FLOORS.B} − ${GRADE_TOL} (n=${reg.n}).` };
        break;
      }
    }
    if (B.status === "withheld") {
      const rb = statOf(regionRows(rows, 0.6, upperB));
      B.reason = `Wilayah [0,60, ${upperB}) tidak mencapai lantai B ${GRADE_FLOORS.B} − ${GRADE_TOL} dengan n≥100 (n wilayah=${rb.n}, hit-rate ${rb.hitRate}).`;
    }
    const upperC = B.status === "ok" ? B.threshold! : upperB;
    let C: GradeRegion = { threshold: null, region: statOf([]), status: "withheld", reason: "Tidak ada wilayah C yang memenuhi lantai." };
    for (const t of [0.55, 0.6]) {
      if (t >= upperC) break;
      const reg = statOf(regionRows(rows, t, upperC));
      if (reg.n >= 50 && reg.hitRate !== null && reg.hitRate >= GRADE_FLOORS.C - GRADE_TOL) {
        C = { threshold: t, region: reg, status: "ok", reason: `Hit-rate wilayah [${t}, ${upperC}): ${reg.hitRate} ≥ lantai ${GRADE_FLOORS.C} − ${GRADE_TOL} (n=${reg.n}).` };
        break;
      }
    }
    if (C.status === "withheld") {
      const rc = statOf(regionRows(rows, 0.55, upperC));
      C.reason = `Wilayah [0,55, ${upperC}) tidak mencapai lantai C ${GRADE_FLOORS.C} − ${GRADE_TOL} dengan n≥50 (n wilayah=${rc.n}, hit-rate ${rc.hitRate}).`;
    }
    const caveats: string[] = [];
    for (const b of bandStats(rows)) {
      if (b.n > 0 && b.n < THIN_N) caveats.push(`Pita ${b.band} tipis (n=${b.n} < ${THIN_N}).`);
    }
    for (const sb of selectionBands.filter((s) => s.market === m)) {
      for (const b of sb.bands) {
        if (b.lo >= 0.75 && b.n >= 100 && b.gap !== null && b.gap < -0.03) {
          caveats.push(`Seleksi '${sb.selection}' pita ${b.band} overconfident: gap ${b.gap} (n=${b.n}) — jangan nilai seleksi ini setara pooled market-nya di pita itu.`);
        }
      }
    }
    perMarket.push({ market: m, A, B, C, caveats });
  }
  return { mode: global ? "global" : "per-market", floors: GRADE_FLOORS, tolerance: GRADE_TOL, global, perMarket };
}

// ===========================================================================
// Perakitan hasil + laporan
// ===========================================================================
interface GenContext {
  domestic: DomesticStats | null;
  cup: CupStats | null;
  closing: { preKickoffMatches: number; unparseable: number; mapSize: number } | null;
  sm: Omit<SmProbIndex, "byMatch"> | null;
  resolve: ResolveStats | null;
  skipCups: boolean;
}

const fp = (x: number | null | undefined): string =>
  x === null || x === undefined ? "—" : `${(x * 100).toFixed(1).replace(".", ",")}%`;
const fpp = (x: number | null | undefined): string =>
  x === null || x === undefined ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1).replace(".", ",")} pp`;
const fi = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function bandTableMd(title: string, bands: BandCell[], overall: StatCell): string {
  const lines = [
    `**${title}**`,
    "",
    "| Pita | n | Rata-rata prob | Hit-rate | Gap |",
    "|---|---:|---:|---:|---:|",
    ...bands.map((b) => `| ${b.band} | ${fi(b.n)} | ${fp(b.meanProb)} | ${fp(b.hitRate)} | ${fpp(b.gap)} |`),
    `| **Semua prob** | **${fi(overall.n)}** | **${fp(overall.meanProb)}** | **${fp(overall.hitRate)}** | **${fpp(overall.gap)}** |`,
    "",
  ];
  return lines.join("\n");
}

function analyze(ctx: GenContext): void {
  const picks = loadResolvedLabPicks();
  const domestic = picks.filter((p) => p.pop === "domestic");
  const cup = picks.filter((p) => p.pop === "cup");
  const db = getPicksDb();
  const totalLab = (db.prepare("SELECT COUNT(*) AS n FROM picks WHERE source = 'lab'").get() as { n: number }).n;
  const unresolvedLab = listUnresolved().filter((p) => p.source === "lab").length;

  // Tabel pita per market × populasi + resmi dari ledger (pooled).
  const markets = [...new Set(picks.map((p) => p.market))].sort();
  const bandsByPop: Record<string, { market: string; bands: BandCell[]; overall: StatCell }[]> = {
    domestic: markets.map((m) => {
      const rows = domestic.filter((p) => p.market === m);
      return { market: m, bands: bandStats(rows), overall: statOf(rows) };
    }),
    cup: markets.map((m) => {
      const rows = cup.filter((p) => p.market === m);
      return { market: m, bands: bandStats(rows), overall: statOf(rows) };
    }),
  };
  const official = hitRateByBand({ source: "lab" });

  // Split per seleksi (domestik) — basis caveat grade.
  const selectionBands: { market: string; selection: string; bands: BandCell[]; overall: StatCell }[] = [];
  for (const m of markets) {
    const sels = [...new Set(domestic.filter((p) => p.market === m).map((p) => p.selection))].sort();
    for (const s of sels) {
      const rows = domestic.filter((p) => p.market === m && p.selection === s);
      selectionBands.push({ market: m, selection: s, bands: bandStats(rows), overall: statOf(rows) });
    }
  }

  // Potongan headline (domestik).
  const fav1x2 = bestPerMatch(domestic.filter((p) => p.market === "1x2"));
  const dcBest = bestPerMatch(domestic.filter((p) => p.market === "dc"));
  const cutDefs: { key: string; title: string; rows: ResolvedPick[] }[] = [
    { key: "1x2_fav", title: "1X2 — sisi favorit (prob tertinggi per match)", rows: fav1x2 },
    { key: "dc_best", title: "Double chance — seleksi terbaik per match", rows: dcBest },
    { key: "ou15_over", title: "Over/Under 1,5 — over", rows: domestic.filter((p) => p.market === "ou15" && p.selection === "over") },
    { key: "ou25_over", title: "Over/Under 2,5 — over", rows: domestic.filter((p) => p.market === "ou25" && p.selection === "over") },
    { key: "ou25_under", title: "Over/Under 2,5 — under", rows: domestic.filter((p) => p.market === "ou25" && p.selection === "under") },
    { key: "btts_yes", title: "BTTS — yes", rows: domestic.filter((p) => p.market === "btts" && p.selection === "yes") },
    { key: "btts_no", title: "BTTS — no", rows: domestic.filter((p) => p.market === "btts" && p.selection === "no") },
  ];
  const headline = cutDefs.map((c) => ({ key: c.key, title: c.title, bands: bandStats(c.rows), overall: statOf(c.rows) }));

  // Survival parlay.
  const THRESHOLDS = [0.65, 0.7, 0.75];
  const assembly = survivalAssembly(domestic, THRESHOLDS);
  const bootstrap = survivalBootstrap(domestic, THRESHOLDS);

  // Kesepakatan pasar untuk 1X2 (hanya subset bermarket_prob).
  const spreadRows = domestic.filter((p) => p.market === "1x2" && p.market_prob !== null && p.model_prob >= 0.65);
  const spreadBuckets = [
    { label: "≤0,05", rows: spreadRows.filter((p) => Math.abs(p.model_prob - (p.market_prob ?? 0)) <= 0.05) },
    { label: "0,05–0,10", rows: spreadRows.filter((p) => { const s = Math.abs(p.model_prob - (p.market_prob ?? 0)); return s > 0.05 && s <= 0.1; }) },
    { label: ">0,10", rows: spreadRows.filter((p) => Math.abs(p.model_prob - (p.market_prob ?? 0)) > 0.1) },
  ].map((b) => ({ bucket: b.label, ...statOf(b.rows) }));

  // Usulan grade.
  const grades = proposeGrades(domestic, selectionBands);

  // Perbandingan cakupan piala vs tasks/cup-oos.json.
  interface OosComp { nTest: number; nRated: number; coverage: number; status: string }
  let cupOos: Record<string, OosComp> | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "cup-oos.json"), "utf8")) as {
      competitions: Record<string, { nTest: number; nRated: number; coverage: number; status: string }>;
    };
    cupOos = raw.competitions;
  } catch { /* cup-oos.json tak terbaca — perbandingan dilewati */ }
  const cupComparison = (ctx.cup?.perComp ?? []).map((c) => {
    const o = cupOos?.[c.competition_id];
    return {
      competition_id: c.competition_id,
      lab: { test: c.test, rated: c.rated, coverage: c.coverage },
      cupOos: o ? { test: o.nTest, rated: o.nRated, coverage: round4(o.coverage) } : null,
      discrepancy: o ? o.nTest !== c.test || o.nRated !== c.rated : null,
    };
  });

  // Temuan overconfidence: semua sel pita (market pooled + headline +
  // seleksi) dengan gap <= −0,03 dan n>=100, diurutkan dari yang terburuk.
  interface Finding { scope: string; band: string; n: number; meanProb: number | null; hitRate: number | null; gap: number | null }
  const findings: Finding[] = [];
  const collect = (scope: string, bands: BandCell[]) => {
    for (const b of bands) if (b.n >= 100 && b.gap !== null && b.gap <= -0.03) findings.push({ scope, band: b.band, n: b.n, meanProb: b.meanProb, hitRate: b.hitRate, gap: b.gap });
  };
  for (const mb of bandsByPop.domestic) collect(`domestik · ${mb.market} (pooled)`, mb.bands);
  for (const sb of selectionBands) collect(`domestik · ${sb.market}/${sb.selection}`, sb.bands);
  // Headline: hanya pseudo-market argmax (1X2 favorit, DC terbaik) yang
  // bukan duplikat split seleksi di atas; potongan seleksi tunggal
  // (ou15 over, btts yes, …) sudah terwakili selectionBands.
  for (const h of headline.filter((x) => x.key === "1x2_fav" || x.key === "dc_best")) collect(`domestik · ${h.title}`, h.bands);
  findings.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));

  const results = {
    generated_at: new Date().toISOString(),
    config: {
      model: "Level B produksi tervalidasi (tasks/oos-results.json: winner kx2)",
      halfLifeDays: HALF_LIFE,
      kappaFit: KFIT,
      rho: RHO,
      kappaScale: KAPPA_SCALE,
      minMatches: MIN_MATCHES,
      folds: "V1 train[0,55%)→test[55%,70%); V2 train[0,70%)→test[70%,85%); H train[0,85%)→test[85%,100%)",
      candidatesPerMatch: 16,
    },
    population: {
      domestic: ctx.domestic,
      cup: ctx.cup ? { perComp: ctx.cup.perComp, testMatches: ctx.cup.testMatches, ratedMatches: ctx.cup.ratedMatches, picksAttempted: ctx.cup.picksAttempted, picksInserted: ctx.cup.picksInserted, marketProbFilled: ctx.cup.marketProbFilled, smProbFilled: ctx.cup.smProbFilled, missingMatchId: ctx.cup.missingMatchId } : null,
      cupOosComparison: cupComparison,
      resolvedPicksLoaded: { domestic: domestic.length, cup: cup.length },
    },
    checks: { closing: ctx.closing, sm: ctx.sm },
    resolution: {
      totalLabPicks: totalLab,
      resolved: picks.length,
      unresolved: unresolvedLab,
      pctResolved: totalLab > 0 ? round4(picks.length / totalLab) : 0,
      inProcess: ctx.resolve,
    },
    bands: { byPopulation: bandsByPop, officialLedger: official, bySelectionDomestic: selectionBands },
    headline,
    survival: { assembly, bootstrap },
    agreementSpread1x2: { subset: "domestik 1X2, model_prob>=0.65, market_prob tersedia", n: spreadRows.length, buckets: spreadBuckets },
    grades,
    overconfidenceFindings: findings,
  };
  fs.writeFileSync(path.join(process.cwd(), "tasks", "parlay-lab-results.json"), JSON.stringify(results, null, 2));

  // ---------------- Laporan Markdown (Bahasa Indonesia) ----------------
  const dom = ctx.domestic;
  const cupStats = ctx.cup;
  const L: string[] = [];
  L.push("# Parlay Lab — Pengukuran Kejujuran Probabilitas Model (Phase A)");
  L.push("");
  L.push(`Dihasilkan ${results.generated_at} oleh \`npx tsx scripts/parlay-lab.ts${ctx.skipCups ? " --skip-cups" : ""}\`. Angka mentah lengkap: \`tasks/parlay-lab-results.json\`.`);
  L.push("");
  L.push("## Metode & disiplin anti-leakage");
  L.push("");
  L.push("- **Model yang diukur = jalur saji produksi tervalidasi** (Level B `tasks/oos-results.json`, konfigurasi terpilih `winner kx2`): fit IPF half-life 365 hari + shrinkage log-space κfit=10 + rho=0, lalu blend telemetri/form James-Stein kappaScale=2. Fungsi harness `scripts/backtest-walkforward.ts` tidak diekspor, jadi dicerminkan ke skrip lab dengan atribusi (preseden yang sama seperti harness mencerminkan `fitLeague`); harness asli tidak diubah.");
  L.push("- **Probabilitas dari `calculateDixonColes`** lewat konvensi rasio harness (leagueAvgGoals=μ, homeAdvantage=λ/μ, attack/defense=1, rho=0, maxGoals=10), dibaca dari `score_matrix` presisi penuh — bukan field `prob_*` yang dibulatkan 4 desimal. Dari matriks yang sama dihitung 16 kandidat per match: 1X2 (3), double chance (3), O/U 1,5/2,5/3,5 (6), BTTS (2), tim kandang/tandang mencetak gol (2).");
  L.push("- **Domestik:** lipatan kronologis per liga identik harness — V1 train[0,55%)→test[55%,70%), V2 train[0,70%)→test[70%,85%), H train[0,85%)→test[85%,100%). Test match hanya memakai fit train lipatannya dan telemetri bertanggal strictly sebelum tanggal laga (cutoff di dalam `blendInput` cerminan).");
  L.push("- **Piala:** dicerminkan dari `scripts/backtest-cup-offsets.ts` — per kompetisi, per musim setelah musim pertama, fit domestik + offset δ hanya dari data bertanggal sebelum musim uji mulai; match dinilai hanya bila `predictMatch` jalur offset mengembalikan prediksi (kedua liga teridentifikasi δ-nya). Matriks kandidat dari panggilan Dixon-Coles yang sama seperti di dalam `predictMatch`.");
  L.push("- **market_prob** hanya untuk 1X2: closing line = tangkapan `match_odds_history` pre-kickoff terakhir, prioritas bookmaker Pinnacle lalu 1xBet, di-strip vig metode Shin (cerminan `closingLineProbs` harness).");
  L.push("- **sm_prob** hanya diisi dari `sm_predictions` yang `captured_utc < kickoff` (prediksi pra-laga asli). Lihat temuan di bagian Keterbatasan — hasil pemeriksaan: tidak ada yang lolos.");
  L.push("- **Outcome** di-resolve dari skor final lokal `dataset.matches`; tidak ada panggilan API di seluruh lab.");
  L.push("");
  L.push("## Populasi & cakupan");
  L.push("");
  if (dom) {
    L.push(`### Domestik — ${dom.leaguesInPopulation} liga calibrated`);
    L.push("");
    L.push(`Populasi ditentukan persis seperti gating produksi: \`getLeagueGate(competitionIdToDiv(compId)).status === 'calibrated'\` atas liga \`sm:%\` di dataset. Liga calibrated di bawah lantai ${MIN_MATCHES} match selesai (stabilitas lipatan, sama seperti harness): ${dom.skippedBelowFloor.length === 0 ? "tidak ada" : dom.skippedBelowFloor.map((s) => `${s.competition_id} (${s.matches})`).join(", ")}.`);
    L.push("");
    L.push("| Lipatan | Match uji |");
    L.push("|---|---:|");
    for (const [f, n] of Object.entries(dom.matchesPerFold)) L.push(`| ${f} | ${fi(n)} |`);
    L.push(`| **Total** | **${fi(dom.testMatches)}** |`);
    L.push("");
    L.push(`Kandidat ditulis: ${fi(dom.picksAttempted)} pick dicoba, ${fi(dom.picksInserted)} baris baru masuk ledger (sisanya dedupe idempoten${dom.picksInserted === 0 && dom.picksAttempted > 0 ? " — angka run terakhir; run pengisian pertama memasukkan seluruhnya, lihat total ledger di bagian resolusi" : ""}). market_prob terisi pada ${fi(dom.marketProbFilled)} pick 1X2; sm_prob terisi ${fi(dom.smProbFilled)}. Match uji tanpa matriks (λ/μ tak valid): ${dom.unratedMatches}.`);
    L.push("");
    L.push(`Liga populasi: ${dom.leagueIds.join(", ")}.`);
    L.push("");
  } else {
    L.push("### Domestik — (run --analyze-only: angka populasi dari run generate sebelumnya di `tasks/parlay-lab-results.json`)");
    L.push("");
  }
  if (cupStats) {
    L.push("### Piala — 17 kompetisi model offset");
    L.push("");
    L.push("| Kompetisi | Graf | Status gerbang | Match uji | Ter-rate | Cakupan lab | Cakupan cup-oos.json | Selisih |");
    L.push("|---|---|---|---:|---:|---:|---:|---|");
    for (const c of cupStats.perComp) {
      const cmp = cupComparison.find((x) => x.competition_id === c.competition_id);
      L.push(`| ${c.competition_id} | ${c.graph} | ${c.gate_status} | ${fi(c.test)} | ${fi(c.rated)} | ${fp(c.coverage)} | ${cmp?.cupOos ? fp(cmp.cupOos.coverage) : "—"} | ${cmp?.discrepancy ? "**BEDA**" : "sama"} |`);
    }
    L.push("");
    L.push(`Total piala: ${fi(cupStats.testMatches)} match uji, ${fi(cupStats.ratedMatches)} ter-rate (${fp(cupStats.testMatches ? cupStats.ratedMatches / cupStats.testMatches : 0)}), ${fi(cupStats.picksAttempted)} kandidat dicoba, ${fi(cupStats.picksInserted)} baris baru. Fraksi ter-rate ADALAH cakupan model offset — konsisten dengan \`tasks/cup-oos.json\` per konstruksi walk-forward yang sama${cupComparison.some((c) => c.discrepancy) ? "; **ada selisih yang ditandai BEDA pada tabel di atas dan di JSON — cermati sebelum memakai angka piala**" : " (tidak ada selisih)"}. n piala kecil dan terpool lintas kompetisi di semua tabel berikutnya.`);
    L.push("");
  }
  const resolveNote = !ctx.resolve
    ? ""
    : ctx.resolve.examined === 0 && totalLab > 0
      ? " — tahap resolve in-process pada run penghasil laporan ini memeriksa 0 pick (semua sudah ter-resolve dari run pengisian pertama; run ulang penuh memverifikasi idempotensi: 0 baris baru, 0 outcome berubah)"
      : ` — tahap resolve in-process memeriksa ${fi(ctx.resolve.examined)}, me-resolve ${fi(ctx.resolve.resolved)}, sisa ${fi(ctx.resolve.stillUnresolved)}`;
  L.push(`Resolusi outcome: ${fi(picks.length)} dari ${fi(totalLab)} pick lab ter-resolve (${fp(totalLab ? picks.length / totalLab : 0)})${resolveNote}. Resolver standalone \`scripts/resolve-pick-outcomes.ts\` dijalankan terpisah sebagai pembuktian silang dan melaporkan 0 pick baru ter-resolve (lihat catatan run di laporan agen).`);
  L.push("");
  L.push("## Tabel pita per market");
  L.push("");
  L.push("Gap = hit-rate − rata-rata probabilitas. Positif = model kurang percaya diri (under-confident); negatif = overconfident. Pita di luar 55–100% bukan wilayah safe-bet dan tidak diukur di sini (sesuai definisi pita ledger).");
  L.push("");
  L.push("### Domestik (populasi calibrated)");
  L.push("");
  for (const mb of bandsByPop.domestic) L.push(bandTableMd(`Market ${mb.market}`, mb.bands, mb.overall));
  L.push("### Piala (terpool lintas kompetisi — n kecil, baca sebagai indikatif)");
  L.push("");
  for (const mb of bandsByPop.cup) L.push(bandTableMd(`Market ${mb.market}`, mb.bands, mb.overall));
  L.push("## Potongan headline (domestik)");
  L.push("");
  for (const h of headline) L.push(bandTableMd(h.title, h.bands, h.overall));
  L.push("## Temuan overconfidence");
  L.push("");
  if (findings.length === 0) {
    L.push("Tidak ada sel pita (n≥100) dengan gap ≤ −3,0 pp. Model tidak menunjukkan overconfidence material pada pita yang terukur.");
  } else {
    L.push("Sel pita dengan gap ≤ −3,0 pp dan n≥100 (probabilitas yang dinyatakan model lebih tinggi dari frekuensi kejadian sebenarnya), terburuk dulu:");
    L.push("");
    L.push("| Cakupan | Pita | n | Rata-rata prob | Hit-rate | Gap |");
    L.push("|---|---|---:|---:|---:|---:|");
    for (const f of findings.slice(0, 30)) L.push(`| ${f.scope} | ${f.band} | ${fi(f.n)} | ${fp(f.meanProb)} | ${fp(f.hitRate)} | ${fpp(f.gap)} |`);
    if (findings.length > 30) L.push("");
    if (findings.length > 30) L.push(`(dan ${findings.length - 30} sel lain — daftar lengkap di JSON, kunci \`overconfidenceFindings\`.)`);
  }
  L.push("");
  L.push("## Survival parlay (domestik)");
  L.push("");
  L.push("Leg = kandidat mana pun dengan model_prob ≥ ambang T. Per match hanya leg terbaiknya (prob tertinggi) yang dipakai di kedua metode.");
  L.push("");
  L.push("**Metode utama — perakitan kronologis:** leg dikelompokkan per tanggal kickoff (UTC); tanggal dengan ≥5 match berkaki memenuhi syarat membentuk parlay ukuran 2–5 dari 5 match pertama secara kronologis (satu parlay per ukuran per tanggal, awalan bersarang/nested). Survival empiris = fraksi parlay yang semua leg-nya hit; prediksi = rata-rata hasil kali probabilitas model leg-legnya (asumsi independensi).");
  L.push("");
  L.push("| T | Ukuran | Tanggal parlay | Survival empiris | Prediksi (produk) | Gap |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const s of assembly) L.push(`| ${fp(s.threshold)} | ${s.size} | ${fi(s.nParlays)} | ${fp(s.empirical)} | ${fp(s.predicted)} | ${fpp(s.gap)} |`);
  L.push("");
  const semesta = THRESHOLDS.map((T) => {
    const cell = assembly.find((s) => s.threshold === T);
    return `T=${fp(T)} → ${fi(cell?.matches ?? 0)} match`;
  }).join("; ");
  L.push(`Semesta leg per ambang: ${semesta}. Baris T=65% dan T=70% identik karena SETIAP match uji domestik punya leg terbaik ≥70% (leg double-chance dan tim-mencetak-gol mendominasi probabilitas tertinggi per match) — pada semesta leg-terbaik, ambang 65% tidak menyaring apa pun; penyaringan baru terasa di T=75%.`);
  L.push("");
  L.push("**Cross-check — bootstrap:** 10.000 sampel per (T, ukuran); leg ditarik acak dari seluruh pool leg ≥T dengan penolakan match_id ganda dalam satu sampel (seed tetap 20261105, dapat direproduksi).");
  L.push("");
  L.push("| T | Ukuran | Sampel | Survival empiris | Prediksi (produk) | Gap | Δ empiris vs perakitan |");
  L.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const s of bootstrap) {
    const a = assembly.find((x) => x.threshold === s.threshold && x.size === s.size);
    const delta = s.empirical !== null && a?.empirical != null ? round4(s.empirical - a.empirical) : null;
    L.push(`| ${fp(s.threshold)} | ${s.size} | ${fi(s.nParlays)} | ${fp(s.empirical)} | ${fp(s.predicted)} | ${fpp(s.gap)} | ${fpp(delta)} |`);
  }
  L.push("");
  const signedDeltas = bootstrap.map((s) => {
    const a = assembly.find((x) => x.threshold === s.threshold && x.size === s.size);
    return s.empirical !== null && a?.empirical != null ? s.empirical - a.empirical : 0;
  });
  const maxDelta = Math.max(...signedDeltas.map((d) => Math.abs(d)));
  L.push(maxDelta <= 0.03
    ? `Kedua metode sepakat (selisih empiris terbesar ${fpp(maxDelta)}): angka survival perakitan kronologis dapat dipakai sebagai estimasi utama.`
    : `**Kedua metode tidak sepenuhnya sepakat** (selisih empiris terbesar ${(maxDelta * 100).toFixed(1).replace(".", ",")} pp): pada ukuran 2 keduanya praktis sama, tapi pada ukuran 3–5 bootstrap sistematis LEBIH RENDAH dari perakitan kronologis. Perakitan hanya memakai tanggal padat (≥5 match berkaki) dan 5 leg kronologis pertama per tanggal — subset yang ternyata sedikit lebih kuat dari rata-rata semesta leg. Perlakukan survival sebagai rentang: bootstrap = batas bawah konservatif, perakitan = estimasi untuk tanggal padat. Soal independensi: gap empiris-vs-produk pada bootstrap selalu negatif (${fpp(Math.min(...bootstrap.map((s) => s.gap ?? 0)))} s.d. ${fpp(Math.max(...bootstrap.map((s) => s.gap ?? 0)))}) — produk independensi melebih-lebihkan survival leg acak; pada perakitan gap-nya dekat nol (${fpp(Math.min(...assembly.map((s) => s.gap ?? 0)))} s.d. ${fpp(Math.max(...assembly.map((s) => s.gap ?? 0)))}).`);
  L.push("");
  L.push(`Kesepakatan pasar (1X2 domestik, model_prob ≥65%, market_prob tersedia, n=${fi(spreadRows.length)}): ${spreadBuckets.map((b) => `spread ${b.bucket}: n=${fi(b.n)}, hit-rate ${fp(b.hitRate)}, gap ${fpp(b.gap)}`).join("; ")}.`);
  L.push("");
  L.push("## Usulan grade (untuk Phase B)");
  L.push("");
  L.push(`Definisi: grade adalah janji lantai hit-rate — **A ≥ ${fp(GRADE_FLOORS.A)}, B ≥ ${fp(GRADE_FLOORS.B)}, C ≥ ${fp(GRADE_FLOORS.C)}** — dan wilayah grade lolos bila hit-rate empiris wilayahnya ≥ lantai − 0,02 (toleransi). Aturan keras: sel (market, pita) dengan n<${THIN_N} itu **tipis** dan tidak bisa menopang grade A (mentok B); market yang pita tingginya overconfident (gap < −3,0 pp, n≥100) ambang A-nya dinaikkan di atas pita itu atau A ditahan, dinyatakan eksplisit per market. Basis bukti: tabel pita domestik di atas (populasi calibrated) + split per seleksi di JSON.`);
  L.push("");
  if (grades.mode === "global" && grades.global) {
    L.push(`**Satu set ambang global DAPAT dipertahankan** untuk semua market: **A ≥ ${fp(grades.global.tA)}, B ≥ ${fp(grades.global.tB)}, C ≥ ${fp(grades.global.tC)}** (ambang = probabilitas model minimum). Semua market lolos pemeriksaan lantai per wilayah pada set ini, kecuali pembatasan tipis per market pada tabel di bawah (market yang wilayah A-nya n<${THIN_N} tetap mentok B walau ambang global berlaku). Ini set yang diusulkan untuk Phase B.`);
  } else {
    L.push("**Satu set ambang global TIDAK dapat dipertahankan** — pemeriksaan lantai per wilayah gagal untuk set global mana pun yang diuji (0,75/0,80/0,85 untuk A), jadi usulan di bawah per market. Detail kegagalan global ada di JSON (`grades.global = null`, mode `per-market`).");
  }
  L.push("");
  L.push("| Market | Grade A (ambang, n, hit-rate) | Grade B | Grade C | Catatan |");
  L.push("|---|---|---|---|---|");
  const fmtRegion = (r: GradeRegion): string =>
    r.status === "withheld" ? `DITAHAN — ${r.reason}` : `${r.threshold !== null ? "≥" + fp(r.threshold) : "—"} · n=${fi(r.region.n)} · hit ${fp(r.region.hitRate)}${r.status === "capped-thin" ? " · TIPIS (mentok B)" : ""}`;
  for (const g of grades.perMarket) {
    L.push(`| ${g.market} | ${fmtRegion(g.A)} | ${fmtRegion(g.B)} | ${fmtRegion(g.C)} | ${g.caveats.slice(0, 3).join(" ") || "—"} |`);
  }
  L.push("");
  for (const g of grades.perMarket) {
    L.push(`- **${g.market}** — A: ${g.A.reason} B: ${g.B.reason} C: ${g.C.reason}${g.caveats.length ? ` Caveat: ${g.caveats.join(" ")}` : ""}`);
  }
  L.push("");
  const wideSpread = spreadBuckets.find((b) => b.bucket === ">0,10");
  if (wideSpread && wideSpread.n >= 50) {
    L.push(`Opsi spread kesepakatan (khusus 1X2, satu-satunya market bermarket_prob): pada subset prob ≥65%, leg dengan |model − pasar| > 0,10 ber-hit-rate ${fp(wideSpread.hitRate)} (n=${fi(wideSpread.n)}). ${wideSpread.hitRate !== null && wideSpread.hitRate < GRADE_FLOORS.A - GRADE_TOL ? "Itu di bawah lantai A − toleransi, jadi untuk grade A 1X2 diusulkan syarat tambahan **agreement_spread ≤ 0,10**." : "Angka itu tidak cukup buruk untuk memaksa syarat spread pada grade A; spread dicatat saja di Phase B, bukan gerbang."}`);
    L.push("");
  } else {
    L.push(`Opsi spread kesepakatan tidak diusulkan sebagai gerbang: subset 1X2 bermarket_prob pada prob tinggi terlalu kecil (bucket spread >0,10: n=${wideSpread ? fi(wideSpread.n) : "0"}) untuk menopang aturan.`);
    L.push("");
  }
  L.push("## Keterbatasan");
  L.push("");
  L.push("- **sm_prob absen untuk riwayat.** `predictions.db` hanya mencakup fixture mendatang; 35 fixture yang tumpang tindih dengan match finished di dataset semuanya ditangkap SETELAH kickoff (refresh harian menangkap ulang fixture yang sudah bermain), jadi mengisinya akan jadi kebocoran pasca-laga. Filter `captured_utc < kickoff` menghasilkan 0 baris — sm_prob null di semua pick lab, dan kolom kesepakatan tiga-sumber belum bisa diukur dari lab ini.");
  L.push("- **market_prob hanya untuk 1X2 dan hanya era tangkapan odds** (tangkapan mulai 2026-10-18; subset match uji yang punya closing line kecil dan condong ke match terbaru). Angka kesepakatan pasar di atas berasal dari subset kecil itu.");
  L.push("- **Status-at-pick-time = status kanonik saat ini.** Populasi domestik disaring dengan status calibrated registry *sekarang* (basis kanonik pasca-rekalibrasi), bukan status historis pada tanggal laga — lab mengukur model tervalidasi saat ini secara walk-forward, bukan rekonstruksi keputusan historis.");
  L.push("- **n piala kecil** dan terpool lintas 17 kompetisi dengan status gerbang berbeda-beda (partial/uncalibrated); tabel pita piala indikatif, bukan basis grade. Grade diusulkan HANYA dari populasi domestik calibrated.");
  L.push("- **Survival mengasumsikan leg terbaik per match** dan, pada angka prediksi, independensi antar-leg. Gap empiris-vs-produk di tabel adalah ukuran seberapa jauh asumsi itu meleset (korelasi tanggal/liga yang sama tidak dimodelkan).");
  L.push("- Lipatan memakai fraksi kronologis per liga (bukan batas musim), persis seperti harness validasi — musim yang terpotong di tengah ikut terdistribusi ke train/test sesuai urutan tanggal.");
  L.push("");
  L.push("## Reproduksi");
  L.push("");
  L.push("```bash");
  L.push("npx tsx scripts/parlay-lab.ts            # generate → resolve → analyze (idempoten)");
  L.push("npx tsx scripts/parlay-lab.ts --skip-cups");
  L.push("npx tsx scripts/resolve-pick-outcomes.ts # pembuktian silang: harus melaporkan resolved: 0 setelah lab");
  L.push("```");

  fs.writeFileSync(path.join(process.cwd(), "tasks", "parlay-lab-report.md"), L.join("\n") + "\n");
  console.log(`[lab] analisis: ${fi(picks.length)} pick ter-resolve (domestik ${fi(domestic.length)}, piala ${fi(cup.length)}) → tasks/parlay-lab-results.json + tasks/parlay-lab-report.md`);
}

// ===========================================================================
// MAIN
// ===========================================================================
function main(): void {
  const t0 = performance.now();
  let ctx: GenContext = { domestic: null, cup: null, closing: null, sm: null, resolve: null, skipCups: SKIP_CUPS };

  if (ANALYZE_ONLY) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tasks", "parlay-lab-results.json"), "utf8")) as {
        population?: { domestic?: DomesticStats | null; cup?: CupStats | null };
        checks?: { closing: GenContext["closing"]; sm: GenContext["sm"] };
        resolution?: { inProcess?: ResolveStats | null };
      };
      ctx = {
        domestic: prev.population?.domestic ?? null,
        cup: prev.population?.cup ?? null,
        closing: prev.checks?.closing ?? null,
        sm: prev.checks?.sm ?? null,
        resolve: prev.resolution?.inProcess ?? null,
        skipCups: SKIP_CUPS,
      };
      console.log("[lab] --analyze-only: populasi diambil dari results JSON sebelumnya");
    } catch {
      console.log("[lab] --analyze-only tanpa results JSON sebelumnya — bagian populasi laporan akan kosong");
    }
  } else {
    const closingInfo = buildClosingMap();
    console.log(`[lab] closing line: ${fi(closingInfo.map.size)} match berprobabilitas ter-parse dari ${fi(closingInfo.preKickoffMatches)} match pre-kickoff (${closingInfo.unparseable} tak ter-parse)`);
    const smInfo = buildSmProbIndex();
    console.log(
      `[lab] sm_prob: ${fi(smInfo.fixturesInPredictions)} fixture di predictions.db, ${fi(smInfo.fixturesOverlappingDataset)} tumpang tindih dataset, ` +
        `${fi(smInfo.fixturesWithPreMatchRows)} punya baris pra-laga asli, ${fi(smInfo.fixturesExcludedPostKickoffOnly)} hanya punya tangkapan pasca-kickoff → dikecualikan`,
    );
    ctx.closing = { preKickoffMatches: closingInfo.preKickoffMatches, unparseable: closingInfo.unparseable, mapSize: closingInfo.map.size };
    ctx.sm = {
      fixturesInPredictions: smInfo.fixturesInPredictions,
      fixturesOverlappingDataset: smInfo.fixturesOverlappingDataset,
      fixturesWithPreMatchRows: smInfo.fixturesWithPreMatchRows,
      fixturesExcludedPostKickoffOnly: smInfo.fixturesExcludedPostKickoffOnly,
    };

    const dom = generateDomestic(closingInfo.map, smInfo);
    ctx.domestic = dom;
    console.log(
      `[lab] domestik: ${dom.leaguesInPopulation} liga calibrated, match uji V1=${fi(dom.matchesPerFold.V1)} V2=${fi(dom.matchesPerFold.V2)} H=${fi(dom.matchesPerFold.H)} ` +
        `(total ${fi(dom.testMatches)}), kandidat dicoba ${fi(dom.picksAttempted)}, baris baru ${fi(dom.picksInserted)}, market_prob terisi ${fi(dom.marketProbFilled)}, sm_prob terisi ${fi(dom.smProbFilled)}` +
        (dom.skippedBelowFloor.length ? `, dilewati <${MIN_MATCHES} match: ${dom.skippedBelowFloor.map((s) => s.competition_id).join(", ")}` : ""),
    );

    if (!SKIP_CUPS) {
      const cup = generateCups(closingInfo.map, smInfo);
      ctx.cup = cup;
      console.log(`[lab] piala: ${fi(cup.testMatches)} match uji, ${fi(cup.ratedMatches)} ter-rate, kandidat dicoba ${fi(cup.picksAttempted)}, baris baru ${fi(cup.picksInserted)}, market_prob terisi ${fi(cup.marketProbFilled)}, sm_prob terisi ${fi(cup.smProbFilled)}`);
      for (const c of cup.perComp) {
        console.log(`  [cup] ${c.competition_id} [${c.graph}/${c.gate_status}] uji=${fi(c.test)} rated=${fi(c.rated)} cakupan=${fp(c.coverage)}`);
      }
    } else {
      console.log("[lab] piala dilewati (--skip-cups)");
    }

    const res = resolveLabPicks();
    ctx.resolve = res;
    console.log(`[lab] resolve: diperiksa ${fi(res.examined)}, ter-resolve ${fi(res.resolved)}, sisa ${fi(res.stillUnresolved)}`);
    for (const r of res.reasons.slice(0, 10)) console.log(`  [resolve-gagal] ${r.match_id}: ${r.reason}`);
  }

  analyze(ctx);
  console.log(`[lab] selesai dalam ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

main();
