/**
 * CLI EVALUASI Q0 — BASELINE PEMBANDING (Item 1, Sprint A+B).
 *
 * Menjalankan protokol beku tasks/sprint-ab/q0-design.md: tiga baseline
 * (Freq, NaivePoisson, Elo) dinilai lewat evaluator kronologis PR 3 pada
 * himpunan liga + irisan lipatan yang IDENTIK dengan generasi champion
 * PR 4, dengan jangkar champion H terkunci (1,0134022623271062) sebagai
 * syarat sah run. Q0 adalah lantai pembanding — BUKAN kandidat; tidak
 * ada gerbang promosi dan tidak ada tulisan ke data produksi (DB dibaca
 * readOnly; penjaga hash berkas saji + stat DB sebelum/sesudah).
 *
 * Pakai (dari root worktree):
 *   npx tsx scripts/evaluate-q0-baselines.ts \
 *     --data-dir=../app-football/data \
 *     --out=tasks/sprint-ab/evidence
 * Menghasilkan subdirektori q0-freq/, q0-naive/, q0-elo/ di bawah --out,
 * masing-masing berisi design.md, run-manifest.json, predictions.jsonl,
 * metrics.json, decision.json, run.log.
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
  outcomeIndex,
  summarizePredictions,
  type EvalFoldName,
  type EvalLogRow,
  type EvalMatchRow,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import {
  eloGapsSequential,
  eloMapProbs,
  fitEloMapper,
  fitNaivePoisson,
  leagueFrequencies,
  predictNaivePoisson,
  type Probs3,
} from "../lib/eval/q0-baselines";
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
const OUT_DIR = argVal("out", "tasks/sprint-ab/evidence");
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

/** Pemuatan data — query identik dengan CLI PR 4 (evaluate-kandidat-q1). */
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

type BaselineId = "freq" | "naive" | "elo";

interface RowOut {
  match: string;
  league: string;
  fold: EvalFoldName;
  date: string;
  week: string;
  hs: number;
  as: number;
  champP: Probs3;
  baseP: Probs3;
  champFallback: boolean;
  baseFallback: boolean;
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

  // Baris per lipatan per baseline + champion (satu generasi bersama).
  const rowsByFold = new Map<EvalFoldName, Map<BaselineId, RowOut[]>>();
  const champByFold = new Map<EvalFoldName, ScoredRow[]>();
  for (const fold of EVAL_FOLDS) {
    const perBase = new Map<BaselineId, RowOut[]>([
      ["freq", []],
      ["naive", []],
      ["elo", []],
    ]);
    const champRows: ScoredRow[] = [];
    for (const leagueId of leagueIds) {
      const { fit, train, test } = ev.foldFit(leagueId, fold, 10);
      if (fold.name === "H") {
        const fit20 = ev.foldFit(leagueId, fold, 20);
        if (!fit || !fit20.fit) continue;
      } else if (!fit) {
        continue;
      }
      const freqP = leagueFrequencies(train);
      const naiveModel = fitNaivePoisson(train);
      // Elo: sekuensial atas seluruh liga; mapper hanya dari irisan latih.
      const all = ev.leagueMatches(leagueId);
      const gaps = eloGapsSequential(all);
      const nTrain = Math.floor(all.length * fold.trainEnd);
      const mapper = fitEloMapper(
        gaps.slice(0, nTrain).map((g) => ({
          gap: g.gap,
          y: outcomeIndex(g.match.home_score, g.match.away_score),
        })),
      );
      const gapByMatchId = new Map(gaps.map((g) => [g.match.match_id, g.gap]));
      for (const m of test) {
        const pred = ev.predictLevelB(fit, m);
        const y = outcomeIndex(m.home_score, m.away_score);
        champRows.push({ p: pred.p, y, fallback: pred.fallback });
        const base: RowOut = {
          match: `${leagueId}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`,
          league: leagueId,
          fold: fold.name,
          date: m.utc_date.slice(0, 10),
          week: isoWeekKey(m.utc_date),
          hs: m.home_score,
          as: m.away_score,
          champP: pred.p,
          baseP: [0, 0, 0],
          champFallback: pred.fallback,
          baseFallback: false,
        };
        perBase.get("freq")!.push({ ...base, baseP: freqP });
        const np = predictNaivePoisson(naiveModel, m);
        perBase.get("naive")!.push({ ...base, baseP: np.p, baseFallback: np.fallback });
        const gap = gapByMatchId.get(m.match_id)!;
        perBase.get("elo")!.push({ ...base, baseP: eloMapProbs(mapper, gap) });
      }
    }
    rowsByFold.set(fold.name, perBase);
    champByFold.set(fold.name, champRows);
  }

  const champH = summarizePredictions(champByFold.get("H")!);
  const anchorOk = Math.abs(champH.logloss - LOCKED_CHAMPION_H_LL) < 1e-9;

  const guardAfter = guardSnapshot();
  const guardOk = JSON.stringify(guardBefore) === JSON.stringify(guardAfter);
  let gitHead: string | null = null;
  try {
    gitHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    gitHead = null;
  }

