/**
 * TEST:E2E — pipa mini ujung-ke-ujung K0 di sandbox fixture:
 *   impor CSV fixture → build-fixture-links → resolve-pick-outcomes →
 *   adapter halaman (lib/web/data.ts).
 *
 * Memakai skenario jalur-hijau yang sama dengan test:data; di sini yang
 * dinilai adalah sambungan antar-langkahnya sampai yang bisa dibaca
 * halaman: pick ter-resolve hit di ledger dan skornya terbaca adapter.
 *
 * Pakai: npm run test:e2e
 */
import {
  Suite,
  openRo,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import {
  GREEN_IDS,
  buildGreenSandbox,
  runProbe,
} from "./helpers/scenarios";

async function main(): Promise<void> {
  const suite = new Suite("test:e2e");

  const env = await buildGreenSandbox();

  const imp = runScript(env, "scripts/import-free-feed.ts", [
    "--results",
    "--odds",
    "--divs=E0",
  ]);
  suite.check("e2e impor: exit 0", imp.code === 0, `exit=${imp.code} ${imp.stderr.slice(0, 200)}`);

  const links = runScript(env, "scripts/build-fixture-links.ts");
  suite.check("e2e builder alias: exit 0", links.code === 0, `exit=${links.code}`);

  const res = runScript(env, "scripts/resolve-pick-outcomes.ts");
  suite.check(
    "e2e resolver: exit 0 + resolved 1",
    res.code === 0 && res.stdout.includes("resolved: 1"),
    res.stdout.trim(),
  );

  const picksDb = openRo(env, "picks.db");
  const outcome = picksDb
    .prepare(
      `SELECT o.home_goals AS hg, o.away_goals AS ag, o.hit AS hit
       FROM pick_outcomes o JOIN picks p ON p.id = o.pick_id WHERE p.match_id = ?`,
    )
    .get(GREEN_IDS.sm) as { hg: number; ag: number; hit: number } | undefined;
  picksDb.close();
  suite.eq("e2e ledger: pick sm_777 ter-resolve 3–1 hit", outcome ?? null, {
    hg: 3,
    ag: 1,
    hit: 1,
  });

  const probe = runProbe(env, [GREEN_IDS.fd, "tidak-dikenal-xyz"]);
  const fdResult = probe.perId[GREEN_IDS.fd].result;
  suite.check(
    "e2e adapter: skor laga terbaca dari baris hasil fd_ (3–1)",
    fdResult !== null && fdResult.home_goals === 3 && fdResult.away_goals === 1,
    JSON.stringify(fdResult),
  );
  suite.check(
    "e2e adapter: id tak dikenal → null, bukan throw",
    probe.perId["tidak-dikenal-xyz"].detail === null &&
      probe.perId["tidak-dikenal-xyz"].detailError === null &&
      probe.perId["tidak-dikenal-xyz"].result === null,
  );
  suite.eq("e2e adapter: ledgerStats live_resolved = 1", probe.stats, {
    lab_total: 0,
    live_total: 1,
    live_resolved: 1,
  });

  settleFixtureEnv(env, suite.failedCount > 0);
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
