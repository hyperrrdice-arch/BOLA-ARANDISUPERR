/**
 * ML1-PIT A — suite acceptance Brief ML1-PIT A §6.
 *
 * Menguji jalur yang sama dengan CLI (`runMl1PitA` di lib/eval/ml1-pit-a.ts)
 * dengan clock + executor inferensi injeksi di atas fixture SQLite sintetis
 * minimal dalam DB_DIR sementara. Ke-12 kasus acceptance brief dipetakan
 * satu-satu (A1..A12 di bawah). Suite berjalan murni Node (stub executor) —
 * smoke inferensi Python asli dilaporkan terpisah, bukan di suite ini.
 *
 * Kasus:
 *  A1  Paket 09.00 & 11.00, keputusan 10.00 → edisi 09.00; keputusan
 *      berikutnya 11.30 → edisi 11.00.
 *  A2  Edisi slate tepat cutoff terpilih; paket manual diabaikan; kickoff
 *      sama dengan cutoff dikeluarkan.
 *  A3  Edisi terbaru as-of memajukan kickoff lewat cutoff → seluruh fixture
 *      dikeluarkan walau edisi lama alias lain berkickoff future.
 *  A4  Seri computed_utc lintas alias → ID terbesar menang (skema produksi
 *      melarang seri per (match_id, trigger), jadi seri diuji lintas alias).
 *  A5  Clock inferensi melintasi kickoff / keluaran tepat saat kickoff →
 *      fixture itu tanpa row; fixture lain tetap tersimpan.
 *  A6  Jam mundur / status / jadwal / UID berubah saat inferensi → alasan
 *      skip spesifik; keputusan tetap merujuk snapshot awal.
 *  A7  fd_* + sm_* satu UID + fixture lain, limit 2 → tepat 2 fixture
 *      fisik; rerun 0 row baru.
 *  A8  Dua koneksi key sama; alias berpindah UID; UID bentrok; UID tak
 *      dikenal → unik, row pertama utuh, konflik/gap terbaca di ringkasan.
 *  A9  Dua leg tim+kompetisi sama, UID beda → keduanya terprediksi.
 *  A10 Marker A/B beda + C kosong → marker masing-masing + unknown; hash
 *      payload dari string mentah; hash kandidat dari byte manifest.
 *  A11 Runner gagal / keluaran rusak → throw (CLI exit nonzero), tanpa row
 *      parsial; rerun menyelesaikan fixture yang masih eligible.
 *  A12 Isolasi: hash fixture input + DB pilot identik sebelum/sesudah
 *      (termasuk daftar file); mode legacy + format ringkasan cron tetap
 *      kompatibel; --pit-a --now ditolak.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT, Suite } from "./helpers/fixture-env";
import {
  createPythonInferenceExecutor,
  ensurePitASchema,
  insertPitARow,
  runMl1PitA,
  sha256FilePitA,
  PIT_A_EVAL_VERSION,
  PIT_A_HORIZON_ID,
  type PitAInferenceExecutor,
  type PitAPredictionRow,
  type PitARunSummary,
} from "../lib/eval/ml1-pit-a";
import { ensureIdentitySchema } from "../lib/identity/fixture-resolver";
import { ensurePackagesSchema } from "../lib/picks/packages";

const suite = new Suite("ML1-PIT A (Brief ML1-PIT A §6)");
const DECISION = "2026-11-27T10:00:00.000Z";
const envsToClean: string[] = [];

const sha256Str = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// ============================================================================
// Fixture env
// ============================================================================
interface PitAEnv {
  root: string;
  dataDir: string;
  staticDir: string;
  datasetPath: string;
  upcomingPath: string;
  snapshotsPath: string;
  outputPath: string;
  pilotPath: string;
  modelDir: string;
  manifestPath: string;
}

function makeEnv(label: string): PitAEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bola-pita-${label}-`));
  envsToClean.push(root);
  const dataDir = path.join(root, "db");
  const staticDir = path.join(root, "static");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, "fixture-links.json"), JSON.stringify({ links: [] }));

  const datasetPath = path.join(dataDir, "thestats_dataset.db");
  const ds = new DatabaseSync(datasetPath);
  ds.exec(`
    CREATE TABLE matches (
      match_id TEXT PRIMARY KEY, competition_id TEXT, utc_date TEXT,
      home_team_id TEXT, away_team_id TEXT, home_score INTEGER, away_score INTEGER,
      status TEXT, season TEXT
    );
    CREATE TABLE team_match_logs_canonical (
      team_id TEXT, match_date TEXT, shots_for REAL, shots_against REAL,
      shots_on_target_for REAL, shots_on_target_against REAL
    );
    CREATE TABLE league_calibration (league_id TEXT PRIMARY KEY, status TEXT);
  `);
  ensureIdentitySchema(ds);
  ds.prepare("INSERT INTO league_calibration (league_id, status) VALUES ('sm:100', 'calibrated')").run();
  const insM = ds.prepare(
    "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season) VALUES (?, 'sm:100', ?, ?, ?, ?, ?, 'finished', '2026')",
  );
  insM.run("mt_hist1", "2026-11-20T20:00:00.000Z", "tm_h1", "tm_a1", 2, 1);
  insM.run("mt_hist2", "2026-11-22T20:00:00.000Z", "tm_a1", "tm_h1", 0, 0);
  const insL = ds.prepare(
    "INSERT INTO team_match_logs_canonical (team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insL.run("tm_h1", "2026-11-20", 12, 8, 5, 3);
  insL.run("tm_a1", "2026-11-20", 8, 12, 3, 5);
  ds.close();

  const upcomingPath = path.join(dataDir, "upcoming_fixtures.db");
  const up = new DatabaseSync(upcomingPath);
  up.exec(`
    CREATE TABLE upcoming_fixtures (
      match_id TEXT PRIMARY KEY, competition_id TEXT, competition_name TEXT,
      utc_date TEXT, status TEXT, home_team_id TEXT, home_team_name TEXT,
      away_team_id TEXT, away_team_name TEXT
    );
    CREATE TABLE sm_id_map (match_id TEXT PRIMARY KEY, sm_fixture_id INTEGER NOT NULL);
  `);
  up.close();

  const snapshotsPath = path.join(dataDir, "analysis_snapshots.db");
  const sn = new DatabaseSync(snapshotsPath);
  ensurePackagesSchema(sn);
  sn.close();

  const modelDir = path.join(root, "model");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, "ml1-b-home.booster"), "fixture-home-booster-bytes");
  fs.writeFileSync(path.join(modelDir, "ml1-b-away.booster"), "fixture-away-booster-bytes");
  const manifest = {
    candidate_id: "ml1-b-fixture-candidate",
    model: "ml1-b",
    boosters: {
      home: { file: "ml1-b-home.booster", sha256: sha256Str("fixture-home-booster-bytes") },
      away: { file: "ml1-b-away.booster", sha256: sha256Str("fixture-away-booster-bytes") },
    },
  };
  const manifestPath = path.join(modelDir, "model-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    root,
    dataDir,
    staticDir,
    datasetPath,
    upcomingPath,
    snapshotsPath,
    outputPath: path.join(dataDir, "ml1_prospective_pit_a.db"),
    pilotPath: path.join(dataDir, "ml1_prospective.db"),
    modelDir,
    manifestPath,
  };
}

// ------------------------------------------------------------ seed helpers --
function addUpcoming(
  env: PitAEnv,
  matchId: string,
  kickoff: string,
  opts: { status?: string; homeName?: string; awayName?: string } = {},
): void {
  const db = new DatabaseSync(env.upcomingPath);
  db.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name)
     VALUES (?, 'sm:100', 'Fixture League', ?, ?, 'tm_h1', ?, 'tm_a1', ?)`,
  ).run(matchId, kickoff, opts.status ?? "scheduled", opts.homeName ?? "Fixture Home", opts.awayName ?? "Fixture Away");
  db.close();
}

function addIdentity(env: PitAEnv, uid: string, matchIds: string[], names?: { home: string; away: string }): void {
  const db = new DatabaseSync(env.datasetPath);
  db.prepare(
    `INSERT OR IGNORE INTO canonical_fixtures (fixture_uid, competition_id, home_name, away_name, kickoff_utc, state, created_at, updated_at)
     VALUES (?, 'sm:100', ?, ?, '2026-11-27T20:00:00.000Z', 'scheduled', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  ).run(uid, names?.home ?? "Fixture Home", names?.away ?? "Fixture Away");
  const ins = db.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES (?, ?, ?, 'fixture', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  );
  for (const id of matchIds) {
    ins.run(id.startsWith("sm_") ? "sportmonks" : "football-data", id, uid);
  }
  db.close();
}

function setLinks(env: PitAEnv, links: { twin_id: string; canonical_id: string }[]): void {
  fs.writeFileSync(path.join(env.staticDir, "fixture-links.json"), JSON.stringify({ links }));
}

function addPkg(
  env: PitAEnv,
  opts: {
    matchId: string;
    computed: string;
    kickoff: string;
    lam?: number;
    mu?: number;
    trigger?: string;
    marker?: string | null;
    payloadRaw?: string;
    homeName?: string;
    awayName?: string;
  },
): number {
  const payload =
    opts.payloadRaw ??
    JSON.stringify({
      fixture: { home: opts.homeName ?? "Fixture Home", away: opts.awayName ?? "Fixture Away" },
      probabilities: { "1x2:1": 0.5, "1x2:x": 0.3, "1x2:2": 0.2 },
    });
  const db = new DatabaseSync(env.snapshotsPath);
  const res = db
    .prepare(
      `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc, computed_utc, trigger, ratings_marker, lambda, mu, payload_json)
       VALUES (?, 'sm:100', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(opts.matchId, opts.kickoff, opts.computed, opts.trigger ?? "slate", opts.marker ?? null, opts.lam ?? 1.5, opts.mu ?? 1.2, payload);
  db.close();
  return Number(res.lastInsertRowid);
}

/** Seed satu fixture sederhana: upcoming + identitas + satu edisi slate. */
function seedFixture(
  env: PitAEnv,
  opts: {
    matchId: string;
    uid: string;
    kickoff: string;
    computed?: string;
    lam?: number;
    alsoIds?: string[];
  },
): number {
  addUpcoming(env, opts.matchId, opts.kickoff);
  addIdentity(env, opts.uid, [opts.matchId, ...(opts.alsoIds ?? [])]);
  return addPkg(env, {
    matchId: opts.matchId,
    computed: opts.computed ?? "2026-11-27T09:00:00.000Z",
    kickoff: opts.kickoff,
    lam: opts.lam,
  });
}