  const summaries: Record<string, unknown> = {};
  for (const baseId of ["freq", "naive", "elo"] as BaselineId[]) {
    const outDir = path.join(OUT_DIR, `q0-${baseId}`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync("tasks/sprint-ab/q0-design.md", path.join(outDir, "design.md"));

    const foldMetrics: Record<string, unknown> = {};
    for (const fold of EVAL_FOLDS) {
      const rows = rowsByFold.get(fold.name)!.get(baseId)!;
      const scored: ScoredRow[] = rows.map((r) => ({
        p: r.baseP,
        y: outcomeIndex(r.hs, r.as),
        fallback: r.baseFallback,
      }));
      foldMetrics[fold.name] = {
        baseline: summarizePredictions(scored),
        champion: summarizePredictions(
          rows.map((r) => ({ p: r.champP, y: outcomeIndex(r.hs, r.as), fallback: r.champFallback })),
        ),
      };
    }

    const rowsH = rowsByFold.get("H")!.get(baseId)!;
    const paired: PairedDeltaRow[] = rowsH.map((r) => {
      const y = outcomeIndex(r.hs, r.as);
      return { block: r.week, delta: logLossClamped(r.baseP, y) - logLossClamped(r.champP, y) };
    });
    const boot = blockBootstrapDelta(paired, { resamples: 5000, seed: BOOTSTRAP_SEED });
    const baseH = summarizePredictions(
      rowsH.map((r) => ({ p: r.baseP, y: outcomeIndex(r.hs, r.as), fallback: r.baseFallback })),
    );
    const gate = applyKappaDecision({
      meanDelta: boot.meanDelta,
      bootstrapUpperOneSided95: boot.upperOneSided95,
      coverageChampion: champH.coverage,
      coverageChallenger: baseH.coverage,
      brierChampion: champH.brier,
      brierChallenger: baseH.brier,
      nMatches: boot.nMatches,
      nBlocks: boot.nBlocks,
    });

    const metrics = {
      baseline: `q0-${baseId}`,
      universe: { leagues: leagueIds.length },
      folds: foldMetrics,
      holdout_h: {
        baseline: baseH,
        champion: champH,
        delta_baseline_minus_champion: baseH.logloss - champH.logloss,
        bootstrap: boot,
        gate_readout_not_a_candidate: gate,
        anchor_champion_ll_locked: LOCKED_CHAMPION_H_LL,
        anchor_ok: anchorOk,
      },
    };
    fs.writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2));
    fs.writeFileSync(
      path.join(outDir, "predictions.jsonl"),
      rowsH.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
    fs.writeFileSync(
      path.join(outDir, "decision.json"),
      JSON.stringify(
        {
          decision: "baseline_only",
          meaning:
            "Q0 adalah lantai pembanding (brief hal. 10) — bukan kandidat promosi; tidak ada gerbang yang dilalui atau gagal. Angka Δ vs champion menunjukkan jarak lantai ke champion pada holdout H yang sama.",
          headline: {
            n: boot.nMatches,
            blocks: boot.nBlocks,
            champion_logloss: champH.logloss,
            baseline_logloss: baseH.logloss,
            mean_delta: boot.meanDelta,
            bootstrap_upper_one_sided_95: boot.upperOneSided95,
            ci95: [boot.ci95Low, boot.ci95High],
            coverage_champion: champH.coverage,
            coverage_baseline: baseH.coverage,
            brier_champion: champH.brier,
            brier_baseline: baseH.brier,
          },
          promotion_performed: false,
        },
        null,
        2,
      ),
    );
    const manifest = {
      tool: "scripts/evaluate-q0-baselines.ts",
      candidate: `q0-${baseId}`,
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
        design_sha256: sha256File("tasks/sprint-ab/q0-design.md"),
      },
      config: { champion: CHAMPION_CONFIG, bootstrap: { resamples: 5000, seed: BOOTSTRAP_SEED } },
      anchors: { holdout_champion_ok: anchorOk },
      guard: { before: guardBefore, after: guardAfter, identical: guardOk },
    };
    fs.writeFileSync(path.join(outDir, "run-manifest.json"), JSON.stringify(manifest, null, 2));
    const summary = {
      baseline: `q0-${baseId}`,
      folds_n: Object.fromEntries(
        EVAL_FOLDS.map((f) => [f.name, rowsByFold.get(f.name)!.get(baseId)!.length]),
      ),
      holdout_h: {
        champion_ll: champH.logloss,
        baseline_ll: baseH.logloss,
        delta: boot.meanDelta,
        upper_one_sided_95: boot.upperOneSided95,
        baseline_brier: baseH.brier,
        champion_brier: champH.brier,
        anchor_ok: anchorOk,
      },
      guard_identical: guardOk,
    };
    fs.writeFileSync(path.join(outDir, "run.log"), JSON.stringify(summary, null, 2) + "\n");
    summaries[baseId] = summary;
  }

  console.log(JSON.stringify({ summaries, anchor_ok: anchorOk, guard_identical: guardOk }, null, 2));
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
