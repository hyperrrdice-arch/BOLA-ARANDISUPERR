/**
 * TEST:KOREKSI-KICKOFF — PR koreksi kickoff Jadwal (brief 2026-11-28,
 * audit produksi §3). Dua kegagalan yang direproduksi:
 *
 *  1. Importer lupa mengubah katalog: impor fixture E0 15:00 UTC lalu
 *     CSV direvisi ke 18:00 UTC — canonical_fixtures.kickoff_utc pindah
 *     (resolver alias dikenal) tetapi upcoming_fixtures.utc_date dan
 *     Jadwal tetap 15:00. Koreksi harus menggerakkan KEDUA store lewat
 *     cabang fixture-yang-sudah-ada, dengan guard otoritas (jam CSV
 *     eksplisit valid, UID terverifikasi, status non-terminal, tanpa
 *     konflik anchor sumber lain) yang berjalan SEBELUM resolver.
 *  2. Paket lama memunculkan laga pada tanggal lama: katalog sudah
 *     18:00 UTC (= 01:00 WIB hari berikutnya) dan paket beku 15:00 UTC
 *     (= 22:00 WIB hari yang sama) — listSchedule menampilkan laga di
 *     DUA jendela tanggal WIB. Katalog adalah sumber waktu + keanggotaan
 *     jendela: laga tampil sekali, di jendela katalog, jam katalog.
 *
 * Semua impor lewat CLI asli scripts/import-free-feed.ts --fixtures
 * --divs=E0 dengan SQLite sementara + FOOTBALL_DATA_CSV_DIR fixture
 * (helper K0: createFixtureEnv, writeCsv, runScript; skema dibangun
 * subprocess tests/helpers/koreksi-schema-probe.ts supaya banyak env
 * bisa hidup dalam satu proses suite). Adapter dibaca lewat subprocess
 * tests/helpers/koreksi-jadwal-probe.ts.
 *
 * Pakai: npm run test:data (atau langsung: npx tsx tests/test-koreksi-kickoff.ts)
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  createFixtureEnv,
  openRo,
  runScript,
  seedDatasetTeams,
  settleFixtureEnv,
  writeCsv,
  writeTeamRegistry,
  type FixtureEnv,
  type RunResult,
} from "./helpers/fixture-env";

const suite = new Suite("koreksi-kickoff (audit §3)");

const TEAMS = [
  { team_id: "tm_arsenal", name: "Arsenal" },
  { team_id: "tm_chelsea", name: "Chelsea" },
];
const FD6 = "fd_E0_20261206_arsenal_chelsea";
const FD20 = "fd_E0_20261120_arsenal_chelsea";
const T15 = "2026-12-06T15:00:00.000Z";
const T18 = "2026-12-06T18:00:00.000Z";
const T20 = "2026-12-06T20:00:00.000Z";
const T00 = "2026-12-06T00:00:00.000Z";
const P15 = "2026-11-20T15:00:00.000Z";
const P18 = "2026-11-20T18:00:00.000Z";
// Jendela tanggal WIB (adapter menerima jendela UTC [dari, sampai)).
const WIB_6DES: [string, string] = ["2026-12-05T17:00:00.000Z", "2026-12-06T17:00:00.000Z"];
const WIB_7DES: [string, string] = ["2026-12-06T17:00:00.000Z", "2026-12-07T17:00:00.000Z"];
const LEBAR: [string, string] = ["2026-12-05T00:00:00.000Z", "2026-12-08T00:00:00.000Z"];

const CSV_HEAD = "Div,Date,Time,HomeTeam,AwayTeam,PPH,PPD,PPA,B365H,B365D,B365A";
const csvRow = (date: string, time: string) =>
  `E0,${date},${time},Arsenal,Chelsea,1.80,3.60,4.40,1.85,3.55,4.30`;

interface Tally {
  fixtures_inserted: number;
  fixtures: {
    parsed: number;
    inserted: number;
    bridged: number;
    already: number;
    schedule_updated?: number;
    schedule_unchanged?: number;
    schedule_conflict?: number;
    schedule_events?: {
      source_match_id: string;
      fixture_uid: string | null;
      old_kickoff_utc: string | null;
      new_kickoff_utc: string | null;
      outcome: string;
      reason: string | null;
    }[];
  };
}

function buatEnv(label: string): FixtureEnv {
  const env = createFixtureEnv(label);
  const skema = runScript(env, "tests/helpers/koreksi-schema-probe.ts");
  if (skema.code !== 0 || !skema.stdout.includes("SCHEMA_OK")) {
    throw new Error(`schema probe gagal untuk env ${label}: ${skema.stdout} ${skema.stderr}`);
  }
  seedDatasetTeams(env, TEAMS);
  writeTeamRegistry(env, TEAMS);
  fs.writeFileSync(
    path.join(env.dataDir, "league-canonical.json"),
    JSON.stringify({ version: 1, leagues: [] }),
  );
  fs.writeFileSync(path.join(env.dataDir, "fixture-links.json"), JSON.stringify({}));
  return env;
}

function tulisFixtures(env: FixtureEnv, rows: string[]): void {
  writeCsv(env, "fixtures.csv", [CSV_HEAD, ...rows, ""].join("\n"));
}

function impor(env: FixtureEnv, extraArgs: string[] = []): { res: RunResult; tally: Tally } {
  const res = runScript(env, "scripts/import-free-feed.ts", [
    "--fixtures",
    "--divs=E0",
    ...extraArgs,
  ]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("TALLY "));
  if (!line) {
    throw new Error(`importer tanpa TALLY (exit=${res.code}): ${res.stdout} ${res.stderr}`);
  }
  return { res, tally: JSON.parse(line.slice("TALLY ".length)) as Tally };
}

function katalog(env: FixtureEnv, matchId: string): { utc_date: string; status: string | null } | null {
  const db = openRo(env, "upcoming_fixtures.db");
  try {
    const r = db
      .prepare("SELECT utc_date, status FROM upcoming_fixtures WHERE match_id = ?")
      .get(matchId) as { utc_date: string; status: string | null } | undefined;
    return r ?? null;
  } finally {
    db.close();
  }
}

function jumlahBaris(env: FixtureEnv, file: string, tabel: string): number {
  const db = openRo(env, file);
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function kanonik(
  env: FixtureEnv,
  fdId: string,
): { fixture_uid: string; kickoff_utc: string | null; state: string } | null {
  const db = openRo(env, "thestats_dataset.db");
  try {
    const r = db
      .prepare(
        `SELECT cf.fixture_uid AS fixture_uid, cf.kickoff_utc AS kickoff_utc, cf.state AS state
         FROM canonical_fixtures cf
         JOIN fixture_aliases fa ON fa.fixture_uid = cf.fixture_uid
         WHERE fa.source = 'football-data' AND fa.source_match_id = ?`,
      )
      .get(fdId) as
      | { fixture_uid: string; kickoff_utc: string | null; state: string }
      | undefined;
    return r ?? null;
  } finally {
    db.close();
  }
}

function tulisDb(env: FixtureEnv, file: string, sql: string, params: unknown[] = []): void {
  const db = new DatabaseSync(path.join(env.dataDir, file));
  try {
    db.prepare(sql).run(...(params as never[]));
  } finally {
    db.close();
  }
}

function tanamPaket(env: FixtureEnv, matchId: string, kickoffUtc: string): number {
  const db = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  try {
    const payload = {
      fixture: {
        match_id: matchId,
        competition_name: "English Premier League",
        home: "Arsenal",
        away: "Chelsea",
        kickoff_utc: kickoffUtc,
      },
      gate_status: "calibrated",
      population: "league",
      lambda: 1.6,
      mu: 1.0,
      rho: 0,
      probabilities: { "1x2:1": 0.52, "1x2:x": 0.27, "1x2:2": 0.21 },
      top_scores: [{ home_goals: 1, away_goals: 0, prob: 0.13 }],
      score_matrix: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0.03)),
      legs: [],
    };
    const r = db
      .prepare(
        `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc, computed_utc, trigger, fit_source, gate_status, payload_json)
         VALUES (?, 'E0', ?, '2026-11-19T00:00:00.000Z', 'slate', 'free', 'calibrated', ?)`,
      )
      .run(matchId, kickoffUtc, JSON.stringify(payload));
    return Number(r.lastInsertRowid);
  } finally {
    db.close();
  }
}

interface ItemJadwal {
  match_id: string;
  fixture_uid: string | null;
  kickoff_utc: string;
  package_id: number | null;
}

function probeJadwal(env: FixtureEnv, windows: [string, string][]): ItemJadwal[][] {
  const res = runScript(env, "tests/helpers/koreksi-jadwal-probe.ts", [
    JSON.stringify(windows),
  ]);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(`jadwal probe gagal (exit=${res.code}): ${res.stdout} ${res.stderr}`);
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as ItemJadwal[][];
}

// ===========================================================================
// A — Alur utama: impor 15:00 → koreksi 18:00 → rerun / dry-run / odds.
// ===========================================================================
function blokA(): void {
  console.log("\n[A] koreksi kickoff dua store lewat CLI");
  const env = buatEnv("kick-a");
  tulisFixtures(env, [csvRow("06/12/2026", "15:00")]);
  const a1 = impor(env);
  suite.check("A1 impor awal: exit 0", a1.res.code === 0, a1.res.stderr.slice(0, 200));
  suite.eq("A1 katalog: 15:00 UTC", katalog(env, FD6)?.utc_date, T15);
  const kanA1 = kanonik(env, FD6);
  suite.eq("A1 kanonik: 15:00 UTC", kanA1?.kickoff_utc, T15);
  suite.check("A1 UID terbit dari alias football-data", !!kanA1?.fixture_uid);
  const uidA = kanA1?.fixture_uid;

  tulisFixtures(env, [csvRow("06/12/2026", "18:00")]);
  const a2 = impor(env);
  suite.check("A2 impor revisi: exit 0", a2.res.code === 0, a2.res.stderr.slice(0, 200));
  suite.eq("A2 tally: schedule_updated = 1", a2.tally.fixtures.schedule_updated, 1);
  suite.eq("A2 katalog: ikut koreksi ke 18:00 UTC", katalog(env, FD6)?.utc_date, T18);
  const kanA2 = kanonik(env, FD6);
  suite.eq("A2 kanonik: 18:00 UTC", kanA2?.kickoff_utc, T18);
  suite.eq("A2 UID tetap sama", kanA2?.fixture_uid, uidA);
  suite.eq("A2 katalog tetap 1 baris", jumlahBaris(env, "upcoming_fixtures.db", "upcoming_fixtures"), 1);
  suite.eq("A2 kanonik tetap 1 baris", jumlahBaris(env, "thestats_dataset.db", "canonical_fixtures"), 1);

  const a3 = impor(env);
  suite.eq("A3 rerun CSV sama: 0 koreksi tambahan", a3.tally.fixtures.schedule_updated, 0);
  suite.eq("A3 rerun CSV sama: schedule_unchanged = 1", a3.tally.fixtures.schedule_unchanged, 1);
  suite.eq("A3 katalog tetap 18:00", katalog(env, FD6)?.utc_date, T18);

  tulisFixtures(env, [csvRow("06/12/2026", "19:00")]);
  const a4 = impor(env, ["--dry-run"]);
  suite.check("A4 dry-run: exit 0", a4.res.code === 0);
  suite.eq("A4 dry-run: katalog tidak berubah", katalog(env, FD6)?.utc_date, T18);
  suite.eq("A4 dry-run: kanonik tidak berubah", kanonik(env, FD6)?.kickoff_utc, T18);

  const a5 = impor(env, ["--odds"]);
  suite.check("A5 odds saja: exit 0", a5.res.code === 0, a5.res.stderr.slice(0, 200));
  suite.eq("A5 odds saja: katalog tidak berubah", katalog(env, FD6)?.utc_date, T18);
  suite.eq("A5 odds saja: kanonik tidak berubah", kanonik(env, FD6)?.kickoff_utc, T18);

  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// B — Warisan: kanonik sudah 18:00, katalog masih 15:00 (kegagalan parsial
// antar dua koneksi). Input yang sama harus menyembuhkan tanpa UID kedua.
// ===========================================================================
function blokB(): void {
  console.log("\n[B] warisan split-store sembuh pada rerun");
  const env = buatEnv("kick-b");
  tulisDb(
    env,
    "upcoming_fixtures.db",
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, competition_country,
       utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name, fetched_utc)
     VALUES (?, 'E0', 'English Premier League', 'England', ?, 'scheduled',
       'tm_arsenal', 'Arsenal', 'tm_chelsea', 'Chelsea', '2026-11-19T00:00:00.000Z')`,
    [FD6, T15],
  );
  tulisDb(
    env,
    "thestats_dataset.db",
    `INSERT INTO canonical_fixtures (fixture_uid, competition_id, season, home_cid, away_cid,
       home_name, away_name, kickoff_utc, kickoff_precision, state, created_at, updated_at)
     VALUES ('fx_warisan01', 'E0', '2026-2027', 'tm_arsenal', 'tm_chelsea',
       'Arsenal', 'Chelsea', ?, 'exact', 'scheduled', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    [T18],
  );
  tulisDb(
    env,
    "thestats_dataset.db",
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES ('football-data', ?, 'fx_warisan01', 'created', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    [FD6],
  );
  tulisFixtures(env, [csvRow("06/12/2026", "18:00")]);
  const b1 = impor(env);
  suite.check("B1 impor: exit 0", b1.res.code === 0, b1.res.stderr.slice(0, 200));
  suite.eq("B1 tally: schedule_updated = 1 (katalog menyusul)", b1.tally.fixtures.schedule_updated, 1);
  suite.eq("B1 katalog sembuh ke 18:00", katalog(env, FD6)?.utc_date, T18);
  const kanB = kanonik(env, FD6);
  suite.eq("B1 kanonik tetap 18:00", kanB?.kickoff_utc, T18);
  suite.eq("B1 UID tetap fx_warisan01 (tanpa UID kedua)", kanB?.fixture_uid, "fx_warisan01");
  suite.eq("B1 kanonik tetap 1 baris", jumlahBaris(env, "thestats_dataset.db", "canonical_fixtures"), 1);
  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// C — Guard otoritas: koreksi yang harus DITAHAN + tengah malam eksplisit.
// ===========================================================================
function blokC(): void {
  console.log("\n[C] guard: jam absen/di luar rentang, anchor lain, status terminal, ganti tanggal UTC");
  const env = buatEnv("kick-c");
  tulisFixtures(env, [csvRow("06/12/2026", "15:00")]);
  impor(env);
  const uidC = kanonik(env, FD6)?.fixture_uid;
  suite.check("C0 baseline: UID ada", !!uidC);

  // C1 — Time absen: parser warisan mengimputasi 00:00; itu BUKAN bukti.
  tulisFixtures(env, [csvRow("06/12/2026", "")]);
  const c1 = impor(env);
  suite.eq("C1 jam absen: schedule_conflict = 1", c1.tally.fixtures.schedule_conflict, 1);
  suite.eq(
    "C1 jam absen: alasan time_absent tercatat",
    c1.tally.fixtures.schedule_events?.find((e) => e.source_match_id === FD6)?.reason,
    "time_absent",
  );
  suite.eq("C1 katalog tetap 15:00", katalog(env, FD6)?.utc_date, T15);
  suite.eq("C1 kanonik tetap 15:00 (tidak jadi 00:00 imputasi)", kanonik(env, FD6)?.kickoff_utc, T15);

  // C2 — Menit di luar rentang (15:75 → parser melonggarkan ke 16:15).
  tulisFixtures(env, [csvRow("06/12/2026", "15:75")]);
  const c2 = impor(env);
  suite.eq("C2 jam di luar rentang: schedule_conflict = 1", c2.tally.fixtures.schedule_conflict, 1);
  suite.eq(
    "C2 alasan time_out_of_range tercatat",
    c2.tally.fixtures.schedule_events?.find((e) => e.source_match_id === FD6)?.reason,
    "time_out_of_range",
  );
  suite.eq("C2 katalog tetap 15:00", katalog(env, FD6)?.utc_date, T15);
  suite.eq("C2 kanonik tetap 15:00", kanonik(env, FD6)?.kickoff_utc, T15);

  // C3 — Anchor sumber lain (sm_) pada jam berbeda: otoritas belum diputuskan.
  tulisDb(
    env,
    "upcoming_fixtures.db",
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, competition_country,
       utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name, fetched_utc)
     VALUES ('sm_4242', 'E0', 'English Premier League', 'England', ?, 'scheduled',
       'tm_arsenal', 'Arsenal', 'tm_chelsea', 'Chelsea', '2026-11-19T00:00:00.000Z')`,
    [T20],
  );
  tulisDb(
    env,
    "thestats_dataset.db",
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES ('sportmonks', 'sm_4242', ?, 'catalog_bridge', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    [uidC],
  );
  tulisFixtures(env, [csvRow("06/12/2026", "18:00")]);
  const c3 = impor(env);
  suite.eq("C3 anchor lain beda jam: schedule_conflict = 1", c3.tally.fixtures.schedule_conflict, 1);
  suite.eq(
    "C3 alasan other_source_anchor tercatat",
    c3.tally.fixtures.schedule_events?.find((e) => e.source_match_id === FD6)?.reason,
    "other_source_anchor",
  );
  suite.eq("C3 katalog fd tetap 15:00", katalog(env, FD6)?.utc_date, T15);
  suite.eq("C3 kanonik tetap 15:00", kanonik(env, FD6)?.kickoff_utc, T15);
  tulisDb(env, "upcoming_fixtures.db", "DELETE FROM upcoming_fixtures WHERE match_id = 'sm_4242'");
  tulisDb(env, "thestats_dataset.db", "DELETE FROM fixture_aliases WHERE source_match_id = 'sm_4242'");

  // C4 — Status terminal di katalog menahan koreksi.
  tulisDb(env, "upcoming_fixtures.db", "UPDATE upcoming_fixtures SET status = 'cancelled' WHERE match_id = ?", [FD6]);
  const c4 = impor(env);
  suite.eq("C4 status cancelled: schedule_conflict = 1", c4.tally.fixtures.schedule_conflict, 1);
  suite.eq(
    "C4 alasan terminal_status tercatat",
    c4.tally.fixtures.schedule_events?.find((e) => e.source_match_id === FD6)?.reason,
    "terminal_status",
  );
  suite.eq("C4 katalog tetap 15:00", katalog(env, FD6)?.utc_date, T15);
  suite.eq("C4 kanonik tetap 15:00", kanonik(env, FD6)?.kickoff_utc, T15);
  tulisDb(env, "upcoming_fixtures.db", "UPDATE upcoming_fixtures SET status = 'scheduled' WHERE match_id = ?", [FD6]);

  // C5 — Tanggal UTC berubah = reschedule, di luar cakupan: laga lama utuh.
  tulisFixtures(env, [csvRow("07/12/2026", "15:00")]);
  const c5 = impor(env);
  suite.eq("C5 ganti tanggal UTC: 0 koreksi pada laga lama", c5.tally.fixtures.schedule_updated, 0);
  suite.eq("C5 katalog laga lama tetap 15:00 6 Des", katalog(env, FD6)?.utc_date, T15);
  suite.eq("C5 kanonik laga lama tetap 15:00", kanonik(env, FD6)?.kickoff_utc, T15);
  suite.eq("C5 UID laga lama tetap", kanonik(env, FD6)?.fixture_uid, uidC);

  // C6 — Tengah malam eksplisit adalah jam sumber yang sah.
  tulisFixtures(env, [csvRow("06/12/2026", "00:00")]);
  const c6 = impor(env);
  suite.eq("C6 tengah malam eksplisit: schedule_updated = 1", c6.tally.fixtures.schedule_updated, 1);
  suite.eq("C6 katalog pindah ke 00:00 UTC", katalog(env, FD6)?.utc_date, T00);
  suite.eq("C6 kanonik pindah ke 00:00 UTC", kanonik(env, FD6)?.kickoff_utc, T00);

  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// D — Histori penerbitan beku + kickoff yang dimajukan melewati jam kini.
// ===========================================================================
function blokD(): void {
  console.log("\n[D] histori penerbitan tidak berubah; kickoff lampau tetap dikoreksi");
  const env = buatEnv("kick-d");
  tulisFixtures(env, [csvRow("20/11/2026", "15:00")]);
  impor(env);
  const uidD = kanonik(env, FD20)?.fixture_uid;
  suite.check("D0 baseline: UID ada", !!uidD);
  const pkgId = tanamPaket(env, FD20, P15);
  tulisDb(
    env,
    "picks.db",
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc, market, selection,
       model_prob, grade, source, pick_uid, published_prob, package_id, published_at_utc,
       probability_basis, kickoff_at_issue_utc, fixture_uid)
     VALUES ('2026-11-19T10:00:00.000Z', ?, 'E0', ?, 'team_over05_home', 'home', 0.87, 'A', 'live-run',
       'uid-koreksi-d', 0.8, ?, '2026-11-19T10:00:00.000Z', 'model', ?, ?)`,
    [FD20, P15, pkgId, P15, uidD],
  );
  const pickRow = (() => {
    const db = openRo(env, "picks.db");
    try {
      return db.prepare("SELECT id FROM picks WHERE pick_uid = 'uid-koreksi-d'").get() as { id: number };
    } finally {
      db.close();
    }
  })();
  tulisDb(
    env,
    "picks.db",
    `INSERT INTO fix4_tickets (ticket_uid, date_wib, decision_ts, expected_hit_prob, ticket_hash, policy_version, created_utc)
     VALUES ('fx4_koreksi_d', '2026-11-19', '2026-11-19T07:00:00.000Z', 0.8, 'hash-d', 'fix4-test', '2026-11-19T07:00:00.000Z')`,
  );
  tulisDb(
    env,
    "picks.db",
    `INSERT INTO fix4_ticket_legs (ticket_uid, position, pick_id, match_id, market, selection, published_prob)
     VALUES ('fx4_koreksi_d', 1, ?, ?, 'team_over05_home', 'home', 0.8)`,
    [pickRow.id, FD20],
  );

  tulisFixtures(env, [csvRow("20/11/2026", "18:00")]);
  const d2 = impor(env);
  suite.eq("D2 koreksi kickoff lampau: schedule_updated = 1", d2.tally.fixtures.schedule_updated, 1);
  suite.eq("D2 katalog: 18:00", katalog(env, FD20)?.utc_date, P18);
  suite.eq("D2 katalog: status tetap scheduled (jam saja tak menyimpulkan live)", katalog(env, FD20)?.status, "scheduled");
  suite.eq("D2 kanonik: 18:00", kanonik(env, FD20)?.kickoff_utc, P18);

  const snap = openRo(env, "analysis_snapshots.db");
  const pkgSesudah = snap
    .prepare("SELECT kickoff_utc FROM packages WHERE id = ?")
    .get(pkgId) as { kickoff_utc: string };
  snap.close();
  suite.eq("D2 histori: kickoff paket terbit tetap 15:00", pkgSesudah.kickoff_utc, P15);

  const pdb = openRo(env, "picks.db");
  const pickSesudah = pdb
    .prepare(
      "SELECT kickoff_utc, kickoff_at_issue_utc, published_prob, fixture_uid FROM picks WHERE pick_uid = 'uid-koreksi-d'",
    )
    .get() as {
    kickoff_utc: string;
    kickoff_at_issue_utc: string;
    published_prob: number;
    fixture_uid: string;
  };
  const legSesudah = pdb
    .prepare("SELECT published_prob FROM fix4_ticket_legs WHERE ticket_uid = 'fx4_koreksi_d'")
    .get() as { published_prob: number };
  pdb.close();
  suite.eq("D2 histori: kickoff pick tetap 15:00", pickSesudah.kickoff_utc, P15);
  suite.eq("D2 histori: kickoff_at_issue pick tetap 15:00", pickSesudah.kickoff_at_issue_utc, P15);
  suite.eq("D2 histori: probabilitas pick tetap 0.8", pickSesudah.published_prob, 0.8);
  suite.eq("D2 histori: UID pick tetap", pickSesudah.fixture_uid, uidD);
  suite.eq("D2 histori: probabilitas leg Fix-4 tetap 0.8", legSesudah.published_prob, 0.8);

  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// E — Adapter Jadwal: paket lama tidak memunculkan laga di tanggal lama.
// ===========================================================================
function blokE(): void {
  console.log("\n[E] adapter: katalog sumber waktu + keanggotaan jendela WIB");
  const env = buatEnv("kick-e");
  tulisFixtures(env, [csvRow("06/12/2026", "15:00")]);
  impor(env);
  // Keadaan brief §1: katalog sudah benar 18:00, paket lama beku 15:00.
  tulisDb(env, "upcoming_fixtures.db", "UPDATE upcoming_fixtures SET utc_date = ? WHERE match_id = ?", [T18, FD6]);
  const pkgId = tanamPaket(env, FD6, T15);

  const [w6, w7, lebar] = probeJadwal(env, [WIB_6DES, WIB_7DES, LEBAR]);
  const di6 = w6.filter((i) => i.match_id === FD6);
  const di7 = w7.filter((i) => i.match_id === FD6);
  const diLebar = lebar.filter((i) => i.match_id === FD6);
  suite.eq("E jendela WIB 6 Des: laga TIDAK tampil di tanggal lama", di6.length, 0);
  suite.eq("E jendela WIB 7 Des: laga tampil tepat sekali", di7.length, 1);
  suite.eq("E jendela WIB 7 Des: jam katalog 18:00 UTC (= 01:00 WIB)", di7[0]?.kickoff_utc, T18);
  suite.eq("E jendela lebar: laga tampil tepat sekali", diLebar.length, 1);
  suite.eq("E jendela lebar: jam katalog terbaru, bukan jam paket", diLebar[0]?.kickoff_utc, T18);
  suite.eq("E jendela lebar: paket lama tetap menempel pada baris katalog", diLebar[0]?.package_id, pkgId);

  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// F — Adapter: paket berasal dari alias terverifikasi (id berbeda dari
// baris katalog) — tetap satu baris, jam katalog.
// ===========================================================================
function blokF(): void {
  console.log("\n[F] adapter: paket alias terverifikasi ikut aturan katalog");
  const env = buatEnv("kick-f");
  tulisFixtures(env, [csvRow("06/12/2026", "15:00")]);
  impor(env);
  const uidF = kanonik(env, FD6)?.fixture_uid;
  tulisDb(env, "upcoming_fixtures.db", "UPDATE upcoming_fixtures SET utc_date = ? WHERE match_id = ?", [T18, FD6]);
  tulisDb(
    env,
    "thestats_dataset.db",
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES ('sportmonks', 'sm_999', ?, 'catalog_bridge', '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')`,
    [uidF],
  );
  const pkgId = tanamPaket(env, "sm_999", T15);

  const [w6, lebar] = probeJadwal(env, [WIB_6DES, LEBAR]);
  const di6 = [...w6.filter((i) => i.match_id === "sm_999"), ...w6.filter((i) => i.match_id === FD6)];
  const grupLebar = lebar.filter((i) => i.fixture_uid === uidF);
  suite.eq("F jendela WIB 6 Des: tidak ada baris grup ini", di6.length, 0);
  suite.eq("F jendela lebar: tepat satu baris per UID", grupLebar.length, 1);
  suite.eq("F jendela lebar: jam katalog 18:00", grupLebar[0]?.kickoff_utc, T18);
  suite.eq("F jendela lebar: paket alias menempel", grupLebar[0]?.package_id, pkgId);

  settleFixtureEnv(env, suite.failedCount > 0);
}

// ===========================================================================
// G — Adapter: laga tanpa katalog yang mengandalkan paket tetap tampil.
// ===========================================================================
function blokG(): void {
  console.log("\n[G] adapter: paket tanpa katalog tetap tampil di jendela paket");
  const env = buatEnv("kick-g");
  const pkgId = tanamPaket(env, "sm_111", T15);
  const [w6, w7] = probeJadwal(env, [WIB_6DES, WIB_7DES]);
  const di6 = w6.filter((i) => i.match_id === "sm_111");
  suite.eq("G jendela paket: tampil sekali", di6.length, 1);
  suite.eq("G jendela paket: jam paket dipertahankan", di6[0]?.kickoff_utc, T15);
  suite.eq("G jendela paket: package_id terisi", di6[0]?.package_id, pkgId);
  suite.eq("G jendela lain: kosong", w7.filter((i) => i.match_id === "sm_111").length, 0);
  settleFixtureEnv(env, suite.failedCount > 0);
}

async function main(): Promise<void> {
  blokA();
  blokB();
  blokC();
  blokD();
  blokE();
  blokF();
  blokG();
  suite.finish();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
