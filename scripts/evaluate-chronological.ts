/**
 * CLI EVALUATOR KRONOLOGIS TUNGGAL (PR 3).
 *
 * Dua mode pengukuran resmi:
 *
 *   k5-holdout        — konfigurasi K5: universe liga registry
 *                       (calibrated|partial, ≥120 laga), lipatan H,
 *                       Level A+B pada κ-fit 10 & 20. Menghasilkan
 *                       baris prediksi bentuk yang sama dengan
 *                       tasks/experiments/k5-kappa/predictions-h.jsonl
 *                       + perbandingan per-laga terhadap file itu.
 *
 *   closing-benchmark — set pasangan hasil dump scripts/closing-benchmark.ts
 *                       (CB_DUMP_PAIRS=1): probabilitas model dibuat ulang
 *                       untuk laga yang sama persis dalam dua mode —
 *                       "as-of" (point-in-time, jujur) dan "whole-store"
 *                       (replika kebocoran parlay-lab) — lalu log-loss
 *                       1X2/OU2.5 dibandingkan terhadap Pinnacle closing
 *                       dengan konvensi benchmark lama (−ln p, tanpa jepit).
 *
 * Semua keluaran ditulis ke direktori --out (default di bawah
 * tasks/pr3/evidence/). DB produksi hanya DIBACA (readOnly).
 *
 * Pakai (dari root repo):
 *   npx tsx scripts/evaluate-chronological.ts --mode=k5-holdout \
 *     --data-dir=/path/ke/data --out=tasks/pr3/evidence/k5-holdout \
 *     --compare=tasks/experiments/k5-kappa/predictions-h.jsonl
 *   npx tsx scripts/evaluate-chronological.ts --mode=closing-benchmark \
 *     --data-dir=/path/ke/data --pairs=/tmp/cb-pairs.json \
 *     --out=tasks/pr3/evidence/closing-benchmark
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
  logLossRaw,
  outcomeIndex,
  summarizePredictions,
  type ChronoEvalConfig,
  type EvalLogRow,
  type EvalMatchRow,
  type ScoredRow,
} from "../lib/eval/chronological-evaluator";
import { blockBootstrapDelta, type PairedDeltaRow } from "../lib/quant/experiment-stats";
import { dbDir } from "../lib/db/paths";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MODE = argVal("mode", "");
const DATA_DIR = argVal("data-dir", "data");
const EVAL_DB_DIR = argVal("data-dir", dbDir());
const OUT_DIR = argVal("out", "");
const BOOTSTRAP_SEED = 20261124;

function gitHead(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pemuatan data (query identik dengan harness K5)
// ---------------------------------------------------------------------------

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

function writeManifest(extra: Record<string, unknown>, config: ChronoEvalConfig, data: LoadedData): void {
  const manifest = {
    tool: "scripts/evaluate-chronological.ts",
    mode: MODE,
    git_head: gitHead(),
    generated_at: new Date().toISOString(),
    data_dir: path.resolve(DATA_DIR),
    dataset: { file: "thestats_dataset.db", size_bytes: data.datasetSize, mtime: data.datasetMtime },
    inputs: {
      universe_matches: data.universe.length,
      compavg_matches: data.compAvg.length,
      team_logs: data.logs.length,
      matches_hash: data.matchesHash,
      logs_hash: data.logsHash,
    },
    config,
    ...extra,
  };
  fs.writeFileSync(path.join(OUT_DIR, "run-manifest.json"), JSON.stringify(manifest, null, 2));
}

// ---------------------------------------------------------------------------
// Mode k5-holdout
// ---------------------------------------------------------------------------

interface HRowOut {
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

function runK5Holdout(data: LoadedData): void {
  const config: ChronoEvalConfig = { ...CHAMPION_CONFIG, compAvgMode: "as-of" };
  const ev = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, config);
  const H = EVAL_FOLDS.find((f) => f.name === "H")!;
  const MIN_MATCHES = 120;
  const leagueIds = ev
    .leagueIds()
    .filter((id) => {
      const st = data.registryStatus.get(id);
      return (st === "calibrated" || st === "partial") && ev.leagueMatches(id).length >= MIN_MATCHES;
    })
    .sort((a, b) => a.localeCompare(b));

  const rows: HRowOut[] = [];
  for (const leagueId of leagueIds) {
    const fit10 = ev.foldFit(leagueId, H, 10);
    const fit20 = ev.foldFit(leagueId, H, 20);
    if (!fit10.fit || !fit20.fit) continue;
    for (const m of fit10.test) {
      const a10 = ev.predictLevelA(fit10.fit, m);
      const b10 = ev.predictLevelB(fit10.fit, m);
      const a20 = ev.predictLevelA(fit20.fit, m);
      const b20 = ev.predictLevelB(fit20.fit, m);
      rows.push({
        match: `${leagueId}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`,
        league: leagueId,
        date: m.utc_date.slice(0, 10),
        week: isoWeekKey(m.utc_date),
        hs: m.home_score,
        as: m.away_score,
        A10: a10.p, A20: a20.p, B10: b10.p, B20: b20.p,
        fbA10: a10.fallback, fbA20: a20.fallback, fbB10: b10.fallback, fbB20: b20.fallback,
      });
    }
  }
  rows.sort((a, b) => (a.match < b.match ? -1 : a.match > b.match ? 1 : 0));

  const cols = ["A10", "A20", "B10", "B20"] as const;
  const metrics: Record<string, unknown> = {};
  for (const c of cols) {
    const scored: ScoredRow[] = rows.map((r) => ({ p: r[c], y: outcomeIndex(r.hs, r.as), fallback: r[`fb${c}` as const] }));
    metrics[c] = summarizePredictions(scored);
  }

  // Perbandingan terhadap artefak K5 yang dibekukan.
  let comparison: Record<string, unknown> | null = null;
  const comparePath = argVal("compare", "");
  if (comparePath && fs.existsSync(comparePath)) {
    const fileRows = new Map<string, HRowOut>();
    for (const line of fs.readFileSync(comparePath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as HRowOut;
      fileRows.set(r.match, r);
    }
    const perCol: Record<string, unknown> = {};
    for (const c of cols) {
      let matched = 0,
        maxDiff = 0,
        nDiff = 0;
      const fileScored: ScoredRow[] = [];
      const myScored: ScoredRow[] = [];
      for (const r of rows) {
        const f = fileRows.get(r.match);
        if (!f) continue;
        matched++;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(r[c][k] - f[c][k]);
          if (d > maxDiff) maxDiff = d;
          if (d > 1e-9) nDiff++;
        }
        fileScored.push({ p: f[c], y: outcomeIndex(f.hs, f.as) });
        myScored.push({ p: r[c], y: outcomeIndex(r.hs, r.as) });
      }
      perCol[c] = {
        matched,
        max_abs_prob_diff: maxDiff,
        prob_cells_diff_gt_1e_9: nDiff,
        logloss_file: summarizePredictions(fileScored).logloss,
        logloss_recomputed: summarizePredictions(myScored).logloss,
      };
    }
    comparison = {
      file: comparePath,
      file_rows: fileRows.size,
      recomputed_rows: rows.length,
      missing_in_recomputed: [...fileRows.keys()].filter((k) => !rows.some((r) => r.match === k)).length,
      per_column: perCol,
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "predictions-h-recomputed.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const out = {
    universe: { leagues: leagueIds.length, holdout_rows: rows.length, window: rows.length ? [rows.map((r) => r.date).sort()[0], rows.map((r) => r.date).sort()[rows.length - 1]] : null },
    metrics,
    comparison,
  };
  fs.writeFileSync(path.join(OUT_DIR, "k5-metrics.json"), JSON.stringify(out, null, 2));
  writeManifest({ run: "k5-holdout", leagues_in_scope: leagueIds.length }, config, data);
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// Mode closing-benchmark
// ---------------------------------------------------------------------------

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

function runClosingBenchmark(data: LoadedData): void {
  const pairsPath = argVal("pairs", "");
  if (!pairsPath) throw new Error("--pairs wajib diisi (dump CB_DUMP_PAIRS=1 dari scripts/closing-benchmark.ts)");
  const raw = JSON.parse(fs.readFileSync(pairsPath, "utf8")) as (Pair1x2 | PairOu)[];
  const pairs1x2 = raw.filter((p): p is Pair1x2 => p.market === "1x2");
  const pairsOu = raw.filter((p): p is PairOu => p.market === "ou25");

  const byId = new Map<string, EvalMatchRow>();
  for (const m of data.universe) byId.set(m.match_id, m);

  const evPit = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, { ...CHAMPION_CONFIG, compAvgMode: "as-of" });
  const evLeaky = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, { ...CHAMPION_CONFIG, compAvgMode: "whole-store" });

  interface RegenRow {
    matchId: string;
    div: string;
    season: string;
    league: string;
    date: string;
    week: string;
    fold: string | null;
    y: number;
    ledger: [number, number, number];
    leaky: [number, number, number];
    pit: [number, number, number];
    closing: [number, number, number];
    llLedger: number;
    llLeaky: number;
    llPit: number;
    llClosing: number;
    fitFallback: boolean;
  }
  const regen: RegenRow[] = [];
  let missing = 0;
  for (const pr of pairs1x2) {
    const m = byId.get(pr.matchId);
    if (!m) {
      missing++;
      continue;
    }
    const pit = evPit.predictMatchLevelB(m);
    const leaky = evLeaky.predictMatchLevelB(m);
    regen.push({
      matchId: pr.matchId,
      div: pr.div,
      season: pr.season,
      league: m.competition_id,
      date: m.utc_date.slice(0, 10),
      week: isoWeekKey(m.utc_date),
      fold: pit.fold,
      y: pr.actualIdx,
      ledger: pr.model,
      leaky: leaky.p,
      pit: pit.p,
      closing: pr.closing,
      llLedger: logLossRaw(pr.model, pr.actualIdx),
      llLeaky: logLossRaw(leaky.p, pr.actualIdx),
      llPit: logLossRaw(pit.p, pr.actualIdx),
      llClosing: logLossRaw(pr.closing, pr.actualIdx),
      fitFallback: pit.fitFallback,
    });
  }
  const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
  const pooled = {
    n: regen.length,
    missing_in_dataset: missing,
    window: regen.length ? [regen.map((r) => r.date).sort()[0], regen.map((r) => r.date).sort()[regen.length - 1]] : null,
    ll_ledger_old: mean(regen.map((r) => r.llLedger)),
    ll_leaky_regen: mean(regen.map((r) => r.llLeaky)),
    ll_pit_honest: mean(regen.map((r) => r.llPit)),
    ll_closing: mean(regen.map((r) => r.llClosing)),
    delta_old_reported: mean(regen.map((r) => r.llLedger)) - mean(regen.map((r) => r.llClosing)),
    delta_honest: mean(regen.map((r) => r.llPit)) - mean(regen.map((r) => r.llClosing)),
    leakage_effect_leaky_minus_pit: mean(regen.map((r) => r.llLeaky)) - mean(regen.map((r) => r.llPit)),
    residual_ledger_minus_leaky: mean(regen.map((r) => r.llLedger)) - mean(regen.map((r) => r.llLeaky)),
    fit_fallbacks: regen.filter((r) => r.fitFallback).length,
    mean_abs_prob_diff_ledger_vs_leaky: mean(regen.flatMap((r) => r.ledger.map((v, k) => Math.abs(v - r.leaky[k])))),
    mean_abs_prob_diff_ledger_vs_pit: mean(regen.flatMap((r) => r.ledger.map((v, k) => Math.abs(v - r.pit[k])))),
    mean_abs_fav_gap_pit: mean(
      regen.map((r) => {
        const fav = r.closing.indexOf(Math.max(...r.closing));
        return Math.abs(r.pit[fav] - r.closing[fav]);
      }),
    ),
  };
  const boot = (rows: PairedDeltaRow[]) => blockBootstrapDelta(rows, { resamples: 5000, seed: BOOTSTRAP_SEED });
  const bootstrap = {
    pit_minus_closing: boot(regen.map((r) => ({ block: r.week, delta: r.llPit - r.llClosing }))),
    leaky_minus_pit: boot(regen.map((r) => ({ block: r.week, delta: r.llLeaky - r.llPit }))),
    ledger_minus_leaky: boot(regen.map((r) => ({ block: r.week, delta: r.llLedger - r.llLeaky }))),
  };
  const perLeague: Record<string, unknown>[] = [];
  for (const div of [...new Set(regen.map((r) => r.div))].sort()) {
    const rs = regen.filter((r) => r.div === div);
    perLeague.push({
      div,
      n: rs.length,
      ll_ledger_old: mean(rs.map((r) => r.llLedger)),
      ll_pit_honest: mean(rs.map((r) => r.llPit)),
      ll_closing: mean(rs.map((r) => r.llClosing)),
      delta_honest: mean(rs.map((r) => r.llPit)) - mean(rs.map((r) => r.llClosing)),
    });
  }
  const byFold: Record<string, number> = {};
  for (const r of regen) byFold[r.fold ?? "null"] = (byFold[r.fold ?? "null"] ?? 0) + 1;
  const bySeason: Record<string, number> = {};
  for (const r of regen) bySeason[r.season] = (bySeason[r.season] ?? 0) + 1;

  // OU2.5 pada set pasangan OU (konvensi lama yang sama).
  interface OuRow {
    matchId: string;
    llLedger: number;
    llLeaky: number;
    llPit: number;
    llClosing: number;
  }
  const ouRows: OuRow[] = [];
  for (const pr of pairsOu) {
    const m = byId.get(pr.matchId);
    if (!m) continue;
    const pit = evPit.predictMatchLevelB(m);
    const leaky = evLeaky.predictMatchLevelB(m);
    const yOver = pr.actualOver;
    const ll = (pOver: number): number => -Math.log(yOver ? pOver : 1 - pOver);
    ouRows.push({
      matchId: pr.matchId,
      llLedger: ll(pr.modelOver),
      llLeaky: ll(leaky.pOver25),
      llPit: ll(pit.pOver25),
      llClosing: ll(pr.closingOver),
    });
  }
  const ou = {
    n: ouRows.length,
    ll_ledger_old: mean(ouRows.map((r) => r.llLedger)),
    ll_leaky_regen: mean(ouRows.map((r) => r.llLeaky)),
    ll_pit_honest: mean(ouRows.map((r) => r.llPit)),
    ll_closing: mean(ouRows.map((r) => r.llClosing)),
    delta_old_reported: mean(ouRows.map((r) => r.llLedger)) - mean(ouRows.map((r) => r.llClosing)),
    delta_honest: mean(ouRows.map((r) => r.llPit)) - mean(ouRows.map((r) => r.llClosing)),
    leakage_effect_leaky_minus_pit: mean(ouRows.map((r) => r.llLeaky)) - mean(ouRows.map((r) => r.llPit)),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-pairs-regenerated.jsonl"), regen.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const out = { pooled_1x2: pooled, bootstrap_1x2: bootstrap, per_league_1x2: perLeague, by_fold: byFold, by_season: bySeason, ou25: ou };
  fs.writeFileSync(path.join(OUT_DIR, "benchmark-metrics.json"), JSON.stringify(out, null, 2));
  writeManifest({ run: "closing-benchmark", modes: ["as-of", "whole-store"], pairs_file: pairsPath, pairs_1x2: pairs1x2.length, pairs_ou25: pairsOu.length }, CHAMPION_CONFIG, data);
  console.log(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------

function main(): void {
  if (!OUT_DIR) throw new Error("--out wajib diisi");
  const data = loadData();
  if (MODE === "k5-holdout") runK5Holdout(data);
  else if (MODE === "closing-benchmark") runClosingBenchmark(data);
  else throw new Error(`--mode tidak dikenal: "${MODE}" (pilihan: k5-holdout | closing-benchmark)`);
}

main();
