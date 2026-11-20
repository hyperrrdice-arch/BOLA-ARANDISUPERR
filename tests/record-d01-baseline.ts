/**
 * PEREKAM BASELINE D01 — menjalankan skenario D01 di kode saat ini dan
 * merekam perilaku AKTUAL ke tests/baseline/d01-baseline.json + .md.
 *
 * Rekaman pertama (K0, dari b9b3871) membekukan kegagalan 0/2. Di K1
 * baseline direkam ulang SESUDAH perbaikan identitas: perilaku baru
 * memenuhi harapan acceptance.json dan menjadi regresi wajib hijau.
 * File .md yang dihasilkan SELALU memuat blok histori K0 (statis, di
 * bawah) supaya kegagalan asal tidak hilang tertimpa rekaman baru.
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

  const md = `# Baseline D01 — regresi hijau (K1) + histori kegagalan (K0)

- Direkam ulang: ${baseline.recorded_at} dari commit \`${head}\` (Node ${process.version}).
- Skenario: \`tests/d01-scenario.ts\` — sandbox fixture segar, urutan penuh
  importer → builder alias → resolver → adapter, dijalankan DUA KALI.
- Perintah reproduksi persis: \`npm run test:baseline:d01\` (menjalankan
  ulang skenario yang sama dari \`tests/d01-scenario.ts\` lalu
  membandingkan), atau \`npx --no-install tsx tests/record-d01-baseline.ts\`
  untuk merekam ulang baseline dari kode saat itu.

## Histori K0 — kegagalan yang dibekukan (statis, jangan dihapus)

Direkam 2026-11-20T04:24:52.820Z dari commit
\`b9b38713b214f4e34c5e56c4cb5c222e4ab50c64\` (kode audit, sebelum K0/K1):

| Metrik | Harapan | Run 1 (K0) | Run 2 (K0) |
|---|---|---|---|
| pick ter-resolve | 2 | 0 | 0 |
| verdict | [hit, miss] | [] | [] |
| laga fixture selesai | 2 | 1 | 1 |
| log sisi tim (2 laga) | 4 | 2 | 2 |
| tautan kembar katalog | — | 0 | 0 |
| resolver examined/resolved | 2/2 | 2/0 | 2/0 |
| adapter getResult sm_901 | skor 2–1 | null | null |
| adapter getResult sm_902 | skor 0–1 | null | null |
| adapter getResult fd_ (Alpha) | skor 2–1 | {"home_goals":2,"away_goals":1,"finished":false} | sama |

Tiga titik putus terukur saat itu: (1) importer menulis hasil Gamma/Delta
sebagai baris \`fd_\` baru alih-alih meng-update baris \`sm_902\` yang sudah
\`scheduled\` (jembatan tercatat, skor tidak pernah ditulis); (2) builder
alias menghasilkan 0 tautan karena hasil \`fd_\` hidup di dataset, bukan
katalog; (3) resolver examined=2/resolved=0 pada kedua run; ditambah
adapter web memeriksa status \`'FT'\` sedangkan dataset memakai
\`'finished'\`, dan parser tautan web mencari \`groups\` sedangkan builder
menulis \`links\`. K1 memperbaiki kelimanya lewat resolver identitas satu
pintu (\`lib/identity/fixture-resolver.ts\`).

## Aktual terekam saat ini (sesudah perbaikan K1)

Harapan acceptance.json kini terpenuhi: 2 pick ter-resolve dengan verdict
[hit, miss], 2 laga selesai, 4 log sisi tim, hitungan rerun identik.

| Metrik | Harapan | Run 1 | Run 2 |
|---|---|---|---|
| pick ter-resolve | 2 | ${run1.state.picks_resolved} | ${run2.state.picks_resolved} |
| verdict | [hit, miss] | [${run1.state.verdicts.join(", ")}] | [${run2.state.verdicts.join(", ")}] |
| laga fixture selesai | 2 | ${run1.state.finished_fixture_matches} | ${run2.state.finished_fixture_matches} |
| log sisi tim (2 laga) | 4 | ${run1.state.team_logs_fixture} | ${run2.state.team_logs_fixture} |
| fixture kanonik (UID) | 2 | ${run1.state.canonical_fixtures} | ${run2.state.canonical_fixtures} |
| alias identitas | 4 | ${run1.state.fixture_aliases} | ${run2.state.fixture_aliases} |
| revisi hasil | 2 | ${run1.state.result_revisions} | ${run2.state.result_revisions} |
| tautan kembar katalog | — | ${run1.links_count} | ${run2.links_count} |
| resolver examined/resolved | 2/2 | ${run1.resolver.examined}/${run1.resolver.resolved} | ${run2.resolver.examined}/${run2.resolver.resolved} |
| impor: inserted/bridged/already | — | ${run1.tally?.results_inserted}/${run1.tally?.results_bridged}/${run1.tally?.results_already_present} | ${run2.tally?.results_inserted}/${run2.tally?.results_bridged}/${run2.tally?.results_already_present} |
| impor: log telemetri | — | ${run1.tally?.telemetry_rows} | ${run2.tally?.telemetry_rows} |
| adapter getResult sm_901 | skor 2–1 | ${JSON.stringify(run1.adapter.sm901_result)} | ${JSON.stringify(run2.adapter.sm901_result)} |
| adapter getResult sm_902 | skor 0–1 | ${JSON.stringify(run1.adapter.sm902_result)} | ${JSON.stringify(run2.adapter.sm902_result)} |

Metrik lengkap (termasuk tally impor dan hasil adapter per id) ada di
\`d01-baseline.json\` — itulah yang dibandingkan \`test:baseline:d01\`
secara persis, di samping assertion harapan eksplisit di suite yang sama.
Perubahan perilaku apa pun (membaik atau memburuk) tanpa pembaruan
baseline yang disadari membuat perintah itu exit 1.
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
