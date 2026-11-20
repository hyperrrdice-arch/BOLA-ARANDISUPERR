/**
 * TEST:WEB — suite adapter web K0 (lib/web/data.ts) di atas DB fixture.
 *
 * Adapter adalah penerus hidup kontrak mapper lama (test-view-mapper.ts):
 * halaman membaca lewat lapis ini. Yang dinilai di sini hanya jalur yang
 * memang lulus di kode saat ini:
 *  - id tak dikenal → getMatchDetail/getResult mengembalikan null,
 *    BUKAN throw / 500 (definisi lulus U02);
 *  - detail laga berpaket menampilkan nama fixture dari payload paket dan
 *    pick ledger paket itu beserta verdict resolusinya;
 *  - getResult membaca skor baris dataset apa adanya;
 *  - ledgerStats menghitung total + resolved dari ledger fixture.
 *
 * Keadaan disiapkan lewat rantai nyata (importer → builder alias →
 * resolver) di sandbox jalur-hijau, lalu satu paket analisis fixture
 * ditautkan ke pick-nya.
 *
 * Pakai: npm run test:web
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";
import {
  GREEN_IDS,
  buildGreenSandbox,
  runProbe,
} from "./helpers/scenarios";

async function main(): Promise<void> {
  const suite = new Suite("test:web");

  const env = await buildGreenSandbox();

  // Rantai data nyata sampai pick ter-resolve (prasyarat keadaan web).
  for (const [script, args] of [
    ["scripts/import-free-feed.ts", ["--results", "--odds", "--divs=E0"]],
    ["scripts/build-fixture-links.ts", []],
    ["scripts/resolve-pick-outcomes.ts", []],
  ] as const) {
    const r = runScript(env, script, [...args]);
    suite.check(`rantai data: ${script} exit 0`, r.code === 0, `exit=${r.code}`);
  }

  // Tabel telemetri kanonik (dibangun build-canonical-telemetry di produksi;
  // di fixture dibuat kosong dengan kolom yang dipilih adapter).
  const ds = new DatabaseSync(path.join(env.dataDir, "thestats_dataset.db"));
  ds.exec(`
    CREATE TABLE IF NOT EXISTS team_match_logs_canonical (
      canonical_team_id TEXT, canonical_opponent_id TEXT, match_date TEXT,
      venue TEXT, goals_for INTEGER, goals_against INTEGER,
      xg_for REAL, xg_against REAL
    );
  `);
  ds.close();

  // Satu paket analisis fixture untuk sm_777 (skema oleh ensurePackagesSchema
  // saat buildCoreSchemas) + tautkan pick ledger ke paketnya.
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const payload = {
    fixture: {
      match_id: GREEN_IDS.sm,
      competition_name: "English Premier League",
      home: "Epsilon Rovers",
      away: "Zeta City",
      kickoff_utc: GREEN_IDS.kickoff,
    },
    gate_status: "partial",
    population: "domestic",
    lambda: 1.9,
    mu: 1.0,
    rho: -0.05,
    probabilities: { "1x2:1": 0.6, "1x2:x": 0.24, "1x2:2": 0.16 },
    top_scores: [],
    score_matrix: [[0.12]],
    market: null,
    sm_panel: null,
    legs: [
      {
        market: "1x2",
        selection: "1",
        model_prob: 0.6,
        effective_prob: 0.6,
        effective_source: "stated-fallback",
        band: null,
        band_n: null,
        grade: "A",
        market_prob: null,
        sm_prob: null,
        agreement_spread: null,
      },
    ],
  };
  const pkgRes = snap
    .prepare(
      `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc,
         computed_utc, trigger, fit_source, gate_status, payload_json)
       VALUES (?, 'E0', ?, '2026-11-18T10:05:00.000Z', 'manual', 'fixture', 'partial', ?)`,
    )
    .run(GREEN_IDS.sm, GREEN_IDS.kickoff, JSON.stringify(payload));
  snap.close();
  const packageId = Number(pkgRes.lastInsertRowid);
  const pk = new DatabaseSync(path.join(env.dataDir, "picks.db"));
  pk.prepare("UPDATE picks SET package_id = ? WHERE match_id = ?").run(packageId, GREEN_IDS.sm);
  pk.close();

  // Probe adapter sebenarnya sebagai subprocess di cwd sandbox.
  const probe = runProbe(env, [GREEN_IDS.sm, GREEN_IDS.fd, "tidak-dikenal-xyz"]);

  const unknown = probe.perId["tidak-dikenal-xyz"];
  suite.check(
    "adapter: id tak dikenal → detail null, bukan throw",
    unknown.detail === null && unknown.detailError === null,
    JSON.stringify(unknown),
  );
  suite.check(
    "adapter: id tak dikenal → result null, bukan throw",
    unknown.result === null && unknown.resultError === null,
    JSON.stringify(unknown),
  );

  const detail = probe.perId[GREEN_IDS.sm].detail;
  suite.check("adapter: detail sm_777 ditemukan", detail !== null, JSON.stringify(probe.perId[GREEN_IDS.sm]));
  if (detail) {
    suite.eq("adapter: nama kandang dari payload paket", detail.home, "Epsilon Rovers");
    suite.eq("adapter: nama tamu dari payload paket", detail.away, "Zeta City");
    suite.eq("adapter: tepat 1 pick ledger pada paket", detail.picks.length, 1);
    suite.eq(
      "adapter: pick terbaca beserta verdict hit-nya",
      detail.picks[0] ?? null,
      { market: "1x2", selection: "1", hit: 1 },
    );
  }

  const fdResult = probe.perId[GREEN_IDS.fd].result;
  suite.check(
    "adapter: getResult baris fd_ membaca skor 3–1",
    fdResult !== null && fdResult.home_goals === 3 && fdResult.away_goals === 1,
    JSON.stringify(fdResult),
  );

  suite.eq(
    "adapter: ledgerStats live_total/live_resolved dari fixture",
    probe.stats,
    { lab_total: 0, live_total: 1, live_resolved: 1 },
  );

  settleFixtureEnv(env, suite.failedCount > 0);
    suite.finish();
  }

  main().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
