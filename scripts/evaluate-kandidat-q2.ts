/**
 * CLI EVALUASI Q2a — ρ DIXON–COLES TERPOOL (Item 2, Sprint A+B).
 *
 * Menjalankan design beku tasks/sprint-ab/q2-design.md: satu ρ global
 * di-fit (likelihood skor eksak DC + penalti L2) pada baris uji V1 untuk
 * lipatan V2, dan pada V1+V2 untuk holdout H — disiplin walk-forward
 * PR 4. Gerbang PR 4 persis; jangkar champion H terkunci
 * 1,0134022623271062 sebagai syarat sah. Status akhir maksimum
 * READY_FOR_PROSPECTIVE_CONFIRMATION — promosi TIDAK dilakukan.
 *
 * Pakai: npx tsx scripts/evaluate-kandidat-q2.ts --data-dir=../app-football/data
 * Artefak → tasks/sprint-ab/evidence/q2a-rho/
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
  matrixProbs,
  outcomeIndex,
  summarizePredictions,
  type EvalFoldName,
  type EvalLogRow,
  type EvalMatchRow,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import { fullMatrixProbs, gateVocabulary } from "../lib/eval/kandidat-q1-poisson";
import {
  RHO_PENALTY_GRID,
  dcScoreLogLik,
  fitRho,
  type RhoRow,
} from "../lib/eval/kandidat-q2-rho";
import {
  applyKappaDecision,
  blockBootstrapDelta,
  type PairedDeltaRow,
} from "../lib/quant/experiment-stats";
import { dbDir } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DATA_DIR = argVal("data-dir", "data");
const EVAL_DB_DIR = argVal("data-dir", dbDir());
const OUT_DIR = argVal("out", "tasks/sprint-ab/evidence/q2a-rho");
const BOOTSTRAP_SEED = 20261124;
const LOCKED_CHAMPION_H_LL = 1.0134022623271062;

const sha256File = (p: string): string =>
  createHash("sha256").update(fs.readFileSync(p)).digest("hex");

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

interface LoadedData {
  universe: EvalMatchRow[];
  compAvg: EvalMatchRow[];
  logs: EvalLogRow[];
  registryStatus: Map<string, string>;
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
       FROM matches WHERE competition_id LIKE 'sm:%' AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compAvg = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compOfMatch = new Map<string, string>();
  for (const r of ds.prepare("SELECT match_id, competition_id FROM matches").all() as unknown as { match_id: string; competition_id: string }[]) {
    compOfMatch.set(r.match_id, r.competition_id);
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
    matchesHash: `sha256:${mh.digest("hex")}`,
    logsHash: `sha256:${lh.digest("hex")}`,
    datasetSize: stat.size,
    datasetMtime: stat.mtime.toISOString(),
  };
}

interface GenRow {
  league: string;
  m: EvalMatchRow;
  date: string;
  week: string;
  champLam: number;
  champMu: number;
  champP: [number, number, number];
  champOver: number;
  champFallback: boolean;
}

function main(): void {
  const guardBefore = guardSnapshot();
  const data = loadData();
  const ev = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, {
    ...CHAMPION_CONFIG,
    compAvgMode: "as-of",
  });
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
        const fit20 = ev.foldFit(leagueId, fold, 20);
        if (!fit || !fit20.fit) continue;
      } else if (!fit) {
        continue;
      }
      for (const m of test) {
        const pred = ev.predictLevelB(fit, m);
        rows.push({
          league: leagueId,
          m,
          date: m.utc_date.slice(0, 10),
          week: isoWeekKey(m.utc_date),
          champLam: pred.lam,
          champMu: pred.mu,
          champP: pred.p,
          champOver: pred.pOver25,
          champFallback: pred.fallback,
        });
      }
    }
    return rows;
  };

  const rowsV1 = genRows("V1");
  const rowsV2 = genRows("V2");
  const rowsH = genRows("H");

  // Baris fit ρ: hanya baris non-fallback (λ/μ champion asli).
  const rhoRows = (rows: GenRow[]): RhoRow[] =>
    rows
      .filter((r) => !r.champFallback)
      .map((r) => ({ lam: r.champLam, mu: r.champMu, hs: r.m.home_score, as: r.m.away_score }));
  const fitRowsV1 = rhoRows(rowsV1);
  const fitRowsV2 = rhoRows(rowsV2);

  // Pemilihan penalti: gain likelihood V2 dari ρ fit-V1 (seri → penalti lebih besar).
  const penaltyTable = RHO_PENALTY_GRID.map((penalty) => {
    const fit = fitRho(fitRowsV1, penalty);
    const gain =
      (dcScoreLogLik(fitRowsV2, fit.rho) - dcScoreLogLik(fitRowsV2, 0)) / Math.max(1, fitRowsV2.length);
    return { penalty, rho_from_v1: fit.rho, v2_mean_ll_gain: gain };
  });
  let penaltyStar = penaltyTable[0].penalty;
  let bestGain = -Infinity;
  for (const row of penaltyTable) {
    if (row.v2_mean_ll_gain >= bestGain - 1e-12) {
      bestGain = row.v2_mean_ll_gain;
      penaltyStar = row.penalty;
    }
  }
  const rhoV2Fit = fitRho(fitRowsV1, penaltyStar);
  const rhoFinalFit = fitRho([...fitRowsV1, ...fitRowsV2], penaltyStar);
  const rhoFinal = rhoFinalFit.rho;

  // Prediksi H.
  interface HOut {
    match: string;
    league: string;
    date: string;
    week: string;
    hs: number;
    as: number;
    champ: { lam: number; mu: number; p: [number, number, number]; pOver25: number };
    cand: { lam: number; mu: number; p: [number, number, number]; pOver25: number; abstain: boolean };
    fallback: boolean;
  }
  const hOut: HOut[] = rowsH.map((r) => {
    const base: HOut = {
      match: `${r.league}|${r.m.utc_date}|${r.m.home_team_id}|${r.m.away_team_id}`,
      league: r.league,
      date: r.date,
      week: r.week,
      hs: r.m.home_score,
      as: r.m.away_score,
      champ: { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver },
      cand: { lam: r.champLam, mu: r.champMu, p: r.champP, pOver25: r.champOver, abstain: true },
      fallback: r.champFallback,
    };
    if (!r.champFallback) {
      const mp = matrixProbs(r.champLam, r.champMu, rhoFinal);
      base.cand = { lam: r.champLam, mu: r.champMu, p: mp.p, pOver25: mp.pOver25, abstain: mp.fallback };
      base.fallback = mp.fallback;
    }
    return base;
  });
  hOut.sort((a, b) => (a.match < b.match ? -1 : a.match > b.match ? 1 : 0));

  const champFallbackByMatch = new Map(
    rowsH.map((r) => [`${r.league}|${r.m.utc_date}|${r.m.home_team_id}|${r.m.away_team_id}`, r.champFallback]),
  );
  const champScored: ScoredRow[] = hOut.map((r) => ({
    p: r.champ.p,
    y: outcomeIndex(r.hs, r.as),
    fallback: champFallbackByMatch.get(r.match) ?? false,
  }));
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
  const status =
    decisionWord === "eligible_for_shadow"
      ? "READY_FOR_PROSPECTIVE_CONFIRMATION"
      : decisionWord === "retain"
        ? "RETAIN_CHAMPION"
        : "INCONCLUSIVE_RETAIN_CHAMPION";

  // Irisan sekunder H + penutup diagnostik seri.
  const binLl = (p: number, y: boolean): number => -Math.log(y ? p : 1 - p);
  let ouChamp = 0;
  let ouCand = 0;
  let bttsChamp = 0;
  let bttsCand = 0;
  let bttsN = 0;
  let drawChamp = 0;
  let drawCand = 0;
  let drawAct = 0;
  for (const r of hOut) {
    const over = r.hs + r.as > 2.5;
    ouChamp += binLl(r.champ.pOver25, over);
    ouCand += binLl(r.cand.pOver25, over);
    const fmChamp = fullMatrixProbs(r.champ.lam, r.champ.mu, 0);
    const fmCand = fullMatrixProbs(r.cand.lam, r.cand.mu, rhoFinal);
    if (!fmChamp.fallback && !fmCand.fallback && Number.isFinite(fmChamp.pBtts) && Number.isFinite(fmCand.pBtts)) {
      const btts = r.hs >= 1 && r.as >= 1;
      bttsChamp += binLl(fmChamp.pBtts, btts);
      bttsCand += binLl(fmCand.pBtts, btts);
      bttsN++;
    }
    drawChamp += r.champ.p[1];
    drawCand += r.cand.p[1];
    if (r.hs === r.as) drawAct++;
  }
  const nH = hOut.length;
  const secondaryH = {
    ou25_binary_logloss: { n: nH, champion: ouChamp / nH, candidate: ouCand / nH, delta: ouCand / nH - ouChamp / nH },
    btts_binary_logloss: { n: bttsN, champion: bttsN ? bttsChamp / bttsN : NaN, candidate: bttsN ? bttsCand / bttsN : NaN, delta: bttsN ? bttsCand / bttsN - bttsChamp / bttsN : NaN },
    draw_share: { champion_predicted: drawChamp / nH, candidate_predicted: drawCand / nH, actual: drawAct / nH },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync("tasks/sprint-ab/q2-design.md", path.join(OUT_DIR, "design.md"));
  fs.writeFileSync(path.join(OUT_DIR, "predictions.jsonl"), hOut.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const candidateArtifact = {
    candidate_id: "q2a-dc-rho-pooled-v1",
    hypothesis: "Q2a — satu ρ Dixon–Coles terpool di atas λ/μ champion (brief P2 Model Quant)",
    champion: "2.0-dixon-coles-mle+kfit10+hl365+rho:zero+js2 (Level B, evaluator PR 3, as-of)",
    penalty_grid: [...RHO_PENALTY_GRID],
    penalty_star: penaltyStar,
    penalty_table: penaltyTable,
    rho_for_v2: rhoV2Fit.rho,
    rho_final: rhoFinal,
    trained_on: { v1_rows: fitRowsV1.length, v2_rows: fitRowsV2.length, refit_rows: fitRowsV1.length + fitRowsV2.length },
    abstain_policy: "identik dengan fallback champion",
  };
  const artifactSha = createHash("sha256").update(JSON.stringify(candidateArtifact)).digest("hex");
  fs.writeFileSync(path.join(OUT_DIR, "candidate-artifact.json"), JSON.stringify({ ...candidateArtifact, artifact_sha256: artifactSha }, null, 2));

  const metrics = {
    universe: { leagues: leagueIds.length, rows_v1: rowsV1.length, rows_v2: rowsV2.length, rows_h: rowsH.length },
    penalty_selection: penaltyTable,
    penalty_star: penaltyStar,
    rho: { for_v2: rhoV2Fit.rho, final: rhoFinal },
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
    gate: { machine_decision: gate.decision, brief_decision: decisionWord, status, checks: gate.checks },
  };
  fs.writeFileSync(path.join(OUT_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "decision.json"),
    JSON.stringify(
      {
        decision: decisionWord,
        status,
        meaning:
          status === "READY_FOR_PROSPECTIVE_CONFIRMATION"
            ? "Gerbang PR 4 LOLOS pada holdout H, tetapi H sudah dipakai K5/PR 3/PR 4 — menurut brief sprint kandidat hanya berstatus siap konfirmasi prospektif; promosi TIDAK dilakukan dan memerlukan periode prospektif baru + keputusan pemilik."
            : decisionWord === "retain"
              ? "Gerbang PR 4 GAGAL pada holdout H — champion dipertahankan; ρ terpool tidak layak lanjut."
              : "Bukti/sampel tidak cukup menurut lantai gerbang — tanpa kesimpulan; champion dipertahankan.",
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
          rho_final: rhoFinal,
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
    tool: "scripts/evaluate-kandidat-q2.ts",
    candidate: "q2a-dc-rho-pooled-v1",
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
      design_sha256: sha256File("tasks/sprint-ab/q2-design.md"),
    },
    config: { champion: CHAMPION_CONFIG, penalty_grid: [...RHO_PENALTY_GRID], bootstrap: { resamples: 5000, seed: BOOTSTRAP_SEED } },
    anchors: { holdout_champion_ok: anchorOk },
    guard: { before: guardBefore, after: guardAfter, identical: guardOk },
  };
  fs.writeFileSync(path.join(OUT_DIR, "run-manifest.json"), JSON.stringify(manifest, null, 2));

  const summary = {
    rows: { v1: rowsV1.length, v2: rowsV2.length, h: rowsH.length },
    penalty_star: penaltyStar,
    rho_final: rhoFinal,
    holdout: {
      champion_ll: champMetrics.logloss,
      candidate_ll: candMetrics.logloss,
      delta: boot.meanDelta,
      upper_one_sided_95: boot.upperOneSided95,
      ci95: [boot.ci95Low, boot.ci95High],
      anchor_ok: anchorOk,
    },
    decision: decisionWord,
    status,
    guard_identical: guardOk,
  };
  fs.writeFileSync(path.join(OUT_DIR, "run.log"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  if (!anchorOk) {
    console.error("PERINGATAN JANGKAR: champion H tidak mereproduksi angka terkunci PR 3 — run tidak sah.");
    process.exitCode = 2;
  }
  if (!guardOk) {
    console.error("PERINGATAN PENJAGA: berkas saji/DB berubah selama run — isolasi shadow GAGAL.");
    process.exitCode = 3;
  }
}

main();
