/**
 * ML1-PIT B — suite acceptance Brief ML1-PIT B §5 + regresi §1.
 *
 * Menguji jalur yang sama dengan CLI (`runMl1PitB` di lib/eval/ml1-pit-b.ts)
 * dengan clock + executor injeksi di atas fixture SQLite sintetis (tiga
 * store WAL, dua koneksi penulis independen untuk race sesudah pin).
 * Smoke inferensi Python asli dilaporkan terpisah, bukan di suite ini.
 *
 * Kasus (pemetaan §5 brief):
 *  B1  Hasil lama available_at NULL terlihat di snapshot → usable dengan
 *      bukti snapshot_visible; manifest + proyeksi + hash konsisten;
 *      replay dari artefak mereproduksi hash vektor baris tersimpan.
 *  B2  Hasil masuk 10.01 (sesudah cutoff 10.00, saat inferensi) → keputusan
 *      lama tidak memasukkannya (form/Elo/proyeksi); keputusan baru boleh.
 *      Varian: available_at 10.01 yang sudah ada sebelum pin → dikeluarkan
 *      oleh aturan observasi eksplisit + dihitung.
 *  B3  Koreksi skor lama + shots lama datang sesudah cutoff → replay
 *      snapshot lama = tepat 32 nilai + hash sama; snapshot baru
 *      memperlihatkan perubahan (termasuk late shots bertanggal lama).
 *  B4  Hasil target/alias target sudah ada + event sesudah cutoff
 *      berstatus finished → dikeluarkan; Elo tidak bergerak (vektor sama
 *      persis dengan env bersih).
 *  B5  Shots bertanggal sama dengan cutoff tanpa jam event → dikeluarkan
 *      + terhitung; missing flags sesuai kontrak booster untuk tim baru.
 *  B6  Registry berubah saat inferensi → fitur + hash cocok dengan
 *      registry yang benar-benar dibaca (byte terpin).
 *  B7  Regresi §1a: presisi timestamp campuran (09:00:00Z vs
 *      09:00:00.500Z) → edisi .500Z menang; tie-break ID untuk dua string
 *      ber-instant sama. Berlaku untuk mode B dan mode A (selector sama).
 *  B8  Regresi §1b: bridge dihapus saat inferensi → skip; tautan dua hop
 *      ke UID lain ditambah saat inferensi → skip; kontrol tersimpan.
 *  B9  Proyeksi rusak/hilang/isi berubah → replay gagal eksplisit.
 *  B10 Parity + isolasi: input bersih → vektor B == vektor A (extractor
 *      warisan); DB input + pilot + PIT A utuh logis; CLI menolak
 *      --pit-b --now dan kombinasi --pit-a --pit-b.
 *  B11 Pin lintas store: edisi paket yang di-commit penulis kedua sesudah
 *      pin tidak terlihat run berjalan (WAL, tiga store).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT, Suite } from "./helpers/fixture-env";
import {
  runMl1PitA,
  sha256FilePitA,
  type PitAInferenceExecutor,
} from "../lib/eval/ml1-pit-a";
import {
  replayPitBProjectionFile,
  runMl1PitB,
  PIT_B_EVAL_VERSION,
  type PitBRunSummary,
} from "../lib/eval/ml1-pit-b";
import { ELO_START } from "../lib/eval/q0-baselines";
import { ML1_B_FEATURE_NAMES } from "../lib/eval/ml1-features";
import { ensureIdentitySchema } from "../lib/identity/fixture-resolver";
import { ensurePackagesSchema } from "../lib/picks/packages";

const suite = new Suite("ML1-PIT B (Brief ML1-PIT B §5)");
const DECISION = "2026-11-27T10:00:00.000Z";
const KICKOFF = "2026-11-28T20:00:00.000Z";
const envsToClean: string[] = [];
const sha256Str = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const IDX = (name: string): number => ML1_B_FEATURE_NAMES.indexOf(name as never);

// ============================================================================
// Fixture env
// ============================================================================
interface PitBEnv {
  root: string;
  dataDir: string;
  staticDir: string;
  datasetPath: string;
  upcomingPath: string;
  snapshotsPath: string;
  outputPath: string;
  pilotPath: string;
  pitAPath: string;
  modelDir: string;
  manifestPath: string;
  projectionDir: string;
}

function makeEnv(label: string): PitBEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bola-pitb-${label}-`));
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
      status TEXT, season TEXT, available_at TEXT
    );
    CREATE TABLE team_match_logs_canonical (
      log_id TEXT, team_id TEXT, match_date TEXT, shots_for REAL, shots_against REAL,
      shots_on_target_for REAL, shots_on_target_against REAL, chosen_source TEXT
    );
    CREATE TABLE league_calibration (league_id TEXT PRIMARY KEY, status TEXT);
  `);
  ensureIdentitySchema(ds);
  ds.prepare("INSERT INTO league_calibration (league_id, status) VALUES ('sm:100', 'calibrated')").run();
  // Riwayat kaya: kedua tim target punya 4 laga lampau sebelum 28 Nov.
  const insM = ds.prepare(
    "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES (?, 'sm:100', ?, ?, ?, ?, ?, 'finished', '2026', ?)",
  );
  insM.run("mt_h1", "2026-11-10T20:00:00.000Z", "tm_h1", "tm_x1", 3, 0, "2026-11-10T22:05:00.000Z");
  insM.run("mt_h2", "2026-11-14T20:00:00.000Z", "tm_x1", "tm_h1", 1, 2, "2026-11-14T22:05:00.000Z");
  insM.run("mt_h3", "2026-11-18T20:00:00.000Z", "tm_h1", "tm_a1", 2, 1, "2026-11-18T22:05:00.000Z");
  insM.run("mt_h4", "2026-11-21T20:00:00.000Z", "tm_a1", "tm_x2", 1, 1, "2026-11-21T22:05:00.000Z");
  insM.run("mt_h5", "2026-11-24T20:00:00.000Z", "tm_x2", "tm_a1", 0, 2, "2026-11-24T22:05:00.000Z");
  // Row LAMA bercap versi kosong: available_at NULL — terlihat di snapshot.
  insM.run("mt_h6", "2026-11-25T20:00:00.000Z", "tm_a1", "tm_h1", 1, 0, null);
  const insL = ds.prepare(
    "INSERT INTO team_match_logs_canonical (log_id, team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against, chosen_source) VALUES (?, ?, ?, ?, ?, ?, ?, 'thestats')",
  );
  insL.run("log_h1a", "tm_h1", "2026-11-10", 14, 6, 6, 2);
  insL.run("log_h1b", "tm_h1", "2026-11-14", 10, 9, 4, 3);
  insL.run("log_h1c", "tm_h1", "2026-11-18", 12, 8, 5, 3);
  insL.run("log_h1d", "tm_h1", "2026-11-25", 11, 7, 5, 2);
  insL.run("log_a1a", "tm_a1", "2026-11-18", 8, 12, 3, 5);
  insL.run("log_a1b", "tm_a1", "2026-11-21", 9, 10, 4, 4);
  insL.run("log_a1c", "tm_a1", "2026-11-24", 13, 5, 6, 2);
  insL.run("log_a1d", "tm_a1", "2026-11-25", 7, 11, 2, 5);
  ds.exec("PRAGMA journal_mode=WAL");
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
    PRAGMA journal_mode=WAL;
  `);
  up.close();

  const snapshotsPath = path.join(dataDir, "analysis_snapshots.db");
  const sn = new DatabaseSync(snapshotsPath);
  ensurePackagesSchema(sn);
  sn.exec("PRAGMA journal_mode=WAL");
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
    outputPath: path.join(dataDir, "ml1_prospective_pit_b.db"),
    pilotPath: path.join(dataDir, "ml1_prospective.db"),
    pitAPath: path.join(dataDir, "ml1_prospective_pit_a.db"),
    modelDir,
    manifestPath,
    projectionDir: path.join(dataDir, "pitb-projections"),
  };
}

// ------------------------------------------------------------ seed helpers --
function addUpcoming(
  env: PitBEnv,
  matchId: string,
  kickoff: string,
  opts: { status?: string; homeId?: string; awayId?: string; homeName?: string; awayName?: string } = {},
): void {
  const db = new DatabaseSync(env.upcomingPath);
  db.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name)
     VALUES (?, 'sm:100', 'Fixture League', ?, ?, ?, ?, ?, ?)`,
  ).run(
    matchId, kickoff, opts.status ?? "scheduled",
    opts.homeId ?? "tm_h1", opts.homeName ?? "Fixture Home",
    opts.awayId ?? "tm_a1", opts.awayName ?? "Fixture Away",
  );
  db.close();
}

function addIdentity(
  env: PitBEnv,
  uid: string,
  matchIds: string[],
  opts: { home?: string; away?: string; kickoff?: string } = {},
): void {
  const db = new DatabaseSync(env.datasetPath);
  db.prepare(
    `INSERT OR IGNORE INTO canonical_fixtures (fixture_uid, competition_id, home_name, away_name, kickoff_utc, state, created_at, updated_at)
     VALUES (?, 'sm:100', ?, ?, ?, 'scheduled', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  ).run(uid, opts.home ?? "Fixture Home", opts.away ?? "Fixture Away", opts.kickoff ?? KICKOFF);
  const ins = db.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES (?, ?, ?, 'fixture', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  );
  for (const id of matchIds) {
    ins.run(id.startsWith("sm_") ? "sportmonks" : "football-data", id, uid);
  }
  db.close();
}

function setLinks(env: PitBEnv, links: { twin_id: string; canonical_id: string }[]): void {
  fs.writeFileSync(path.join(env.staticDir, "fixture-links.json"), JSON.stringify({ links }));
}

function addPkg(
  env: PitBEnv,
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

function seedFixture(
  env: PitBEnv,
  opts: {
    matchId: string;
    uid: string;
    kickoff?: string;
    computed?: string;
    lam?: number;
    alsoIds?: string[];
    homeId?: string;
    awayId?: string;
    homeName?: string;
    awayName?: string;
  },
): number {
  const kickoff = opts.kickoff ?? KICKOFF;
  addUpcoming(env, opts.matchId, kickoff, { homeId: opts.homeId, awayId: opts.awayId, homeName: opts.homeName, awayName: opts.awayName });
  addIdentity(env, opts.uid, [opts.matchId, ...(opts.alsoIds ?? [])], { kickoff });
  return addPkg(env, {
    matchId: opts.matchId,
    computed: opts.computed ?? "2026-11-27T09:00:00.000Z",
    kickoff,
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
  env: PitBEnv,
  opts: { onCall?: (requests: { match_id: string }[]) => void; fail?: boolean } = {},
): PitAInferenceExecutor {
  return ({ requests }) => {
    if (opts.fail) throw new Error("stub executor gagal (fixture)");
    opts.onCall?.(requests);
    return {
      results: new Map(
        requests.map((r) => [r.match_id, { lam: r.champLam * 1.05, mu: r.champMu * 0.95 }] as const),
      ),
      candidateId: "ml1-b-fixture-candidate",
      candidateManifestSha256: sha256FilePitA(env.manifestPath),
    };
  };
}

function runPitB(
  env: PitBEnv,
  opts: { clock: () => Date; executor: PitAInferenceExecutor; limit?: number; outputPath?: string },
): PitBRunSummary {
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  const upcoming = new DatabaseSync(env.upcomingPath, { readOnly: true });
  const snapshots = new DatabaseSync(env.snapshotsPath, { readOnly: true });
  try {
    return runMl1PitB({
      dataset,
      upcoming,
      snapshots,
      outputDbPath: opts.outputPath ?? env.outputPath,
      projectionDir: env.projectionDir,
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

interface StoredRowB {
  fixture_uid: string;
  source_match_id: string;
  package_id: number;
  champ_lam: number;
  feature_time_status: string;
  input_evidence_status: string;
  grading_status: string;
  status: string;
  feature_snapshot_id: string;
  features_sha256: string;
  features_json: string;
  home_team_key: string;
  away_team_key: string;
  elo_fallback_home: number;
  elo_fallback_away: number;
  champion_ratings_marker: string | null;
  champion_provenance_status: string;
  [k: string]: unknown;
}

function readRowsB(env: PitBEnv, outputPath?: string): StoredRowB[] {
  const p = outputPath ?? env.outputPath;
  if (!fs.existsSync(p)) return [];
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM predictions ORDER BY fixture_uid").all() as unknown as StoredRowB[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function readManifestB(env: PitBEnv, outputPath?: string): Record<string, unknown>[] {
  const p = outputPath ?? env.outputPath;
  if (!fs.existsSync(p)) return [];
  const db = new DatabaseSync(p, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM feature_snapshots").all() as unknown as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function featsOf(row: StoredRowB | undefined): number[] {
  return row ? (JSON.parse(row.features_json) as number[]) : [];
}

// ============================================================================
// B1 — snapshot_visible untuk row lama available_at NULL + artefak konsisten
// ============================================================================
console.log("\nB1. Bukti snapshot_visible + manifest + replay konsisten");
{
  const env = makeEnv("b1");
  seedFixture(env, { matchId: "fd_201", uid: "fx_uid_b1", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  const s = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRowsB(env);
  suite.eq("B1: satu row tersimpan", s.predicted_new, 1);
  suite.eq("B1: decision_at_utc dari clock sesudah pin", s.decision_at_utc, DECISION);
  const pins = s.snapshot_pinned_at_utc;
  suite.check(
    "B1: pin tercatat untuk tiga store dan semuanya <= decision",
    [pins.snapshots, pins.dataset, pins.upcoming].every((p) => p !== "" && p <= DECISION),
    JSON.stringify(pins),
  );
  suite.eq("B1: feature_time_status = snapshot_visible", rows[0]?.feature_time_status, "snapshot_visible");
  suite.eq("B1: input_evidence_status = snapshot_visible", rows[0]?.input_evidence_status, "snapshot_visible");
  suite.eq("B1: grading_status terpisah = pending", rows[0]?.grading_status, "pending");
  suite.eq("B1: status data = PIT_B_STAGED", rows[0]?.status, "PIT_B_STAGED");
  suite.eq("B1: row mengacu feature_snapshot_id ringkasan", rows[0]?.feature_snapshot_id, s.feature_snapshot_id);
  // Row lama mt_h6 (available_at NULL) ikut terproyeksi → usable untuk keputusan ini.
  const projPath = path.join(env.projectionDir, s.projection?.file ?? "");
  suite.check("B1: file proyeksi ada di direktori artefak", fs.existsSync(projPath), projPath);
  const replay = replayPitBProjectionFile(projPath, { expectedSha256: s.feature_snapshot_id ?? "" });
  suite.eq("B1: replay feature_snapshot_id == ringkasan", replay.feature_snapshot_id, s.feature_snapshot_id);
  suite.eq(
    "B1: hash vektor replay == features_sha256 baris",
    replay.vectorHashes.get("fx_uid_b1"),
    rows[0]?.features_sha256,
  );
  suite.eq("B1: vektor tepat 32 nilai", replay.vectors.get("fx_uid_b1")?.length, 32);
  const man = readManifestB(env);
  suite.eq("B1: satu baris manifest snapshot", man.length, 1);
  suite.eq("B1: manifest projection_sha256 == snapshot id", man[0]?.projection_sha256, s.feature_snapshot_id);
  const manPins = JSON.parse(String(man[0]?.snapshot_pinned_at_utc_json ?? "{}")) as Record<string, string>;
  suite.eq(
    "B1: manifest menyimpan pin per store (3 store)",
    Object.keys(manPins).sort(),
    ["dataset", "snapshots", "upcoming"],
  );
  suite.eq("B1: hasil lama NULL-cap terproyeksi (6 hasil)", s.visibility.results_projected, 6);
  suite.eq("B1: tidak ada hasil terbuang di env bersih", s.visibility.results_excluded_observation_after_cutoff, 0);
  suite.check("B1: ringkasan memuat ukuran artefak + timing", (s.projection?.bytes ?? 0) > 0 && s.timings.batch_ms >= 0 && s.timings.read_transaction_ms >= 0);
}

// ============================================================================
// B2 — hasil masuk 10.01: keputusan lama tidak melihatnya; keputusan baru boleh
// ============================================================================
console.log("\nB2. Hasil tiba sesudah cutoff (10.01) — lama vs keputusan baru");
{
  const env = makeEnv("b2");
  seedFixture(env, { matchId: "fd_202", uid: "fx_uid_b2", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  // Penulis kedua memasukkan hasil laga 26 Nov SAAT inferensi (sesudah pin):
  // available_at-nya 10.01 — satu menit sesudah cutoff keputusan 10.00.
  const exec = stubExecutor(env, {
    onCall: () => {
      const ds = new DatabaseSync(env.datasetPath);
      ds.prepare(
        "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES ('mt_h7', 'sm:100', '2026-11-26T20:00:00.000Z', 'tm_h1', 'tm_a1', 5, 0, 'finished', '2026', '2026-11-27T10:01:00.000Z')",
      ).run();
      ds.close();
    },
  });
  const s1 = runPitB(env, { clock: clk.clock, executor: exec });
  const rows1 = readRowsB(env);
  const f1 = featsOf(rows1[0]);
  suite.eq("B2 run lama: row tersimpan", s1.predicted_new, 1);
  suite.eq("B2 run lama: form_gf5_home tanpa hasil 10.01", f1[IDX("form_gf5_home")], 1.75);
  suite.eq("B2 run lama: hasil terproyeksi tetap 6 (mt_h7 absen dari snapshot)", s1.visibility.results_projected, 6);
  const projJsonl1 = gunzipSync(fs.readFileSync(path.join(env.projectionDir, s1.projection?.file ?? ""))).toString("utf8");
  suite.check(
    "B2 run lama: proyeksi terarsip tidak memuat mt_h7",
    !projJsonl1.includes('"mt_h7"'),
  );
  // Keputusan baru (12.00) di DB shadow baru: hasil yang sama kini terlihat
  // (event 26 Nov < keputusan; observasi 10.01 <= 12.00) dan boleh dipakai.
  const out2 = path.join(env.dataDir, "ml1_prospective_pit_b2.db");
  clk.set("2026-11-27T12:00:00.000Z");
  const s2 = runPitB(env, { clock: clk.clock, executor: stubExecutor(env), outputPath: out2 });
  const rows2 = readRowsB(env, out2);
  const f2 = featsOf(rows2[0]);
  suite.eq("B2 run baru: row tersimpan", s2.predicted_new, 1);
  suite.eq("B2 run baru: hasil terproyeksi 7 (mt_h7 masuk)", s2.visibility.results_projected, 7);
  suite.eq("B2 run baru: form_gf5_home memuat hasil itu", f2[IDX("form_gf5_home")], 2.4);
  suite.check("B2: Elo ikut bergerak pada keputusan baru", f2[IDX("elo_home")] !== f1[IDX("elo_home")], `elo ${f1[IDX("elo_home")]} -> ${f2[IDX("elo_home")]}`);

  // Varian: available_at 10.01 SUDAH ada sebelum pin, keputusan 10.00 →
  // dikeluarkan oleh aturan observasi eksplisit dan dihitung sebagai konflik.
  const env3 = makeEnv("b2obs");
  seedFixture(env3, { matchId: "fd_202", uid: "fx_uid_b2", kickoff: KICKOFF });
  const ds3 = new DatabaseSync(env3.datasetPath);
  ds3.prepare(
    "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES ('mt_h7', 'sm:100', '2026-11-26T20:00:00.000Z', 'tm_h1', 'tm_a1', 5, 0, 'finished', '2026', '2026-11-27T10:01:00.000Z')",
  ).run();
  ds3.close();
  const clk3 = makeClock(DECISION);
  const s3 = runPitB(env3, { clock: clk3.clock, executor: stubExecutor(env3) });
  const f3 = featsOf(readRowsB(env3)[0]);
  suite.eq("B2 observasi: konflik observasi terhitung 1", s3.visibility.results_excluded_observation_after_cutoff, 1);
  suite.eq("B2 observasi: form tetap baseline", f3[IDX("form_gf5_home")], 1.75);
}

// ============================================================================
// B3 — koreksi skor + late shots sesudah cutoff: replay lama identik
// ============================================================================
console.log("\nB3. Koreksi sesudah cutoff — replay snapshot lama vs snapshot baru");
{
  const env = makeEnv("b3");
  seedFixture(env, { matchId: "fd_203", uid: "fx_uid_b3", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  const s1 = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const row1 = readRowsB(env)[0];
  const v1 = featsOf(row1);
  suite.eq("B3 run 1: form_ga5_home baseline", v1[IDX("form_ga5_home")], 0.75);
  suite.eq("B3 run 1: shots_for_home baseline", v1[IDX("shots_for_home")], 11.75);

  // Sesudah run 1: koreksi skor mt_h3 (2-1 -> 2-4) + shots lama tiba
  // (tanggal log 19 Nov — sebelum cutoff — tetapi BARU masuk store sekarang).
  const ds = new DatabaseSync(env.datasetPath);
  ds.prepare("UPDATE matches SET away_score = 4 WHERE match_id = 'mt_h3'").run();
  ds.prepare(
    "INSERT INTO team_match_logs_canonical (log_id, team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against, chosen_source) VALUES ('log_late_1', 'tm_h1', '2026-11-19', 20, 4, 9, 2, 'thestats')",
  ).run();
  ds.close();

  // Replay proyeksi lama: tepat 32 nilai + hash yang sama persis.
  const replayOld = replayPitBProjectionFile(path.join(env.projectionDir, s1.projection?.file ?? ""), {
    expectedSha256: row1?.feature_snapshot_id,
  });
  suite.eq("B3: replay lama = 32 nilai", replayOld.vectors.get("fx_uid_b3")?.length, 32);
  suite.eq("B3: replay lama hash == hash baris tersimpan", replayOld.vectorHashes.get("fx_uid_b3"), row1?.features_sha256);
  suite.eq(
    "B3: replay lama vektor identik byte-per-byte",
    JSON.stringify(replayOld.vectors.get("fx_uid_b3")),
    JSON.stringify(v1),
  );

  // Snapshot baru memperlihatkan koreksi + late shots.
  const out2 = path.join(env.dataDir, "ml1_prospective_pit_b2.db");
  clk.set("2026-11-27T12:00:00.000Z");
  const s2 = runPitB(env, { clock: clk.clock, executor: stubExecutor(env), outputPath: out2 });
  const v2 = featsOf(readRowsB(env, out2)[0]);
  suite.eq("B3 run 2: form_ga5_home memuat koreksi 2-4", v2[IDX("form_ga5_home")], 1.5);
  suite.eq("B3 run 2: shots_for_home memuat late shots 19 Nov", v2[IDX("shots_for_home")], 13.4);
  suite.check("B3: snapshot id baru berbeda dari yang lama", s2.feature_snapshot_id !== s1.feature_snapshot_id);
  suite.eq("B3: baris run 1 tidak berubah", readRowsB(env)[0]?.features_sha256, row1?.features_sha256);
}

// ============================================================================
// B4 — hasil target/alias + event pasca-cutoff finished → keluar; Elo diam
// ============================================================================
console.log("\nB4. Anomali target + event sesudah cutoff dikeluarkan dari histori");
{
  const clean = makeEnv("b4clean");
  seedFixture(clean, { matchId: "fd_204", uid: "fx_uid_b4", kickoff: KICKOFF, alsoIds: ["sm_204"] });
  const clkC = makeClock(DECISION);
  runPitB(clean, { clock: clkC.clock, executor: stubExecutor(clean) });
  const cleanRow = readRowsB(clean)[0];

  const dirty = makeEnv("b4dirty");
  seedFixture(dirty, { matchId: "fd_204", uid: "fx_uid_b4", kickoff: KICKOFF, alsoIds: ["sm_204"] });
  const ds = new DatabaseSync(dirty.datasetPath);
  // Hasil untuk fixture target itu sendiri, tercatat atas alias sm_204.
  ds.prepare(
    "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES ('sm_204', 'sm:100', '2026-11-28T20:00:00.000Z', 'tm_h1', 'tm_a1', 9, 9, 'finished', '2026', '2026-11-27T09:30:00.000Z')",
  ).run();
  // Event LAIN sesudah cutoff (27 Nov 18.00) yang sudah berstatus finished.
  ds.prepare(
    "INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES ('mt_h8', 'sm:100', '2026-11-27T18:00:00.000Z', 'tm_h1', 'tm_x1', 4, 0, 'finished', '2026', '2026-11-27T09:45:00.000Z')",
  ).run();
  ds.close();
  const clkD = makeClock(DECISION);
  const sD = runPitB(dirty, { clock: clkD.clock, executor: stubExecutor(dirty) });
  const dirtyRow = readRowsB(dirty)[0];
  suite.eq("B4: komponen target dikeluarkan (1)", sD.visibility.results_excluded_target_component, 1);
  suite.eq("B4: event sesudah cutoff dikeluarkan (1)", sD.visibility.results_excluded_event_not_before_decision, 1);
  suite.eq("B4: vektor dirty == vektor clean (hash)", dirtyRow?.features_sha256, cleanRow?.features_sha256);
  suite.eq(
    "B4: Elo home tidak bergerak",
    featsOf(dirtyRow)[IDX("elo_home")],
    featsOf(cleanRow)[IDX("elo_home")],
  );
}

// ============================================================================
// B5 — shots tanggal == cutoff tanpa jam event → keluar + terhitung; flags
// ============================================================================
console.log("\nB5. Presisi tanggal shots + missing flags kontrak booster");
{
  const env = makeEnv("b5");
  seedFixture(env, { matchId: "fd_205", uid: "fx_uid_b5a", kickoff: KICKOFF });
  // Tim tanpa riwayat sama sekali (fallback Elo awal + flags missing).
  seedFixture(env, {
    matchId: "fd_206",
    uid: "fx_uid_b5b",
    kickoff: KICKOFF,
    homeId: "tm_new1",
    awayId: "tm_new2",
    homeName: "New Home",
    awayName: "New Away",
  });
  const ds = new DatabaseSync(env.datasetPath);
  // Shots bertanggal PERSIS tanggal keputusan (27 Nov) tanpa jam event,
  // nilai ekstrem — bila bocor, rata-rata shots tm_a1 berubah drastis.
  ds.prepare(
    "INSERT INTO team_match_logs_canonical (log_id, team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against, chosen_source) VALUES ('log_same_day', 'tm_a1', '2026-11-27', 99, 99, 99, 99, 'thestats')",
  ).run();
  ds.close();
  const clk = makeClock(DECISION);
  const s = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRowsB(env);
  const byUid = new Map(rows.map((r) => [r.fixture_uid, r]));
  suite.eq("B5: dua fixture tersimpan", s.predicted_new, 2);
  suite.eq("B5: shots tanggal-sama terhitung dikeluarkan", s.visibility.shots_excluded_date_precision, 1);
  suite.eq("B5: shots_for_away tetap baseline (tidak bocor 99)", featsOf(byUid.get("fx_uid_b5a"))[IDX("shots_for_away")], 9.25);
  const fb = featsOf(byUid.get("fx_uid_b5b"));
  suite.eq("B5: tim baru has_prior_shots_home = 0", fb[IDX("has_prior_shots_home")], 0);
  suite.eq("B5: tim baru has_prior_shots_away = 0", fb[IDX("has_prior_shots_away")], 0);
  suite.eq("B5: tim baru n_prior_shots_home = 0", fb[IDX("n_prior_shots_home")], 0);
  suite.eq("B5: tim baru miss_form_home = 1", fb[IDX("miss_form_home")], 1);
  suite.eq("B5: tim baru elo_home = ELO_START", fb[IDX("elo_home")], ELO_START);
  suite.eq("B5: tim baru elo_away = ELO_START", fb[IDX("elo_away")], ELO_START);
  suite.eq("B5: flag fallback Elo tersimpan di baris", byUid.get("fx_uid_b5b")?.elo_fallback_home, 1);
  suite.eq("B5: coverage menghitung fixture fallback Elo", s.feature_coverage.elo_fallback_fixtures, 1);
}

// ============================================================================
// B6 — registry berubah saat inferensi: fitur mengikuti byte terpin
// ============================================================================
console.log("\nB6. Perubahan registry saat inferensi tidak mengubah fitur");
{
  const env = makeEnv("b6");
  const regV1 = JSON.stringify({
    version: 1,
    teams: [
      {
        canonical_id: "canon_reg_h",
        name: "Reg Home",
        country: null,
        members: [
          { system: "thestats", team_id: "tm_h1", name_as_stored: "H1" },
          { system: "src", team_id: "src_h", name_as_stored: "Reg Home" },
        ],
        aliases: [],
        contested_name: false,
      },
    ],
  });
  const regV2 = JSON.stringify({
    version: 1,
    teams: [
      {
        canonical_id: "canon_other",
        name: "Other",
        country: null,
        members: [
          { system: "thestats", team_id: "tm_a1", name_as_stored: "A1" },
          { system: "src", team_id: "src_h", name_as_stored: "Reg Home" },
        ],
        aliases: [],
        contested_name: false,
      },
    ],
  });
  fs.writeFileSync(path.join(env.staticDir, "team-canonical.json"), regV1);
  seedFixture(env, {
    matchId: "fd_207",
    uid: "fx_uid_b6",
    kickoff: KICKOFF,
    homeId: "src_h",
    homeName: "Reg Home",
  });
  const clk = makeClock(DECISION);
  const exec = stubExecutor(env, {
    onCall: () => {
      // Registry di disk berubah total saat inferensi berjalan.
      fs.writeFileSync(path.join(env.staticDir, "team-canonical.json"), regV2);
    },
  });
  const s = runPitB(env, { clock: clk.clock, executor: exec });
  const rows = readRowsB(env);
  suite.eq("B6: row tersimpan", s.predicted_new, 1);
  suite.eq("B6: home_team_key dari registry terpin (tm_h1)", rows[0]?.home_team_key, "tm_h1");
  suite.eq("B6: form memakai histori tm_h1", featsOf(rows[0])[IDX("form_gf5_home")], 1.75);
  const man = readManifestB(env);
  suite.eq(
    "B6: hash registry di manifest == hash byte v1 yang dibaca",
    man[0]?.registry_team_canonical_sha256,
    sha256Str(regV1),
  );
  suite.check(
    "B6: hash manifest != hash registry v2 di disk sekarang",
    man[0]?.registry_team_canonical_sha256 !== sha256Str(regV2),
  );
}

// ============================================================================
// B7 — regresi §1a: presisi timestamp campuran + tie-break instant sama
// ============================================================================
console.log("\nB7. Regresi timestamp presisi campuran (mode B dan mode A)");
{
  const env = makeEnv("b7");
  // Dua edisi satu ID: 09:00:00Z vs 09:00:00.500Z — instant .500Z lebih baru.
  addUpcoming(env, "fd_208", KICKOFF);
  addIdentity(env, "fx_uid_b7a", ["fd_208"], { kickoff: KICKOFF });
  addPkg(env, { matchId: "fd_208", computed: "2026-11-27T09:00:00Z", kickoff: KICKOFF, lam: 1.1 });
  const idMs = addPkg(env, { matchId: "fd_208", computed: "2026-11-27T09:00:00.500Z", kickoff: KICKOFF, lam: 1.9 });
  // Tie-break: dua string, instant SAMA (09:00:00Z == 09:00:00.000Z) → ID besar.
  addUpcoming(env, "fd_209", KICKOFF);
  addIdentity(env, "fx_uid_b7b", ["fd_209"], { kickoff: KICKOFF });
  addPkg(env, { matchId: "fd_209", computed: "2026-11-27T09:00:00Z", kickoff: KICKOFF, lam: 1.3 });
  const idTie = addPkg(env, { matchId: "fd_209", computed: "2026-11-27T09:00:00.000Z", kickoff: KICKOFF, lam: 1.7 });
  const clk = makeClock(DECISION);
  const s = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rows = readRowsB(env);
  const byUid = new Map(rows.map((r) => [r.fixture_uid, r]));
  suite.eq("B7: dua fixture tersimpan", s.predicted_new, 2);
  suite.eq("B7: edisi .500Z menang atas 09:00:00Z", byUid.get("fx_uid_b7a")?.package_id, idMs);
  suite.eq("B7: champ_lam dari edisi .500Z", byUid.get("fx_uid_b7a")?.champ_lam, 1.9);
  suite.eq("B7: tie instant → ID paket terbesar menang", byUid.get("fx_uid_b7b")?.package_id, idTie);
  suite.eq("B7: champ_lam tie-break", byUid.get("fx_uid_b7b")?.champ_lam, 1.7);

  // Selector yang sama dipakai mode A — regresi tertutup di sana juga.
  const envA = makeEnv("b7a");
  addUpcoming(envA, "fd_208", KICKOFF);
  addIdentity(envA, "fx_uid_b7a", ["fd_208"], { kickoff: KICKOFF });
  addPkg(envA, { matchId: "fd_208", computed: "2026-11-27T09:00:00Z", kickoff: KICKOFF, lam: 1.1 });
  const idMsA = addPkg(envA, { matchId: "fd_208", computed: "2026-11-27T09:00:00.500Z", kickoff: KICKOFF, lam: 1.9 });
  const dsA = new DatabaseSync(envA.datasetPath, { readOnly: true });
  const upA = new DatabaseSync(envA.upcomingPath, { readOnly: true });
  const snA = new DatabaseSync(envA.snapshotsPath, { readOnly: true });
  try {
    runMl1PitA({
      dataset: dsA,
      upcoming: upA,
      snapshots: snA,
      outputDbPath: envA.pitAPath,
      dataDirPath: envA.staticDir,
      modelDir: envA.modelDir,
      clock: makeClock(DECISION).clock,
      executor: stubExecutor(envA),
    });
  } finally {
    dsA.close();
    upA.close();
    snA.close();
  }
  const dbA = new DatabaseSync(envA.pitAPath, { readOnly: true });
  const rowA = dbA.prepare("SELECT package_id, champ_lam FROM predictions").get() as { package_id: number; champ_lam: number };
  dbA.close();
  suite.eq("B7 mode A: edisi .500Z juga menang", rowA.package_id, idMsA);
  suite.eq("B7 mode A: champ_lam .500Z", rowA.champ_lam, 1.9);
}

// ============================================================================
// B8 — regresi §1b: bridge hilang + konflik dua hop saat inferensi
// ============================================================================
console.log("\nB8. Regresi revalidasi alias: bridge hilang + dua hop UID lain");
{
  const env = makeEnv("b8");
  // Fixture X: fd_210 TANPA alias K1; UID hanya lewat bridge ke sm_210.
  addUpcoming(env, "fd_210", KICKOFF);
  addUpcoming(env, "sm_210", KICKOFF);
  addIdentity(env, "fx_uid_b8x", ["sm_210"], { kickoff: KICKOFF });
  const up0 = new DatabaseSync(env.upcomingPath);
  up0.prepare("INSERT INTO sm_id_map (match_id, sm_fixture_id) VALUES ('fd_210', 210)").run();
  up0.close();
  addPkg(env, { matchId: "fd_210", computed: "2026-11-27T09:00:00.000Z", kickoff: KICKOFF });
  // Fixture Y: fd_211 dengan UID sendiri.
  seedFixture(env, { matchId: "fd_211", uid: "fx_uid_b8y", kickoff: KICKOFF });
  // sm_212 membawa UID lain (target hop kedua).
  addIdentity(env, "fx_uid_b8z", ["sm_212"], { kickoff: KICKOFF });
  // Kontrol yang selalu layak.
  seedFixture(env, { matchId: "fd_213", uid: "fx_uid_b8c", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  const exec = stubExecutor(env, {
    onCall: () => {
      const up = new DatabaseSync(env.upcomingPath);
      // (i) bridge satu-satunya penghubung fd_210 -> UID dihapus.
      up.prepare("DELETE FROM sm_id_map WHERE match_id = 'fd_210'").run();
      // (ii) hop pertama untuk fd_211 ditambah: bridge fd_212 -> sm_212.
      up.prepare("INSERT INTO sm_id_map (match_id, sm_fixture_id) VALUES ('fd_212', 212)").run();
      up.close();
      // (ii) hop kedua: file tautan fd_211 <-> fd_212.
      setLinks(env, [{ twin_id: "fd_212", canonical_id: "fd_211" }]);
    },
  });
  const s = runPitB(env, { clock: clk.clock, executor: exec });
  const rows = readRowsB(env);
  suite.eq("B8: hanya kontrol yang tersimpan", s.predicted_new, 1);
  suite.eq("B8: kontrol = fd_213", rows.map((r) => r.fixture_uid), ["fx_uid_b8c"]);
  suite.eq("B8: dua kasus identitas ditolak identity_changed", s.skipped.identity_changed ?? 0, 2);
  suite.check(
    "B8: tidak ada row untuk UID X maupun Y",
    !rows.some((r) => r.fixture_uid === "fx_uid_b8x" || r.fixture_uid === "fx_uid_b8y"),
  );
}

// ============================================================================
// B9 — proyeksi rusak/hilang/berubah → replay gagal eksplisit
// ============================================================================
console.log("\nB9. Integritas artefak proyeksi saat replay");
{
  const env = makeEnv("b9");
  seedFixture(env, { matchId: "fd_214", uid: "fx_uid_b9", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  const s = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const row = readRowsB(env)[0];
  const projPath = path.join(env.projectionDir, s.projection?.file ?? "");
  const recordedSha = row?.feature_snapshot_id ?? "";

  let threwMissing = false;
  try {
    replayPitBProjectionFile(path.join(env.projectionDir, "pitb-projection-tidak-ada.jsonl.gz"));
  } catch {
    threwMissing = true;
  }
  suite.check("B9: file hilang → replay gagal eksplisit", threwMissing);

  let threwHash = false;
  try {
    replayPitBProjectionFile(projPath, { expectedSha256: "0".repeat(64) });
  } catch {
    threwHash = true;
  }
  suite.check("B9: hash tak cocok → replay gagal eksplisit", threwHash);

  // Isi diubah sesudah hash dicatat: skor satu hasil diganti, gzip ulang.
  const jsonl = gunzipSync(fs.readFileSync(projPath)).toString("utf8");
  const tampered = jsonl.replace('"home_score":3', '"home_score":7');
  suite.check("B9: fixture tamper benar-benar mengubah isi", tampered !== jsonl);
  const tamperedPath = path.join(env.projectionDir, "pitb-projection-tampered.jsonl.gz");
  fs.writeFileSync(tamperedPath, gzipSync(Buffer.from(tampered, "utf8")));
  let threwTamper = false;
  try {
    replayPitBProjectionFile(tamperedPath, { expectedSha256: recordedSha });
  } catch {
    threwTamper = true;
  }
  suite.check("B9: isi berubah → replay dengan hash tercatat gagal", threwTamper);
  // Tanpa hash tercatat pun, vektor dari artefak rusak TIDAK sama dengan
  // baris tersimpan — bukti valid hanya datang dari artefak yang utuh.
  const replayTampered = replayPitBProjectionFile(tamperedPath);
  suite.check(
    "B9: vektor artefak rusak != hash baris tersimpan",
    replayTampered.vectorHashes.get("fx_uid_b9") !== row?.features_sha256,
  );
  const replayGood = replayPitBProjectionFile(projPath, { expectedSha256: recordedSha });
  suite.eq("B9: artefak asli tetap replay-valid", replayGood.vectorHashes.get("fx_uid_b9"), row?.features_sha256);
}

// ============================================================================
// B10 — parity dengan extractor warisan + isolasi store + kontrak CLI
// ============================================================================
console.log("\nB10. Parity vektor B vs A + isolasi + CLI");
{
  const env = makeEnv("b10");
  // DB pilot + PIT A dengan isi — tidak boleh disentuh run B.
  const pilot = new DatabaseSync(env.pilotPath);
  pilot.exec("CREATE TABLE predictions (match_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  pilot.prepare("INSERT INTO predictions (match_id, status) VALUES ('fd_pilot', 'pending')").run();
  pilot.close();
  const pitA = new DatabaseSync(env.pitAPath);
  pitA.exec("CREATE TABLE predictions (fixture_uid TEXT PRIMARY KEY, status TEXT NOT NULL)");
  pitA.prepare("INSERT INTO predictions (fixture_uid, status) VALUES ('fx_lama', 'PIT_A_STAGED')").run();
  pitA.close();
  seedFixture(env, { matchId: "fd_215", uid: "fx_uid_b10", kickoff: KICKOFF });

  const dumpStore = (p: string, tables: string[]): string => {
    const db = new DatabaseSync(p, { readOnly: true });
    const parts: string[] = [];
    const schema = db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all();
    parts.push(JSON.stringify(schema));
    for (const t of tables) {
      parts.push(t + ":" + JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()));
    }
    db.close();
    return parts.join("\n");
  };
  const before = {
    dataset: dumpStore(env.datasetPath, ["matches", "team_match_logs_canonical", "league_calibration", "canonical_fixtures", "fixture_aliases"]),
    upcoming: dumpStore(env.upcomingPath, ["upcoming_fixtures", "sm_id_map"]),
    snapshots: dumpStore(env.snapshotsPath, ["packages"]),
    pilot: sha256FilePitA(env.pilotPath),
    pitA: sha256FilePitA(env.pitAPath),
  };

  const clk = makeClock(DECISION);
  const sB = runPitB(env, { clock: clk.clock, executor: stubExecutor(env) });
  const rowB = readRowsB(env)[0];
  suite.eq("B10: run B menyimpan 1 row", sB.predicted_new, 1);

  // Mode A pada env yang sama (DB shadow A terpisah, data bersih):
  // vektor harus IDENTIK — extractor warisan atas input yang sama.
  const dsA = new DatabaseSync(env.datasetPath, { readOnly: true });
  const upA = new DatabaseSync(env.upcomingPath, { readOnly: true });
  const snA = new DatabaseSync(env.snapshotsPath, { readOnly: true });
  const outA2 = path.join(env.dataDir, "ml1_prospective_pit_a_fresh.db");
  try {
    runMl1PitA({
      dataset: dsA,
      upcoming: upA,
      snapshots: snA,
      outputDbPath: outA2,
      dataDirPath: env.staticDir,
      modelDir: env.modelDir,
      clock: makeClock(DECISION).clock,
      executor: stubExecutor(env),
    });
  } finally {
    dsA.close();
    upA.close();
    snA.close();
  }
  const dbA = new DatabaseSync(outA2, { readOnly: true });
  const rowA = dbA.prepare("SELECT features_json FROM predictions WHERE fixture_uid = 'fx_uid_b10'").get() as { features_json: string };
  dbA.close();
  suite.eq(
    "B10: vektor PIT B identik dengan vektor jalur warisan (PIT A)",
    rowB?.features_json,
    rowA.features_json,
  );

  const after = {
    dataset: dumpStore(env.datasetPath, ["matches", "team_match_logs_canonical", "league_calibration", "canonical_fixtures", "fixture_aliases"]),
    upcoming: dumpStore(env.upcomingPath, ["upcoming_fixtures", "sm_id_map"]),
    snapshots: dumpStore(env.snapshotsPath, ["packages"]),
    pilot: sha256FilePitA(env.pilotPath),
    pitA: sha256FilePitA(env.pitAPath),
  };
  suite.eq("B10: dataset utuh logis", after.dataset, before.dataset);
  suite.eq("B10: upcoming utuh logis", after.upcoming, before.upcoming);
  suite.eq("B10: snapshots utuh logis", after.snapshots, before.snapshots);
  suite.eq("B10: DB pilot tidak berubah (hash file)", after.pilot, before.pilot);
  suite.eq("B10: DB PIT A tidak berubah (hash file)", after.pitA, before.pitA);

  // Kontrak CLI: --pit-b menolak --now; --pit-a + --pit-b eksklusif.
  const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const rejectNow = spawnSync(tsx, [path.join(REPO_ROOT, "scripts/ml1-prospective.ts"), "--pit-b", "--now=2026-11-27T10:00:00.000Z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DB_DIR: env.dataDir, TZ: "UTC" },
  });
  suite.check("B10: CLI --pit-b --now exit 2", rejectNow.status === 2, `status=${rejectNow.status}`);
  suite.check("B10: pesan penolakan mengarahkan ke fixture uji", /fixture uji/.test(rejectNow.stderr ?? ""), rejectNow.stderr ?? "");
  const rejectBoth = spawnSync(tsx, [path.join(REPO_ROOT, "scripts/ml1-prospective.ts"), "--pit-a", "--pit-b"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DB_DIR: env.dataDir, TZ: "UTC" },
  });
  suite.check("B10: CLI --pit-a --pit-b eksklusif (exit 2)", rejectBoth.status === 2, `status=${rejectBoth.status}`);
}

// ============================================================================
// B11 — pin lintas store: edisi pasca-pin dari penulis kedua tidak terlihat
// ============================================================================
console.log("\nB11. Edisi paket pasca-pin absen dari run berjalan (WAL)");
{
  const env = makeEnv("b11");
  const idOld = seedFixture(env, { matchId: "fd_216", uid: "fx_uid_b11", kickoff: KICKOFF, lam: 1.5 });
  const clk = makeClock(DECISION);
  const exec = stubExecutor(env, {
    onCall: () => {
      // Penulis kedua commit edisi baru 09.30 SAAT run berjalan.
      addPkg(env, { matchId: "fd_216", computed: "2026-11-27T09:30:00.000Z", kickoff: KICKOFF, lam: 9.9 });
    },
  });
  const s = runPitB(env, { clock: clk.clock, executor: exec });
  const rows = readRowsB(env);
  suite.eq("B11: run menyimpan 1 row", s.predicted_new, 1);
  suite.eq("B11: edisi terpin (09.00) yang dipakai", rows[0]?.package_id, idOld);
  suite.eq("B11: champ_lam edisi terpin", rows[0]?.champ_lam, 1.5);
  // Run berikutnya (DB shadow baru) melihat edisi 09.30.
  const out2 = path.join(env.dataDir, "ml1_prospective_pit_b2.db");
  const s2 = runPitB(env, { clock: clk.clock, executor: stubExecutor(env), outputPath: out2 });
  suite.eq("B11: run berikutnya memakai edisi 09.30", readRowsB(env, out2)[0]?.champ_lam, 9.9);
  suite.eq("B11: run berikutnya predicted_new", s2.predicted_new, 1);
}

// ----------------------------------------------------------------------------
for (const root of envsToClean) {
  if (suite.failedCount === 0) fs.rmSync(root, { recursive: true, force: true });
  else console.log(`[fixture] sandbox dipertahankan untuk inspeksi: ${root}`);
}
suite.finish();
