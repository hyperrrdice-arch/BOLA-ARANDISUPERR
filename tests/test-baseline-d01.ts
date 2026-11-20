/**
 * TEST:BASELINE:D01 — REGRESI WAJIB HIJAU D01 (sejak K1).
 *
 * Menjalankan skenario D01 segar dan menilai dua lapis:
 *  1. Harapan eksplisit acceptance.json: tepat 2 laga finished, verdict
 *     pick kandang [hit, miss], 4 log sisi tim, 2 UID / 4 alias / 2
 *     revisi identitas, adapter membaca skor yang benar dari semua id.
 *  2. Kesamaan persis dengan baseline terekam
 *     (tests/baseline/d01-baseline.json) — perilaku yang berubah tanpa
 *     pembaruan baseline yang disadari memerahkan suite ini.
 *
 * Di K0 suite ini membekukan kegagalan 0/2 sebagai baseline; histori itu
 * dipertahankan di tests/baseline/d01-baseline.md. Bukan skip, bukan
 * continue-on-error.
 *
 * Pakai: npm run test:baseline:d01
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, Suite, settleFixtureEnv } from "./helpers/fixture-env";
import { runD01Scenario, type D01RunMetrics } from "./d01-scenario";

async function main(): Promise<void> {
  const suite = new Suite("test:baseline:d01");

  const baselinePath = path.join(REPO_ROOT, "tests", "baseline", "d01-baseline.json");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as {
    recorded_from_commit: string;
    actual: { run1: D01RunMetrics; run2: D01RunMetrics };
  };
  console.log(`Baseline terekam dari commit ${baseline.recorded_from_commit}`);

  const { env, run1, run2 } = await runD01Scenario();

  // Lapis 1 — harapan eksplisit acceptance.json (import_replay).
  suite.eq("D01 harapan: 2 pick ter-resolve", run1.state.picks_resolved, 2);
  suite.eq("D01 harapan: verdict [hit, miss]", run1.state.verdicts, ["hit", "miss"]);
  suite.eq("D01 harapan: tepat 2 laga finished", run1.state.finished_fixture_matches, 2);
  suite.eq("D01 harapan: 4 log sisi tim", run1.state.team_logs_fixture, 4);
  suite.eq("D01 harapan: 2 fixture unik (UID)", run1.state.canonical_fixtures, 2);
  suite.eq("D01 harapan: 4 alias identitas", run1.state.fixture_aliases, 4);
  suite.eq("D01 harapan: 2 revisi hasil", run1.state.result_revisions, 2);
  suite.eq(
    "D01 harapan: adapter sm_901 membaca 2–1 finished",
    run1.adapter.sm901_result,
    { home_goals: 2, away_goals: 1, finished: true },
  );
  suite.eq(
    "D01 harapan: adapter sm_902 membaca 0–1 finished",
    run1.adapter.sm902_result,
    { home_goals: 0, away_goals: 1, finished: true },
  );

  // Lapis 2 — kesamaan persis dengan baseline terekam + idempotensi.
  suite.eq("D01 run 1: metrik identik dengan baseline terekam", run1, baseline.actual.run1);
  suite.eq("D01 run 2: metrik identik dengan baseline terekam", run2, baseline.actual.run2);
  suite.eq(
    "D01 idempoten: keadaan run 2 == keadaan run 1",
    run2.state,
    run1.state,
  );
  console.log(
    `Info baseline: resolved=${baseline.actual.run1.state.picks_resolved}/2, ` +
      `finished=${baseline.actual.run1.state.finished_fixture_matches}/2, ` +
      `logs=${baseline.actual.run1.state.team_logs_fixture}/4 ` +
      `(harapan acceptance.json: 2/2, 2/2, 4/4 — terpenuhi sejak K1)`,
  );

  settleFixtureEnv(env, suite.failedCount > 0);
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