// ------------------------------------------------------------- run helpers --
function makeClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    clock: () => new Date(ms),
    set(iso2: string) {
      ms = Date.parse(iso2);
    },
  };
}

function stubExecutor(
  env: PitAEnv,
  opts: {
    onCall?: (requests: { match_id: string }[]) => void;
    fail?: boolean;
    corrupt?: "missing" | "extra" | "nan";
  } = {},
): PitAInferenceExecutor {
  return ({ requests }) => {
    if (opts.fail) throw new Error("stub executor gagal (fixture)");
    opts.onCall?.(requests);
    const results = new Map(
      requests.map((r) => [r.match_id, { lam: r.champLam * 1.05, mu: r.champMu * 0.95 }] as const),
    );
    if (opts.corrupt === "missing" && requests.length > 0) results.delete(requests[0].match_id);
    if (opts.corrupt === "extra") results.set("sm_999999", { lam: 1, mu: 1 });
    if (opts.corrupt === "nan" && requests.length > 0) {
      results.set(requests[0].match_id, { lam: Number.NaN, mu: 1 });
    }
    return {
      results,
      candidateId: "ml1-b-fixture-candidate",
      candidateManifestSha256: sha256FilePitA(env.manifestPath),
    };
  };
}

function runPitA(
  env: PitAEnv,
  opts: { clock: () => Date; executor: PitAInferenceExecutor; limit?: number },
): PitARunSummary {
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  const upcoming = new DatabaseSync(env.upcomingPath, { readOnly: true });
  const snapshots = new DatabaseSync(env.snapshotsPath, { readOnly: true });
  try {
    return runMl1PitA({
      dataset,
      upcoming,
      snapshots,
      outputDbPath: env.outputPath,
      dataDirPath: env.staticDir,
      modelDir: env.modelDir,
      clock: opts.clock,
      executor: opts.executor,
      limit: opts.limit ?? 0,
    });
  } finally {
    dataset.close();
    upcoming.close();
    snapshots.close();
  }
}

