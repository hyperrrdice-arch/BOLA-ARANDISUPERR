/**
 * PEREKAM BASELINE D01 — menjalankan skenario D01 di kode saat ini dan
 * merekam perilaku AKTUAL ke tests/baseline/d01-baseline.json + .md.
 *
 * Baseline ini sengaja merekam perilaku apa adanya (di kode audit: 0/2
 * ter-resolve). test:baseline:d01 membandingkan perilaku terhadap rekaman
 * ini; K1 yang mengubah D01 menjadi regresi hijau dan memperbarui
 * baseline ini dengan sadar.
 *
 * Pakai: npx --no-install tsx tests/record-d01-baseline.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, settleFixtureEnv } from "./helpers/fixture-env";
import { runD01Scenario } from "./d01-scenario";

const EXPECTED = {
  resolved_picks: 2,
  verdicts: ["hit", "miss"],
  finished_matches: 2,
  team_logs_if_telemetry_supplied: 4,
  unique_fixtures: 2,
};

async function main(): Promise<void> {
  const { env, run1, run2 } = await runD01Scenario();
  const head = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const baseline = {
    test_id: "D01",
    source_fixture: "docs/plans/peningkatan-aplikasi-bola/fixtures/acceptance.json (blok import_replay)",
    recorded_at: new Date().toISOString(),
    recorded_from_commit: head,
    node: process.version,
    expected: EXPECTED,
    actual: { run1, run2 },
  };
  const dir = path.join(REPO_ROOT, "tests", "baseline");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "d01-baseline.json"), JSON.stringify(baseline, null, 2));

  const md = `# Baseline D01 — perilaku aktual terekam (K0)

- Direkam: ${baseline.recorded_at} dari commit \`${head}\` (Node ${process.version}).
- Skenario: \`tests/d01-scenario.ts\` — sandbox fixture segar, urutan penuh
  importer → builder alias → resolver → adapter, dijalankan DUA KALI.
- Perintah reproduksi persis: \`npm run test:baseline:d01\` (menjalankan
  ulang skenario yang sama dari \`tests/d01-scenario.ts\` lalu
  membandingkan), atau \`npx --no-install tsx tests/record-d01-baseline.ts\`
  untuk merekam ulang baseline dari kode saat itu.

## Harapan acceptance.json (belum terpenuhi di baseline ini)

- 2 pick ter-resolve, verdict [hit, miss]
- 2 laga selesai (finished + skor)
- 4 log sisi tim (telemetri tersedia di CSV fixture)
- hitungan rerun identik

## Aktual terekam

| Metrik | Harapan | Run 1 | Run 2 |
|---|---|---|---|
| pick ter-resolve | 2 | ${run1.state.picks_resolved} | ${run2.state.picks_resolved} |
| verdict | [hit, miss] | [${run1.state.verdicts.join(", ")}] | [${run2.state.verdicts.join(", ")}] |
| laga fixture selesai | 2 | ${run1.state.finished_fixture_matches} | ${run2.state.finished_fixture_matches} |
| log sisi tim (2 laga) | 4 | ${run1.state.team_logs_fixture} | ${run2.state.team_logs_fixture} |
| tautan kembar katalog | — | ${run1.links_count} | ${run2.links_count} |
| resolver examined/resolved | 2/2 | ${run1.resolver.examined}/${run1.resolver.resolved} | ${run2.resolver.examined}/${run2.resolver.resolved} |
| impor: inserted/bridged/already | — | ${run1.tally?.results_inserted}/${run1.tally?.results_bridged}/${run1.tally?.results_already_present} | ${run2.tally?.results_inserted}/${run2.tally?.results_bridged}/${run2.tally?.results_already_present} |
| impor: log telemetri | — | ${run1.tally?.telemetry_rows} | ${run2.tally?.telemetry_rows} |
| adapter getResult sm_901 | skor 2–1 | ${JSON.stringify(run1.adapter.sm901_result)} | ${JSON.stringify(run2.adapter.sm901_result)} |
| adapter getResult sm_902 | skor 0–1 | ${JSON.stringify(run1.adapter.sm902_result)} | ${JSON.stringify(run2.adapter.sm902_result)} |

Metrik lengkap (termasuk tally impor dan hasil adapter per id) ada di
\`d01-baseline.json\` — itulah yang dibandingkan \`test:baseline:d01\`
secara persis. Perubahan perilaku apa pun (membaik atau memburuk) tanpa
pembaruan baseline yang disadari membuat perintah itu exit 1.
`;
  fs.writeFileSync(path.join(dir, "d01-baseline.md"), md);
  settleFixtureEnv(env, false);
  console.log(`Baseline D01 terekam dari ${head}`);
  console.log(
    `run1: resolved=${run1.state.picks_resolved} finished=${run1.state.finished_fixture_matches} logs=${run1.state.team_logs_fixture} links=${run1.links_count}`,
  );
  console.log(
    `run2: resolved=${run2.state.picks_resolved} finished=${run2.state.finished_fixture_matches} logs=${run2.state.team_logs_fixture} links=${run2.links_count}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
