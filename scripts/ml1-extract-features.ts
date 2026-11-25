/**
 * CLI EKSTRAKSI FITUR ML1 (Fase 1 — shadow murni).
 *
 * Memuat data persis seperti CLI PR 3/PR 4 (query identik), menghitung
 * prediksi Level B champion untuk baris uji V1/V2/H di universe PR 3
 * penuh, dan mengekstrak fitur ML1-A/ML1-B per baris (design
 * tasks/ml1/design.md). DB produksi hanya DIBACA (readOnly); satu-satunya
 * tulisan adalah berkas fitur + manifest di direktori --out.
 *
 * Penjaga isolasi pola PR 4: sha256 berkas saji + ukuran/mtime DB dicatat
 * sebelum/sesudah dan harus identik (dilaporkan di manifest).
 *
 * Pakai:
 *   npx tsx scripts/ml1-extract-features.ts \
 *     --data-dir=data --out=tasks/ml1/evidence/features.jsonl
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
  type EvalFoldName,
  type EvalLogRow,
  type EvalMatchRow,
} from "../lib/eval/chronological-evaluator";
import {
  ML1_A_FEATURE_NAMES,
  ML1_B_FEATURE_NAMES,
  Ml1FeatureExtractor,
  type Ml1CanonicalLogRow,
} from "../lib/eval/ml1-features";

const args = process.argv.slice(2);
const argVal = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DATA_DIR = argVal("data-dir", "data");
const OUT = argVal("out", "tasks/ml1/evidence/features.jsonl");
const MANIFEST_OUT = argVal("manifest-out", "tasks/ml1/evidence/features-manifest.json");

const sha256File = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function guardSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  const manifestPath = path.join(DATA_DIR, "model-manifest.json");
  if (fs.existsSync(manifestPath)) snap["model-manifest.json"] = { sha256: sha256File(manifestPath) };
  const ratingsPath = path.join(DATA_DIR, "calibrated_ratings.json");
  if (fs.existsSync(ratingsPath)) snap["calibrated_ratings.json"] = { sha256: sha256File(ratingsPath) };
  for (const db of ["picks.db", "analysis_snapshots.db", "thestats_dataset.db"]) {
    const p = path.join(DATA_DIR, db);
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
  canonicalLogs: Ml1CanonicalLogRow[];
  registryStatus: Map<string, string>;
  seasonByMatchId: Map<string, string>;
  matchesHash: string;
  logsHash: string;
  canonicalHash: string;
  datasetSize: number;
  datasetMtime: string;
}

function loadData(): LoadedData {
  const datasetPath = path.join(DATA_DIR, "thestats_dataset.db");
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
  const canonicalLogs = ds
    .prepare(
      `SELECT team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against
       FROM team_match_logs_canonical ORDER BY team_id, match_date`,
    )
    .all() as unknown as Ml1CanonicalLogRow[];
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
  const ch = createHash("sha256");
  const canonByTeam = new Map<string, Ml1CanonicalLogRow[]>();
  for (const l of canonicalLogs) {
    const arr = canonByTeam.get(l.team_id) ?? [];
    arr.push(l);
    canonByTeam.set(l.team_id, arr);
  }
  for (const [team, arr] of [...canonByTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const l of arr) ch.update(`${team}|${l.match_date}|${l.shots_for}|${l.shots_against}|${l.shots_on_target_for}|${l.shots_on_target_against}\n`);
  }
  const stat = fs.statSync(datasetPath);
  return {
    universe, compAvg, logs, canonicalLogs, registryStatus, seasonByMatchId,
    matchesHash: `sha256:${mh.digest("hex")}`,
    logsHash: `sha256:${lh.digest("hex")}`,
    canonicalHash: `sha256:${ch.digest("hex")}`,
    datasetSize: stat.size,
    datasetMtime: stat.mtime.toISOString(),
  };
}

export interface Ml1FeatureRow {
  match: string;
  league: string;
  fold: EvalFoldName;
  date: string;
  week: string;
  hs: number;
  as: number;
  status: string | null;
  champLam: number;
  champMu: number;
  champP: [number, number, number];
  champOver: number;
  champFallback: boolean;
  featA: number[];
  featB: number[];
}

function main(): void {
  const guardBefore = guardSnapshot();
  const data = loadData();
  const ev = new ChronologicalEvaluator(data.universe, data.compAvg, data.logs, { ...CHAMPION_CONFIG, compAvgMode: "as-of" });
  const extractor = new Ml1FeatureExtractor(data.universe, data.compAvg, data.seasonByMatchId, data.canonicalLogs);

  const rows: Ml1FeatureRow[] = [];
  const excluded: { league: string; fold: string }[] = [];
  for (const fold of EVAL_FOLDS) {
    for (const leagueId of ev.leagueIds()) {
      // Liga mungil (n kecil): irisan uji bisa kosong — lewati tanpa memanggil
      // foldFit (foldSlice evaluator mengasumsikan train/test tak kosong;
      // universe K5 PR 4 tak pernah menabrak ini karena >=120 laga/liga).
      const nLeague = ev.leagueMatches(leagueId).length;
      const testN = Math.floor(nLeague * fold.testEnd) - Math.floor(nLeague * fold.testStart);
      if (testN <= 0) continue;
      const { fit, test } = ev.foldFit(leagueId, fold, 10);
      if (!fit) {
        if (test.length > 0) excluded.push({ league: leagueId, fold: fold.name });
        continue;
      }
      for (const m of test) {
        const pred = ev.predictLevelB(fit, m);
        rows.push({
          match: `${leagueId}|${m.utc_date}|${m.home_team_id}|${m.away_team_id}`,
          league: leagueId,
          fold: fold.name,
          date: m.utc_date.slice(0, 10),
          week: isoWeekKey(m.utc_date),
          hs: m.home_score,
          as: m.away_score,
          status: data.registryStatus.get(leagueId) ?? null,
          champLam: pred.lam,
          champMu: pred.mu,
          champP: pred.p,
          champOver: pred.pOver25,
          champFallback: pred.fallback,
          featA: extractor.featuresA(m),
          featB: extractor.featuresB(m),
        });
      }
    }
  }
  const foldOrder: Record<string, number> = { V1: 0, V2: 1, H: 2 };
  rows.sort((a, b) => foldOrder[a.fold] - foldOrder[b.fold] || (a.match < b.match ? -1 : a.match > b.match ? 1 : 0));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(OUT, body);
  const featuresSha = createHash("sha256").update(body).digest("hex");

  const guardAfter = guardSnapshot();
  const guardOk = JSON.stringify(guardBefore) === JSON.stringify(guardAfter);
  let gitHead: string | null = null;
  try {
    gitHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    gitHead = null;
  }
  const perFold: Record<string, number> = {};
  for (const r of rows) perFold[r.fold] = (perFold[r.fold] ?? 0) + 1;
  const manifest = {
    tool: "scripts/ml1-extract-features.ts",
    git_head: gitHead,
    generated_at: new Date().toISOString(),
    data_dir: path.resolve(DATA_DIR),
    dataset: { file: "thestats_dataset.db", size_bytes: data.datasetSize, mtime: data.datasetMtime },
    inputs: {
      universe_matches: data.universe.length,
      compavg_matches: data.compAvg.length,
      team_logs: data.logs.length,
      canonical_logs: data.canonicalLogs.length,
      matches_hash: data.matchesHash,
      logs_hash: data.logsHash,
      canonical_logs_hash: data.canonicalHash,
    },
    config: { champion: CHAMPION_CONFIG },
    features: {
      file: OUT,
      sha256: featuresSha,
      rows: rows.length,
      rows_per_fold: perFold,
      columns_a: ML1_A_FEATURE_NAMES,
      columns_b: ML1_B_FEATURE_NAMES,
      excluded_league_folds_fit_null: excluded,
    },
    guard: { before: guardBefore, after: guardAfter, identical: guardOk },
  };
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ rows: rows.length, rows_per_fold: perFold, features_sha256: featuresSha, excluded_league_folds: excluded.length, guard_identical: guardOk }, null, 2));
  if (!guardOk) {
    console.error("PERINGATAN PENJAGA: berkas saji/DB berubah selama ekstraksi — isolasi shadow GAGAL.");
    process.exitCode = 3;
  }
}

main();
