/**
 * SKENARIO D01 — menjalankan SELURUH urutan D01 dua kali di sandbox segar
 * dan mengembalikan metrik keadaan yang terukur (tanpa timestamp):
 *
 *   importer sebenarnya (semua bagian, divisi E0)
 *   → scripts/build-fixture-links.ts
 *   → scripts/resolve-pick-outcomes.ts
 *   → adapter lib/web/data.ts (lewat web-probe)
 *
 * Dipakai bersama oleh perekam baseline (record-d01-baseline.ts) dan
 * pembanding baseline (test-baseline-d01.ts). Bug D01 TIDAK diperbaiki di
 * K0 — perilaku aktual apa pun yang terukur di sini menjadi baseline.
 */
import {
  openRo,
  runScript,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  D01_IDS,
  buildD01Sandbox,
  readSandboxJson,
  runProbe,
} from "./helpers/scenarios";

export interface D01RunMetrics {
  tally: {
    results_inserted: number;
    results_bridged: number;
    results_already_present: number;
    telemetry_rows: number;
    closing_odds_written: number;
    fixtures_inserted: number;
    fixtures_bridged: number;
    fixtures_already_present: number;
  } | null;
  links_count: number;
  resolver: { examined: number; resolved: number };
  state: {
    dataset_matches_total: number;
    finished_fixture_matches: number;
    team_logs_fixture: number;
    odds_rows: number;
    picks_resolved: number;
    verdicts: string[];
  };
  adapter: {
    sm901_result: unknown;
    fd_alpha_result: unknown;
    sm902_result: unknown;
    unknown_detail: string;
  };
}

function parseResolver(stdout: string): { examined: number; resolved: number } {
  const ex = /examined: (\d+)/.exec(stdout);
  const rs = /resolved: (\d+)/.exec(stdout);
  return {
    examined: ex ? Number(ex[1]) : -1,
    resolved: rs ? Number(rs[1]) : -1,
  };
}

function measureState(env: FixtureEnv): D01RunMetrics["state"] {
  const ds = openRo(env, "thestats_dataset.db");
  const one = (sql: string, ...p: string[]) =>
    (ds.prepare(sql).get(...p) as { n: number }).n;
  const state = {
    dataset_matches_total: one("SELECT COUNT(*) AS n FROM matches"),
    finished_fixture_matches: one(
      `SELECT COUNT(*) AS n FROM matches
       WHERE match_id IN (?, ?) AND status = 'finished' AND home_score IS NOT NULL`,
      D01_IDS.fdAlpha,
      D01_IDS.sm902,
    ),
    team_logs_fixture: one(
      "SELECT COUNT(*) AS n FROM team_match_logs WHERE match_id IN (?, ?)",
      D01_IDS.fdAlpha,
      D01_IDS.sm902,
    ),
    odds_rows: one("SELECT COUNT(*) AS n FROM match_odds_history"),
  };
  ds.close();
  const pk = openRo(env, "picks.db");
  const verdictRows = pk
    .prepare("SELECT hit FROM pick_outcomes ORDER BY pick_id ASC")
    .all() as unknown as { hit: number }[];
  pk.close();
  return {
    ...state,
    picks_resolved: verdictRows.length,
    verdicts: verdictRows.map((r) => (r.hit === 1 ? "hit" : "miss")),
  };
}

function runOnce(env: FixtureEnv): D01RunMetrics {
  const imp = runScript(env, "scripts/import-free-feed.ts", ["--divs=E0"]);
  if (imp.code !== 0) {
    throw new Error(`importer gagal (exit=${imp.code}): ${imp.stderr.slice(0, 400)}`);
  }
  const tallyLine = imp.stdout.split("\n").find((l) => l.startsWith("TALLY "));
  let tally: D01RunMetrics["tally"] = null;
  if (tallyLine) {
    const t = JSON.parse(tallyLine.slice("TALLY ".length)) as Record<string, number>;
    tally = {
      results_inserted: t.results_inserted,
      results_bridged: t.results_bridged,
      results_already_present: t.results_already_present,
      telemetry_rows: t.telemetry_rows,
      closing_odds_written: t.closing_odds_written,
      fixtures_inserted: t.fixtures_inserted,
      fixtures_bridged: t.fixtures_bridged,
      fixtures_already_present: t.fixtures_already_present,
    };
  }

  const lnk = runScript(env, "scripts/build-fixture-links.ts");
  if (lnk.code !== 0) {
    throw new Error(`builder alias gagal (exit=${lnk.code}): ${lnk.stderr.slice(0, 400)}`);
  }
  const linksFile = readSandboxJson<{ links: unknown[] }>(env, "fixture-links.json");

  const res = runScript(env, "scripts/resolve-pick-outcomes.ts");
  if (res.code !== 0) {
    throw new Error(`resolver gagal (exit=${res.code}): ${res.stderr.slice(0, 400)}`);
  }

  const probe = runProbe(env, [
    D01_IDS.sm901,
    D01_IDS.fdAlpha,
    D01_IDS.sm902,
    "tidak-dikenal-xyz",
  ]);

  return {
    tally,
    links_count: linksFile.links.length,
    resolver: parseResolver(res.stdout),
    state: measureState(env),
    adapter: {
      sm901_result: probe.perId[D01_IDS.sm901].result,
      fd_alpha_result: probe.perId[D01_IDS.fdAlpha].result,
      sm902_result: probe.perId[D01_IDS.sm902].result,
      unknown_detail:
        probe.perId["tidak-dikenal-xyz"].detailError !== null
          ? "error"
          : probe.perId["tidak-dikenal-xyz"].detail === null
            ? "null"
            : "object",
    },
  };
}

export interface D01ScenarioResult {
  env: FixtureEnv;
  run1: D01RunMetrics;
  run2: D01RunMetrics;
}

/** Bangun sandbox D01 segar dan jalankan seluruh urutan dua kali. */
export async function runD01Scenario(): Promise<D01ScenarioResult> {
  const env = await buildD01Sandbox();
  const run1 = runOnce(env);
  const run2 = runOnce(env);
  return { env, run1, run2 };
}