interface StoredRow {
  fixture_uid: string;
  source_match_id: string;
  package_id: number;
  champ_lam: number;
  issued_at_utc: string;
  decision_at_utc: string;
  champion_ratings_marker: string | null;
  champion_provenance_status: string;
  package_payload_sha256: string;
  candidate_id: string | null;
  candidate_manifest_sha256: string | null;
  identity_method: string;
  aliases_json: string;
  [k: string]: unknown;
}

function readRows(env: PitAEnv): StoredRow[] {
  if (!fs.existsSync(env.outputPath)) return [];
  const db = new DatabaseSync(env.outputPath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM predictions ORDER BY fixture_uid").all() as unknown as StoredRow[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// ============================================================================
// A1 — seleksi as-of: edisi 09.00 pada keputusan 10.00; 11.00 pada 11.30
// ============================================================================
console.log("\nA1. Seleksi paket as-of (09.00 vs 11.00, keputusan 10.00)");
{
  const env = makeEnv("a1");
  addUpcoming(env, "fd_101", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a1", ["fd_101"]);
  const id09 = addPkg(env, { matchId: "fd_101", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 1.4 });
  addPkg(env, { matchId: "fd_101", computed: "2026-11-27T11:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 2.4 });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRows(env);
  suite.eq("A1 run @10.00: predicted_new", s.predicted_new, 1);
  suite.eq("A1 run @10.00: package terpilih = edisi 09.00", rows[0]?.package_id, id09);
  suite.eq("A1 run @10.00: champ_lam dari edisi 09.00", rows[0]?.champ_lam, 1.4);
  suite.eq("A1 run @10.00: decision_at_utc", s.decision_at_utc, DECISION);

  const env2 = makeEnv("a1b");
  addUpcoming(env2, "fd_101", "2026-11-27T20:00:00.000Z");
  addIdentity(env2, "fx_uid_a1", ["fd_101"]);
  addPkg(env2, { matchId: "fd_101", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 1.4 });
  const id11 = addPkg(env2, { matchId: "fd_101", computed: "2026-11-27T11:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 2.4 });
  const clk2 = makeClock("2026-11-27T11:30:00.000Z");
  runPitA(env2, { clock: clk2.clock, executor: stubExecutor(env2) });
  const rows2 = readRows(env2);
  suite.eq("A1 run @11.30: package terpilih = edisi 11.00", rows2[0]?.package_id, id11);
  suite.eq("A1 run @11.30: champ_lam dari edisi 11.00", rows2[0]?.champ_lam, 2.4);
}

// ============================================================================
// A2 — edisi tepat cutoff terpilih; manual diabaikan; kickoff == cutoff keluar
// ============================================================================
console.log("\nA2. Edisi tepat cutoff + manual diabaikan + kickoff == cutoff");
{
  const env = makeEnv("a2");
  addUpcoming(env, "fd_102", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a2", ["fd_102"]);
  addPkg(env, { matchId: "fd_102", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 9.99, trigger: "manual" });
  const idSlate = addPkg(env, { matchId: "fd_102", computed: DECISION, kickoff: "2026-11-27T20:00:00.000Z", lam: 1.6 });
  addPkg(env, { matchId: "fd_102", computed: "2026-11-27T10:30:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 8.88, trigger: "manual" });
  // Fixture kedua: kickoff PERSIS sama dengan cutoff keputusan.
  seedFixture(env, { matchId: "fd_103", uid: "fx_uid_a2b", kickoff: DECISION, computed: "2026-11-27T09:00:00.000Z" });

  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRows(env);
  suite.eq("A2: hanya fixture kickoff-future yang tersimpan", s.predicted_new, 1);
  suite.eq("A2: edisi slate tepat cutoff terpilih (manual diabaikan)", rows[0]?.package_id, idSlate);
  suite.eq("A2: champ_lam edisi slate, bukan manual", rows[0]?.champ_lam, 1.6);
  suite.check("A2: kickoff == cutoff dikeluarkan (kickoff_not_future)", (s.skipped.kickoff_not_future ?? 0) >= 1, JSON.stringify(s.skipped));
}

// ============================================================================
// A3 — edisi terbaru memajukan kickoff lewat cutoff → seluruh fixture keluar
// ============================================================================
console.log("\nA3. Edisi terbaru as-of memajukan kickoff hingga lewat cutoff");
{
  const env = makeEnv("a3");
  addUpcoming(env, "fd_104", "2026-11-27T20:00:00.000Z");
  addUpcoming(env, "sm_104", "2026-11-27T09:30:00.000Z");
  addIdentity(env, "fx_uid_a3", ["fd_104", "sm_104"]);
  addPkg(env, { matchId: "fd_104", computed: "2026-11-27T08:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 1.5 });
  addPkg(env, { matchId: "sm_104", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T09:30:00.000Z", lam: 1.7 });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A3: tidak ada row untuk fixture itu", s.predicted_new, 0);
  suite.eq("A3: baris tersimpan kosong", readRows(env).length, 0);
  suite.check("A3: alasan kickoff_not_future tercatat", (s.skipped.kickoff_not_future ?? 0) >= 1, JSON.stringify(s.skipped));
}

// ============================================================================
// A4 — seri computed_utc lintas alias → ID terbesar menang
// ============================================================================
console.log("\nA4. Tie-break computed_utc lintas alias (ID terbesar)");
{
  const env = makeEnv("a4");
  addUpcoming(env, "fd_105", "2026-11-27T20:00:00.000Z");
  addUpcoming(env, "sm_105", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a4", ["fd_105", "sm_105"]);
  addPkg(env, { matchId: "fd_105", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 1.5 });
  const idBig = addPkg(env, { matchId: "sm_105", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z", lam: 2.5 });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRows(env);
  suite.eq("A4: satu fixture fisik tersimpan", s.predicted_new, 1);
  suite.eq("A4: pemenang = edisi ID terbesar", rows[0]?.package_id, idBig);
  suite.eq("A4: champ_lam pemenang", rows[0]?.champ_lam, 2.5);
  suite.eq("A4: source_match_id pemenang", rows[0]?.source_match_id, "sm_105");
}

// ============================================================================
// A5 — clock inferensi melintasi kickoff / tepat saat kickoff
// ============================================================================
console.log("\nA5. Clock melintasi kickoff saat inferensi");
{
  const env = makeEnv("a5");
  seedFixture(env, { matchId: "fd_106", uid: "fx_uid_a5a", kickoff: "2026-11-27T10:30:00.000Z" });
  seedFixture(env, { matchId: "fd_107", uid: "fx_uid_a5b", kickoff: "2026-11-27T20:00:00.000Z" });
  const clk = makeClock(DECISION);
  const exec = stubExecutor(env, {
    onCall: () => clk.set("2026-11-27T10:30:00.000Z"), // keluaran datang tepat saat kickoff fixture pertama
  });
  const s = runPitA(env, { clock: clk.clock, executor: exec });
  const rows = readRows(env);
  suite.eq("A5: hanya fixture yang masih eligible tersimpan", s.predicted_new, 1);
  suite.eq("A5: fixture tersimpan = yang kickoff 20.00", rows[0]?.fixture_uid, "fx_uid_a5b");
  suite.eq("A5: alasan kickoff_passed tercatat", s.skipped.kickoff_passed ?? 0, 1);
  suite.eq("A5: issued_at_utc = jam sesudah inferensi", rows[0]?.issued_at_utc, "2026-11-27T10:30:00.000Z");
  suite.eq("A5: decision_at_utc tetap dari snapshot awal", rows[0]?.decision_at_utc, DECISION);
}

// ============================================================================
// A6 — mutasi saat inferensi: status / jadwal / UID / jam mundur
// ============================================================================
console.log("\nA6. Perubahan saat inferensi → alasan skip spesifik");
{
  const env = makeEnv("a6");
  seedFixture(env, { matchId: "fd_108", uid: "fx_uid_a6a", kickoff: "2026-11-27T20:00:00.000Z" });
  seedFixture(env, { matchId: "fd_109", uid: "fx_uid_a6b", kickoff: "2026-11-27T20:00:00.000Z" });
  seedFixture(env, { matchId: "fd_110", uid: "fx_uid_a6c", kickoff: "2026-11-27T20:00:00.000Z", alsoIds: ["sm_110"] });
  seedFixture(env, { matchId: "fd_111", uid: "fx_uid_a6d", kickoff: "2026-11-27T20:00:00.000Z" });
  const clk = makeClock(DECISION);
  const exec = stubExecutor(env, {
    onCall: () => {
      const up = new DatabaseSync(env.upcomingPath);
      up.prepare("UPDATE upcoming_fixtures SET status = 'finished' WHERE match_id = 'fd_108'").run();
      up.prepare("UPDATE upcoming_fixtures SET utc_date = '2026-11-27T21:00:00.000Z' WHERE match_id = 'fd_109'").run();
      up.close();
      const ds = new DatabaseSync(env.datasetPath);
      ds.prepare("UPDATE fixture_aliases SET fixture_uid = 'fx_uid_lain' WHERE source_match_id = 'sm_110'").run();
      ds.close();
    },
  });
  const s = runPitA(env, { clock: clk.clock, executor: exec });
  const rows = readRows(env);
  suite.eq("A6: hanya fixture kontrol tersimpan", s.predicted_new, 1);
  suite.eq("A6: fixture kontrol = fd_111", rows[0]?.fixture_uid, "fx_uid_a6d");
  suite.eq("A6: status berubah → fixture_state_ineligible", s.skipped.fixture_state_ineligible ?? 0, 1);
  suite.eq("A6: jadwal berubah → schedule_conflict", s.skipped.schedule_conflict ?? 0, 1);
  suite.eq("A6: UID berubah → identity_changed", s.skipped.identity_changed ?? 0, 1);

  // Jam mundur: keputusan tetap merujuk snapshot awal, semua attempt skip.
  const env2 = makeEnv("a6clock");
  seedFixture(env2, { matchId: "fd_112", uid: "fx_uid_a6e", kickoff: "2026-11-27T20:00:00.000Z" });
  const clk2 = makeClock(DECISION);
  const exec2 = stubExecutor(env2, { onCall: () => clk2.set("2026-11-27T09:00:00.000Z") });
  const s2 = runPitA(env2, { clock: clk2.clock, executor: exec2 });
  suite.eq("A6 jam mundur: tidak ada row", s2.predicted_new, 0);
  suite.eq("A6 jam mundur: alasan clock_invalid", s2.skipped.clock_invalid ?? 0, 1);
  suite.eq("A6 jam mundur: decision_at_utc tetap snapshot awal", s2.decision_at_utc, DECISION);
  suite.eq("A6 jam mundur: baris tersimpan kosong", readRows(env2).length, 0);
}

// ============================================================================
// A7 — fd_* + sm_* satu UID + fixture lain, limit 2 → tepat 2 fixture fisik
// ============================================================================
console.log("\nA7. Dedupe UID sebelum limit; rerun 0 baru");
{
  const env = makeEnv("a7");
  seedFixture(env, { matchId: "fd_113", uid: "fx_uid_a7p", kickoff: "2026-11-27T19:00:00.000Z", alsoIds: ["sm_113"] });
  addUpcoming(env, "sm_113", "2026-11-27T19:00:00.000Z");
  addPkg(env, { matchId: "sm_113", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T19:00:00.000Z", lam: 1.9 });
  seedFixture(env, { matchId: "fd_114", uid: "fx_uid_a7q", kickoff: "2026-11-27T20:00:00.000Z" });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env), limit: 2 });
  const rows = readRows(env);
  suite.eq("A7: limit 2 = tepat 2 fixture fisik", s.predicted_new, 2);
  suite.eq("A7: attempted = 2 (bukan 3 alias)", s.attempted, 2);
  suite.eq(
    "A7: UID tersimpan = P dan Q",
    rows.map((r) => r.fixture_uid).sort(),
    ["fx_uid_a7p", "fx_uid_a7q"],
  );
  const s2 = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A7 rerun: 0 row baru", s2.predicted_new, 0);
  suite.eq("A7 rerun: already_stored = 2", s2.skipped.already_stored ?? 0, 2);
  suite.eq("A7 rerun: total baris tetap 2", readRows(env).length, 2);
}

// ============================================================================
// A8 — dua koneksi, alias pindah UID, UID bentrok, UID tak dikenal
// ============================================================================
console.log("\nA8. Unik di bawah dua koneksi + drift + konflik + tak dikenal");
{
  const env = makeEnv("a8");
  seedFixture(env, { matchId: "fd_115", uid: "fx_uid_a8a", kickoff: "2026-11-27T20:00:00.000Z", alsoIds: ["sm_115"] });
  const clk = makeClock(DECISION);
  const s1 = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A8 run 1: fixture A tersimpan", s1.predicted_new, 1);
  const rowA = readRows(env)[0];

  // Dua koneksi menulis key yang sama → unik, row pertama utuh.
  const dummy: PitAPredictionRow = {
    eval_version: PIT_A_EVAL_VERSION,
    horizon_id: PIT_A_HORIZON_ID,
    feature_time_status: "pending_pit_b",
    status: "PIT_A_STAGED",
    fixture_uid: "fx_uid_a8x",
    source_match_id: "fd_115",
    identity_method: "fixture_aliases",
    aliases_json: JSON.stringify(["fd_115"]),
    competition_id: "sm:100",
    decision_at_utc: DECISION,
    issued_at_utc: DECISION,
    kickoff_utc: "2026-11-27T20:00:00.000Z",
    lead_seconds: 36000,
    package_id: 1,
    package_computed_utc: "2026-11-27T09:00:00.000Z",
    package_payload_sha256: "0".repeat(64),
    champion_ratings_marker: null,
    champion_provenance_status: "unknown",
    candidate_id: "ml1-b-fixture-candidate",
    candidate_manifest_sha256: "1".repeat(64),
    home_team_key: "tm_h1",
    away_team_key: "tm_a1",
    home_name: "Fixture Home",
    away_name: "Fixture Away",
    slice: "kompetitif",
    registry_status: "calibrated",
    champ_lam: 1.5,
    champ_mu: 1.2,
    champ_p_h: 0.5,
    champ_p_d: 0.3,
    champ_p_a: 0.2,
    cand_lam: 1.5,
    cand_mu: 1.2,
    cand_p_h: 0.5,
    cand_p_d: 0.3,
    cand_p_a: 0.2,
    features_json: "[]",
  };
  const c1 = new DatabaseSync(env.outputPath);
  const c2 = new DatabaseSync(env.outputPath);
  ensurePitASchema(c1);
  ensurePitASchema(c2);
  const firstIn = insertPitARow(c1, dummy);
  const secondIn = insertPitARow(c2, { ...dummy, champ_lam: 9.99 });
  c1.close();
  c2.close();
  suite.eq("A8: insert koneksi pertama diterima", firstIn, true);
  suite.eq("A8: insert koneksi kedua (key sama) ditolak handler tertarget", secondIn, false);
  const xRows = readRows(env).filter((r) => r.fixture_uid === "fx_uid_a8x");
  suite.eq("A8: tepat satu row untuk key itu", xRows.length, 1);
  suite.eq("A8: row pertama utuh (champ_lam tidak tertimpa)", xRows[0]?.champ_lam, 1.5);

  // Alias sm_115 berpindah ke UID fixture B; B punya edisi sendiri.
  const ds = new DatabaseSync(env.datasetPath);
  ds.prepare("UPDATE fixture_aliases SET fixture_uid = 'fx_uid_a8b' WHERE source_match_id = 'sm_115'").run();
  ds.close();
  seedFixture(env, { matchId: "fd_116", uid: "fx_uid_a8b", kickoff: "2026-11-27T21:00:00.000Z" });
  // Fixture C: dua alias menunjuk dua UID berbeda (konflik).
  addUpcoming(env, "fd_117", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a8c1", ["fd_117"]);
  addIdentity(env, "fx_uid_a8c2", ["sm_117"]);
  setLinks(env, [{ twin_id: "sm_117", canonical_id: "fd_117" }]);
  addPkg(env, { matchId: "fd_117", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z" });
  // Fixture U: tanpa UID sama sekali.
  addUpcoming(env, "fd_118", "2026-11-27T20:00:00.000Z");
  addPkg(env, { matchId: "fd_118", computed: "2026-11-27T09:00:00.000Z", kickoff: "2026-11-27T20:00:00.000Z" });

  const s2 = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A8 run 2: tidak ada insert baru", s2.predicted_new, 0);
  suite.check("A8 run 2: A terbaca already_stored", (s2.skipped.already_stored ?? 0) >= 1, JSON.stringify(s2.skipped));
  suite.eq("A8 run 2: alias pindah → identity_changed_since_issue", s2.skipped.identity_changed_since_issue ?? 0, 1);
  suite.eq("A8 run 2: UID bentrok → identity_conflict", s2.skipped.identity_conflict ?? 0, 1);
  suite.eq("A8 run 2: UID tak dikenal → identity_unresolved", s2.skipped.identity_unresolved ?? 0, 1);
  const rowsAfter = readRows(env);
  suite.eq("A8: row A tetap utuh sesudah run 2", rowsAfter.find((r) => r.fixture_uid === "fx_uid_a8a")?.package_id, rowA?.package_id);
  suite.check("A8: tidak ada row untuk UID B", !rowsAfter.some((r) => r.fixture_uid === "fx_uid_a8b"));
}

// ============================================================================
// A9 — dua leg, tim + kompetisi sama, UID berbeda → keduanya terprediksi
// ============================================================================
console.log("\nA9. Dua leg dengan tim/kompetisi sama, UID berbeda");
{
  const env = makeEnv("a9");
  seedFixture(env, { matchId: "fd_119", uid: "fx_uid_a9l1", kickoff: "2026-11-28T20:00:00.000Z" });
  seedFixture(env, { matchId: "fd_120", uid: "fx_uid_a9l2", kickoff: "2026-12-05T20:00:00.000Z" });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRows(env);
  suite.eq("A9: kedua leg tersimpan", s.predicted_new, 2);
  suite.eq(
    "A9: UID kedua leg",
    rows.map((r) => r.fixture_uid).sort(),
    ["fx_uid_a9l1", "fx_uid_a9l2"],
  );
}

// ============================================================================
// A10 — provenance: marker A/B/C + hash payload mentah + hash manifest byte
// ============================================================================
console.log("\nA10. Provenance champion + hash payload/manifest");
{
  const env = makeEnv("a10");
  const rawPayloadA = '{"fixture": {"home": "Prov Home", "away": "Prov Away"}, "probabilities": {"1x2:1": 0.5, "1x2:x": 0.3, "1x2:2": 0.2}}';
  addUpcoming(env, "fd_121", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a10a", ["fd_121"]);
  addPkg(env, {
    matchId: "fd_121",
    computed: "2026-11-27T09:00:00.000Z",
    kickoff: "2026-11-27T20:00:00.000Z",
    marker: "sha256:aaaaaaaabbbbbbbbccccccccdddddddd",
    payloadRaw: rawPayloadA,
  });
  addUpcoming(env, "fd_122", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a10b", ["fd_122"]);
  addPkg(env, {
    matchId: "fd_122",
    computed: "2026-11-27T09:00:00.000Z",
    kickoff: "2026-11-27T20:00:00.000Z",
    marker: "mrk-pendek",
  });
  addUpcoming(env, "fd_123", "2026-11-27T20:00:00.000Z");
  addIdentity(env, "fx_uid_a10c", ["fd_123"]);
  addPkg(env, {
    matchId: "fd_123",
    computed: "2026-11-27T09:00:00.000Z",
    kickoff: "2026-11-27T20:00:00.000Z",
    marker: null,
  });
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRows(env);
  const byUid = new Map(rows.map((r) => [r.fixture_uid, r]));
  suite.eq("A10: tiga fixture tersimpan", s.predicted_new, 3);
  suite.eq("A10: marker A tersalin apa adanya", byUid.get("fx_uid_a10a")?.champion_ratings_marker, "sha256:aaaaaaaabbbbbbbbccccccccdddddddd");
  suite.eq("A10: status A = package_marker", byUid.get("fx_uid_a10a")?.champion_provenance_status, "package_marker");
  suite.eq("A10: marker pendek B tetap ditulis sebagai marker pendek", byUid.get("fx_uid_a10b")?.champion_ratings_marker, "mrk-pendek");
  suite.eq("A10: status B = package_marker", byUid.get("fx_uid_a10b")?.champion_provenance_status, "package_marker");
  suite.eq("A10: marker C kosong tersimpan kosong", byUid.get("fx_uid_a10c")?.champion_ratings_marker, null);
  suite.eq("A10: status C = unknown", byUid.get("fx_uid_a10c")?.champion_provenance_status, "unknown");
  suite.eq(
    "A10: hash payload = SHA-256 string mentah (dengan spasi asli)",
    byUid.get("fx_uid_a10a")?.package_payload_sha256,
    sha256Str(rawPayloadA),
  );
  suite.eq(
    "A10: hash kandidat = SHA-256 byte manifest",
    byUid.get("fx_uid_a10a")?.candidate_manifest_sha256,
    sha256FilePitA(env.manifestPath),
  );
  suite.eq("A10: candidate_id dari manifest", byUid.get("fx_uid_a10a")?.candidate_id, "ml1-b-fixture-candidate");
}

// ============================================================================
// A11 — runner gagal / keluaran rusak → throw, tanpa row parsial; rerun bisa
// ============================================================================
console.log("\nA11. Kegagalan runner dan keluaran rusak");
{
  const env = makeEnv("a11");
  seedFixture(env, { matchId: "fd_124", uid: "fx_uid_a11a", kickoff: "2026-11-27T20:00:00.000Z" });
  seedFixture(env, { matchId: "fd_125", uid: "fx_uid_a11b", kickoff: "2026-11-27T21:00:00.000Z" });
  const clk = makeClock(DECISION);

  let threw = false;
  try {
    runPitA(env, { clock: clk.clock, executor: stubExecutor(env, { fail: true }) });
  } catch {
    threw = true;
  }
  suite.check("A11: executor gagal → run melempar (CLI exit nonzero)", threw);
  suite.eq("A11: tanpa row parsial sesudah gagal", readRows(env).length, 0);

  for (const corrupt of ["missing", "extra", "nan"] as const) {
    let t = false;
    try {
      runPitA(env, { clock: clk.clock, executor: stubExecutor(env, { corrupt }) });
    } catch {
      t = true;
    }
    suite.check(`A11: keluaran rusak (${corrupt}) → run melempar`, t);
  }
  suite.eq("A11: tetap tanpa row sesudah keluaran rusak", readRows(env).length, 0);

  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A11: rerun sehat menyelesaikan kedua fixture", s.predicted_new, 2);

  // Executor produksi: keluaran runner duplikat ditolak sebelum write.
  const fakeRunner = path.join(env.root, "fake-runner.mjs");
  fs.writeFileSync(
    fakeRunner,
    `import fs from "node:fs";
     const args = process.argv.slice(2);
     const out = args.find((a) => a.startsWith("--output=")).slice("--output=".length);
     const inp = args.find((a) => a.startsWith("--input=")).slice("--input=".length);
     const first = JSON.parse(fs.readFileSync(inp, "utf8").split("\\n")[0]);
     const line = JSON.stringify({ match: first.match, lam: 1.5, mu: 1.2 });
     fs.writeFileSync(out, line + "\\n" + line + "\\n");
    `,
  );
  const prodExec = createPythonInferenceExecutor({ pythonPath: process.execPath, predictScriptPath: fakeRunner });
  let execThrew = false;
  try {
    prodExec({
      modelDir: env.modelDir,
      requests: [{ match_id: "fd_124", champLam: 1.5, champMu: 1.2, featB: new Array(32).fill(0) }],
    });
  } catch {
    execThrew = true;
  }
  suite.check("A11: executor produksi menolak keluaran duplikat", execThrew);
}

// ============================================================================
// A12 — isolasi DB + pilot; CLI menolak --now; mode legacy tetap kompatibel
// ============================================================================
console.log("\nA12. Isolasi, penolakan --now, dan kompatibilitas legacy");
{
  const env = makeEnv("a12");
  // DB pilot legacy dengan satu baris — tidak boleh disentuh mode PIT A.
  const pilot = new DatabaseSync(env.pilotPath);
  pilot.exec("CREATE TABLE predictions (match_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  pilot.prepare("INSERT INTO predictions (match_id, status) VALUES ('fd_pilot', 'pending')").run();
  pilot.close();
  seedFixture(env, { matchId: "fd_126", uid: "fx_uid_a12", kickoff: "2026-11-27T20:00:00.000Z" });

  const hashTree = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const f of fs.readdirSync(env.dataDir).sort()) {
      map.set(f, sha256FilePitA(path.join(env.dataDir, f)));
    }
    return map;
  };
  const before = hashTree();
  const clk = makeClock(DECISION);
  const s = runPitA(env, { clock: clk.clock, executor: stubExecutor(env) });
  suite.eq("A12: run PIT A menyimpan 1 row", s.predicted_new, 1);
  const after = hashTree();
  let inputsIdentical = true;
  for (const [name, h] of before) {
    if (after.get(name) !== h) inputsIdentical = false;
  }
  suite.check("A12: hash semua file input + pilot identik sebelum/sesudah", inputsIdentical,
    `before=${JSON.stringify([...before.keys()])} after=${JSON.stringify([...after.keys()])}`);
  suite.check(
    "A12: satu-satunya file baru adalah DB PIT A",
    [...after.keys()].every((k) => before.has(k) || k === "ml1_prospective_pit_a.db"),
    JSON.stringify([...after.keys()]),
  );
  suite.eq("A12: DB pilot tetap berisi baris aslinya", (() => {
    const db = new DatabaseSync(env.pilotPath, { readOnly: true });
    const n = (db.prepare("SELECT COUNT(*) AS n FROM predictions").get() as { n: number }).n;
    db.close();
    return n;
  })(), 1);

  // CLI: --pit-a --now ditolak dengan arahan ke fixture uji.
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const reject = spawnSync(tsx, [path.join(REPO_ROOT, "scripts/ml1-prospective.ts"), "--pit-a", "--now=2026-11-27T10:00:00.000Z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DB_DIR: env.dataDir, TZ: "UTC" },
  });
  suite.check("A12: CLI --pit-a --now exit nonzero", (reject.status ?? 1) !== 0, `status=${reject.status}`);
  suite.check("A12: pesan penolakan mengarahkan ke fixture uji", /fixture uji/.test(reject.stderr ?? ""), reject.stderr ?? "");

  // Mode legacy pada env tanpa paket: ringkasan cron lama tetap terbit.
  const envL = makeEnv("a12legacy");
  const legacy = spawnSync(tsx, [path.join(REPO_ROOT, "scripts/ml1-prospective.ts")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DB_DIR: envL.dataDir, TZ: "UTC" },
    maxBuffer: 64 * 1024 * 1024,
  });
  suite.eq("A12: legacy CLI exit 0 pada env fixture kosong", legacy.status, 0);
  const lastLine = (legacy.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  let legacyJson: Record<string, unknown> | null = null;
  try {
    legacyJson = JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    legacyJson = null;
  }
  suite.check("A12: legacy tetap mencetak JSON ringkasan cron", legacyJson !== null, lastLine.slice(0, 200));
  suite.eq("A12: legacy tool id tidak berubah", legacyJson?.tool, "ml1-prospective");
  suite.eq("A12: legacy predicted_new = 0", legacyJson?.predicted_new, 0);
  suite.eq("A12: legacy status COLLECTING", legacyJson?.status, "COLLECTING");
  suite.check(
    "A12: legacy mempertahankan kunci ringkasan cron",
    legacyJson !== null && "graded_new" in legacyJson && "guard_identical" in legacyJson && "kompetitif" in legacyJson,
  );
}

// ----------------------------------------------------------------------------
for (const root of envsToClean) {
  if (suite.failedCount === 0) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`[fixture] sandbox dipertahankan untuk inspeksi: ${root}`);
}
suite.finish();
