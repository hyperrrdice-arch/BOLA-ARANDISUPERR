/**
 * TEST:BASELINE:D01 — menjalankan skenario D01 segar dan MEMBANDINGKAN
 * metrik aktual terhadap baseline terekam (tests/baseline/d01-baseline.json).
 *
 * Exit 0 = perilaku masih persis sama dengan baseline (walaupun baseline
 * itu sendiri gagal memenuhi harapan acceptance.json — itulah gunanya
 * baseline K0). Exit 1 = perilaku berubah, membaik ATAU memburuk, tanpa
 * baseline diperbarui. Bukan skip, bukan continue-on-error.
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
      `(harapan acceptance.json: 2/2, 2/2, 4/4)`,
  );

  settleFixtureEnv(env, suite.failedCount > 0);
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
