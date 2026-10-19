/**
 * Ablasi penskalaan koefisien UEFA (sqrt Q) untuk laga UCL — paired ON vs OFF.
 *
 * READ-ONLY: hanya SELECT via helper yang ada; ratings-loader TIDAK disentuh
 * (diimpor hanya untuk konstanta + ratings statis). Shrinkage + Dixon-Coles
 * direplikasi lokal agar kedua arm memakai data IDENTIK kecuali scaling.
 *
 * Anti-leakage: telemetri rolling memakai cutoff pre-match (utc_date laga),
 * sama seperti Track C backtest. Ratings file statis → leakage (bila ada)
 * identik di kedua arm, jadi pemenang paired tetap valid.
 *
 * Metrik: log-loss 1X2 + Brier. Ambang: |meanDiff| > 2xSE atau mayoritas liga.
 * Verdict: KEEP / DROP / UNDECIDED.
 */
import { getTheStatsDb } from "../lib/db/thestats-dataset";
import { getTeamRollingTelemetry } from "../lib/db/team-telemetry";
import { calculateDixonColes } from "../lib/quant/dixon-coles";
import { normalizeTeamName } from "../lib/quant/team-normalizer";
import {
  loadCalibratedRatings,
  UEFA_LEAGUE_COEFFICIENT,
  type CalibratedRatingsFile,
  type TeamRating,
} from "../lib/quant/ratings-loader";

const EPS = 1e-6;
// Konstanta UCL persis seperti branch isUCL di getShrunkMatchParameters.
const UCL_AVG = 2.04;
const UCL_HA = 1.12;
const UCL_RHO = -0.05;
// Divisi kasta kedua — dilewati saat cari rating domestik (mirror SECOND_DIVS).
const SECOND_DIVS = new Set(["E1", "SP2", "I2", "D2", "F2"]);

function calcLogLoss(pH: number, pD: number, pA: number, actual: "H" | "D" | "A"): number {
  const p = actual === "H" ? pH : actual === "D" ? pD : pA;
  return -Math.log(Math.max(EPS, Math.min(1 - EPS, p)));
}

function calcBrier(pH: number, pD: number, pA: number, actual: "H" | "D" | "A"): number {
  const yH = actual === "H" ? 1 : 0;
  const yD = actual === "D" ? 1 : 0;
  const yA = actual === "A" ? 1 : 0;
  return (pH - yH) ** 2 + (pD - yD) ** 2 + (pA - yA) ** 2;
}

/** Cari rating domestik MENTAH (tanpa scaling) + div asal. Mirror findTeamRatingForUCL minus scaling. */
function findRawDomestic(
  data: CalibratedRatingsFile,
  norm: string,
  rawName: string
): { raw: TeamRating; div: string } | null {
  for (const [div, league] of Object.entries(data.leagues)) {
    if (SECOND_DIVS.has(div) || !UEFA_LEAGUE_COEFFICIENT[div]) continue;
    const hit =
      league.teams[norm] ||
      league.teams[rawName] ||
      Object.entries(league.teams).find(
        ([k]) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === rawName.toLowerCase()
      )?.[1];
    if (hit) return { raw: hit, div };
  }
  return null;
}

interface LiveSide {
  liveAtk: number;
  liveDef: number;
  n: number;
  kappa: number;
}

/** Replikasi likelihood + kappa bimodal dari getShrunkMatchParameters (UCL avg). */
function liveSide(
  telem: ReturnType<typeof getTeamRollingTelemetry>,
  defAtkGoals: number,
  defDefBase: number
): LiveSide {
  let liveAtk = defAtkGoals / UCL_AVG;
  let liveDef = defDefBase;
  let n = 5;
  let kappa = 16.0;
  if (telem && telem.observed_xg_samples >= 3 && telem.rolling_xg_for !== null) {
    liveAtk = telem.rolling_xg_for / UCL_AVG;
    if (telem.rolling_xg_against !== null) liveDef = telem.rolling_xg_against / UCL_AVG;
    n = telem.observed_xg_samples;
    kappa = 8.0;
  } else if (telem && telem.sample_size >= 1) {
    liveAtk = telem.rolling_goals_for / UCL_AVG;
    liveDef = telem.rolling_goals_against / UCL_AVG;
    n = telem.sample_size;
    kappa = 14.0;
  }
  return { liveAtk, liveDef, n, kappa };
}

/** Blend James-Stein: w*live + (1-w)*hist. */
function blend(hist: number, live: number, n: number, kappa: number, floor: number): number {
  const w = n + kappa > 0 ? n / (n + kappa) : 0;
  const v = w * live + (1 - w) * hist;
  return Math.max(floor, Number.isFinite(v) ? Number(v.toFixed(3)) : 1.0);
}

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

