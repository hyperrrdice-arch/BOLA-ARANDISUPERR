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
 *  K10 Isolasi cohort_id (tindak lanjut §3.1): dua manifest pada satu
 *      DB shadow — B tanpa grading sendiri laporannya n=0, B menulis
 *      gradingnya sendiri, koreksi A tidak mengubah laporan B, rerun
 *      masing-masing stabil.
 *  K11 Ikatan bukti (tindak lanjut §3.2): mutasi SATU field tersimpan
 *      (vektor fitur, hash fitur, SHA/ID kandidat, peluang + λ/μ
 *      champion, marker, identitas paket, waktu hitung paket, waktu
 *      keputusan, kickoff) → baris ditolak evidence_invalid; kontrol
 *      utuh tetap graded dengan LL yang benar.
 *  K12 Manifest beku (tindak lanjut §3.3): proposal = staging saja,
 *      mode official mensyaratkan manifest FROZEN lengkap + cutoff
 *      grading == cutoff beku, snapshot grading formal ter-persist,
 *      koreksi pasca-cutoff tidak masuk laporan lama, klasifikasi
 *      mengikuti allowlist manifest.
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
  canonicalJson,
  cohortIdFor,
  computeCohortFunnel,
  evaluateCohortFromDb,
  gradeCohort,
  protocolHash,
  recomputeFrozenReport,
  validateProtocolManifest,
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
  candLam?: number;
  candMu?: number;
  candidateId?: string;
  candidateManifestSha256?: string;
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
    // Keluaran kandidat dibekukan ke arsip dengan nilai yang sama
    // persis dengan baris prediksi di bawah (ikatan bukti §4.2).
    candidate_outputs: preds.map((p) => ({
      fixture_uid: p.uid,
      cand_lam: p.candLam ?? 1.6,
      cand_mu: p.candMu ?? 1.1,
      cand_p_h: (p.cand ?? [0.55, 0.28, 0.17])[0],
      cand_p_d: (p.cand ?? [0.55, 0.28, 0.17])[1],
      cand_p_a: (p.cand ?? [0.55, 0.28, 0.17])[2],
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
        candidate_id: p.candidateId ?? "ml1-b-fixture-candidate",
        candidate_manifest_sha256: p.candidateManifestSha256 ?? "fab-candidate-manifest",
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
        cand_lam: p.candLam ?? 1.6,
        cand_mu: p.candMu ?? 1.1,
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

type TestProtocolOverrides = Omit<Partial<CohortProtocol>, "study" | "champion" | "window" | "gates" | "review" | "competitive_primary"> & {
  study?: Partial<CohortProtocol["study"]>;
  champion?: Partial<CohortProtocol["champion"]>;
  window?: Partial<CohortProtocol["window"]>;
  gates?: Partial<CohortProtocol["gates"]>;
  review?: Partial<CohortProtocol["review"]>;
  competitive_primary?: Partial<CohortProtocol["competitive_primary"]>;
};

function testProtocol(overrides: TestProtocolOverrides = {}): CohortProtocol {
  const base = buildProposedProtocol();
  const p: CohortProtocol = {
    ...base,
    ...overrides,
    // Kandidat fixture: baris fabrikasi + executor stub diterbitkan atas
    // nama kandidat ini; protokol tes mengikat ke kandidat yang sama.
    study: { ...base.study, candidate_id: "ml1-b-fixture-candidate", ...(overrides.study ?? {}) },
    champion: { ...base.champion, primary_marker: PRIMARY_MARKER, ...(overrides.champion ?? {}) },
    window: { ...base.window, ...(overrides.window ?? {}) },
    gates: { ...base.gates, ...(overrides.gates ?? {}) },
    review: { ...base.review, ...(overrides.review ?? {}) },
    competitive_primary: { ...base.competitive_primary, ...(overrides.competitive_primary ?? {}) },
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
  const funnel = computeCohortFunnel(shadow, dataset, protocol, "2026-12-06T00:00:00.000Z", cohortIdFor(protocol));
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
// K10 — isolasi kohor pada satu DB shadow (Brief Tindak Lanjut §3.1)
// ============================================================================
console.log("\nK10. Isolasi cohort_id pada DB shadow yang sama");
{
  const env = makeEnv("k10");
  fabricateBatch(env, [{ uid: "fx_k10", sourceId: "fd_k10", kickoff: KICKOFF }]);
  addIdentity(env, "fx_k10", ["fd_k10"], { competition: "sm:8" });
  addRevision(env, "fx_k10", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env, "fx_k10", { state: "finished", currentRevision: 1 });
  const protoA = testProtocol();
  const protoB = testProtocol({
    window: {
      weeks: 12, t0: "2026-11-20T00:00:00.000Z", t1: "2026-12-10T00:00:00.000Z",
      grading_cutoff: null, kickoff_in: "[T0, T1)", decision_from: "T0", min_blocks_with_graded: 8,
    },
    gates: { min_graded_competitive: 250, max_mean_delta_ll: -0.005, bootstrap_resamples: 5000, bootstrap_seed: 20261124, bootstrap_upper_one_sided_95_below: 0, min_blocks: 8 },
  });
  const evalFor = (protocol: CohortProtocol, cutoff: string) => {
    const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
    try {
      return evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: cutoff, asOfUtc: cutoff });
    } finally {
      shadow.close();
    }
  };
  const gA = grade(env, protoA, "2026-12-05T00:00:00.000Z");
  suite.eq("K10: kohor A grading 1 baris", gA.new_gradings, 1);
  const evB0 = evalFor(protoB, "2026-12-06T00:00:00.000Z");
  suite.eq("K10: laporan B sebelum B grading — 0 grading terbaca", evB0.operations.latest_gradings, 0);
  suite.eq("K10: laporan B sebelum B grading — 0 pair (bukan pair A)", evB0.evaluation.pairs, 0);
  const gB = grade(env, protoB, "2026-12-05T00:00:00.000Z");
  suite.eq("K10: B menulis grading SENDIRI (bukan idempoten milik A)", gB.new_gradings, 1);
  suite.eq("K10: B tanpa idempotent skip pada larian pertamanya", gB.idempotent_skips, 0);
  suite.eq("K10: total baris = 1 per kohor", gradingRows(env).length, 2);
  const evB1 = evalFor(protoB, "2026-12-06T00:00:00.000Z");
  suite.eq("K10: laporan B sesudah grading sendiri — 1 pair", evB1.evaluation.pairs, 1);
  const deltaB = evB1.evaluation.mean_delta_ll;
  // Rerun masing-masing kohor: stabil, tanpa baris baru.
  const gA2 = grade(env, protoA, "2026-12-05T00:00:00.000Z");
  const gB2 = grade(env, protoB, "2026-12-05T00:00:00.000Z");
  suite.eq("K10: rerun A idempoten", gA2.new_gradings, 0);
  suite.eq("K10: rerun B idempoten", gB2.new_gradings, 0);
  suite.eq("K10: rerun A skip tercatat 1", gA2.idempotent_skips, 1);
  suite.eq("K10: rerun B skip tercatat 1", gB2.idempotent_skips, 1);
  // Koreksi revisi hanya di-grading ulang oleh A → laporan B tidak berubah.
  addRevision(env, "fx_k10", { revision: 2, status: "finished", home: 1, away: 1, observed: "2026-12-03T00:00:00.000Z" });
  setCanonical(env, "fx_k10", { state: "finished", currentRevision: 2 });
  const gA3 = grade(env, protoA, "2026-12-05T00:00:00.000Z", "2026-12-06T12:00:00.000Z");
  suite.eq("K10: koreksi menambah edisi di A", gA3.new_gradings, 1);
  const evB2 = evalFor(protoB, "2026-12-07T00:00:00.000Z");
  suite.eq("K10: laporan B tidak berubah oleh koreksi A (pair)", evB2.evaluation.pairs, 1);
  suite.eq("K10: laporan B tidak berubah oleh koreksi A (mean Δ)", evB2.evaluation.mean_delta_ll, deltaB);
  const evA2 = evalFor(protoA, "2026-12-07T00:00:00.000Z");
  suite.check("K10: laporan A memakai koreksinya sendiri (mean Δ berubah)", evA2.evaluation.mean_delta_ll !== deltaB, `${evA2.evaluation.mean_delta_ll} vs ${deltaB}`);
  // Funnel ter-scope kohor: B menghitung grading-nya sendiri.
  const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
  const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
  const funnelB = computeCohortFunnel(shadow, dataset, protoB, "2026-12-07T00:00:00.000Z", cohortIdFor(protoB));
  dataset.close();
  shadow.close();
  suite.eq("K10: funnel B — graded milik B saja", funnelB.graded, 1);
}

// ============================================================================
// K11 — mutasi per field pada prediksi tersimpan → ditolak (§3.2)
// ============================================================================
console.log("\nK11. Ikatan bukti: mutasi satu field tersimpan ditolak");
{
  const protocol = testProtocol({ study: { candidate_manifest_sha256: "fab-candidate-manifest" } });
  const cases: { name: string; sql: string | null; status: string; reason: string | null }[] = [
    { name: "kontrol tanpa mutasi", sql: null, status: "graded", reason: null },
    { name: "features_json → []", sql: "UPDATE predictions SET features_json = '[]'", status: "evidence_invalid", reason: "features_json_mismatch" },
    { name: "features_sha256 diganti", sql: "UPDATE predictions SET features_sha256 = '0000000000000000000000000000000000000000000000000000000000000000'", status: "evidence_invalid", reason: "features_hash_mismatch" },
    { name: "candidate_manifest_sha256 diganti", sql: "UPDATE predictions SET candidate_manifest_sha256 = 'sha256:mutated-candidate'", status: "evidence_invalid", reason: "candidate_manifest_mismatch" },
    { name: "candidate_id diganti", sql: "UPDATE predictions SET candidate_id = 'ml1-b-lain'", status: "evidence_invalid", reason: "candidate_id_mismatch" },
    { name: "peluang champion → [0.9,0.05,0.05]", sql: "UPDATE predictions SET champ_p_h = 0.9, champ_p_d = 0.05, champ_p_a = 0.05", status: "evidence_invalid", reason: "champion_values_mismatch" },
    { name: "champ_lam diganti", sql: "UPDATE predictions SET champ_lam = 2.5", status: "evidence_invalid", reason: "champion_values_mismatch" },
    { name: "champ_mu diganti", sql: "UPDATE predictions SET champ_mu = 0.7", status: "evidence_invalid", reason: "champion_values_mismatch" },
    // Brief Validasi Rilis §4.2: keluaran kandidat kini terikat ke arsip
    // proyeksi beku — mutasi peluang kandidat yang MASIH distribusi
    // valid (ID/SHA kandidat tetap benar) tetap ditolak.
    { name: "peluang kandidat → [0.9,0.05,0.05]", sql: "UPDATE predictions SET cand_p_h = 0.9, cand_p_d = 0.05, cand_p_a = 0.05", status: "evidence_invalid", reason: "candidate_values_mismatch" },
    { name: "cand_lam diganti", sql: "UPDATE predictions SET cand_lam = 2.9", status: "evidence_invalid", reason: "candidate_values_mismatch" },
    { name: "cand_mu diganti", sql: "UPDATE predictions SET cand_mu = 0.4", status: "evidence_invalid", reason: "candidate_values_mismatch" },
    { name: "champion_ratings_marker diganti", sql: "UPDATE predictions SET champion_ratings_marker = 'sha256:deadbeefdeadbeef'", status: "evidence_invalid", reason: "package_identity_mismatch" },
    { name: "package_payload_sha256 diganti", sql: "UPDATE predictions SET package_payload_sha256 = '1111111111111111111111111111111111111111111111111111111111111111'", status: "evidence_invalid", reason: "package_identity_mismatch" },
    { name: "package_id diganti", sql: "UPDATE predictions SET package_id = 9999", status: "evidence_invalid", reason: "package_identity_mismatch" },
    { name: "package_computed_utc diganti", sql: "UPDATE predictions SET package_computed_utc = '2026-11-27T10:30:00.000Z'", status: "evidence_invalid", reason: "package_computed_mismatch" },
    { name: "decision_at_utc diganti", sql: "UPDATE predictions SET decision_at_utc = '2026-11-27T10:30:00.000Z', issued_at_utc = '2026-11-27T10:31:00.000Z'", status: "evidence_invalid", reason: "decision_time_mismatch" },
    { name: "kickoff_utc diganti", sql: "UPDATE predictions SET kickoff_utc = '2026-11-28T21:00:00.000Z'", status: "evidence_invalid", reason: "fixture_identity_mismatch" },
  ];
  for (const c of cases) {
    const env = makeEnv("k11");
    fabricateBatch(env, [{ uid: "fx_k11", sourceId: "fd_k11", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2] }]);
    addIdentity(env, "fx_k11", ["fd_k11"], { competition: "sm:8" });
    addRevision(env, "fx_k11", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
    setCanonical(env, "fx_k11", { state: "finished", currentRevision: 1 });
    if (c.sql) {
      const db = new DatabaseSync(env.outputPath);
      db.prepare(`${c.sql} WHERE fixture_uid = 'fx_k11'`).run();
      db.close();
    }
    grade(env, protocol, "2026-12-05T00:00:00.000Z");
    const row = gradingRows(env).find((r) => r.fixture_uid === "fx_k11");
    suite.eq(`K11: ${c.name} → status ${c.status}`, row?.status, c.status);
    if (c.reason !== null) suite.eq(`K11: ${c.name} → alasan ${c.reason}`, row?.reason, c.reason);
    if (c.name.startsWith("kontrol")) {
      suite.eq("K11: kontrol — LL champion benar -ln(0,5)", Math.round((row?.ll_champion as number) * 10000) / 10000, 0.6931);
    }
    const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
    const ev = evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-06T00:00:00.000Z", asOfUtc: "2026-12-06T00:00:00.000Z" });
    shadow.close();
    suite.eq(`K11: ${c.name} → pair evaluasi ${c.status === "graded" ? 1 : 0}`, ev.evaluation.pairs, c.status === "graded" ? 1 : 0);
  }
}

// Retry grading atas bukti kandidat yang utuh: idempoten, baris tetap
// strict, dan tidak ada edisi ganda (§4.2 — retry/idempotensi terjaga).
{
  const protocol = testProtocol({ study: { candidate_manifest_sha256: "fab-candidate-manifest" } });
  const env = makeEnv("k11r");
  fabricateBatch(env, [{ uid: "fx_k11r", sourceId: "fd_k11r", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2] }]);
  addIdentity(env, "fx_k11r", ["fd_k11r"], { competition: "sm:8" });
  addRevision(env, "fx_k11r", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env, "fx_k11r", { state: "finished", currentRevision: 1 });
  const g1 = grade(env, protocol, "2026-12-05T00:00:00.000Z");
  suite.eq("K11R: grading pertama menulis 1 edisi", g1.new_gradings, 1);
  const g2 = grade(env, protocol, "2026-12-05T00:00:00.000Z", "2026-12-05T06:00:00.000Z");
  suite.eq("K11R: retry grading — 0 edisi baru", g2.new_gradings, 0);
  suite.eq("K11R: retry grading — 1 idempotent skip", g2.idempotent_skips, 1);
  suite.eq("K11R: total edisi tetap 1", gradingRows(env).length, 1);
  const dbRo = new DatabaseSync(env.outputPath, { readOnly: true });
  const v = verifyPitBArtifacts(dbRo, env.projectionDir);
  dbRo.close();
  suite.eq("K11R: baris utuh tetap strict sesudah ikatan kandidat", v.strict_prediction_ids.length, 1);
}

// ============================================================================
// K12 — penegakan manifest beku + cutoff formal + snapshot laporan (§3.3)
// ============================================================================
console.log("\nK12. Manifest beku ditegakkan; proposal hanya staging");
{
  const gradeMode = (env: KohorEnv, protocol: CohortProtocol, cutoff: string, mode?: "staging" | "official", gradedAt = "2026-12-05T00:00:00.000Z") => {
    const shadow = new DatabaseSync(env.outputPath);
    const dataset = new DatabaseSync(env.datasetPath, { readOnly: true });
    try {
      return gradeCohort({
        shadowDb: shadow, dataset, projectionDir: env.projectionDir, protocol,
        cohortId: cohortIdFor(protocol), gradingCutoffUtc: cutoff, clock: () => new Date(gradedAt), mode,
      });
    } finally {
      dataset.close();
      shadow.close();
    }
  };
  const env = makeEnv("k12");
  fabricateBatch(env, [{ uid: "fx_k12", sourceId: "fd_k12", kickoff: KICKOFF }]);
  addIdentity(env, "fx_k12", ["fd_k12"], { competition: "sm:8" });
  addRevision(env, "fx_k12", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env, "fx_k12", { state: "finished", currentRevision: 1 });

  const proposal = testProtocol();
  const valProposal = validateProtocolManifest(proposal);
  suite.eq("K12: proposal valid untuk staging", valProposal.ok, true);
  suite.eq("K12: proposal ber-mode staging", valProposal.mode, "staging");
  suite.check("K12: proposal mencatat nilai produksi kosong sebagai warning", valProposal.warnings.length >= 3, valProposal.warnings.join(" | "));

  let errOfficial = "";
  try {
    gradeMode(env, proposal, "2026-12-05T00:00:00.000Z", "official");
  } catch (err) {
    errOfficial = err instanceof Error ? err.message : String(err);
  }
  suite.check("K12: mode official pada proposal → ditolak", errOfficial.includes("FROZEN_FOR_COLLECTION"), errOfficial);

  const frozenIncomplete: CohortProtocol = {
    ...testProtocol(),
    status: "FROZEN_FOR_COLLECTION",
    champion: { ...testProtocol().champion, primary_marker: null },
  };
  const valIncomplete = validateProtocolManifest(frozenIncomplete);
  suite.eq("K12: manifest FROZEN tak lengkap → tidak ok", valIncomplete.ok, false);
  suite.check("K12: error menyebut marker + SHA kandidat", valIncomplete.errors.some((e) => e.includes("primary_marker")) && valIncomplete.errors.some((e) => e.includes("candidate_manifest_sha256")), valIncomplete.errors.join(" | "));
  let errIncomplete = "";
  try {
    gradeMode(env, frozenIncomplete, "2026-12-05T00:00:00.000Z");
  } catch (err) {
    errIncomplete = err instanceof Error ? err.message : String(err);
  }
  suite.check("K12: grading dengan manifest FROZEN tak lengkap → ditolak", errIncomplete.includes("manifest final tidak lengkap"), errIncomplete);

  // Manifest FINAL membekukan SHA kandidat sebagai hash SHA-256 asli;
  // baris yang diterbitkan di bawahnya membawa SHA yang sama.
  const FAB_CANDIDATE_SHA = sha256Str("fab-candidate-manifest");
  {
    const db = new DatabaseSync(env.outputPath);
    db.prepare("UPDATE predictions SET candidate_manifest_sha256 = ? WHERE fixture_uid = 'fx_k12'").run(FAB_CANDIDATE_SHA);
    db.close();
  }
  const frozenFull: CohortProtocol = {
    ...testProtocol({
      study: { candidate_manifest_sha256: FAB_CANDIDATE_SHA },
      window: {
        weeks: 12, t0: "2026-11-27T00:00:00.000Z", t1: "2026-12-04T00:00:00.000Z",
        grading_cutoff: "2026-12-05T00:00:00.000Z", kickoff_in: "[T0, T1)", decision_from: "T0", min_blocks_with_graded: 8,
      },
    }),
    status: "FROZEN_FOR_COLLECTION",
    review: { formal_review_date: "2026-12-20", single_formal_review: true },
  };
  const valFull = validateProtocolManifest(frozenFull);
  suite.eq("K12: manifest FROZEN lengkap → ok + mode official", `${valFull.ok}/${valFull.mode}`, "true/official");
  let errCutoff = "";
  try {
    gradeMode(env, frozenFull, "2026-12-04T00:00:00.000Z");
  } catch (err) {
    errCutoff = err instanceof Error ? err.message : String(err);
  }
  suite.check("K12: cutoff grading ≠ cutoff beku → ditolak", errCutoff.includes("cutoff beku"), errCutoff);
  const gFrozen = gradeMode(env, frozenFull, "2026-12-05T00:00:00.000Z", undefined, "2026-12-05T12:00:00.000Z");
  suite.eq("K12: grading resmi pada cutoff beku berjalan", gFrozen.new_gradings, 1);

  // Laporan formal di-persist + snapshot grading dibekukan.
  const shadowW = new DatabaseSync(env.outputPath);
  const evPersist = evaluateCohortFromDb(shadowW, frozenFull, {
    cohortId: cohortIdFor(frozenFull), reportCutoffUtc: "2026-12-05T12:00:00.000Z", asOfUtc: "2026-12-05T12:00:00.000Z", persist: true,
  });
  const reportRow = shadowW.prepare("SELECT id, report_json FROM cohort_reports WHERE cohort_id = ?").get(cohortIdFor(frozenFull)) as unknown as { id: number; report_json: string };
  const snapRows = shadowW.prepare("SELECT * FROM cohort_report_gradings WHERE report_id = ?").all(reportRow.id) as unknown as Record<string, unknown>[];
  shadowW.close();
  suite.eq("K12: laporan formal — 1 pair", evPersist.evaluation.pairs, 1);
  suite.eq("K12: snapshot grading formal — 1 baris beku", snapRows.length, 1);
  suite.eq("K12: snapshot menunjuk grading yang dipakai", snapRows[0]?.status, "graded");
  suite.check("K12: report_json tersimpan memuat pair yang sama", JSON.parse(reportRow.report_json).evaluation.pairs === 1, reportRow.report_json.slice(0, 120));

  // Koreksi tiba SESUDAH cutoff formal: revisinya tidak terlihat pada
  // cutoff beku dan skor koreksi TIDAK PERNAH ter-grading di kohor beku;
  // laporan lama tidak berubah. Pointer kanonik yang maju karena revisi
  // pasca-cutoff kini dinilai as-of cutoff (Validasi Rilis §4.3):
  // re-grade pada cutoff beku menghasilkan draft yang sama dengan
  // edisi formal → idempoten, TANPA edisi proof_conflict pencemar.
  addRevision(env, "fx_k12", { revision: 2, status: "finished", home: 1, away: 1, observed: "2026-12-06T00:00:00.000Z" });
  setCanonical(env, "fx_k12", { state: "finished", currentRevision: 2 });
  const gAfter = gradeMode(env, frozenFull, "2026-12-05T00:00:00.000Z", undefined, "2026-12-07T00:00:00.000Z");
  const rowsAfter = gradingRows(env).filter((r) => r.fixture_uid === "fx_k12");
  suite.check(
    "K12: skor koreksi pasca-cutoff tidak pernah ter-grading di kohor beku",
    rowsAfter.every((r) => !(r.home_score === 1 && r.away_score === 1)),
    JSON.stringify(rowsAfter.map((r) => [r.status, r.home_score, r.away_score])),
  );
  suite.eq("K12: re-grade pada cutoff beku sesudah koreksi — idempoten (0 edisi baru)", gAfter.new_gradings, 0);
  suite.eq("K12: re-grade pada cutoff beku sesudah koreksi — 1 idempotent skip", gAfter.idempotent_skips, 1);
  suite.eq("K12: tidak ada edisi pencemar pasca-cutoff", rowsAfter.length, 1);
  const shadow2 = new DatabaseSync(env.outputPath, { readOnly: true });
  const evOld = evaluateCohortFromDb(shadow2, frozenFull, { cohortId: cohortIdFor(frozenFull), reportCutoffUtc: "2026-12-05T12:00:00.000Z", asOfUtc: "2026-12-05T12:00:00.000Z" });
  shadow2.close();
  suite.eq("K12: laporan lama tetap 1 pair dengan Δ sama", `${evOld.evaluation.pairs}/${evOld.evaluation.mean_delta_ll}`, `${evPersist.evaluation.pairs}/${evPersist.evaluation.mean_delta_ll}`);

  // Klasifikasi mengikuti ALLOWLIST manifest, bukan konstanta kode.
  const env2 = makeEnv("k12b");
  fabricateBatch(env2, [{ uid: "fx_k12b", sourceId: "fd_k12b", kickoff: KICKOFF }]);
  addIdentity(env2, "fx_k12b", ["fd_k12b"], { competition: "sm:8" });
  addRevision(env2, "fx_k12b", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
  setCanonical(env2, "fx_k12b", { state: "finished", currentRevision: 1 });
  const narrowList: CohortProtocol = {
    ...testProtocol(),
    competitive_primary: {
      ...testProtocol().competitive_primary,
      list: testProtocol().competitive_primary.list.filter((e) => e.competition_id !== "sm:8"),
    },
  };
  grade(env2, narrowList, "2026-12-05T00:00:00.000Z");
  const rowNarrow = gradingRows(env2).find((r) => r.fixture_uid === "fx_k12b");
  suite.eq("K12: sm:8 di luar allowlist manifest → strata non_primary", rowNarrow?.stratum, "non_primary_competition");
  suite.eq("K12: grading tetap berjalan (strata, bukan penolakan)", rowNarrow?.status, "graded");
}

// ============================================================================
// K14 — reproduksibilitas cutoff formal (Brief Validasi Rilis §4.3):
// koreksi hasil SESUDAH cutoff tidak boleh mengubah laporan formal —
// baik saat grading pertama berjalan terlambat (sesudah koreksi tiba)
// maupun saat laporan dihitung ulang dari set baris bekunya.
// ============================================================================
console.log("\nK14. Cutoff formal: koreksi pasca-cutoff tidak mengubah laporan");
{
  const protocol = testProtocol({ study: { candidate_manifest_sha256: "fab-candidate-manifest" } });
  const FORMAL_CUTOFF = "2026-12-20T00:00:00.000Z";

  // Skenario A — grading pertama pada cutoff formal berjalan SESUDAH
  // koreksi tiba (pointer kanonik sudah di revisi 2). Sebelum perbaikan:
  // proof_conflict current_revision_mismatch → 0 pair.
  {
    const env = makeEnv("k14a");
    fabricateBatch(env, [{ uid: "fx_k14a", sourceId: "fd_k14a", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2] }]);
    addIdentity(env, "fx_k14a", ["fd_k14a"], { competition: "sm:8" });
    addRevision(env, "fx_k14a", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
    addRevision(env, "fx_k14a", { revision: 2, status: "finished", home: 1, away: 1, observed: "2026-12-21T00:00:00.000Z" });
    setCanonical(env, "fx_k14a", { state: "finished", currentRevision: 2 });
    const g = grade(env, protocol, FORMAL_CUTOFF, "2026-12-22T00:00:00.000Z");
    suite.eq("K14A: grading terlambat pada cutoff formal tetap menulis edisi", g.new_gradings, 1);
    const row = gradingRows(env).find((r) => r.fixture_uid === "fx_k14a");
    suite.eq("K14A: status graded (bukan proof_conflict)", row?.status, "graded");
    suite.eq("K14A: skor yang dinilai = skor as-of cutoff (2-0)", `${row?.home_score}-${row?.away_score}`, "2-0");
    const shadow = new DatabaseSync(env.outputPath, { readOnly: true });
    const ev = evaluateCohortFromDb(shadow, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-22T00:00:00.000Z", asOfUtc: "2026-12-22T00:00:00.000Z" });
    shadow.close();
    suite.eq("K14A: laporan cutoff formal = 1 pair", ev.evaluation.pairs, 1);
  }

  // Skenario B — grade → persist → koreksi → re-grade → hitung ulang:
  // laporan lama identik dari ketiga jalur (terbaru-pada-cutoff sesudah
  // re-grade, dan set beku laporan).
  {
    const env = makeEnv("k14b");
    fabricateBatch(env, [{ uid: "fx_k14b", sourceId: "fd_k14b", kickoff: KICKOFF, champ: [0.5, 0.3, 0.2] }]);
    addIdentity(env, "fx_k14b", ["fd_k14b"], { competition: "sm:8" });
    addRevision(env, "fx_k14b", { revision: 1, status: "finished", home: 2, away: 0, observed: "2026-11-29T00:00:00.000Z" });
    setCanonical(env, "fx_k14b", { state: "finished", currentRevision: 1 });
    const g1 = grade(env, protocol, FORMAL_CUTOFF, "2026-12-20T12:00:00.000Z");
    suite.eq("K14B: grading formal menulis 1 edisi", g1.new_gradings, 1);
    const shadowW = new DatabaseSync(env.outputPath);
    const evPersist = evaluateCohortFromDb(shadowW, protocol, {
      cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-20T12:00:00.000Z", asOfUtc: "2026-12-20T12:00:00.000Z", persist: true,
    });
    const reportRow = shadowW.prepare("SELECT id FROM cohort_reports WHERE cohort_id = ?").get(cohortIdFor(protocol)) as unknown as { id: number };
    shadowW.close();
    suite.eq("K14B: laporan formal ter-persist = 1 pair", evPersist.evaluation.pairs, 1);

    addRevision(env, "fx_k14b", { revision: 2, status: "finished", home: 1, away: 1, observed: "2026-12-21T00:00:00.000Z" });
    setCanonical(env, "fx_k14b", { state: "finished", currentRevision: 2 });
    const g2 = grade(env, protocol, FORMAL_CUTOFF, "2026-12-23T00:00:00.000Z");
    suite.eq("K14B: re-grade sesudah koreksi — 0 edisi baru", g2.new_gradings, 0);
    suite.eq("K14B: re-grade sesudah koreksi — 1 idempotent skip", g2.idempotent_skips, 1);
    suite.eq("K14B: total edisi tetap 1 (tidak ada edisi pencemar)", gradingRows(env).length, 1);

    const shadow2 = new DatabaseSync(env.outputPath, { readOnly: true });
    const evLate = evaluateCohortFromDb(shadow2, protocol, { cohortId: cohortIdFor(protocol), reportCutoffUtc: "2026-12-23T00:00:00.000Z", asOfUtc: "2026-12-23T00:00:00.000Z" });
    suite.eq("K14B: hitung ulang terbaru-pada-cutoff sesudah re-grade tetap 1 pair", evLate.evaluation.pairs, 1);
    suite.eq("K14B: Δ hitung ulang = Δ laporan formal", evLate.evaluation.mean_delta_ll, evPersist.evaluation.mean_delta_ll);
    const frozen = recomputeFrozenReport(shadow2, reportRow.id, protocol);
    shadow2.close();
    suite.check("K14B: laporan beku ditemukan untuk dihitung ulang", frozen !== null, `report ${reportRow.id}`);
    suite.eq("K14B: hitung ulang dari set beku = 1 pair", frozen?.evaluation.pairs, 1);
    suite.eq("K14B: Δ dari set beku = Δ laporan formal", frozen?.evaluation.mean_delta_ll, evPersist.evaluation.mean_delta_ll);
    suite.eq(
      "K14B: hitung ulang dari set beku identik byte-per-byte dengan report_json tersimpan",
      frozen ? canonicalJson({ evaluation: frozen.evaluation, operations: frozen.operations }) : "(null)",
      frozen?.stored_report_json ?? "(null)",
    );
  }
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
