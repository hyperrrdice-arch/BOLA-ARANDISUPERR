/**
 * TEST:DATA — suite data K0, kasus jalur-hijau di kode saat ini.
 *
 * Kasus kembar katalog (BUKAN D01): katalog upcoming memuat baris sm_777
 * dan kembar fd_-nya untuk laga fisik yang sama; pick live-run di sm_777;
 * hasil CSV E0 tiba. Rantai sebenarnya — importer → builder alias →
 * resolver — harus menautkan hasil fd_ ke pick sm_ lewat jembatan kembar
 * dan menilainya hit. Rerun tidak boleh mengubah apa pun (idempoten).
 *
 * Pakai: npm run test:data
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
  readSandboxJson,
} from "./helpers/scenarios";

async function main(): Promise<void> {
  const suite = new Suite("test:data");

  const env = await buildGreenSandbox();

  // --- Langkah 1: impor hasil CSV (bagian results+odds; fixture katalog
  // sudah ter-seed sebagai keadaan setelah impor fixture sebelumnya).
  const imp = runScript(env, "scripts/import-free-feed.ts", [
    "--results",
    "--odds",
    "--divs=E0",
  ]);
  console.log(imp.stdout.trimEnd());
  suite.check("importer: exit 0", imp.code === 0, `exit=${imp.code} ${imp.stderr.slice(0, 300)}`);
  const tallyLine = imp.stdout.split("\n").find((l) => l.startsWith("TALLY "));
  suite.check("importer: baris TALLY terbit", tallyLine !== undefined);
  if (tallyLine) {
    const tally = JSON.parse(tallyLine.slice("TALLY ".length)) as {
      results_inserted: number;
      telemetry_rows: number;
    };
    suite.eq("importer: tepat 1 hasil baru masuk dataset", tally.results_inserted, 1);
    suite.eq("importer: 2 log telemetri sisi tim tertulis", tally.telemetry_rows, 2);
  }

  // --- Langkah 2: builder alias katalog.
  const links = runScript(env, "scripts/build-fixture-links.ts");
  console.log(links.stdout.trimEnd());
  suite.check("builder alias: exit 0", links.code === 0, `exit=${links.code}`);
  const linksFile = readSandboxJson<{
    links: { twin_id: string; canonical_id: string }[];
    stats: { fixtures: number };
  }>(env, "fixture-links.json");
  suite.eq("builder alias: katalog memuat 2 baris fixture", linksFile.stats.fixtures, 2);
  suite.eq("builder alias: tepat 1 tautan kembar", linksFile.links.length, 1);
  suite.eq(
    "builder alias: kembar fd_ menunjuk kanonik sm_",
    linksFile.links[0] ?? null,
    { twin_id: GREEN_IDS.fd, canonical_id: GREEN_IDS.sm, kickoff_utc: GREEN_IDS.kickoff },
  );

  // --- Langkah 3: resolver.
  const res1 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  console.log(res1.stdout.trimEnd());
  suite.check("resolver: exit 0", res1.code === 0, `exit=${res1.code}`);
  suite.check("resolver: examined 1", res1.stdout.includes("examined: 1"));
  suite.check("resolver: resolved 1", res1.stdout.includes("resolved: 1"));

  const picksDb = openRo(env, "picks.db");
  const outcome = picksDb
    .prepare(
      `SELECT o.home_goals AS hg, o.away_goals AS ag, o.hit AS hit
       FROM pick_outcomes o JOIN picks p ON p.id = o.pick_id
       WHERE p.match_id = ?`,
    )
    .get(GREEN_IDS.sm) as { hg: number; ag: number; hit: number } | undefined;
  picksDb.close();
  suite.eq(
    "ledger: outcome pick sm_777 = skor 3–1, hit",
    outcome ?? null,
    { hg: 3, ag: 1, hit: 1 },
  );

  // --- Idempotensi: impor + resolver sekali lagi, tidak ada yang berubah.
  const imp2 = runScript(env, "scripts/import-free-feed.ts", [
    "--results",
    "--odds",
    "--divs=E0",
  ]);
  const tally2Line = imp2.stdout.split("\n").find((l) => l.startsWith("TALLY "));
  suite.check("importer rerun: exit 0 + TALLY", imp2.code === 0 && tally2Line !== undefined);
  if (tally2Line) {
    const tally2 = JSON.parse(tally2Line.slice("TALLY ".length)) as {
      results_inserted: number;
      results_already_present: number;
    };
    suite.eq("importer rerun: 0 hasil baru", tally2.results_inserted, 0);
    suite.eq("importer rerun: 1 hasil dinyatakan sudah ada", tally2.results_already_present, 1);
  }
  const res2 = runScript(env, "scripts/resolve-pick-outcomes.ts");
  suite.check(
    "resolver rerun: resolved 0 (idempoten)",
    res2.code === 0 && res2.stdout.includes("resolved: 0"),
    res2.stdout.trim(),
  );

  const dsDb = openRo(env, "thestats_dataset.db");
  const matchCount = (
    dsDb.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number }
  ).n;
  const logCount = (
    dsDb.prepare("SELECT COUNT(*) AS n FROM team_match_logs").get() as { n: number }
  ).n;
  dsDb.close();
  suite.eq("dataset: tetap tepat 1 baris laga", matchCount, 1);
  suite.eq("dataset: tetap tepat 2 log telemetri", logCount, 2);
  settleFixtureEnv(env, suite.failedCount > 0);
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