async function main(): Promise<void> {
  const ratings = loadCalibratedRatings();
  if (!ratings) {
    console.log("FATAL: data/calibrated_ratings.json tidak terbaca.");
    console.log("VERDICT: UNDECIDED (ratings tak tersedia)");
    process.exit(0);
  }

  const db = getTheStatsDb();
  const matches = db
    .prepare(
      `SELECT m.match_id, m.utc_date, m.home_team_id, m.away_team_id,
              m.home_score, m.away_score, ht.name AS home_name, at.name AS away_name
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.team_id
       JOIN teams at ON m.away_team_id = at.team_id
       WHERE m.competition_id = 'comp_3498'
         AND m.status = 'finished'
         AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       ORDER BY m.utc_date ASC`
    )
    .all() as {
    match_id: string;
    utc_date: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number;
    away_score: number;
    home_name: string;
    away_name: string;
  }[];

  const totalUcl = matches.length;
  let skippedNoRating = 0;
  let skippedBadProb = 0;

  const diffLL: number[] = [];
  const diffBrier: number[] = [];
  let sumLlOn = 0;
  let sumLlOff = 0;
  let sumBrOn = 0;
  let sumBrOff = 0;
  // Per-div (div domestik tim HOME) untuk uji "mayoritas liga".
  const perDiv = new Map<string, { n: number; llOn: number; llOff: number }>();

  for (const m of matches) {
    const normH = normalizeTeamName(m.home_name);
    const normA = normalizeTeamName(m.away_name);
    const resH = findRawDomestic(ratings, normH, m.home_name);
    const resA = findRawDomestic(ratings, normA, m.away_name);
    if (!resH || !resA) {
      skippedNoRating++;
      continue;
    }

    // Arm ON: attack*sqrt(Q), defense/sqrt(Q). Arm OFF: mentah. Q per tim.
    const qH = UEFA_LEAGUE_COEFFICIENT[resH.div] || 0.8;
    const qA = UEFA_LEAGUE_COEFFICIENT[resA.div] || 0.8;
    const histOn = {
      hAtk: resH.raw.attack * Math.sqrt(qH),
      hDef: resH.raw.defense / Math.sqrt(qH),
      aAtk: resA.raw.attack * Math.sqrt(qA),
      aDef: resA.raw.defense / Math.sqrt(qA),
    };
    const histOff = {
      hAtk: resH.raw.attack,
      hDef: resH.raw.defense,
      aAtk: resA.raw.attack,
      aDef: resA.raw.defense,
    };

    // Telemetri SAMA untuk kedua arm (paired), cutoff pre-match anti-leakage.
    const homeTelem = getTeamRollingTelemetry(m.home_team_id, 6, m.utc_date, "UCL");
    const awayTelem = getTeamRollingTelemetry(m.away_team_id, 6, m.utc_date, "UCL");

    // Default joint (mirror loader: 1.35/1.15 + defense turunan).
    const defLiveAwayAtk = 1.15 / UCL_AVG;
    const defLiveHomeAtk = 1.35 / UCL_AVG;
    const sH = liveSide(homeTelem, 1.35, Math.max(0.6, 2.0 - defLiveAwayAtk));
    const sA = liveSide(awayTelem, 1.15, Math.max(0.7, 2.0 - defLiveHomeAtk));

    const arm = (h: { hAtk: number; hDef: number; aAtk: number; aDef: number }) => ({
      homeAttack: blend(h.hAtk, sH.liveAtk, sH.n, sH.kappa, 0.5),
      homeDefense: blend(h.hDef, sH.liveDef, sH.n, sH.kappa, 0.5),
      awayAttack: blend(h.aAtk, sA.liveAtk, sA.n, sA.kappa, 0.4),
      awayDefense: blend(h.aDef, sA.liveDef, sA.n, sA.kappa, 0.5),
    });

    const pOn = arm(histOn);
    const pOff = arm(histOff);
    const rOn = calculateDixonColes({ ...pOn, homeAdvantage: UCL_HA, leagueAvgGoals: UCL_AVG, rho: UCL_RHO });
    const rOff = calculateDixonColes({ ...pOff, homeAdvantage: UCL_HA, leagueAvgGoals: UCL_AVG, rho: UCL_RHO });
    const probs = [rOn.prob_home_win, rOn.prob_draw, rOn.prob_away_win, rOff.prob_home_win, rOff.prob_draw, rOff.prob_away_win];
    if (!probs.every(Number.isFinite)) {
      skippedBadProb++;
      continue;
    }

    const actual = m.home_score > m.away_score ? "H" : m.home_score === m.away_score ? "D" : "A";
    const llOn = calcLogLoss(rOn.prob_home_win, rOn.prob_draw, rOn.prob_away_win, actual);
    const llOff = calcLogLoss(rOff.prob_home_win, rOff.prob_draw, rOff.prob_away_win, actual);
    const brOn = calcBrier(rOn.prob_home_win, rOn.prob_draw, rOn.prob_away_win, actual);
    const brOff = calcBrier(rOff.prob_home_win, rOff.prob_draw, rOff.prob_away_win, actual);
    diffLL.push(llOn - llOff); // negatif = ON lebih baik
    diffBrier.push(brOn - brOff);
    sumLlOn += llOn;
    sumLlOff += llOff;
    sumBrOn += brOn;
    sumBrOff += brOff;

    const g = perDiv.get(resH.div) || { n: 0, llOn: 0, llOff: 0 };
    g.n++;
    g.llOn += llOn;
    g.llOff += llOff;
    perDiv.set(resH.div, g);
  }

  const n = diffLL.length;
  console.log("=== ABLASI sqrt(Q) UCL: scaling ON vs OFF (paired, data identik) ===");
  console.log(`Total laga UCL finished berskor : ${totalUcl}`);
  console.log(`Sampel paired terpakai (n)      : ${n}`);
  console.log(`Skip: rating tak ketemu=${skippedNoRating}, prob non-finite=${skippedBadProb}`);

  if (n === 0) {
    console.log("VERDICT: UNDECIDED (tidak ada sampel paired)");
    return;
  }

  const avgLlOn = sumLlOn / n;
  const avgLlOff = sumLlOff / n;
  const avgBrOn = sumBrOn / n;
  const avgBrOff = sumBrOff / n;
  const meanD = mean(diffLL);
  const se = sd(diffLL) / Math.sqrt(n);
  const meanDb = mean(diffBrier);
  const seB = sd(diffBrier) / Math.sqrt(n);

  console.log(`Log-loss  ON (sqrtQ) : ${avgLlOn.toFixed(4)}`);
  console.log(`Log-loss OFF (raw)   : ${avgLlOff.toFixed(4)}`);
  console.log(`Delta LL (ON-OFF)    : ${meanD.toFixed(5)} | SE=${se.toFixed(5)} | 2xSE=${(2 * se).toFixed(5)}`);
  console.log(`Brier     ON         : ${avgBrOn.toFixed(4)}`);
  console.log(`Brier    OFF         : ${avgBrOff.toFixed(4)}`);
  console.log(`Delta Brier (ON-OFF) : ${meanDb.toFixed(5)} | SE=${seB.toFixed(5)}`);

  console.log("--- Per div domestik tim HOME (n>=1) ---");
  const decisive = { on: 0, off: 0, tie: 0 };
  for (const [div, g] of [...perDiv.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const o = g.llOn / g.n;
    const f = g.llOff / g.n;
    const w = o < f ? "ON" : o > f ? "OFF" : "TIE";
    if (g.n >= 3) {
      if (w === "ON") decisive.on++;
      else if (w === "OFF") decisive.off++;
      else decisive.tie++;
    }
    console.log(`  ${div}: n=${g.n} LL_ON=${o.toFixed(4)} LL_OFF=${f.toFixed(4)} -> ${w}`);
  }
  console.log(`Divis mayoritas (n>=3): ON-menang=${decisive.on} OFF-menang=${decisive.off} tie=${decisive.tie}`);

  let verdict = "UNDECIDED";
  let reason = "";
  if (n < 30) {
    reason = `n=${n} < 30, sampel tak cukup`;
  } else {
    const sig = Math.abs(meanD) > 2 * se;
    // "Konsisten di mayoritas liga" = supermajoritas (≥2/3) grup decisif (n>=3),
    // bukan 4-vs-3 yang pada dasarnya coin-flip.
    const nDec = decisive.on + decisive.off;
    const onMaj = nDec > 0 && decisive.on / nDec >= 2 / 3;
    const offMaj = nDec > 0 && decisive.off / nDec >= 2 / 3;
    if (meanD < 0 && (sig || onMaj)) {
      verdict = "KEEP";
      reason = sig
        ? `ON menang signifikan (${meanD.toFixed(5)} < -2SE)`
        : `ON konsisten di mayoritas liga (${decisive.on} vs ${decisive.off})`;
    } else if (meanD > 0 && (sig || offMaj)) {
      verdict = "DROP";
      reason = sig
        ? `OFF menang signifikan (+${meanD.toFixed(5)} > +2SE)`
        : `OFF konsisten di mayoritas liga (${decisive.off} vs ${decisive.on})`;
    } else {
      reason = `selisih ${meanD.toFixed(5)} dalam noise (2SE=${(2 * se).toFixed(5)}) & liga split ${decisive.on}-${decisive.off}`;
    }
  }
  console.log(`VERDICT: ${verdict} (${reason})`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
