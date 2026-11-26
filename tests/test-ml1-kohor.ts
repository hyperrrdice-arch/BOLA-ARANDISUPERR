/**
 * ML1 KOHOR PROSPEKTIF — suite acceptance Brief ML1 Kohor Prospektif §6.
 *
 * Menguji penutupan celah bukti PIT B (§2), grader shadow berbasis UID
 * (§4), dan evaluasi berpasangan (§5) di atas fixture SQLite temporer
 * (Node 24, clock + executor injeksi). Smoke Python asli dilaporkan
 * terpisah, bukan di suite ini.
 *
 *  K1  Registry berubah saat clock menyegel keputusan → run memakai byte
 *      pra-cutoff (tm_h1, bukan tm_a1), capture tercatat <= decision,
 *      versi bukti v2.
 *  K2  11+ shots dengan seri tepat di batas window-10 → vektor live ==
 *      replay (hash sama) dan urutan sisip SQLite berbeda → hasil sama.
 *  K3  Store legacy tanpa kolom opsional → run jalan; tabel wajib hilang
 *      → error jelas.
 *  K4  Gzip valid isi diedit / arsip hilang → verifikasi menolak;
 *      prediksi tidak masuk evaluasi ketat.
 *  K5  Lead terlalu jauh, paket hilang, marker beda/kosong, dua alias →
 *      jendela horizon benar, funnel menjelaskan gap, satu fixture
 *      fisik dihitung sekali, marker lain tidak tercampur di primer.
 *  K6  Revisi 1 finished, revisi 2 batal / ET-only → void / pending;
 *      skor regulasi lama tidak muncul kembali.
 *  K7  Koreksi revisi regulasi, alias pindah UID, orientasi terbalik →
 *      edisi grading baru, laporan lama reproducible, konflik beralasan.
 *  K8  Nilai sintetis diketahui + pasangan gagal satu model → LL, Brier,
 *      arah Δ, hitungan blok, gate tepat; tidak ada pair parsial;
 *      rerun grading idempoten.
 *  K9  Isolasi: input + pilot + PIT A terjaga; grader hanya menulis
 *      lokasi shadow.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Suite } from "./helpers/fixture-env";
import { sha256FilePitA, type PitAInferenceExecutor } from "../lib/eval/ml1-pit-a";
import {
  computePitBFeatures,
  ensurePitBSchema,
  insertPitBRow,
  runMl1PitB,
  serializePitBProjection,
  verifyPitBArtifacts,
  writePitBProjectionAtomic,
  PIT_B_EVAL_VERSION,
  PIT_B_FEATURE_CODE_VERSION,
  PIT_B_RUNNER_VERSION,
  type PitBProjection,
  type PitBRunSummary,
} from "../lib/eval/ml1-pit-b";
import {
  buildProposedProtocol,
  cohortIdFor,
  computeCohortFunnel,
  evaluateCohortFromDb,
  gradeCohort,
  protocolHash,
  type CohortProtocol,
} from "../lib/eval/ml1-cohort";
import { ML1_B_FEATURE_NAMES } from "../lib/eval/ml1-features";
import { ensureIdentitySchema } from "../lib/identity/fixture-resolver";
import { ensurePackagesSchema } from "../lib/picks/packages";

const suite = new Suite("ML1 Kohor Prospektif (Brief ML1 Kohor §6)");
const DECISION = "2026-11-27T10:00:00.000Z";
const PIN = "2026-11-27T09:59:59.000Z";
const KICKOFF = "2026-11-28T20:00:00.000Z";
const PRIMARY_MARKER = "sha256:910a9efe3103ffde";
const envsToClean: string[] = [];
const sha256Str = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const sha256File = (p: string): string => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const IDX = (name: string): number => ML1_B_FEATURE_NAMES.indexOf(name as never);

// ============================================================================
// Fixture env (diadaptasi dari suite PIT B)
// ============================================================================
interface KohorEnv {
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
  legacy: boolean;
}

function makeEnv(label: string, opts: { legacy?: boolean; dropLogsTable?: boolean; dropMatchesTable?: boolean } = {}): KohorEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bola-kohor-${label}-`));
  envsToClean.push(root);
  const dataDir = path.join(root, "db");
  const staticDir = path.join(root, "static");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, "fixture-links.json"), JSON.stringify({ links: [] }));
  const legacy = opts.legacy ?? false;

  const datasetPath = path.join(dataDir, "thestats_dataset.db");
  const ds = new DatabaseSync(datasetPath);
  if (!opts.dropMatchesTable) {
    ds.exec(
      legacy
        ? `CREATE TABLE matches (
             match_id TEXT PRIMARY KEY, competition_id TEXT, utc_date TEXT,
             home_team_id TEXT, away_team_id TEXT, home_score INTEGER, away_score INTEGER,
             status TEXT, season TEXT
           );`
        : `CREATE TABLE matches (
             match_id TEXT PRIMARY KEY, competition_id TEXT, utc_date TEXT,
             home_team_id TEXT, away_team_id TEXT, home_score INTEGER, away_score INTEGER,
             status TEXT, season TEXT, available_at TEXT
           );`,
    );
  }
  if (!opts.dropLogsTable) {
    ds.exec(
      legacy
        ? `CREATE TABLE team_match_logs_canonical (
             team_id TEXT, match_date TEXT, shots_for REAL, shots_against REAL,
             shots_on_target_for REAL, shots_on_target_against REAL
           );`
        : `CREATE TABLE team_match_logs_canonical (
             log_id TEXT, team_id TEXT, match_date TEXT, shots_for REAL, shots_against REAL,
             shots_on_target_for REAL, shots_on_target_against REAL, chosen_source TEXT
           );`,
    );
  }
  ds.exec(`CREATE TABLE league_calibration (league_id TEXT PRIMARY KEY, status TEXT);`);
  ensureIdentitySchema(ds);
  ds.prepare("INSERT INTO league_calibration (league_id, status) VALUES ('sm:100', 'calibrated')").run();
  if (!opts.dropMatchesTable) {
    const insM = legacy
      ? ds.prepare("INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season) VALUES (?, 'sm:100', ?, ?, ?, ?, ?, 'finished', '2026')")
      : ds.prepare("INSERT INTO matches (match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score, status, season, available_at) VALUES (?, 'sm:100', ?, ?, ?, ?, ?, 'finished', '2026', ?)");
    const hist: [string, string, string, string, number, number][] = [
      ["mt_h1", "2026-11-10T20:00:00.000Z", "tm_h1", "tm_x1", 3, 0],
      ["mt_h2", "2026-11-14T20:00:00.000Z", "tm_x1", "tm_h1", 1, 2],
      ["mt_h3", "2026-11-18T20:00:00.000Z", "tm_h1", "tm_a1", 2, 1],
      ["mt_h4", "2026-11-21T20:00:00.000Z", "tm_a1", "tm_x2", 1, 1],
      ["mt_h5", "2026-11-24T20:00:00.000Z", "tm_x2", "tm_a1", 0, 2],
      ["mt_h6", "2026-11-25T20:00:00.000Z", "tm_a1", "tm_h1", 1, 0],
    ];
    for (const [id, d, h, a, hs, as] of hist) {
      if (legacy) insM.run(id, d, h, a, hs, as);
      else insM.run(id, d, h, a, hs, as, "2026-11-25T22:05:00.000Z");
    }
  }
  if (!opts.dropLogsTable) {
    const insL = legacy
      ? ds.prepare("INSERT INTO team_match_logs_canonical (team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against) VALUES (?, ?, ?, ?, ?, ?)")
      : ds.prepare("INSERT INTO team_match_logs_canonical (log_id, team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against, chosen_source) VALUES (?, ?, ?, ?, ?, ?, ?, 'thestats')");
    const logs: [string, string, string, number, number, number, number][] = [
      ["log_h1a", "tm_h1", "2026-11-10", 14, 6, 6, 2],
      ["log_h1b", "tm_h1", "2026-11-14", 10, 9, 4, 3],
      ["log_h1c", "tm_h1", "2026-11-18", 12, 8, 5, 3],
      ["log_h1d", "tm_h1", "2026-11-25", 11, 7, 5, 2],
      ["log_a1a", "tm_a1", "2026-11-18", 8, 12, 3, 5],
      ["log_a1b", "tm_a1", "2026-11-21", 9, 10, 4, 4],
      ["log_a1c", "tm_a1", "2026-11-24", 13, 5, 6, 2],
      ["log_a1d", "tm_a1", "2026-11-25", 7, 11, 2, 5],
    ];
    for (const [id, t, d, sf, sa, sotf, sota] of logs) {
      if (legacy) insL.run(t, d, sf, sa, sotf, sota);
      else insL.run(id, t, d, sf, sa, sotf, sota);
    }
  }
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
  const manifestPath = path.join(modelDir, "model-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      candidate_id: "ml1-b-fixture-candidate",
      model: "ml1-b",
      boosters: {
        home: { file: "ml1-b-home.booster", sha256: sha256Str("fixture-home-booster-bytes") },
        away: { file: "ml1-b-away.booster", sha256: sha256Str("fixture-away-booster-bytes") },
      },
    }, null, 2),
  );

  return {
    root, dataDir, staticDir, datasetPath, upcomingPath, snapshotsPath,
    outputPath: path.join(dataDir, "ml1_prospective_pit_b.db"),
    pilotPath: path.join(dataDir, "ml1_prospective.db"),
    pitAPath: path.join(dataDir, "ml1_prospective_pit_a.db"),
    modelDir, manifestPath,
    projectionDir: path.join(dataDir, "pitb-projections"),
    legacy,
  };
}

function addUpcoming(env: KohorEnv, matchId: string, kickoff: string, opts: { homeId?: string; awayId?: string; homeName?: string; awayName?: string } = {}): void {
  const db = new DatabaseSync(env.upcomingPath);
  db.prepare(
    `INSERT INTO upcoming_fixtures (match_id, competition_id, competition_name, utc_date, status, home_team_id, home_team_name, away_team_id, away_team_name)
     VALUES (?, 'sm:100', 'Fixture League', ?, 'scheduled', ?, ?, ?, ?)`,
  ).run(matchId, kickoff, opts.homeId ?? "tm_h1", opts.homeName ?? "Fixture Home", opts.awayId ?? "tm_a1", opts.awayName ?? "Fixture Away");
  db.close();
}

function addIdentity(env: KohorEnv, uid: string, matchIds: string[], opts: { home?: string; away?: string; kickoff?: string; competition?: string } = {}): void {
  const db = new DatabaseSync(env.datasetPath);
  db.prepare(
    `INSERT OR IGNORE INTO canonical_fixtures (fixture_uid, competition_id, home_name, away_name, kickoff_utc, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  ).run(uid, opts.competition ?? "sm:100", opts.home ?? "Fixture Home", opts.away ?? "Fixture Away", opts.kickoff ?? KICKOFF);
  const ins = db.prepare(
    `INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc)
     VALUES (?, ?, ?, 'fixture', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`,
  );
  for (const id of matchIds) ins.run(id.startsWith("sm_") ? "sportmonks" : "football-data", id, uid);
  db.close();
}

function addPkg(env: KohorEnv, opts: { matchId: string; computed: string; kickoff: string; lam?: number; mu?: number; marker?: string | null; competition?: string }): number {
  const payload = JSON.stringify({
    fixture: { home: "Fixture Home", away: "Fixture Away" },
    probabilities: { "1x2:1": 0.5, "1x2:x": 0.3, "1x2:2": 0.2 },
  });
  const db = new DatabaseSync(env.snapshotsPath);
  const res = db
    .prepare(
      `INSERT INTO packages (match_id, competition_canonical_id, kickoff_utc, computed_utc, trigger, ratings_marker, lambda, mu, payload_json)
       VALUES (?, ?, ?, ?, 'slate', ?, ?, ?, ?)`,
    )
    .run(opts.matchId, opts.competition ?? "sm:100", opts.kickoff, opts.computed, opts.marker ?? null, opts.lam ?? 1.5, opts.mu ?? 1.2, payload);
  db.close();
  return Number(res.lastInsertRowid);
}

function seedFixture(env: KohorEnv, opts: { matchId: string; uid: string; kickoff?: string; computed?: string; lam?: number; alsoIds?: string[]; homeId?: string; awayId?: string; homeName?: string; awayName?: string; marker?: string | null; competition?: string }): number {
  const kickoff = opts.kickoff ?? KICKOFF;
  addUpcoming(env, opts.matchId, kickoff, { homeId: opts.homeId, awayId: opts.awayId, homeName: opts.homeName, awayName: opts.awayName });
  addIdentity(env, opts.uid, [opts.matchId, ...(opts.alsoIds ?? [])], { kickoff, competition: opts.competition });
  return addPkg(env, { matchId: opts.matchId, computed: opts.computed ?? "2026-11-27T09:00:00.000Z", kickoff, lam: opts.lam, marker: opts.marker, competition: opts.competition });
}

function makeClock(iso: string) {
  let ms = Date.parse(iso);
  return {
    clock: () => new Date(ms),
    set(iso2: string) { ms = Date.parse(iso2); },
  };
}

function stubExecutor(env: KohorEnv): PitAInferenceExecutor {
  return ({ requests }) => ({
    results: new Map(requests.map((r) => [r.match_id, { lam: r.champLam * 1.05, mu: r.champMu * 0.95 }] as const)),
    candidateId: "ml1-b-fixture-candidate",
    candidateManifestSha256: sha256FilePitA(env.manifestPath),
  });
}

function runPitB(env: KohorEnv, opts: { clock: () => Date; executor?: PitAInferenceExecutor; maxLeadMs?: number }): PitBRunSummary {
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  const upcoming = new DatabaseSync(env.upcomingPath, { readOnly: true });
  const snapshots = new DatabaseSync(env.snapshotsPath, { readOnly: true });
  try {
    return runMl1PitB({
      dataset, upcoming, snapshots,
      outputDbPath: env.outputPath,
      projectionDir: env.projectionDir,
      dataDirPath: env.staticDir,
      modelDir: env.modelDir,
      clock: opts.clock,
      executor: opts.executor ?? stubExecutor(env),
      limit: 0,
      maxLeadMs: opts.maxLeadMs,
    });
  } finally {
    dataset.close();
    upcoming.close();
    snapshots.close();
  }
}

interface StoredRow {
  id: number;
  fixture_uid: string;
  feature_snapshot_id: string;
  features_sha256: string;
  features_json: string;
  home_team_key: string;
  eval_version: string;
  champion_ratings_marker: string | null;
  [k: string]: unknown;
}

function readRows(env: KohorEnv): StoredRow[] {
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

// ------------------------------------------------------------ fabrikasi ---
// Prediksi fabrikasi untuk tes grader: proyeksi + snapshot + baris dibuat
// lewat jalur resmi (serialize/writeAtomic/insertPitBRow) sehingga
// verifikasi §2C lolos, sementara peluang/marker/lead bebas diatur.
interface FabricatedPred {
  uid: string;
  sourceId: string;
  kickoff: string;
  decision?: string;
  marker?: string | null;
  champ?: [number, number, number];
  cand?: [number, number, number];
  competition?: string;
  homeName?: string;
  awayName?: string;
}

function fabricateBatch(env: KohorEnv, preds: FabricatedPred[], decision = DECISION): void {
  const zeroCounts = {
    results_in_snapshot: 0, results_projected: 0, results_excluded_target_component: 0,
    results_excluded_event_not_before_decision: 0, results_excluded_observation_after_cutoff: 0,
    results_excluded_invalid_time: 0, shots_in_snapshot: 0, shots_projected: 0,
    shots_excluded_date_precision: 0, shots_excluded_event_not_before_decision: 0, shots_excluded_invalid_time: 0,
  };
  const proj: PitBProjection = {
    meta: {
      kind: "meta",
      schema_version: 1,
      eval_version: PIT_B_EVAL_VERSION,
      horizon_id: "slate_pre_match",
      decision_at_utc: decision,
      cutoff_utc: decision,
      snapshot_pinned_at_utc: { snapshots: decision, dataset: decision, upcoming: decision },
      feature_code_version: PIT_B_FEATURE_CODE_VERSION,
      runner_version: PIT_B_RUNNER_VERSION,
      registry_team_canonical_sha256: "fab-registry-sha",
      registry_team_canonical_present: true,
      registry_fixture_links_sha256: "fab-links-sha",
      registry_fixture_links_present: true,
      registry_captured_at_utc: { team_canonical: decision, fixture_links: decision },
      counts: { ...zeroCounts, fixtures: preds.length, packages: preds.length },
    },
    results: [],
    shots: [],
    fixtures: preds.map((p) => ({
      fixture_uid: p.uid,
      source_match_id: p.sourceId,
      kickoff_utc: p.kickoff,
      competition_id: p.competition ?? "sm:8",
      home_team_key: "tm_h1",
      away_team_key: "tm_a1",
      home_team_id: "tm_h1",
      away_team_id: "tm_a1",
      home_name: p.homeName ?? "Fixture Home",
      away_name: p.awayName ?? "Fixture Away",
      slice: "kompetitif",
      registry_status: "calibrated",
    })),
    packages: preds.map((p, i) => ({
      fixture_uid: p.uid,
      package_id: 9000 + i,
      package_computed_utc: new Date(Date.parse(p.decision ?? decision) - 3600_000).toISOString(),
      package_payload_sha256: sha256Str(`payload-${p.uid}`),
      champion_ratings_marker: p.marker === undefined ? PRIMARY_MARKER : p.marker,
      champ_lam: 1.5,
      champ_mu: 1.2,
      champ_p_h: (p.champ ?? [0.5, 0.3, 0.2])[0],
      champ_p_d: (p.champ ?? [0.5, 0.3, 0.2])[1],
      champ_p_a: (p.champ ?? [0.5, 0.3, 0.2])[2],
    })),
  };
  const feats = computePitBFeatures(proj);
  const file = writePitBProjectionAtomic(env.projectionDir, serializePitBProjection(proj));
  const db = new DatabaseSync(env.outputPath);
  try {
    ensurePitBSchema(db);
    db.prepare(
      `INSERT INTO feature_snapshots (
         feature_snapshot_id, schema_version, eval_version, decision_at_utc, cutoff_utc,
         snapshot_pinned_at_utc_json, projection_file, projection_bytes, projection_sha256,
         registry_team_canonical_sha256, registry_fixture_links_sha256, registry_captures_json,
         feature_code_version, runner_version, counts_json, created_utc
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      file.sha256, PIT_B_EVAL_VERSION, decision, decision,
      JSON.stringify({ snapshots: decision, dataset: decision, upcoming: decision }),
      file.file, file.bytes, file.sha256, "fab-registry-sha", "fab-links-sha",
      JSON.stringify({ team_canonical: decision, fixture_links: decision }),
      PIT_B_FEATURE_CODE_VERSION, PIT_B_RUNNER_VERSION, JSON.stringify(proj.meta.counts), decision,
    );
    preds.forEach((p, i) => {
      const dec = p.decision ?? decision;
      const feat = feats.get(p.uid)!;
      insertPitBRow(db, {
        eval_version: PIT_B_EVAL_VERSION,
        horizon_id: "slate_pre_match",
        feature_time_status: "snapshot_visible",
        input_evidence_status: "snapshot_visible",
        grading_status: "pending",
        status: "PIT_B_STAGED",
        fixture_uid: p.uid,
        source_match_id: p.sourceId,
        identity_method: "fixture",
        aliases_json: JSON.stringify([p.sourceId]),
        competition_id: p.competition ?? "sm:8",
        decision_at_utc: dec,
        issued_at_utc: new Date(Date.parse(dec) + 60_000).toISOString(),
        kickoff_utc: p.kickoff,
        lead_seconds: Math.round((Date.parse(p.kickoff) - Date.parse(dec)) / 1000),
        package_id: 9000 + i,
        package_computed_utc: new Date(Date.parse(dec) - 3600_000).toISOString(),
        package_payload_sha256: sha256Str(`payload-${p.uid}`),
        champion_ratings_marker: p.marker === undefined ? PRIMARY_MARKER : p.marker,
        champion_provenance_status: p.marker === null ? "unknown" : "package_marker",
        candidate_id: "ml1-b-fixture-candidate",
        candidate_manifest_sha256: "fab-candidate-manifest",
        feature_snapshot_id: file.sha256,
        features_sha256: feat.hash,
        elo_fallback_home: 0,
        elo_fallback_away: 0,
        home_team_key: "tm_h1",
        away_team_key: "tm_a1",
        home_name: p.homeName ?? "Fixture Home",
        away_name: p.awayName ?? "Fixture Away",
        slice: "kompetitif",
        registry_status: "calibrated",
        champ_lam: 1.5,
        champ_mu: 1.2,
        champ_p_h: (p.champ ?? [0.5, 0.3, 0.2])[0],
        champ_p_d: (p.champ ?? [0.5, 0.3, 0.2])[1],
        champ_p_a: (p.champ ?? [0.5, 0.3, 0.2])[2],
        cand_lam: 1.6,
        cand_mu: 1.1,
        cand_p_h: (p.cand ?? [0.55, 0.28, 0.17])[0],
        cand_p_d: (p.cand ?? [0.55, 0.28, 0.17])[1],
        cand_p_a: (p.cand ?? [0.55, 0.28, 0.17])[2],
        features_json: JSON.stringify(feat.vector),
      });
    });
  } finally {
    db.close();
  }
}

function addRevision(
  env: KohorEnv,
  uid: string,
  r: { revision: number; status: string; home?: number | null; away?: number | null; basis?: string; observed: string; matchId?: string },
): void {
  const db = new DatabaseSync(env.datasetPath);
  db.prepare(
    `INSERT INTO result_revisions (fixture_uid, match_id, revision, status, home_score, away_score, score_basis, source, observed_at, checksum, settlement_policy_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'fixture-feed', ?, ?, 'v1')`,
  ).run(uid, r.matchId ?? "fd_x", r.revision, r.status, r.home ?? null, r.away ?? null, r.basis ?? "regulation", r.observed, `chk-${uid}-${r.revision}`);
  db.close();
}

function setCanonical(env: KohorEnv, uid: string, opts: { state: string; currentRevision: number; home?: string; away?: string; kickoff?: string }): void {
  const db = new DatabaseSync(env.datasetPath);
  const sets = ["state = ?", "current_revision = ?", "updated_at = '2026-12-01T00:00:00.000Z'"];
  const vals: unknown[] = [opts.state, opts.currentRevision];
  if (opts.home !== undefined) { sets.push("home_name = ?"); vals.push(opts.home); }
  if (opts.away !== undefined) { sets.push("away_name = ?"); vals.push(opts.away); }
  if (opts.kickoff !== undefined) { sets.push("kickoff_utc = ?"); vals.push(opts.kickoff); }
  vals.push(uid);
  db.prepare(`UPDATE canonical_fixtures SET ${sets.join(", ")} WHERE fixture_uid = ?`).run(...(vals as never[]));
  db.close();
}

function testProtocol(overrides: Partial<CohortProtocol> = {}): CohortProtocol {
  const base = buildProposedProtocol();
  const p: CohortProtocol = {
    ...base,
    ...overrides,
    champion: { ...base.champion, primary_marker: PRIMARY_MARKER, ...(overrides.champion ?? {}) },
  };
  return p;
}

function grade(env: KohorEnv, protocol: CohortProtocol, cutoff: string, gradedAt = "2026-12-05T00:00:00.000Z") {
  const shadow = new DatabaseSync(env.outputPath);
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  try {
    return gradeCohort({
      shadowDb: shadow,
      dataset,
      projectionDir: env.projectionDir,
      protocol,
      cohortId: cohortIdFor(protocol),
      gradingCutoffUtc: cutoff,
      clock: () => new Date(gradedAt),
    });
  } finally {
    dataset.close();
    shadow.close();
  }
}

function gradingRows(env: KohorEnv): Record<string, unknown>[] {
  const db = new DatabaseSync(env.outputPath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM cohort_gradings ORDER BY prediction_id, edition").all() as unknown as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// ============================================================================
// K1 — registry berubah saat clock menyegel keputusan → byte pra-cutoff
// ============================================================================
console.log("\nK1. Registry dibekukan sebelum jam keputusan (§2A)");
{
  const env = makeEnv("k1");
  const regPath = path.join(env.staticDir, "team-canonical.json");
  const regV1 = JSON.stringify({
    version: 1,
    teams: [{
      canonical_id: "canon_reg", name: "Reg Team", country: null,
      members: [
        { system: "thestats", team_id: "tm_h1", name_as_stored: "H1" },
        { system: "src", team_id: "src_h", name_as_stored: "Reg Home" },
      ],
      aliases: [], contested_name: false,
    }],
  });
  const regV2 = JSON.stringify({
    version: 1,
    teams: [{
      canonical_id: "canon_other", name: "Other", country: null,
      members: [
        { system: "thestats", team_id: "tm_a1", name_as_stored: "A1" },
        { system: "src", team_id: "src_h", name_as_stored: "Reg Home" },
      ],
      aliases: [], contested_name: false,
    }],
  });
  fs.writeFileSync(regPath, regV1);
  seedFixture(env, { matchId: "fd_k1", uid: "fx_uid_k1", kickoff: KICKOFF, homeId: "src_h", homeName: "Reg Home" });
  // Clock: 5 panggilan pertama = PIN; panggilan ke-4 menukar file di disk
  // (meniru fixture brief: pemetaan diganti saat jam keputusan diambil);
  // panggilan ke-6+ = DECISION. Kode lama membaca registry SESUDAH
  // decision (panggilan >= 4 sudah menukar file) → akan memakai tm_a1.
  let calls = 0;
  const clock = (): Date => {
    calls++;
    if (calls === 4) fs.writeFileSync(regPath, regV2);
    return new Date(calls >= 6 ? DECISION : PIN);
  };
  const s = runPitB(env, { clock });
  const rows = readRows(env);
  suite.eq("K1: satu row tersimpan", s.predicted_new, 1);
  suite.eq("K1: home_team_key dari byte pra-cutoff (tm_h1)", rows[0]?.home_team_key, "tm_h1");
  suite.eq("K1: versi bukti baris = ml1-pit-b-v2", rows[0]?.eval_version, "ml1-pit-b-v2");
  suite.check(
    "K1: capture registry tercatat dan <= decision",
    s.registry_captured_at_utc.team_canonical !== "" && s.registry_captured_at_utc.team_canonical <= DECISION &&
      s.registry_captured_at_utc.fixture_links <= DECISION,
    JSON.stringify(s.registry_captured_at_utc),
  );
  const db = new DatabaseSync(env.outputPath, { readOnly: true });
  const snap = db.prepare("SELECT registry_team_canonical_sha256, registry_captures_json FROM feature_snapshots").get() as unknown as { registry_team_canonical_sha256: string; registry_captures_json: string };
  db.close();
  suite.eq("K1: hash registry di manifest == byte v1", snap.registry_team_canonical_sha256, sha256Str(regV1));
  const caps = JSON.parse(snap.registry_captures_json) as Record<string, string>;
  suite.check("K1: registry_captures_json terisi dua file", typeof caps.team_canonical === "string" && typeof caps.fixture_links === "string", snap.registry_captures_json);
}

// ============================================================================
// K2 — seri shots di batas window-10: issue == replay, urutan sisip bebas
// ============================================================================
console.log("\nK2. Urutan input satu untuk issue + replay (§2B)");
{
  const buildShotsEnv = (label: string, tieOrder: string[]): { env: KohorEnv; summary: PitBRunSummary } => {
    const env = makeEnv(label);
    const db = new DatabaseSync(env.datasetPath);
    db.prepare("DELETE FROM team_match_logs_canonical WHERE team_id = 'tm_h1'").run();
    const ins = db.prepare(
      "INSERT INTO team_match_logs_canonical (log_id, team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against, chosen_source) VALUES (?, 'tm_h1', ?, ?, ?, ?, ?, 'thestats')",
    );
    ins.run("log_a0", "2026-11-02", 10, 5, 4, 2);
    const tieSf: Record<string, number> = { log_t1: 30, log_t2: 2, log_t3: 16 };
    for (const id of tieOrder) ins.run(id, "2026-11-05", tieSf[id], 5, 4, 2);
    const later: [string, string][] = [
      ["log_b1", "2026-11-08"], ["log_b2", "2026-11-11"], ["log_b3", "2026-11-14"], ["log_b4", "2026-11-17"],
      ["log_b5", "2026-11-19"], ["log_b6", "2026-11-21"], ["log_b7", "2026-11-23"], ["log_b8", "2026-11-25"],
    ];
    for (const [id, d] of later) ins.run(id, d, 10, 5, 4, 2);
    db.close();
    seedFixture(env, { matchId: "fd_k2", uid: "fx_uid_k2", kickoff: KICKOFF });
    const clk = makeClock(DECISION);
    const summary = runPitB(env, { clock: clk.clock });
    return { env, summary };
  };
  const a = buildShotsEnv("k2a", ["log_t3", "log_t1", "log_t2"]);
  const b = buildShotsEnv("k2b", ["log_t2", "log_t3", "log_t1"]);
  const rowsA = readRows(a.env);
  const rowsB = readRows(b.env);
  suite.eq("K2: env A menyimpan 1 row", a.summary.predicted_new, 1);
  suite.eq("K2: env B menyimpan 1 row", b.summary.predicted_new, 1);
  const vecA = JSON.parse(rowsA[0]?.features_json ?? "[]") as number[];
  const vecB = JSON.parse(rowsB[0]?.features_json ?? "[]") as number[];
  // Window-10 deterministik: urutan kanonik log_t1(30) di luar window,
  // log_t2(2)+log_t3(16) di dalam → (8×10 + 2 + 16)/10 = 9,8.
  suite.eq("K2: shots_for_home deterministik 9,8 (env A)", vecA[IDX("shots_for_home")], 9.8);
  suite.eq("K2: vektor identik lintas urutan sisip", JSON.stringify(vecA), JSON.stringify(vecB));
  for (const [label, e] of [["A", a.env], ["B", b.env]] as const) {
    const db = new DatabaseSync(e.outputPath, { readOnly: true });
    const v = verifyPitBArtifacts(db, e.projectionDir);
    db.close();
    suite.eq(`K2: verifikasi artefak env ${label} strict`, v.strict_uids, ["fx_uid_k2"]);
  }
}

// ============================================================================
// K3 — skema legacy + tabel wajib hilang (§2D)
// ============================================================================
console.log("\nK3. Kompatibilitas skema legacy (§2D)");
{
  const env = makeEnv("k3", { legacy: true });
  seedFixture(env, { matchId: "fd_k3", uid: "fx_uid_k3", kickoff: KICKOFF });
  const clk = makeClock(DECISION);
  const s = runPitB(env, { clock: clk.clock });
  suite.eq("K3: run di skema legacy (tanpa available_at/log_id/chosen_source) berhasil", s.predicted_new, 1);

  const envNoLogs = makeEnv("k3b", { dropLogsTable: true });
  seedFixture(envNoLogs, { matchId: "fd_k3b", uid: "fx_uid_k3b", kickoff: KICKOFF });
  let errLogs = "";
  try {
    runPitB(envNoLogs, { clock: makeClock(DECISION).clock });
  } catch (err) {
    errLogs = err instanceof Error ? err.message : String(err);
  }
  suite.check("K3: tabel logs hilang → error jelas", errLogs.includes("team_match_logs_canonical") && errLogs.includes("tidak ditemukan"), errLogs);

  const envNoMatches = makeEnv("k3c", { dropMatchesTable: true });
  let errMatches = "";
  try {
    runPitB(envNoMatches, { clock: makeClock(DECISION).clock });
  } catch (err) {
    errMatches = err instanceof Error ? err.message : String(err);
  }
  suite.check("K3: tabel matches hilang → error jelas", errMatches.includes("matches"), errMatches);
}

// ============================================================================
// K4 — arsip diedit / hilang → verifikasi menolak (§2C)
// ============================================================================
console.log("\nK4. Verifikasi arsip terikat manifest (§2C)");
{
  const env = makeEnv("k4");
  seedFixture(env, { matchId: "fd_k4", uid: "fx_uid_k4", kickoff: KICKOFF, marker: PRIMARY_MARKER });
  addIdentity(env, "fx_uid_k4", [], {});
  const clk = makeClock(DECISION);
  runPitB(env, { clock: clk.clock });
  const dbRo = new DatabaseSync(env.outputPath, { readOnly: true });
  const ok = verifyPitBArtifacts(dbRo, env.projectionDir);
  dbRo.close();
  suite.eq("K4: arsip asli lolos verifikasi strict", ok.strict_uids, ["fx_uid_k4"]);

  // Edit isi JSONL lalu kompres ulang sebagai gzip VALID, nama file sama.
  const projFile = fs.readdirSync(env.projectionDir).find((f) => f.startsWith("pitb-projection-"))!;
  const projPath = path.join(env.projectionDir, projFile);
  const jsonl = gunzipSync(fs.readFileSync(projPath)).toString("utf8");
  const edited = jsonl.replace("Fixture Home", "Fixture Xome");
  suite.check("K4: edit benar-benar mengubah isi", edited !== jsonl);
  fs.writeFileSync(projPath, gzipSync(Buffer.from(edited, "utf8")));

  const dbRo2 = new DatabaseSync(env.outputPath, { readOnly: true });
  const bad = verifyPitBArtifacts(dbRo2, env.projectionDir);
  dbRo2.close();
  suite.eq("K4: gzip valid isi diedit → strict kosong", bad.strict_uids, []);
  suite.eq("K4: snapshot error tercatat", bad.snapshot_errors.length, 1);
  suite.eq("K4: alasan archive_verify_failed", bad.rejected[0]?.reason, "archive_verify_failed");

  const protocol = testProtocol();
  const g = grade(env, protocol, "2026-12-05T00:00:00.000Z");
  suite.eq("K4: grading menandai evidence_invalid", g.by_status.evidence_invalid, 1);
  const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  const ev = evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-06T00:00:00.000Z", asOfUtc: "2026-12-06T00:00:00.000Z" });
  dataset.close();
  shadow.close();
  suite.eq("K4: prediksi bukti rusak tidak masuk pair ketat", ev.evaluation.pairs, 0);

  // Varian arsip hilang.
  const env2 = makeEnv("k4b");
  seedFixture(env2, { matchId: "fd_k4b", uid: "fx_uid_k4b", kickoff: KICKOFF });
  runPitB(env2, { clock: makeClock(DECISION).clock });
  const f2 = fs.readdirSync(env2.projectionDir).find((f) => f.startsWith("pitb-projection-"))!;
  fs.rmSync(path.join(env2.projectionDir, f2));
  const dbRo3 = new DatabaseSync(env2.outputPath, { readOnly: true });
  const missing = verifyPitBArtifacts(dbRo3, env2.projectionDir);
  dbRo3.close();
  suite.eq("K4: arsip hilang → strict kosong", missing.strict_uids, []);
  suite.eq("K4: arsip hilang → snapshot error", missing.snapshot_errors.length, 1);
}

// ============================================================================
// K5 — horizon, marker, alias ganda, gap paket (§3/§6)
// ============================================================================
console.log("\nK5. Jendela horizon + strata marker + funnel");
{
  const env = makeEnv("k5");
  // Fixture terlalu jauh: kickoff = decision + 100 jam.
  const farKickoff = new Date(Date.parse(DECISION) + 100 * 3600_000).toISOString();
  seedFixture(env, { matchId: "fd_k5far", uid: "fx_uid_k5far", kickoff: farKickoff });
  seedFixture(env, { matchId: "fd_k5ok", uid: "fx_uid_k5ok", kickoff: KICKOFF });
  const gated = runPitB(env, { clock: makeClock(DECISION).clock, maxLeadMs: 72 * 3600_000 });
  suite.eq("K5: gerbang horizon sebelum dedupe — hanya fixture dalam jendela tersimpan", gated.predicted_new, 1);
  suite.eq("K5: skip lead_beyond_horizon tercatat", gated.skipped.lead_beyond_horizon, 1);
  suite.eq("K5: fixture jauh tidak mengunci (belum ada row)", readRows(env).map((r) => r.fixture_uid), ["fx_uid_k5ok"]);

  // Fabrikasi untuk strata: lead jauh (tersimpan tanpa gerbang), marker
  // beda, marker kosong, dua alias satu UID.
  const env2 = makeEnv("k5b");
  fabricateBatch(env2, [
    { uid: "fx_k5_far", sourceId: "fd_k5_far", kickoff: farKickoff },
    { uid: "fx_k5_markerb", sourceId: "fd_k5_mb", kickoff: KICKOFF, marker: "sha256:deadbeefdeadbeef" },
    { uid: "fx_k5_markernull", sourceId: "fd_k5_mn", kickoff: KICKOFF, marker: null },
    { uid: "fx_k5_alias", sourceId: "fd_k5_al", kickoff: KICKOFF },
    { uid: "fx_k5_good", sourceId: "fd_k5_good", kickoff: KICKOFF },
  ]);
  for (const [uid, src] of [["fx_k5_far", "fd_k5_far"], ["fx_k5_markerb", "fd_k5_mb"], ["fx_k5_markernull", "fd_k5_mn"], ["fx_k5_alias", "fd_k5_al"], ["fx_k5_good", "fd_k5_good"]] as const) {
    addIdentity(env2, uid, [src], { kickoff: uid === "fx_k5_far" ? farKickoff : KICKOFF, competition: "sm:8" });
  }
  // Alias kedua untuk fixture yang sama (satu fixture fisik, dua ID sumber).
  {
    const db = new DatabaseSync(env2.datasetPath);
    db.prepare(
      "INSERT INTO fixture_aliases (source, source_match_id, fixture_uid, match_basis, first_seen_utc, last_seen_utc) VALUES ('sportmonks', 'sm_k5_al', 'fx_k5_alias', 'fixture', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')",
    ).run();
    db.close();
  }
  // Fixture terjadwal TANPA paket/prediksi di jendela → gap funnel.
  addIdentity(env2, "fx_k5_nopkg", [], { kickoff: KICKOFF, competition: "sm:8" });
  for (const uid of ["fx_k5_alias", "fx_k5_good"]) {
    addRevision(env2, uid, { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z", matchId: "fd_x" });
    setCanonical(env2, uid, { state: "finished", currentRevision: 1 });
  }
  const protocol = testProtocol({
    window: {
      weeks: 12, t0: "2026-11-27T00:00:00.000Z", t1: "2026-12-04T00:00:00.000Z",
      grading_cutoff: "2026-12-11T00:00:00.000Z", kickoff_in: "[T0, T1)", decision_from: "T0", min_blocks_with_graded: 8,
    },
  });
  const g = grade(env2, protocol, "2026-12-05T00:00:00.000Z");
  const rows = gradingRows(env2);
  const byUid = new Map(rows.map((r) => [r.fixture_uid as string, r]));
  suite.eq("K5: lead 100 jam → diagnostic out_of_horizon", byUid.get("fx_k5_far")?.reason, "lead_out_of_horizon");
  suite.eq("K5: marker beda → strata other_marker", byUid.get("fx_k5_markerb")?.stratum, "other_marker");
  suite.eq("K5: marker kosong → strata marker_missing", byUid.get("fx_k5_markernull")?.stratum, "marker_missing");
  suite.eq("K5: dua alias → satu grading graded untuk UID itu", rows.filter((r) => r.fixture_uid === "fx_k5_alias" && r.status === "graded").length, 1);
  const shadow = new DatabaseSync(env2.outputPath, { readOnly: true });
  const dataset = new DatabaseSync(env2.datasetPath, { readOnly: true });
  const ev = evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-06T00:00:00.000Z", asOfUtc: "2026-12-06T00:00:00.000Z" });
  const funnel = computeCohortFunnel(shadow, dataset, protocol, "2026-12-06T00:00:00.000Z");
  dataset.close();
  shadow.close();
  suite.eq("K5: pair primer hanya dari fixture layak (alias + good)", ev.evaluation.pairs, 2);
  suite.eq("K5: fixture unik di operasi = 5 prediksi tergrading", ev.operations.unique_fixtures, 5);
  suite.check("K5: funnel — scheduled mencakup fixture tanpa paket", (funnel.scheduled_in_scope ?? 0) >= 6, JSON.stringify(funnel.scheduled_in_scope));
  suite.eq("K5: funnel — gap = scheduled − stored", funnel.gap_no_prediction, (funnel.scheduled_in_scope ?? 0) - funnel.stored_predictions);
  suite.eq("K5: funnel — bucket lead 12-<36h terisi dari KICKOFF (34 jam)", funnel.lead_buckets["12-<36h"], 4);
  suite.eq("K5: funnel — bucket beyond_horizon untuk lead 100 jam", funnel.lead_buckets["beyond_horizon"], 1);
  void g;
}

// ============================================================================
// K6 — revisi terbaru menutup skor lama (§4)
// ============================================================================
console.log("\nK6. Revisi batal / ET-only menutup skor regulasi lama");
{
  const env = makeEnv("k6");
  fabricateBatch(env, [
    { uid: "fx_k6_void", sourceId: "fd_k6_v", kickoff: KICKOFF },
    { uid: "fx_k6_et", sourceId: "fd_k6_e", kickoff: KICKOFF },
  ]);
  addIdentity(env, "fx_k6_void", ["fd_k6_v"], { competition: "sm:8" });
  addIdentity(env, "fx_k6_et", ["fd_k6_e"], { competition: "sm:8" });
  // Void: rev1 finished regulation 2-1, rev2 batal.
  addRevision(env, "fx_k6_void", { revision: 1, status: "finished", home: 2, away: 1, observed: "2026-11-29T00:00:00.000Z" });
  addRevision(env, "fx_k6_void", { revision: 2, status: "cancelled", observed: "2026-11-30T00:00:00.000Z" });
  setCanonical(env, "fx_k6_void", { state: "cancelled", currentRevision: 2 });
  // ET-only: rev1 finished regulation 1-0, rev2 finished basis non-regulasi.
  addRevision(env, "fx_k6_et", { revision: 1, status: "finished", home: 1, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  addRevision(env, "fx_k6_et", { revision: 2, status: "finished", home: null, away: null, basis: "extra_time", observed: "2026-11-30T00:00:00.000Z" });
  setCanonical(env, "fx_k6_et", { state: "finished", currentRevision: 2 });
  const protocol = testProtocol();
  const g = grade(env, protocol, "2026-12-05T00:00:00.000Z");
  const rows = gradingRows(env);
  const byUid = new Map(rows.map((r) => [r.fixture_uid as string, r]));
  suite.eq("K6: revisi terakhir batal → void", byUid.get("fx_k6_void")?.status, "void");
  suite.eq("K6: void tanpa skor", byUid.get("fx_k6_void")?.home_score, null);
  suite.eq("K6: ET-only → pending score_basis_not_regulation", byUid.get("fx_k6_et")?.reason, "score_basis_not_regulation");
  suite.eq("K6: skor regulasi lama tidak muncul kembali (home_score null)", byUid.get("fx_k6_et")?.home_score, null);
  suite.eq("K6: tidak ada yang graded", g.by_status.graded ?? 0, 0);
}

// ============================================================================
// K7 — koreksi menambah edisi; laporan lama reproducible; konflik identitas
// ============================================================================
console.log("\nK7. Koreksi grading + konflik identitas");
{
  const env = makeEnv("k7");
  fabricateBatch(env, [
    { uid: "fx_k7_fix", sourceId: "fd_k7_f", kickoff: KICKOFF },
    { uid: "fx_k7_alias", sourceId: "fd_k7_a", kickoff: KICKOFF },
    { uid: "fx_k7_flip", sourceId: "fd_k7_x", kickoff: KICKOFF },
  ]);
  addIdentity(env, "fx_k7_fix", ["fd_k7_f"], { competition: "sm:8" });
  addIdentity(env, "fx_k7_alias", ["fd_k7_a"], { competition: "sm:8" });
  addIdentity(env, "fx_k7_flip", ["fd_k7_x"], { competition: "sm:8" });
  addRevision(env, "fx_k7_fix", { revision: 1, status: "finished", home: 2, away: 1, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env, "fx_k7_fix", { state: "finished", currentRevision: 1 });
  const protocol = testProtocol();
  const g1 = grade(env, protocol, "2026-12-01T00:00:00.000Z", "2026-12-01T12:00:00.000Z");
  suite.eq("K7: grading awal — 1 graded", g1.by_status.graded, 1);
  const shadow1 = new DatabaseSync(env.outputPath, { readOnly: true });
  const ev1 = evaluateCohortFromDb(shadow1, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-01T12:00:00.000Z", asOfUtc: "2026-12-01T12:00:00.000Z" });
  shadow1.close();
  suite.eq("K7: laporan awal 1 pair", ev1.evaluation.pairs, 1);
  const deltaBefore = ev1.evaluation.mean_delta_ll;

  // Koreksi skor 2-1 → 1-1 (kelas outcome berubah; LL ikut berubah),
  // alias pindah UID, orientasi kanonik terbalik untuk fixture ketiga.
  addRevision(env, "fx_k7_fix", { revision: 2, status: "finished", home: 1, away: 1, observed: "2026-12-03T00:00:00.000Z" });
  setCanonical(env, "fx_k7_fix", { state: "finished", currentRevision: 2 });
  {
    const db = new DatabaseSync(env.datasetPath);
    db.prepare("UPDATE fixture_aliases SET fixture_uid = 'fx_uid_other' WHERE source_match_id = 'fd_k7_a'").run();
    db.close();
  }
  setCanonical(env, "fx_k7_flip", { state: "scheduled", currentRevision: 0, home: "Fixture Away", away: "Fixture Home" });
  const g2 = grade(env, protocol, "2026-12-05T00:00:00.000Z", "2026-12-05T12:00:00.000Z");
  const rows = gradingRows(env);
  const fixRows = rows.filter((r) => r.fixture_uid === "fx_k7_fix");
  suite.eq("K7: koreksi menambah edisi grading (2 baris)", fixRows.length, 2);
  suite.eq("K7: edisi terbaru memakai skor koreksi 1-1", fixRows[1]?.home_score, 1);
  const byUid2 = new Map(rows.map((r) => [r.fixture_uid as string, r]));
  suite.eq("K7: alias pindah UID → identity_conflict", byUid2.get("fx_k7_alias")?.reason, "alias_moved_to_other_uid");
  suite.eq("K7: orientasi terbalik → identity_conflict", byUid2.get("fx_k7_flip")?.reason, "orientation_reversed");
  // Laporan lama reproducible: cutoff laporan pertama tetap membaca edisi 1.
  const shadow2 = new DatabaseSync(env.outputPath, { readOnly: true });
  const evOld = evaluateCohortFromDb(shadow2, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-01T12:00:00.000Z", asOfUtc: "2026-12-01T12:00:00.000Z" });
  const evNew = evaluateCohortFromDb(shadow2, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-06T00:00:00.000Z", asOfUtc: "2026-12-06T00:00:00.000Z" });
  shadow2.close();
  suite.eq("K7: laporan lama reproducible (mean Δ sama)", evOld.evaluation.mean_delta_ll, deltaBefore);
  suite.check("K7: laporan baru memakai koreksi (mean Δ berubah)", evNew.evaluation.mean_delta_ll !== deltaBefore, `${evNew.evaluation.mean_delta_ll} vs ${deltaBefore}`);
  void g2;
}

// ============================================================================
// K8 — evaluasi sintetis: LL/Brier/Δ/blok/gate + idempotensi (§5)
// ============================================================================
console.log("\nK8. Evaluasi berpasangan sintetis + gate + idempotensi");
{
  const env = makeEnv("k8");
  fabricateBatch(env, [
    { uid: "fx_k8_win", sourceId: "fd_k8_w", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2], cand: [0.7, 0.2, 0.1] },
    { uid: "fx_k8_bad", sourceId: "fd_k8_b", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2], cand: [0.9, 0.4, 0.2] },
  ]);
  addIdentity(env, "fx_k8_win", ["fd_k8_w"], { competition: "sm:8" });
  addIdentity(env, "fx_k8_bad", ["fd_k8_b"], { competition: "sm:8" });
  for (const uid of ["fx_k8_win", "fx_k8_bad"]) {
    addRevision(env, uid, { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
    setCanonical(env, uid, { state: "finished", currentRevision: 1 });
  }
  const protocol = testProtocol({
    gates: { min_graded_competitive: 1, max_mean_delta_ll: -0.005, bootstrap_resamples: 5000, bootstrap_seed: 20261124, bootstrap_upper_one_sided_95_below: 0, min_blocks: 1 },
    window: {
      weeks: 12, t0: "2026-11-27T00:00:00.000Z", t1: "2026-12-04T00:00:00.000Z",
      grading_cutoff: "2026-12-11T00:00:00.000Z", kickoff_in: "[T0, T1)", decision_from: "T0", min_blocks_with_graded: 1,
    },
  });
  const g1 = grade(env, protocol, "2026-12-05T00:00:00.000Z");
  const rows = gradingRows(env);
  const byUid = new Map(rows.map((r) => [r.fixture_uid as string, r]));
  suite.eq("K8: pasangan valid → graded", byUid.get("fx_k8_win")?.status, "graded");
  suite.eq("K8: LL champion = -ln(0,5)", Math.round((byUid.get("fx_k8_win")?.ll_champion as number) * 10000) / 10000, 0.6931);
  suite.eq("K8: LL kandidat = -ln(0,7)", Math.round((byUid.get("fx_k8_win")?.ll_candidate as number) * 10000) / 10000, 0.3567);
  suite.eq("K8: Brier champion = 0,38", Math.round((byUid.get("fx_k8_win")?.brier_champion as number) * 100) / 100, 0.38);
  suite.eq("K8: Brier kandidat = 0,14", Math.round((byUid.get("fx_k8_win")?.brier_candidate as number) * 100) / 100, 0.14);
  suite.check("K8: arah Δ negatif (kandidat lebih baik)", (byUid.get("fx_k8_win")?.delta_ll as number) < 0);
  suite.eq("K8: pasangan gagal satu model → invalid, tanpa pair parsial", byUid.get("fx_k8_bad")?.reason, "probability_pair_invalid");
  const g2 = grade(env, protocol, "2026-12-05T00:00:00.000Z");
  suite.eq("K8: rerun grading idempoten (0 baris baru)", g2.new_gradings, 0);
  suite.eq("K8: rerun grading idempoten (skip tercatat)", g2.idempotent_skips, g1.new_gradings);
  const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
  const ev = evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-12T00:00:00.000Z", asOfUtc: "2026-12-12T00:00:00.000Z" });
  shadow.close();
  suite.eq("K8: evaluasi — 1 pair primer", ev.evaluation.pairs, 1);
  suite.eq("K8: evaluasi — 1 blok pekan ISO", ev.evaluation.blocks, 1);
  suite.eq("K8: gate lulus semua → READY_TO_REVIEW", ev.evaluation.status, "READY_TO_REVIEW");
  suite.check("K8: bootstrap upper satu sisi < 0", (ev.evaluation.bootstrap?.upperOneSided95 ?? 0) < 0, JSON.stringify(ev.evaluation.bootstrap?.upperOneSided95));
}

// ============================================================================
// K9 — isolasi (§6)
// ============================================================================
console.log("\nK9. Isolasi input, pilot, PIT A");
{
  const env = makeEnv("k9");
  fs.writeFileSync(env.pilotPath, "pilot-sentinel");
  fs.writeFileSync(env.pitAPath, "pita-sentinel");
  const pilotHash = sha256File(env.pilotPath);
  const pitAHash = sha256File(env.pitAPath);
  seedFixture(env, { matchId: "fd_k9", uid: "fx_uid_k9", kickoff: KICKOFF, marker: PRIMARY_MARKER });
  addIdentity(env, "fx_uid_k9", [], { competition: "sm:8" });
  const dumpBefore = (() => {
    const db = new DatabaseSync(env.datasetPath, { readOnly: true });
    const m = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(home_score), 0) AS s FROM matches").get() as unknown as { n: number; s: number };
    db.close();
    return { m };
  })();
  runPitB(env, { clock: makeClock(DECISION).clock });
  addRevision(env, "fx_uid_k9", { revision: 1, status: "finished", home: 1, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env, "fx_uid_k9", { state: "finished", currentRevision: 1 });
  const protocol = testProtocol();
  grade(env, protocol, "2026-12-05T00:00:00.000Z");
  const dumpAfter = (() => {
    const db = new DatabaseSync(env.datasetPath, { readOnly: true });
    const m = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(home_score), 0) AS s FROM matches").get() as unknown as { n: number; s: number };
    db.close();
    return { m };
  })();
  suite.eq("K9: isi matches tidak berubah oleh run + grading", JSON.stringify(dumpAfter.m), JSON.stringify(dumpBefore.m));
  suite.eq("K9: DB pilot tidak berubah (hash file)", sha256File(env.pilotPath), pilotHash);
  suite.eq("K9: DB PIT A tidak berubah (hash file)", sha256File(env.pitAPath), pitAHash);
  suite.check("K9: grading hanya menulis tabel shadow cohort_gradings", gradingRows(env).length >= 1);
  suite.check("K9: protocol hash + cohort_id deterministik", cohortIdFor(protocol) === `ml1b-cohort-${protocolHash(protocol).slice(0, 16)}`);
}

// ============================================================================
for (const root of envsToClean) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // direktori temporer — abaikan kegagalan bersih-bersih
  }
}
suite.finish();
