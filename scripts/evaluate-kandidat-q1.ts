/**
 * CLI EVALUASI SHADOW KANDIDAT Q1 (PR 4).
 *
 * Menjalankan protokol yang dibekukan di tasks/pr4/design.md:
 *   1. Prediksi Level B champion (evaluator PR 3, mode as-of) pada blok
 *      uji V1/V2/H di universe K5 — H champion WAJIB mereproduksi angka
 *      terkunci PR 3 (jangkar sanity).
 *   2. Fit β Q1 di V1, pilih α di V2, refit di V1+V2, bekukan.
 *   3. Nilai H sekali: gate brief lewat applyKappaDecision repo.
 *   4. Irisan benchmark penutupan PR 3 (n=1.223 + OU n=561) dengan β
 *      yang tersedia menurut lipatan (walk-forward).
 *
 * SHADOW MURNI: DB produksi hanya dibaca (readOnly); semua tulisan di
 * direktori --out bawah tasks/pr4/. Hash berkas saji (manifest aktif +
 * artefak) dan ukuran/mtime DB dicatat sebelum & sesudah dan harus
 * identik — dicatat di run-manifest.json. TIDAK ada promosi.
 *
 * Pakai (dari root worktree pr4):
 *   npx tsx scripts/evaluate-kandidat-q1.ts \
 *     --data-dir=../app-football/data \
 *     --out=tasks/pr4/evidence/q1-shadow \
 *     --pairs=tasks/pr3/evidence/cb-pairs-dump.json
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CHAMPION_CONFIG,
  ChronologicalEvaluator,
  EVAL_FOLDS,
  isoWeekKey,
  logLossClamped,
  logLossRaw,
  matrixProbs,
  outcomeIndex,
  summarizePredictions,
  type EvalFoldName,
  type EvalLogRow,
  type EvalMatchRow,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import {
  Q1FeatureExtractor,
  applyCandidate,
  featureVector,
  fitPoissonRidge,
  fullMatrixProbs,
  gateVocabulary,
  meanPoissonNll,
  poissonNll,
  type PoissonFitRow,
  type Q1MatchFeatures,
} from "../lib/eval/kandidat-q1-poisson";
import { applyKappaDecision, blockBootstrapDelta, type PairedDeltaRow } from "../lib/quant/experiment-stats";
import { dbDir } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DATA_DIR = argVal("data-dir", "data");
const EVAL_DB_DIR = argVal("data-dir", dbDir());
const OUT_DIR = argVal("out", "tasks/pr4/evidence/q1-shadow");
const PAIRS_PATH = argVal("pairs", "tasks/pr3/evidence/cb-pairs-dump.json");
const BOOTSTRAP_SEED = 20261124;
const ALPHA_GRID = [0.3, 1, 3, 10, 30, 100];
const LOCKED_CHAMPION_H_LL = 1.0134022623271062;
const LOCKED_BENCH_CHAMPION_LL = 1.0094304221309824;

const sha256File = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// ---------------------------------------------------------------------------
// Penjaga isolasi: snapshot berkas saji + DB sebelum/sesudah
// ---------------------------------------------------------------------------
function guardSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  const manifestPath = path.join(DATA_DIR, "model-manifest.json");
  if (fs.existsSync(manifestPath)) snap["model-manifest.json"] = { sha256: sha256File(manifestPath) };
  const artDir = path.join(DATA_DIR, "model-artifacts");
  if (fs.existsSync(artDir)) {
    for (const f of fs.readdirSync(artDir).sort()) {
      snap[`model-artifacts/${f}`] = { sha256: sha256File(path.join(artDir, f)) };
    }
  }
  for (const db of ["picks.db", "analysis_snapshots.db", "thestats_dataset.db"]) {
    const p = path.join(EVAL_DB_DIR, db);
    if (fs.existsSync(p)) {
      const st = fs.statSync(p);
      snap[db] = { size_bytes: st.size, mtime: st.mtime.toISOString() };
    }
  }
  return snap;
}

// ---------------------------------------------------------------------------
// Pemuatan data (query identik dengan CLI PR 3 + peta musim)
// ---------------------------------------------------------------------------
interface LoadedData {
  universe: EvalMatchRow[];
  compAvg: EvalMatchRow[];
  logs: EvalLogRow[];
  registryStatus: Map<string, string>;
  seasonByMatchId: Map<string, string>;
  matchesHash: string;
  logsHash: string;
  datasetSize: number;
  datasetMtime: string;
}

function loadData(): LoadedData {
  const datasetPath = path.join(EVAL_DB_DIR, "thestats_dataset.db");
  const ds = new DatabaseSync(datasetPath, { readOnly: true });
  const universe = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE competition_id LIKE 'sm:%' AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compAvg = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compOfMatch = new Map<string, string>();
  const seasonByMatchId = new Map<string, string>();
  for (const r of ds.prepare("SELECT match_id, competition_id, season FROM matches").all() as unknown as { match_id: string; competition_id: string; season: string }[]) {
    compOfMatch.set(r.match_id, r.competition_id);
    if (r.season) seasonByMatchId.set(r.match_id, r.season);
  }
  const logs = (
    ds
      .prepare(
        `SELECT team_id, match_date, goals_for, goals_against, xg_for, xg_against, match_id
         FROM team_match_logs WHERE source = 'sportmonks' ORDER BY team_id, match_date`,
      )
      .all() as unknown as (EvalLogRow & { match_id: string })[]
  ).map((r) => ({ ...r, competition_id: compOfMatch.get(r.match_id) ?? null }));
  const registryStatus = new Map<string, string>();
  for (const r of ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
    registryStatus.set(r.league_id, r.status);
  }
  ds.close();

  const mh = createHash("sha256");
  for (const m of universe) mh.update(`${m.competition_id}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}|${m.home_score}|${m.away_score}\n`);
  const logsByTeam = new Map<string, EvalLogRow[]>();
  for (const l of logs) {
    const arr = logsByTeam.get(l.team_id) ?? [];
    arr.push(l);
    logsByTeam.set(l.team_id, arr);
  }
  const lh = createHash("sha256");
  for (const [team, arr] of [...logsByTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const l of arr) lh.update(`${team}|${l.match_date}|${l.goals_for}|${l.goals_against}|${l.xg_for}|${l.xg_against}|${l.competition_id}\n`);
  }
  const stat = fs.statSync(datasetPath);
  return {
    universe,
    compAvg,
    logs,
    registryStatus,
    seasonByMatchId,
    matchesHash: `sha256:${mh.digest("hex")}`,
    logsHash: `sha256:${lh.digest("hex")}`,
    datasetSize: stat.size,
    datasetMtime: stat.mtime.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Baris generasi: prediksi champion + fitur untuk satu lipatan
// ---------------------------------------------------------------------------
interface GenRow {
  m: EvalMatchRow;
  league: string;
  fold: EvalFoldName;
  date: string;
  week: string;
  champLam: number;
  champMu: number;
  champP: [number, number, number];
  champOver: number;
  champFallback: boolean;
  feats: Q1MatchFeatures;
}

function main(): void {
  const guardBefore = guardSnapshot();
  const data = loadData();
  const ev = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, { ...CHAMPION_CONFIG, compAvgMode: "as-of" });
  const extractor = new Q1FeatureExtractor(data.universe, data.compAvg, data.seasonByMatchId);

  const MIN_MATCHES = 120;
  const leagueIds = ev
    .leagueIds()
    .filter((id) => {
      const st = data.registryStatus.get(id);
      return (st === "calibrated" || st === "partial") && ev.leagueMatches(id).length >= MIN_MATCHES;
    })
    .sort((a, b) => a.localeCompare(b));

  const genRows = (foldName: EvalFoldName): GenRow[] => {
    const fold = EVAL_FOLDS.find((f) => f.name === foldName)!;
    const rows: GenRow[] = [];
    for (const leagueId of leagueIds) {
      const { fit, test } = ev.foldFit(leagueId, fold, 10);
      if (foldName === "H") {
        // Paritas himpunan dengan mode k5-holdout PR 3: liga dilewati bila
        // fit κ10 ATAU κ20 null (kondisi verbatim runK5Holdout).
        const fit20 = ev.foldFit(leagueId, fold, 20);
        if (!fit || !fit20.fit) continue;
      } else if (!fit) {
        continue;
      }
      for (const m of test) {
        const pred = ev.predictLevelB(fit, m);
        rows.push({
          m,
          league: leagueId,
          fold: foldName,
          date: m.utc_date.slice(0, 10),
          week: isoWeekKey(m.utc_date),
          champLam: pred.lam,
          champMu: pred.mu,
          champP: pred.p,
          champOver: pred.pOver25,
          champFallback: pred.fallback,
          feats: extractor.featuresFor(m),
        });
      }
    }
    return rows;
  };

  const rowsV1 = genRows("V1");
  const rowsV2 = genRows("V2");
  const rowsH = genRows("H");

  const toFitRows = (rows: GenRow[], dropFormResid = false): { home: PoissonFitRow[]; away: PoissonFitRow[] } => {
    const home: PoissonFitRow[] = [];
    const away: PoissonFitRow[] = [];
    for (const r of rows) {
      const xh = featureVector(r.feats.home);
      const xa = featureVector(r.feats.away);
      if (dropFormResid) {
        xh[3] = 0;
        xa[3] = 0;
      }
      home.push({ offsetLog: Math.log(r.champLam), x: xh, y: r.m.home_score });
      away.push({ offsetLog: Math.log(r.champMu), x: xa, y: r.m.away_score });
    }
    return { home, away };
  };
  const totalNll = (rows: GenRow[], betaHome: readonly number[], betaAway: readonly number[]): number => {
    const fr = toFitRows(rows);
    return meanPoissonNll(fr.home, betaHome) + meanPoissonNll(fr.away, betaAway);
  };

  // --- Protokol β: fit V1 → pilih α di V2 → refit V1+V2 -------------------
  const fitV1 = toFitRows(rowsV1);
  const alphaTable: Record<string, unknown>[] = [];
  let alphaStar = NaN;
  let bestV2 = Infinity;
  const betaByAlpha = new Map<number, { home: number[]; away: number[] }>();
  for (const alpha of ALPHA_GRID) {
    const bh = fitPoissonRidge(fitV1.home, alpha);
    const ba = fitPoissonRidge(fitV1.away, alpha);
    betaByAlpha.set(alpha, { home: bh.beta, away: ba.beta });
    const v2 = totalNll(rowsV2, bh.beta, ba.beta);
    alphaTable.push({
      alpha,
      beta_home: bh.beta,
      beta_away: ba.beta,
      converged_home: bh.converged,
      converged_away: ba.converged,
      nll_v1_train: bh.meanNll + ba.meanNll,
      nll_v2_validation: v2,
    });
    if (v2 < bestV2) {
      bestV2 = v2;
      alphaStar = alpha;
    }
  }
  const betaV1 = betaByAlpha.get(alphaStar)!;
  const fitV12 = toFitRows([...rowsV1, ...rowsV2]);
  const finalHome = fitPoissonRidge(fitV12.home, alphaStar);
  const finalAway = fitPoissonRidge(fitV12.away, alphaStar);
  const betaFinal = { home: finalHome.beta, away: finalAway.beta };

  // Determinisme fit: ulangi fit final, β harus identik byte-per-byte.
  const refitHome = fitPoissonRidge(fitV12.home, alphaStar);
  const refitAway = fitPoissonRidge(fitV12.away, alphaStar);
  const fitDeterministic =
    JSON.stringify(refitHome.beta) === JSON.stringify(finalHome.beta) && JSON.stringify(refitAway.beta) === JSON.stringify(finalAway.beta);

  // Ablasi form_resid pada α* (diagnostik brief): fit V1 tanpa kolom form.
  const fitV1NoForm = toFitRows(rowsV1, true);
  const ablHome = fitPoissonRidge(fitV1NoForm.home, alphaStar);
  const ablAway = fitPoissonRidge(fitV1NoForm.away, alphaStar);
  const ablation = {
    alpha: alphaStar,
    nll_v2_full: totalNll(rowsV2, betaV1.home, betaV1.away),
    nll_v2_no_form_resid: (() => {
      const fr = toFitRows(rowsV2, true);
      return meanPoissonNll(fr.home, ablHome.beta) + meanPoissonNll(fr.away, ablAway.beta);
    })(),
  };

  // --- Evaluasi H ----------------------------------------------------------
  interface HOut {
    match: string;
    league: string;
    date: string;
    week: string;
    hs: number;
    as: number;
    champ: { lam: number; mu: number; p: [number, number, number]; pOver25: number };
    cand: { lam: number; mu: number; p: [number, number, number]; pOver25: number; abstain: boolean };
    features: Q1MatchFeatures;
    fallback: boolean;
  }
  const hOut: HOut[] = [];
  for (const r of rowsH) {
    if (r.champFallback) {
      hOut.push({
        match: `${r.league}|${r.m.utc_date}|${r.m.home_team_id}|${r.m.away_team_id}`,
        league: r.league, date: r.date, week: r.week,
        hs: r.m.home_score, as: r.m.away_score,
        champ: { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver },
        cand: { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver, abstain: true },
        features: r.feats, fallback: true,
      });
    } else {
      const { lam, mu } = applyCandidate(r.champLam, r.champMu, r.feats, betaFinal.home, betaFinal.away);
      const mp = matrixProbs(lam, mu, 0);
      hOut.push({
        match: `${r.league}|${r.m.utc_date}|${r.m.home_team_id}|${r.m.away_team_id}`,
        league: r.league, date: r.date, week: r.week,
        hs: r.m.home_score, as: r.m.away_score,
        champ: { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver },
        cand: { lam, mu, p: mp.p, pOver25: mp.pOver25, abstain: false },
        features: r.feats, fallback: mp.fallback,
      });
    }
  }
  hOut.sort((a, b) => (a.match < b.match ? -1 : a.match > b.match ? 1 : 0));

  // Fallback champion per baris H diambil dari peta baris generasi (hOut terurut ulang).
  const champFallbackByMatch = new Map(rowsH.map((r) => [`${r.league}|${r.m.utc_date}|${r.m.home_team_id}|${r.m.away_team_id}`, r.champFallback]));
  const champScored: ScoredRow[] = hOut.map((r) => ({ p: r.champ.p, y: outcomeIndex(r.hs, r.as), fallback: champFallbackByMatch.get(r.match) ?? false }));
  const candScored: ScoredRow[] = hOut.map((r) => ({ p: r.cand.p, y: outcomeIndex(r.hs, r.as), fallback: r.fallback }));

  const champMetrics = summarizePredictions(champScored);
  const candMetrics = summarizePredictions(candScored);
  const anchorOk = Math.abs(champMetrics.logloss - LOCKED_CHAMPION_H_LL) < 1e-9;

  const paired: PairedDeltaRow[] = hOut.map((r) => {
    const y = outcomeIndex(r.hs, r.as);
    return { block: r.week, delta: logLossClamped(r.cand.p, y) - logLossClamped(r.champ.p, y) };
  });
  const boot = blockBootstrapDelta(paired, { resamples: 5000, seed: BOOTSTRAP_SEED });

  const gate = applyKappaDecision({
    meanDelta: boot.meanDelta,
    bootstrapUpperOneSided95: boot.upperOneSided95,
    coverageChampion: champMetrics.coverage,
    coverageChallenger: candMetrics.coverage,
    brierChampion: champMetrics.brier,
    brierChallenger: candMetrics.brier,
    nMatches: boot.nMatches,
    nBlocks: boot.nBlocks,
  });
  const decisionWord = gateVocabulary(gate.decision);

  // Irisan sekunder H: Poisson NLL gol, OU2.5, BTTS.
  const binLl = (p: number, y: boolean): number => -Math.log(y ? p : 1 - p);
  let nllChamp = 0,
    nllCand = 0,
    ouChamp = 0,
    ouCand = 0,
    bttsChamp = 0,
    bttsCand = 0,
    bttsN = 0;
  for (const r of hOut) {
    nllChamp += poissonNll(r.hs, r.champ.lam) + poissonNll(r.as, r.champ.mu);
    nllCand += poissonNll(r.hs, r.cand.lam) + poissonNll(r.as, r.cand.mu);
    const over = r.hs + r.as > 2.5;
    ouChamp += binLl(r.champ.pOver25, over);
    ouCand += binLl(r.cand.pOver25, over);
    const fmChamp = fullMatrixProbs(r.champ.lam, r.champ.mu, 0);
    const fmCand = fullMatrixProbs(r.cand.lam, r.cand.mu, 0);
    if (!fmChamp.fallback && !fmCand.fallback && Number.isFinite(fmChamp.pBtts) && Number.isFinite(fmCand.pBtts)) {
      const btts = r.hs >= 1 && r.as >= 1;
      bttsChamp += binLl(fmChamp.pBtts, btts);
      bttsCand += binLl(fmCand.pBtts, btts);
      bttsN++;
    }
  }
  const nH = hOut.length;
  const secondaryH = {
    poisson_nll_goals: { n: nH, champion: nllChamp / nH, candidate: nllCand / nH, delta: nllCand / nH - nllChamp / nH },
    ou25_binary_logloss: { n: nH, champion: ouChamp / nH, candidate: ouCand / nH, delta: ouCand / nH - ouChamp / nH },
    btts_binary_logloss: { n: bttsN, champion: bttsN ? bttsChamp / bttsN : NaN, candidate: bttsN ? bttsCand / bttsN : NaN, delta: bttsN ? bttsCand / bttsN - bttsChamp / bttsN : NaN },
  };

  // --- Irisan benchmark penutupan ------------------------------------------
  interface Pair1x2 {
    matchId: string;
    div: string;
    season: string;
    market: "1x2";
    model: [number, number, number];
    closing: [number, number, number];
    actualIdx: 0 | 1 | 2;
    odds: [number, number, number];
    score: [number, number];
  }
  interface PairOu {
    matchId: string;
    div: string;
    season: string;
    market: "ou25";
    modelOver: number;
    closingOver: number;
    actualOver: boolean;
    odds: [number, number];
    score: [number, number];
  }
  const rawPairs = JSON.parse(fs.readFileSync(PAIRS_PATH, "utf8")) as (Pair1x2 | PairOu)[];
  const pairs1x2 = rawPairs.filter((p): p is Pair1x2 => p.market === "1x2");
  const pairsOu = rawPairs.filter((p): p is PairOu => p.market === "ou25");
  const byId = new Map<string, EvalMatchRow>();
  for (const m of data.universe) byId.set(m.match_id, m);

  const betaForFold = (fold: EvalFoldName | null): { home: number[]; away: number[] } | null => {
    if (fold === "H") return betaFinal;
    if (fold === "V2") return betaV1;
    return null; // V1 / tanpa lipatan: belum ada OOS lebih awal → kandidat = champion
  };

  interface BenchRow {
    matchId: string;
    fold: string | null;
    week: string;
    llChamp: number;
    llCand: number;
    llClosing: number;
    candActive: boolean;
  }
  const bench: BenchRow[] = [];
  for (const pr of pairs1x2) {
    const m = byId.get(pr.matchId);
    if (!m) continue;
    const champ = ev.predictMatchLevelB(m);
    const beta = betaForFold(champ.fold);
    let candP = champ.p;
    let active = false;
    if (beta && !champ.fitFallback && champ.lam > 0) {
      const { lam, mu } = applyCandidate(champ.lam, champ.mu, extractor.featuresFor(m), beta.home, beta.away);
      candP = matrixProbs(lam, mu, 0).p;
      active = true;
    }
    bench.push({
      matchId: pr.matchId,
      fold: champ.fold,
      week: isoWeekKey(m.utc_date),
      llChamp: logLossRaw(champ.p, pr.actualIdx),
      llCand: logLossRaw(candP, pr.actualIdx),
      llClosing: logLossRaw(pr.closing, pr.actualIdx),
      candActive: active,
    });
  }
  const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
  const benchAnchorOk = Math.abs(mean(bench.map((r) => r.llChamp)) - LOCKED_BENCH_CHAMPION_LL) < 1e-9;
  const benchBoot = blockBootstrapDelta(
    bench.map((r) => ({ block: r.week, delta: r.llCand - r.llChamp })),
    { resamples: 5000, seed: BOOTSTRAP_SEED },
  );
  const benchH = bench.filter((r) => r.fold === "H");
  const benchSummary = (rows: BenchRow[]) => ({
    n: rows.length,
    candidate_active: rows.filter((r) => r.candActive).length,
    ll_champion: mean(rows.map((r) => r.llChamp)),
    ll_candidate: mean(rows.map((r) => r.llCand)),
    ll_closing: mean(rows.map((r) => r.llClosing)),
    delta_champion_vs_closing: mean(rows.map((r) => r.llChamp)) - mean(rows.map((r) => r.llClosing)),
    delta_candidate_vs_closing: mean(rows.map((r) => r.llCand)) - mean(rows.map((r) => r.llClosing)),
    delta_candidate_vs_champion: mean(rows.map((r) => r.llCand)) - mean(rows.map((r) => r.llChamp)),
  });

  let ouBenchN = 0,
    ouChampSum = 0,
    ouCandSum = 0,
    ouClosingSum = 0,
    ouActive = 0;
  for (const pr of pairsOu) {
    const m = byId.get(pr.matchId);
    if (!m) continue;
    const champ = ev.predictMatchLevelB(m);
    const beta = betaForFold(champ.fold);
    let candOver = champ.pOver25;
    if (beta && !champ.fitFallback && champ.lam > 0) {
      const { lam, mu } = applyCandidate(champ.lam, champ.mu, extractor.featuresFor(m), beta.home, beta.away);
      candOver = matrixProbs(lam, mu, 0).pOver25;
      ouActive++;
    }
    const ll = (pOver: number): number => -Math.log(pr.actualOver ? pOver : 1 - pOver);
    ouBenchN++;
    ouChampSum += ll(champ.pOver25);
    ouCandSum += ll(candOver);
    ouClosingSum += ll(pr.closingOver);
  }
  const benchOu = {
    n: ouBenchN,
    candidate_active: ouActive,
    ll_champion: ouChampSum / ouBenchN,
    ll_candidate: ouCandSum / ouBenchN,
    ll_closing: ouClosingSum / ouBenchN,
    delta_candidate_vs_closing: ouCandSum / ouBenchN - ouClosingSum / ouBenchN,
    delta_candidate_vs_champion: ouCandSum / ouBenchN - ouChampSum / ouBenchN,
  };

  // --- Tulis artefak ---------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync("tasks/pr4/design.md", path.join(OUT_DIR, "design.md"));
  fs.writeFileSync(path.join(OUT_DIR, "predictions.jsonl"), hOut.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const betaNamed = (beta: readonly number[]): Record<string, number> => ({
    rest_adv: beta[0],
    venue_neutral: beta[1],
    promoted: beta[2],
    form_resid: beta[3],
    miss_rest: beta[4],
    miss_form: beta[5],
  });
  const candidateArtifact = {
    candidate_id: "q1-poisson-offset-v1",
    hypothesis: "Q1 — Poisson terpenalti di atas champion (brief P2 Model Quant)",
    champion: "2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2 (Level B, evaluator PR 3, as-of)",
    alpha_star: alphaStar,
    alpha_grid: ALPHA_GRID,
    beta_home: betaNamed(betaFinal.home),
    beta_away: betaNamed(betaFinal.away),
    beta_home_v1_only: betaNamed(betaV1.home),
    beta_away_v1_only: betaNamed(betaV1.away),
    trained_on: { v1_rows: rowsV1.length, v2_rows: rowsV2.length, refit_rows: rowsV1.length + rowsV2.length },
    fit_converged: { home: finalHome.converged, away: finalAway.converged },
    intensity_bounds: [0.05, 6.0],
    abstain_policy: "identik dengan fallback champion",
  };
  const artifactSha = createHash("sha256").update(JSON.stringify(candidateArtifact)).digest("hex");
  fs.writeFileSync(path.join(OUT_DIR, "candidate-artifact.json"), JSON.stringify({ ...candidateArtifact, artifact_sha256: artifactSha }, null, 2));

  const metrics = {
    universe: { leagues: leagueIds.length, rows_v1: rowsV1.length, rows_v2: rowsV2.length, rows_h: rowsH.length },
    alpha_selection: alphaTable,
    alpha_star: alphaStar,
    ablation_form_resid: ablation,
    holdout_h: {
      window: [hOut.map((r) => r.date).sort()[0], hOut.map((r) => r.date).sort()[nH - 1]],
      champion: champMetrics,
      candidate: candMetrics,
      delta_candidate_minus_champion: candMetrics.logloss - champMetrics.logloss,
      bootstrap: boot,
      anchor_champion_ll_locked: LOCKED_CHAMPION_H_LL,
      anchor_ok: anchorOk,
    },
    secondary_h: secondaryH,
    benchmark_1x2: {
      pooled: benchSummary(bench),
      holdout_fold_subset: benchSummary(benchH),
      bootstrap_candidate_minus_champion: benchBoot,
      anchor_champion_ll_locked: LOCKED_BENCH_CHAMPION_LL,
      anchor_ok: benchAnchorOk,
    },
    benchmark_ou25: benchOu,
    gate: { machine_decision: gate.decision, brief_decision: decisionWord, checks: gate.checks },
  };
  fs.writeFileSync(path.join(OUT_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "decision.json"),
    JSON.stringify(
      {
        decision: decisionWord,
        meaning:
          decisionWord === "eligible_for_shadow"
            ? "Gate brief LOLOS pada holdout H — kandidat layak shadow/tinjauan promosi menurut aturan; keputusan promosi tetap milik pemilik dan TIDAK dilakukan di PR ini."
            : decisionWord === "retain"
              ? "Gate brief GAGAL pada holdout H — champion dipertahankan; kandidat tidak layak promosi."
              : "Bukti/sampel tidak cukup menurut lantai gate — tanpa kesimpulan; champion dipertahankan.",
        gate_checks: gate.checks,
        headline: {
          n: boot.nMatches,
          blocks: boot.nBlocks,
          champion_logloss: champMetrics.logloss,
          candidate_logloss: candMetrics.logloss,
          mean_delta: boot.meanDelta,
          bootstrap_upper_one_sided_95: boot.upperOneSided95,
          ci95: [boot.ci95Low, boot.ci95High],
          coverage_champion: champMetrics.coverage,
          coverage_candidate: candMetrics.coverage,
          brier_champion: champMetrics.brier,
          brier_candidate: candMetrics.brier,
        },
        promotion_performed: false,
      },
      null,
      2,
    ),
  );

  const guardAfter = guardSnapshot();
  const guardOk = JSON.stringify(guardBefore) === JSON.stringify(guardAfter);
  let gitHead: string | null = null;
  try {
    gitHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    gitHead = null;
  }
  const manifest = {
    tool: "scripts/evaluate-kandidat-q1.ts",
    candidate: "q1-poisson-offset-v1",
    git_head: gitHead,
    generated_at: new Date().toISOString(),
    data_dir: path.resolve(DATA_DIR),
    dataset: { file: "thestats_dataset.db", size_bytes: data.datasetSize, mtime: data.datasetMtime },
    inputs: {
      universe_matches: data.universe.length,
      compavg_matches: data.compAvg.length,
      team_logs: data.logs.length,
      matches_hash: data.matchesHash,
      logs_hash: data.logsHash,
      pairs_file: PAIRS_PATH,
      pairs_sha256: sha256File(PAIRS_PATH),
      design_sha256: sha256File("tasks/pr4/design.md"),
    },
    config: { champion: CHAMPION_CONFIG, alpha_grid: ALPHA_GRID, alpha_star: alphaStar, bootstrap: { resamples: 5000, seed: BOOTSTRAP_SEED } },
    fit_deterministic: fitDeterministic,
    anchors: { holdout_champion_ok: anchorOk, benchmark_champion_ok: benchAnchorOk },
    guard: { before: guardBefore, after: guardAfter, identical: guardOk },
  };
  fs.writeFileSync(path.join(OUT_DIR, "run-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    JSON.stringify(
      {
        rows: { v1: rowsV1.length, v2: rowsV2.length, h: rowsH.length },
        alpha_star: alphaStar,
        holdout: {
          champion_ll: champMetrics.logloss,
          candidate_ll: candMetrics.logloss,
          delta: boot.meanDelta,
          upper_one_sided_95: boot.upperOneSided95,
          ci95: [boot.ci95Low, boot.ci95High],
          anchor_ok: anchorOk,
        },
        benchmark: { pooled: benchSummary(bench), anchor_ok: benchAnchorOk },
        decision: decisionWord,
        guard_identical: guardOk,
        fit_deterministic: fitDeterministic,
      },
      null,
      2,
    ),
  );
  if (!anchorOk || !benchAnchorOk) {
    console.error("PERINGATAN JANGKAR: angka champion tidak mereproduksi angka terkunci PR 3 — selidiki sebelum memercayai hasil kandidat.");
    process.exitCode = 2;
  }
  if (!guardOk) {
    console.error("PERINGATAN PENJAGA: berkas saji/DB berubah selama run — isolasi shadow GAGAL.");
    process.exitCode = 3;
  }
}

main();
