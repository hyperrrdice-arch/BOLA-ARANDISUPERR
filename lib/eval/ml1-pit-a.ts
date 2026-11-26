/**
 * ML1-PIT A — mode shadow ML1-B dengan bukti point-in-time per prediksi
 * (Brief ML1-PIT A: paket, waktu prediksi, dan identitas laga).
 *
 * Menjawab tiga pertanyaan per baris staging:
 *  1. Paket champion edisi berapa yang SUDAH TERSEDIA saat keputusan?
 *     → seleksi edisi `slate` as-of: predikat `computed_utc <= decision_at_utc`
 *       berada DI DALAM subquery selector latest (pola brief §3), tie-break
 *       `computed_utc DESC, id DESC`. Per komponen alias, PEMENANG dipilih
 *       dulu (instant komputasi DESC, ID paket DESC) dan HANYA pemenang yang
 *       divalidasi kickoff + payload-nya — pemenang rusak mengeluarkan
 *       seluruh fixture, edisi lama alias lain tidak menyelamatkannya.
 *  2. Apakah inferensi sempat dicatat SEBELUM kickoff?
 *     → `decision_at_utc` (dari clock, dipin sesudah snapshot paket terkunci)
 *       dan `issued_at_utc` (dari clock yang sama, dibaca PER BARIS sesudah
 *       lock tulis) disimpan terpisah; per baris wajib
 *       `package_computed_utc <= decision_at_utc <= issued_at_utc < kickoff_utc`.
 *       Sesudah staging insert, clock dibaca LAGI sebelum commit: baris yang
 *       kickoff-nya sudah lewat/sama dibuang dari transaksi yang sama.
 *       Eligibility (upcoming + state/jadwal kanonik + UID) diperiksa oleh
 *       SATU fungsi di dua titik: sebelum limit dan sesudah inferensi
 *       (lookup baru), supaya laga batal tidak memakan jatah inferensi dan
 *       perubahan state saat inferensi tetap tertangkap.
 *  3. Apakah fixture fisik ini sudah punya prediksi di horizon yang sama?
 *     → dedupe per UID kanonik K1 SEBELUM inferensi/limit; komponen alias
 *       dihitung transitif (K1 + tautan fixture + bridge `sm_id_map`);
 *       unique key `(eval_version, fixture_uid, horizon_id)` + conflict
 *       handler tertarget; set alias terverifikasi disimpan per baris untuk
 *       deteksi drift rerun.
 *
 * ISOLASI: DB masukan (thestats_dataset, upcoming_fixtures,
 * analysis_snapshots) dibuka `{ readOnly: true }` oleh pemanggil dan modul
 * ini TIDAK PERNAH menulis ke sana; accessor paket yang menginisialisasi
 * skema/mengubah PRAGMA tidak dipakai. Semua write masuk DB shadow BARU
 * `ml1_prospective_pit_a.db`. Status data `PIT_A_STAGED`,
 * `feature_time_status = 'pending_pit_b'` — semua baris tahap A berada di
 * luar evaluasi promosi (kronologi form/Elo/shots = pekerjaan PIT B).
 *
 * Fitur memakai fungsi produksi yang sama dengan jalur pilot
 * (`Ml1FeatureExtractor.prospectiveFeaturesB`), runner Python yang sama
 * (`scripts/ml1-predict.py`), dan matematika probabilitas yang sama
 * (`matrixProbs`). Query pemuatan data di bawah identik dengan
 * `loadData()` pada scripts/ml1-prospective.ts.
 *
 * FORMAT WAKTU: store produksi menyimpan `computed_utc` seragam sebagai
 * ISO 8601 UTC milidetik (`2026-11-26T09:47:57.248Z`, terverifikasi pada
 * SHA basis) dan `kickoff_utc` mayoritas format yang sama (ada varian
 * valid tanpa milidetik, 20 char). Jalur cepat selector memakai
 * perbandingan leksikal SQLite untuk `computed_utc`, TETAPI setiap match
 * kandidat diperiksa varian formatnya lebih dulu: bila ada edisi dengan
 * format non-seragam (mis. offset numerik `+01:00`/`-01:00` yang urutan
 * leksikalnya menyimpang dari urutan instant), seleksi match itu dihitung
 * ulang per instant dengan parser berzona eksplisit (`Date.parse` atas
 * ISO 8601 berzona: UTC ± milidetik atau offset numerik valid). Semua
 * perbandingan lain (kickoff, validasi as-of, ranking pemenang) selalu
 * atas instant. Field waktu pada baris keluaran (`decision_at_utc`,
 * `issued_at_utc`, `kickoff_utc`, `package_computed_utc`) dinormalisasi
 * ke UTC ISO milidetik; hash payload tetap dari byte mentah. Nilai waktu
 * kosong/invalid — termasuk kickoff tanggal-saja tanpa komponen jam —
 * membuat edisi dilewati (`invalid_time`).
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matrixProbs, type EvalMatchRow } from "./chronological-evaluator";
import { Ml1FeatureExtractor, type Ml1CanonicalLogRow } from "./ml1-features";
import {
  getAliasesForUid,
  getFixtureByUid,
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  linkSiblingsOf,
  loadFixtureLinkGroups,
  sourceOfMatchId,
  type FixtureLinkGroup,
} from "../identity/fixture-resolver";
import {
  canonicalIdForTeamId,
  canonicalIdForTeamName,
  loadCanonicalTeams,
} from "../quant/team-identity";

export const PIT_A_EVAL_VERSION = "ml1-pit-a-v1";
export const PIT_A_HORIZON_ID = "slate_pre_match";
export const PIT_A_DATA_STATUS = "PIT_A_STAGED";
export const PIT_A_FEATURE_TIME_STATUS = "pending_pit_b";

// ============================================================================
// Kontrak injeksi: clock + executor inferensi
// ============================================================================

/** Jam run — produksi memakai jam aktual; tes menyuntik jam buatan. */
export type PitAClock = () => Date;

export interface PitAInferenceRequest {
  match_id: string;
  champLam: number;
  champMu: number;
  featB: number[];
}

export interface PitAInferenceResult {
  lam: number;
  mu: number;
}

export interface PitAExecutorResult {
  /** Tepat satu hasil per match_id masukan (divalidasi pemanggil). */
  results: Map<string, PitAInferenceResult>;
  candidateId: string | null;
  /** SHA-256 byte manifest kandidat yang benar-benar dipakai inferensi. */
  candidateManifestSha256: string;
}

export type PitAInferenceExecutor = (input: {
  modelDir: string;
  requests: PitAInferenceRequest[];
}) => PitAExecutorResult;

// ============================================================================
// Helper hash
// ============================================================================

/** sha256 berkas dibaca per potongan 8 MiB — identik penjaga pilot. */
export function sha256FilePitA(p: string): string {
  const h = createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** SHA-256 dari byte UTF-8 string mentah (payload_json SEBELUM parse). */
export function sha256Utf8(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// ============================================================================
// Executor produksi: salin artefak kandidat ke direktori temporer run,
// jalankan scripts/ml1-predict.py terhadap SALINAN itu (runner sendiri
// memverifikasi hash booster terhadap manifest salinan), validasi keluaran.
// ============================================================================
export function createPythonInferenceExecutor(opts: {
  pythonPath: string;
  predictScriptPath: string;
}): PitAInferenceExecutor {
  return ({ modelDir, requests }) => {
    const manifestPath = path.join(modelDir, "model-manifest.json");
    let manifest: {
      candidate_id?: unknown;
      boosters?: { home?: { file?: unknown }; away?: { file?: unknown } };
    };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as typeof manifest;
    } catch (err) {
      throw new Error(
        `ML1-PIT-A: manifest kandidat tidak terbaca di ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const boosterFiles = [manifest.boosters?.home?.file, manifest.boosters?.away?.file].filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
    if (boosterFiles.length !== 2) {
      throw new Error("ML1-PIT-A: manifest kandidat tidak mencantumkan file booster home/away.");
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ml1-pit-a-"));
    try {
      // Salinan run: hash manifest dicatat DARI SALINAN yang dipakai runner.
      const copiedManifest = path.join(tmp, "model-manifest.json");
      fs.copyFileSync(manifestPath, copiedManifest);
      for (const f of boosterFiles) {
        fs.copyFileSync(path.join(modelDir, f), path.join(tmp, f));
      }
      const candidateManifestSha256 = sha256FilePitA(copiedManifest);

      const inPath = path.join(tmp, "in.jsonl");
      const outPath = path.join(tmp, "out.jsonl");
      fs.writeFileSync(
        inPath,
        requests
          .map((r) =>
            JSON.stringify({ match: r.match_id, champLam: r.champLam, champMu: r.champMu, champFallback: false, featB: r.featB }),
          )
          .join("\n") + "\n",
      );
      try {
        execFileSync(
          opts.pythonPath,
          [opts.predictScriptPath, `--model-dir=${tmp}`, `--input=${inPath}`, `--output=${outPath}`],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
      } catch (err) {
        throw new Error(
          `ML1-PIT-A: runner inferensi Python gagal (${opts.predictScriptPath}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const results = new Map<string, PitAInferenceResult>();
      for (const line of fs.readFileSync(outPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let row: { match?: unknown; lam?: unknown; mu?: unknown };
        try {
          row = JSON.parse(line) as typeof row;
        } catch {
          throw new Error("ML1-PIT-A: keluaran runner tidak valid (baris bukan JSON).");
        }
        const id = typeof row.match === "string" ? row.match : "";
        if (!id || results.has(id)) {
          throw new Error(`ML1-PIT-A: keluaran runner duplikat/tanpa id untuk '${id}'.`);
        }
        results.set(id, { lam: Number(row.lam), mu: Number(row.mu) });
      }
      validateInferenceResults(requests, results);
      return {
        results,
        candidateId: typeof manifest.candidate_id === "string" ? manifest.candidate_id : null,
        candidateManifestSha256,
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

/**
 * Kontrak keluaran runner (§5): tepat satu hasil per match_id masukan,
 * tanpa id asing, intensitas finite positif. Pelanggaran = gagal SEBELUM
 * write apa pun.
 */
export function validateInferenceResults(
  requests: PitAInferenceRequest[],
  results: Map<string, PitAInferenceResult>,
): void {
  const wanted = new Set(requests.map((r) => r.match_id));
  for (const id of results.keys()) {
    if (!wanted.has(id)) {
      throw new Error(`ML1-PIT-A: keluaran inferensi memuat id tak diminta '${id}'.`);
    }
  }
  for (const r of requests) {
    const got = results.get(r.match_id);
    if (!got) {
      throw new Error(`ML1-PIT-A: keluaran inferensi kehilangan hasil untuk '${r.match_id}'.`);
    }
    if (!Number.isFinite(got.lam) || !Number.isFinite(got.mu) || got.lam <= 0 || got.mu <= 0) {
      throw new Error(
        `ML1-PIT-A: intensitas inferensi tidak valid untuk '${r.match_id}' (lam=${got.lam}, mu=${got.mu}).`,
      );
    }
  }
}

// ============================================================================
// Pemuatan data fitur — query IDENTIK loadData() jalur pilot.
// ============================================================================
interface LoadedData {
  universe: EvalMatchRow[];
  compAvg: EvalMatchRow[];
  canonicalLogs: Ml1CanonicalLogRow[];
  registryStatus: Map<string, string>;
  seasonByMatchId: Map<string, string>;
}

function loadData(ds: DatabaseSync): LoadedData {
  const universe = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE competition_id LIKE 'sm:%' AND status = 'finished'
         AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const compAvg = ds
    .prepare(
      `SELECT match_id, competition_id, utc_date, home_team_id, away_team_id, home_score, away_score
       FROM matches
       WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
       ORDER BY competition_id, utc_date`,
    )
    .all() as unknown as EvalMatchRow[];
  const seasonByMatchId = new Map<string, string>();
  for (const r of ds.prepare("SELECT match_id, season FROM matches").all() as unknown as { match_id: string; season: string }[]) {
    if (r.season) seasonByMatchId.set(r.match_id, r.season);
  }
  const canonicalLogs = ds
    .prepare(
      `SELECT team_id, match_date, shots_for, shots_against, shots_on_target_for, shots_on_target_against
       FROM team_match_logs_canonical ORDER BY team_id, match_date`,
    )
    .all() as unknown as Ml1CanonicalLogRow[];
  const registryStatus = new Map<string, string>();
  for (const r of ds.prepare("SELECT league_id, status FROM league_calibration").all() as unknown as { league_id: string; status: string }[]) {
    registryStatus.set(r.league_id, r.status);
  }
  return { universe, compAvg, canonicalLogs, registryStatus, seasonByMatchId };
}

/** Resolusi kunci tim — logika IDENTIK resolveTeamKey() jalur pilot. */
function resolveTeamKey(sourceId: string, name: string): string {
  const canon = canonicalIdForTeamId(sourceId) ?? canonicalIdForTeamName(name);
  if (canon) {
    const team = loadCanonicalTeams().find((t) => t.canonical_id === canon);
    const th = team?.members.find((m) => m.system === "thestats");
    if (th) return th.team_id;
  }
  return sourceId;
}

// ============================================================================
// DB shadow PIT A
// ============================================================================
export interface PitAPredictionRow {
  eval_version: string;
  horizon_id: string;
  feature_time_status: string;
  status: string;
  fixture_uid: string;
  source_match_id: string;
  identity_method: string;
  aliases_json: string;
  competition_id: string | null;
  decision_at_utc: string;
  issued_at_utc: string;
  kickoff_utc: string;
  lead_seconds: number;
  package_id: number;
  package_computed_utc: string;
  package_payload_sha256: string;
  champion_ratings_marker: string | null;
  champion_provenance_status: string;
  candidate_id: string | null;
  candidate_manifest_sha256: string | null;
  home_team_key: string;
  away_team_key: string;
  home_name: string | null;
  away_name: string | null;
  slice: string;
  registry_status: string | null;
  champ_lam: number;
  champ_mu: number;
  champ_p_h: number;
  champ_p_d: number;
  champ_p_a: number;
  cand_lam: number;
  cand_mu: number;
  cand_p_h: number;
  cand_p_d: number;
  cand_p_a: number;
  features_json: string;
}

export function ensurePitASchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eval_version TEXT NOT NULL,
      horizon_id TEXT NOT NULL,
      feature_time_status TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PIT_A_STAGED',
      fixture_uid TEXT NOT NULL,
      source_match_id TEXT NOT NULL,
      identity_method TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      competition_id TEXT,
      decision_at_utc TEXT NOT NULL,
      issued_at_utc TEXT NOT NULL,
      kickoff_utc TEXT NOT NULL,
      lead_seconds INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      package_computed_utc TEXT NOT NULL,
      package_payload_sha256 TEXT NOT NULL,
      champion_ratings_marker TEXT,
      champion_provenance_status TEXT NOT NULL,
      candidate_id TEXT,
      candidate_manifest_sha256 TEXT,
      home_team_key TEXT NOT NULL,
      away_team_key TEXT NOT NULL,
      home_name TEXT,
      away_name TEXT,
      slice TEXT NOT NULL,
      registry_status TEXT,
      champ_lam REAL NOT NULL,
      champ_mu REAL NOT NULL,
      champ_p_h REAL NOT NULL,
      champ_p_d REAL NOT NULL,
      champ_p_a REAL NOT NULL,
      cand_lam REAL NOT NULL,
      cand_mu REAL NOT NULL,
      cand_p_h REAL NOT NULL,
      cand_p_d REAL NOT NULL,
      cand_p_a REAL NOT NULL,
      features_json TEXT NOT NULL,
      UNIQUE (eval_version, fixture_uid, horizon_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pita_uid ON predictions(fixture_uid);
  `);
}

const INSERT_PIT_A_SQL = `
  INSERT INTO predictions (
    eval_version, horizon_id, feature_time_status, status,
    fixture_uid, source_match_id, identity_method, aliases_json,
    competition_id, decision_at_utc, issued_at_utc, kickoff_utc, lead_seconds,
    package_id, package_computed_utc, package_payload_sha256,
    champion_ratings_marker, champion_provenance_status,
    candidate_id, candidate_manifest_sha256,
    home_team_key, away_team_key, home_name, away_name, slice, registry_status,
    champ_lam, champ_mu, champ_p_h, champ_p_d, champ_p_a,
    cand_lam, cand_mu, cand_p_h, cand_p_d, cand_p_a,
    features_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(eval_version, fixture_uid, horizon_id) DO NOTHING
`;

/**
 * Insert satu baris staging dengan conflict handler yang DITARGETKAN ke
 * unique key (eval_version, fixture_uid, horizon_id): konflik kunci itu =
 * baris pertama dipertahankan (return false); pelanggaran constraint lain
 * tetap melempar. Return true bila baris benar-benar tersimpan.
 */
export function insertPitARow(db: DatabaseSync, row: PitAPredictionRow): boolean {
  const res = db.prepare(INSERT_PIT_A_SQL).run(
    row.eval_version, row.horizon_id, row.feature_time_status, row.status,
    row.fixture_uid, row.source_match_id, row.identity_method, row.aliases_json,
    row.competition_id, row.decision_at_utc, row.issued_at_utc, row.kickoff_utc, row.lead_seconds,
    row.package_id, row.package_computed_utc, row.package_payload_sha256,
    row.champion_ratings_marker, row.champion_provenance_status,
    row.candidate_id, row.candidate_manifest_sha256,
    row.home_team_key, row.away_team_key, row.home_name, row.away_name, row.slice, row.registry_status,
    row.champ_lam, row.champ_mu, row.champ_p_h, row.champ_p_d, row.champ_p_a,
    row.cand_lam, row.cand_mu, row.cand_p_h, row.cand_p_d, row.cand_p_a,
    row.features_json,
  );
  return Number(res.changes) > 0;
}

// ============================================================================
// Inti run PIT A
// ============================================================================
export interface PitADeps {
  /** Handle read-only thestats_dataset.db (pemanggil yang membuka/menutup). */
  dataset: DatabaseSync;
  /** Handle read-only upcoming_fixtures.db. */
  upcoming: DatabaseSync;
  /** Handle read-only analysis_snapshots.db. */
  snapshots: DatabaseSync;
  /** Path DB shadow keluaran (dbPath("ml1_prospective_pit_a.db")). */
  outputDbPath: string;
  /** Direktori data statis untuk fixture-links.json (dataDir()). */
  dataDirPath: string;
  /** Direktori artefak kandidat (tasks/ml1/model). */
  modelDir: string;
  clock: PitAClock;
  executor: PitAInferenceExecutor;
  /** Batas jumlah FIXTURE FISIK per run (0 = tanpa batas). */
  limit?: number;
}

export interface PitARunSummary {
  tool: string;
  status: string;
  data_status: string;
  eval_version: string;
  horizon_id: string;
  decision_at_utc: string;
  issued_at_utc: string | null;
  candidates_by_source: Record<string, number>;
  unique_fixtures: number;
  attempted: number;
  predicted_new: number;
  skipped: Record<string, number>;
}

interface RawPkgRow {
  id: number;
  match_id: string;
  competition_canonical_id: string | null;
  computed_utc: string;
  kickoff_utc: string | null;
  lambda: number | null;
  mu: number | null;
  ratings_marker: string | null;
  payload_json: string;
}

/** Edisi terpilih per alias SESUDAH seleksi as-of, SEBELUM validasi isi. */
interface ParsedEdition {
  raw: RawPkgRow;
  computedMs: number | null;
  kickoffMs: number | null;
}

/** Edisi PEMENANG grup yang lolos validasi kickoff + payload. */
interface ValidEdition {
  raw: RawPkgRow;
  computedMs: number;
  kickoffMs: number;
  champP: [number, number, number];
  homeName: string | null;
  awayName: string | null;
}

const PKG_COLS = "id, match_id, competition_canonical_id, computed_utc, kickoff_utc, lambda, mu, ratings_marker, payload_json";

/**
 * Format seragam jalur cepat: ISO 8601 UTC, dengan atau tanpa milidetik,
 * diakhiri `Z`. Varian di luar pola ini (offset numerik, tanpa zona, dst.)
 * memicu seleksi ulang per instant untuk match yang bersangkutan.
 */
const UNIFORM_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Parser berzona eksplisit: hanya menerima ISO 8601 dengan penanda zona
 * yang jelas — `Z` (UTC, ± milidetik) atau offset numerik valid
 * (`+hh:mm`/`-hh:mm`, jam ≤ 14, menit ≤ 59). String tanpa zona DITOLAK
 * (instant-nya ambigu), begitu pula nilai di luar rentang kalender.
 */
const ZONED_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = ZONED_ISO_RE.exec(v.trim());
  if (!m) return null;
  const yN = Number(m[1]), moN = Number(m[2]), dN = Number(m[3]);
  const hN = Number(m[4]), miN = Number(m[5]), sN = Number(m[6]);
  const fracMs = m[7] ? Math.round(Number(`0${m[7]}`) * 1000) : 0;
  const zone = m[8];
  if (moN < 1 || moN > 12 || dN < 1 || dN > 31 || hN > 23 || miN > 59 || sN > 59) return null;
  let offsetMs = 0;
  if (zone !== "Z") {
    const oh = Number(zone.slice(1, 3));
    const om = Number(zone.slice(4, 6));
    if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return null;
    offsetMs = (oh * 60 + om) * 60_000 * (zone.startsWith("-") ? -1 : 1);
  }
  const ms = Date.UTC(yN, moN - 1, dN, hN, miN, sN, fracMs) - offsetMs;
  // Verifikasi round-trip: komponen lokal (pada offset-nya) harus sama
  // persis — menolak tanggal mustahil seperti 31 Februari yang akan
  // digeser diam-diam oleh aritmetika kalender.
  const back = new Date(ms + offsetMs);
  if (
    back.getUTCFullYear() !== yN || back.getUTCMonth() !== moN - 1 || back.getUTCDate() !== dN ||
    back.getUTCHours() !== hN || back.getUTCMinutes() !== miN || back.getUTCSeconds() !== sN
  ) {
    return null;
  }
  return ms;
}

/** Kickoff wajib berpresisi jam (punya komponen 'T'); tanggal-saja = invalid. */
function parseKickoff(v: string | null | undefined): number | null {
  if (typeof v !== "string" || !v.includes("T")) return null;
  return parseInstant(v);
}

export function runMl1PitA(deps: PitADeps): PitARunSummary {
  const { dataset, upcoming, snapshots } = deps;
  const limit = deps.limit ?? 0;
  const skipped: Record<string, number> = {};
  const skip = (cat: string, n = 1) => {
    skipped[cat] = (skipped[cat] ?? 0) + n;
  };

  // ---------------------------------------------------------- §3 SNAPSHOT --
  // Snapshot baca paket dalam SATU transaksi read-only singkat: pembacaan
  // pertama men-pin snapshot, BARU sesudah itu decision_at_utc diambil dari
  // clock dan dipakai untuk seluruh batch.
  let decisionMs = Number.NaN;
  let decision_at_utc = "";
  const selectedRaw = new Map<string, RawPkgRow>();
  const unparseableComputed = new Set<string>();
  snapshots.exec("BEGIN");
  try {
    snapshots.prepare("SELECT COUNT(*) AS n FROM packages").get();
    const decisionDate = deps.clock();
    decisionMs = decisionDate.getTime();
    if (!Number.isFinite(decisionMs)) {
      throw new Error("ML1-PIT-A: clock menghasilkan waktu tidak valid untuk decision_at_utc.");
    }
    decision_at_utc = decisionDate.toISOString();

    // Selector latest as-of: predikat computed_utc <= decision DI DALAM
    // subquery (pola brief §3), tie-break computed_utc DESC, id DESC.
    // Tanpa predikat kickoff luar — kickoff edisi terpilih dicek di kode
    // (perbandingan instant), dan lookup grup perlu melihat edisi yang
    // memajukan kickoff melewati cutoff.
    const primary = snapshots
      .prepare(
        `SELECT ${PKG_COLS} FROM packages p
         WHERE p.trigger = 'slate'
           AND p.id = (
             SELECT p2.id FROM packages p2
             WHERE p2.match_id = p.match_id AND p2.trigger = 'slate'
               AND p2.computed_utc <= ?
             ORDER BY p2.computed_utc DESC, p2.id DESC
             LIMIT 1
           )`,
      )
      .all(decision_at_utc) as unknown as RawPkgRow[];
    for (const r of primary) selectedRaw.set(r.match_id, r);

    // Konsistensi instant (§3.3): varian UTC valid yang urutan leksikalnya
    // berbeda dari urutan instant ditangani per-match dengan pemindaian
    // instant penuh atas edisi match itu saja (terbatas, jarang terjadi).
    const refetchByInstant = (matchId: string): RawPkgRow | null => {
      const rows = snapshots
        .prepare(`SELECT ${PKG_COLS} FROM packages WHERE match_id = ? AND trigger = 'slate'`)
        .all(matchId) as unknown as RawPkgRow[];
      let best: RawPkgRow | null = null;
      let bestMs = Number.NEGATIVE_INFINITY;
      let sawUnparseable = false;
      for (const r of rows) {
        const ms = parseInstant(r.computed_utc);
        if (ms === null) {
          sawUnparseable = true;
          continue;
        }
        if (ms > decisionMs) continue;
        if (ms > bestMs || (ms === bestMs && best !== null && r.id > best.id)) {
          best = r;
          bestMs = ms;
        }
      }
      if (best === null && sawUnparseable) unparseableComputed.add(matchId);
      return best;
    };
    for (const [matchId, r] of [...selectedRaw.entries()]) {
      const ms = parseInstant(r.computed_utc);
      // Deteksi varian format pada SEMUA edisi calon match ini (query
      // terindeks per match_id — volume yang terbaca hanya histori match
      // kandidat, bukan seluruh tabel): satu saja edisi non-seragam
      // membuat urutan leksikal tidak bisa dipercaya untuk match ini,
      // jadi seleksinya dihitung ulang per instant.
      let hasVariant = !UNIFORM_UTC_RE.test(r.computed_utc);
      if (!hasVariant) {
        const allComputed = snapshots
          .prepare("SELECT computed_utc FROM packages WHERE match_id = ? AND trigger = 'slate'")
          .all(matchId) as unknown as { computed_utc: string }[];
        hasVariant = allComputed.some((c) => !UNIFORM_UTC_RE.test(c.computed_utc));
      }
      if (hasVariant || ms === null || ms > decisionMs) {
        const fixed = refetchByInstant(matchId);
        if (fixed) selectedRaw.set(matchId, fixed);
        // fixed === null: baris primer dipertahankan; fase validasi yang
        // menghitungnya sebagai invalid_time (atau memang belum ada edisi).
        if (fixed === null && ms !== null && ms > decisionMs) selectedRaw.delete(matchId);
      }
    }
    const allIds = snapshots
      .prepare("SELECT DISTINCT match_id FROM packages WHERE trigger = 'slate'")
      .all() as unknown as { match_id: string }[];
    for (const { match_id } of allIds) {
      if (selectedRaw.has(match_id)) continue;
      const fixed = refetchByInstant(match_id);
      if (fixed) selectedRaw.set(match_id, fixed);
    }
  } finally {
    try {
      snapshots.exec("COMMIT");
    } catch {
      // Transaksi baca sudah lepas — tidak ada yang perlu dipulihkan.
    }
  }

  // ------------------------------------------- §3 PARSE (tanpa validasi isi)
  // PEMENANG DULU, VALIDASI KEMUDIAN: di titik ini edisi terpilih per alias
  // hanya di-parse waktunya. Payload TIDAK divalidasi per edisi — validasi
  // isi hanya berlaku untuk pemenang grup (§4), sehingga edisi alias yang
  // rusak tidak bisa "menyelamatkan" fixture lewat edisi yang lebih lama.
  const parsed = new Map<string, ParsedEdition>();
  for (const [matchId, raw] of selectedRaw) {
    parsed.set(matchId, {
      raw,
      computedMs: parseInstant(raw.computed_utc),
      kickoffMs: parseKickoff(raw.kickoff_utc),
    });
  }
  for (const matchId of unparseableComputed) {
    if (!parsed.has(matchId)) skip("invalid_time");
  }

  const candidatesBySource: Record<string, number> = {};
  for (const matchId of parsed.keys()) {
    const src = sourceOfMatchId(matchId);
    candidatesBySource[src] = (candidatesBySource[src] ?? 0) + 1;
  }

  // ------------------------------------------------------- §4 IDENTITAS --
  const linkGroups: FixtureLinkGroup[] = loadFixtureLinkGroups(deps.dataDirPath);
  const identityReady = identityTablesExist(dataset);
  const aliasCache = new Map<string, string[]>();
  const uidCache = new Map<string, string | null>();

  const uidOf = (matchId: string): string | null => {
    if (!identityReady) return null;
    const hit = uidCache.get(matchId);
    if (hit !== undefined) return hit;
    const uid = getUidForMatchId(dataset, matchId);
    uidCache.set(matchId, uid);
    return uid;
  };

  const bridgeIds = (matchId: string): string[] => {
    const out: string[] = [];
    try {
      const fwd = upcoming
        .prepare("SELECT sm_fixture_id FROM sm_id_map WHERE match_id = ?")
        .get(matchId) as { sm_fixture_id: number } | undefined;
      if (fwd) out.push(`sm_${fwd.sm_fixture_id}`);
      const m = /^sm_(\d+)$/.exec(matchId);
      if (m) {
        const rev = upcoming
          .prepare("SELECT match_id FROM sm_id_map WHERE sm_fixture_id = ?")
          .all(Number(m[1])) as unknown as { match_id: string }[];
        for (const r of rev) out.push(r.match_id);
      }
    } catch {
      // sm_id_map boleh tidak ada di store lama — jembatan dilewati.
    }
    return out;
  };

  /** Set alias satu id: store identitas + grup tautan + bridge sm_id_map. */
  const aliasSetOf = (matchId: string): string[] => {
    const hit = aliasCache.get(matchId);
    if (hit) return hit;
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (id: string | null | undefined) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    };
    push(matchId);
    if (identityReady) for (const id of getSiblingIds(dataset, matchId)) push(id);
    for (const id of linkSiblingsOf(linkGroups, matchId)) push(id);
    for (const id of bridgeIds(matchId)) push(id);
    aliasCache.set(matchId, ordered);
    return ordered;
  };

  interface Group {
    uid: string;
    /** Id sumber yang punya edisi terpilih di komponen ini. */
    editionIds: string[];
    aliasSet: Set<string>;
  }
  // Komponen alias TRANSITIF: BFS atas graf aliasSetOf — A–B lewat file
  // tautan dan B–C lewat bridge tetap satu komponen, jadi dua UID berbeda
  // di ujung mana pun berarti konflik untuk SELURUH komponen.
  const components: Set<string>[] = [];
  {
    const assigned = new Set<string>();
    for (const startId of parsed.keys()) {
      if (assigned.has(startId)) continue;
      const comp = new Set<string>();
      const queue = [startId];
      while (queue.length > 0) {
        const cur = queue.pop() as string;
        if (comp.has(cur)) continue;
        comp.add(cur);
        assigned.add(cur);
        for (const a of aliasSetOf(cur)) if (!comp.has(a)) queue.push(a);
      }
      components.push(comp);
    }
  }
  const groups = new Map<string, Group>();
  const normName = (s: string | null): string => (s ?? "").trim().toLowerCase();
  /** Nama laga dari payload — parse lunak khusus cek orientasi (bukan validasi isi). */
  const payloadNames = (raw: RawPkgRow): { home: string | null; away: string | null } => {
    try {
      const p = JSON.parse(raw.payload_json) as { fixture?: { home?: unknown; away?: unknown } } | null;
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        return {
          home: typeof p.fixture?.home === "string" ? p.fixture.home : null,
          away: typeof p.fixture?.away === "string" ? p.fixture.away : null,
        };
      }
    } catch {
      // Payload rusak tidak menyumbang bukti orientasi; pemenang divalidasi ketat nanti.
    }
    return { home: null, away: null };
  };
  for (const comp of components) {
    const editionIds = [...comp].filter((id) => parsed.has(id));
    if (editionIds.length === 0) continue;
    const uidSet = new Set<string>();
    for (const id of comp) {
      const uid = uidOf(id);
      if (uid) uidSet.add(uid);
    }
    if (uidSet.size === 0) {
      skip("identity_unresolved");
      continue;
    }
    if (uidSet.size > 1) {
      skip("identity_conflict");
      continue;
    }
    const uid = [...uidSet][0];
    const aliasSet = new Set<string>(comp);
    // Alias terdaftar untuk UID ikut set grup (dasar deteksi drift rerun).
    if (identityReady) {
      for (const a of getAliasesForUid(dataset, uid)) aliasSet.add(a.source_match_id);
    }
    groups.set(uid, { uid, editionIds, aliasSet });
  }
  // Konflik orientasi: nama kandang/tandang antar-edisi grup tertukar, atau
  // tertukar terhadap fixture kanonik UID → bukti identitas bertentangan.
  for (const g of [...groups.values()]) {
    const pairs = g.editionIds
      .map((id) => payloadNames((parsed.get(id) as ParsedEdition).raw))
      .filter((n) => n.home && n.away)
      .map((n) => `${normName(n.home)}|${normName(n.away)}`);
    let conflict = false;
    for (let i = 0; i < pairs.length && !conflict; i++) {
      const [h, a] = pairs[i].split("|");
      for (let j = i + 1; j < pairs.length; j++) {
        const [h2, a2] = pairs[j].split("|");
        if (h === a2 && a === h2 && h !== a) conflict = true;
      }
    }
    if (!conflict && identityReady) {
      const cf = getFixtureByUid(dataset, g.uid);
      if (cf?.home_name && cf?.away_name) {
        const ch = normName(cf.home_name);
        const ca = normName(cf.away_name);
        for (const id of g.editionIds) {
          const n = payloadNames((parsed.get(id) as ParsedEdition).raw);
          if (n.home && n.away && normName(n.home) === ca && normName(n.away) === ch && ch !== ca) {
            conflict = true;
          }
        }
      }
    }
    if (conflict) {
      groups.delete(g.uid);
      skip("identity_conflict");
    }
  }
  const uniqueFixtures = groups.size;

  // Pemenang grup: instant komputasi DESC, id paket DESC, match_id ASC
  // (urutan brief §4.3). HANYA pemenang yang divalidasi isinya: pemenang
  // rusak/waktunya invalid/kickoff-nya lewat mengeluarkan SELURUH fixture.
  interface Prepared {
    uid: string;
    aliasSet: Set<string>;
    winner: ValidEdition;
    winnerId: string;
    method: string;
  }
  const prepared: Prepared[] = [];
  for (const g of groups.values()) {
    const ranked = g.editionIds
      .map((id) => ({ id, ed: parsed.get(id) as ParsedEdition }))
      .sort((x, y) => {
        const cx = x.ed.computedMs ?? Number.NEGATIVE_INFINITY;
        const cy = y.ed.computedMs ?? Number.NEGATIVE_INFINITY;
        if (cy !== cx) return cy - cx;
        if (y.ed.raw.id !== x.ed.raw.id) return y.ed.raw.id - x.ed.raw.id;
        return x.id.localeCompare(y.id);
      });
    const { id: winnerId, ed: winParsed } = ranked[0];
    if (winParsed.computedMs === null || winParsed.kickoffMs === null) {
      skip("invalid_time");
      continue;
    }
    // Cek kickoff edisi PEMENANG sebelum limit: jadwal lama yang masih
    // future tidak menghidupkan fixture yang edisi terbarunya sudah lewat.
    if (winParsed.kickoffMs <= decisionMs) {
      skip("kickoff_not_future");
      continue;
    }
    // Validasi payload pemenang. Bedakan dua kegagalan: store tidak bisa
    // dibuka (error infrastruktur — dilempar pemanggil di fase snapshot)
    // vs ISI payload rusak (di sini): JSON tidak parseable, atau parseable
    // tetapi bukan objek (null/array/primitive), atau field wajib tidak
    // valid → invalid_package.
    let payload: { fixture?: { home?: unknown; away?: unknown }; probabilities?: Record<string, unknown> } | null =
      null;
    let payloadOk = true;
    try {
      const p = JSON.parse(winParsed.raw.payload_json) as unknown;
      if (p !== null && typeof p === "object" && !Array.isArray(p)) {
        payload = p as { fixture?: { home?: unknown; away?: unknown }; probabilities?: Record<string, unknown> };
      } else {
        payloadOk = false;
      }
    } catch {
      payloadOk = false;
    }
    if (payloadOk && payload !== null) {
      const probs = payload.probabilities ?? {};
      const champP = [probs["1x2:1"], probs["1x2:x"], probs["1x2:2"]] as unknown[];
      const probsOk = champP.every(
        (v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1,
      );
      const lamOk = typeof winParsed.raw.lambda === "number" && Number.isFinite(winParsed.raw.lambda) && winParsed.raw.lambda > 0;
      const muOk = typeof winParsed.raw.mu === "number" && Number.isFinite(winParsed.raw.mu) && winParsed.raw.mu > 0;
      if (!probsOk || !lamOk || !muOk) payloadOk = false;
    }
    if (!payloadOk || payload === null) {
      skip("invalid_package");
      continue;
    }
    const winner: ValidEdition = {
      raw: winParsed.raw,
      computedMs: winParsed.computedMs,
      kickoffMs: winParsed.kickoffMs,
      champP: [
        (payload.probabilities as Record<string, number>)["1x2:1"],
        (payload.probabilities as Record<string, number>)["1x2:x"],
        (payload.probabilities as Record<string, number>)["1x2:2"],
      ],
      homeName: typeof payload.fixture?.home === "string" ? payload.fixture.home : null,
      awayName: typeof payload.fixture?.away === "string" ? payload.fixture.away : null,
    };
    // Metode identitas untuk id sumber pemenang.
    let method = "identity_sibling";
    if (uidOf(winnerId) === g.uid) method = "fixture_aliases";
    else if (linkSiblingsOf(linkGroups, winnerId).some((id) => id !== winnerId && uidOf(id) === g.uid)) method = "fixture_links";
    else if (bridgeIds(winnerId).some((id) => uidOf(id) === g.uid)) method = "sm_id_map";
    prepared.push({ uid: g.uid, aliasSet: g.aliasSet, winner, winnerId, method });
  }

  // ------------------------------------------- ELIGIBILITY (satu fungsi) --
  // Dipakai di DUA titik dengan lookup yang sesuai fasenya:
  //  (1) sebelum limit — cache fase awal, tanpa pembacaan identitas segar;
  //  (2) sesudah inferensi — semua lookup BARU (tautan/bridge dibaca ulang,
  //      UID tanpa cache, ID tim dibekukan dari yang dipakai inferensi).
  // Mengembalikan kategori skip, atau null bila fixture layak.
  const uidOfFresh = (matchId: string): string | null => {
    if (!identityTablesExist(dataset)) return null;
    return getUidForMatchId(dataset, matchId);
  };
  const aliasSetFresh = (matchId: string, groupsNow: FixtureLinkGroup[]): string[] => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (id: string | null | undefined) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    };
    push(matchId);
    if (identityReady) for (const id of getSiblingIds(dataset, matchId)) push(id);
    for (const id of linkSiblingsOf(groupsNow, matchId)) push(id);
    for (const id of bridgeIds(matchId)) push(id);
    return ordered;
  };
  const checkEligibility = (args: {
    winnerId: string;
    uid: string;
    kickoffMs: number;
    aliasSet: Set<string>;
    frozenTeam: { homeId: string; awayId: string } | null;
    freshIdentity: boolean;
  }): string | null => {
    // Upcoming pemenang: hilang / di luar scheduled → tidak layak.
    const up = upcoming
      .prepare("SELECT utc_date, status, home_team_id, away_team_id FROM upcoming_fixtures WHERE match_id = ?")
      .get(args.winnerId) as
      | { utc_date: string | null; status: string | null; home_team_id: unknown; away_team_id: unknown }
      | undefined;
    if (!up) return "fixture_state_ineligible";
    const statusRaw = typeof up.status === "string" ? up.status.trim() : "";
    if (statusRaw !== "scheduled") return "fixture_state_ineligible";
    const upKickoffMs = parseKickoff(up.utc_date);
    if (upKickoffMs === null || upKickoffMs !== args.kickoffMs) return "schedule_conflict";
    // ID tim yang dibekukan untuk inferensi tidak boleh berubah.
    if (args.frozenTeam) {
      if (String(up.home_team_id) !== args.frozenTeam.homeId || String(up.away_team_id) !== args.frozenTeam.awayId) {
        return "identity_changed";
      }
    }
    // Bukti kanonik: fixture hilang / state bukan scheduled → tidak layak
    // WALAU upcoming sumber masih terjadwal. Kickoff kanonik presisi
    // `exact` wajib sama instant-nya dengan paket; jalur `date_only`
    // bergantung pada upcoming berwaktu tepat (sudah dicek di atas) selama
    // tanggalnya tidak berkonflik.
    if (identityReady) {
      const cf = getFixtureByUid(dataset, args.uid);
      if (!cf) return "fixture_state_ineligible";
      if (cf.state !== "scheduled") return "fixture_state_ineligible";
      if (cf.kickoff_precision === "date_only") {
        const cfDate = typeof cf.kickoff_utc === "string" ? cf.kickoff_utc.slice(0, 10) : "";
        if (cfDate === "" || cfDate !== new Date(args.kickoffMs).toISOString().slice(0, 10)) {
          return "schedule_conflict";
        }
      } else {
        const cfMs = parseInstant(cf.kickoff_utc);
        if (cfMs === null || cfMs !== args.kickoffMs) return "schedule_conflict";
      }
    }
    // Identitas segar (hanya titik pasca-inferensi): komponen alias dari
    // data link/bridge/K1 terbaru ∪ set alias grup awal harus tetap
    // menunjuk tepat UID yang sama.
    if (args.freshIdentity) {
      const groupsNow = loadFixtureLinkGroups(deps.dataDirPath);
      const ids = new Set<string>(args.aliasSet);
      for (const id of aliasSetFresh(args.winnerId, groupsNow)) ids.add(id);
      const uids = new Set<string>();
      for (const id of ids) {
        const u = uidOfFresh(id);
        if (u) uids.add(u);
      }
      if (uids.size !== 1 || !uids.has(args.uid)) return "identity_changed";
    }
    return null;
  };

  // Eligibility SEBELUM limit: laga yang sudah batal (upcoming/kanonik)
  // atau jadwalnya berkonflik tidak memakan jatah inferensi.
  const eligible: Prepared[] = [];
  for (const p of prepared) {
    const reason = checkEligibility({
      winnerId: p.winnerId,
      uid: p.uid,
      kickoffMs: p.winner.kickoffMs,
      aliasSet: p.aliasSet,
      frozenTeam: null,
      freshIdentity: false,
    });
    if (reason) {
      skip(reason);
      continue;
    }
    eligible.push(p);
  }

  // ------------------------------------------- §4.4 ROW TERSIMPAN + DRIFT --
  const out = new DatabaseSync(deps.outputDbPath);
  try {
    ensurePitASchema(out);
    const storedRows = out
      .prepare(
        "SELECT fixture_uid, aliases_json FROM predictions WHERE eval_version = ? AND horizon_id = ?",
      )
      .all(PIT_A_EVAL_VERSION, PIT_A_HORIZON_ID) as unknown as { fixture_uid: string; aliases_json: string }[];
    const storedByUid = new Map<string, Set<string>>();
    const aliasOwner = new Map<string, string>();
    for (const r of storedRows) {
      let aliases: string[] = [];
      try {
        aliases = JSON.parse(r.aliases_json) as string[];
      } catch {
        aliases = [];
      }
      storedByUid.set(r.fixture_uid, new Set(aliases));
      for (const a of aliases) aliasOwner.set(a, r.fixture_uid);
    }
    const processable: Prepared[] = [];
    for (const p of eligible) {
      if (storedByUid.has(p.uid)) {
        skip("already_stored");
        continue;
      }
      let drift = false;
      for (const a of p.aliasSet) {
        const owner = aliasOwner.get(a);
        if (owner && owner !== p.uid) drift = true;
      }
      if (drift) {
        skip("identity_changed_since_issue");
        continue;
      }
      processable.push(p);
    }
    // Urutan proses stabil: kickoff, lalu UID. Limit = fixture fisik.
    processable.sort((x, y) => {
      if (x.winner.kickoffMs !== y.winner.kickoffMs) return x.winner.kickoffMs - y.winner.kickoffMs;
      return x.uid.localeCompare(y.uid);
    });
    const limited = limit > 0 ? processable.slice(0, limit) : processable;

    // ------------------------------------------------------ §5 FITUR ------
    const data = loadData(dataset);
    const extractor = new Ml1FeatureExtractor(data.universe, data.compAvg, data.seasonByMatchId, data.canonicalLogs);
    interface Attempt extends Prepared {
      featB: number[];
      homeKey: string;
      awayKey: string;
      homeName: string;
      awayName: string;
      /** ID tim sumber persis seperti yang dipakai inferensi (dibekukan). */
      frozenHomeTeamId: string;
      frozenAwayTeamId: string;
      slice: string;
      registryStatus: string | null;
    }
    const attempts: Attempt[] = [];
    for (const p of limited) {
      const up = upcoming
        .prepare(
          "SELECT match_id, home_team_id, away_team_id, home_team_name, away_team_name FROM upcoming_fixtures WHERE match_id = ?",
        )
        .get(p.winnerId) as
        | { match_id: string; home_team_id: string; away_team_id: string; home_team_name: string; away_team_name: string }
        | undefined;
      if (!up) {
        // Eligibility baru saja membuktikan baris ini ada — hilang di
        // antaranya berarti state berubah; kategori yang sama dipakai.
        skip("fixture_state_ineligible");
        continue;
      }
      const homeKey = resolveTeamKey(String(up.home_team_id), up.home_team_name);
      const awayKey = resolveTeamKey(String(up.away_team_id), up.away_team_name);
      const row: EvalMatchRow = {
        match_id: p.winnerId,
        competition_id: p.winner.raw.competition_canonical_id ?? "",
        utc_date: new Date(p.winner.kickoffMs).toISOString(),
        home_team_id: homeKey,
        away_team_id: awayKey,
        home_score: 0,
        away_score: 0,
      };
      const registryStatus = data.registryStatus.get(p.winner.raw.competition_canonical_id ?? "") ?? null;
      attempts.push({
        ...p,
        featB: extractor.prospectiveFeaturesB(row),
        homeKey,
        awayKey,
        homeName: up.home_team_name,
        awayName: up.away_team_name,
        frozenHomeTeamId: String(up.home_team_id),
        frozenAwayTeamId: String(up.away_team_id),
        slice: registryStatus === "calibrated" || registryStatus === "partial" ? "kompetitif" : "friendlies",
        registryStatus,
      });
    }

    // --------------------------------------------------- §5 INFERENSI -----
    let execResult: PitAExecutorResult | null = null;
    if (attempts.length > 0) {
      execResult = deps.executor({
        modelDir: deps.modelDir,
        requests: attempts.map((a) => ({
          match_id: a.winnerId,
          champLam: a.winner.raw.lambda as number,
          champMu: a.winner.raw.mu as number,
          featB: a.featB,
        })),
      });
      validateInferenceResults(
        attempts.map((a) => ({ match_id: a.winnerId, champLam: a.winner.raw.lambda as number, champMu: a.winner.raw.mu as number, featB: a.featB })),
        execResult.results,
      );
    }

    // ------------------------------------------- §5 REVALIDASI + TULIS ----
    // Jam aktual pada tahap penerbitan:
    //  - SESUDAH lock tulis diperoleh, clock dibaca PER BARIS tepat saat
    //    baris itu akan dicatat (issued_at_utc baris tersebut). Jam yang
    //    tidak finite atau mundur melewati decision → rollback batch.
    //  - SESUDAH semua staging insert dan SEBELUM commit, clock dibaca
    //    LAGI; baris staging yang kickoff-nya sudah lewat/sama dengan
    //    waktu cek akhir dibuang dari transaksi yang sama
    //    (`kickoff_passed`), baris lain tetap commit. Jam akhir invalid
    //    atau mundur dari issuance mana pun → rollback batch.
    //  `predicted_new` menghitung baris yang benar-benar commit.
    let issued_at_utc: string | null = null;
    let predictedNew = 0;
    if (execResult !== null && attempts.length > 0) {
      out.exec("BEGIN IMMEDIATE");
      try {
        // Keadaan tersimpan dibaca ulang DI BAWAH lock tulis (drift race).
        const freshStored = out
          .prepare(
            "SELECT fixture_uid, aliases_json FROM predictions WHERE eval_version = ? AND horizon_id = ?",
          )
          .all(PIT_A_EVAL_VERSION, PIT_A_HORIZON_ID) as unknown as { fixture_uid: string; aliases_json: string }[];
        const freshByUid = new Map<string, Set<string>>();
        const freshOwner = new Map<string, string>();
        for (const r of freshStored) {
          let aliases: string[] = [];
          try {
            aliases = JSON.parse(r.aliases_json) as string[];
          } catch {
            aliases = [];
          }
          freshByUid.set(r.fixture_uid, new Set(aliases));
          for (const a of aliases) freshOwner.set(a, r.fixture_uid);
        }

        const staged: { uid: string; kickoffMs: number }[] = [];
        let maxIssuedMs = Number.NEGATIVE_INFINITY;
        let batchRolledBack = false;

        for (const a of attempts) {
          const res = execResult.results.get(a.winnerId);
          if (!res) continue; // sudah divalidasi ada — pertahanan terakhir.
          if (a.winner.computedMs > decisionMs) {
            skip("clock_invalid");
            continue;
          }
          if (freshByUid.has(a.uid)) {
            skip("already_stored");
            continue;
          }
          let drift = false;
          for (const al of a.aliasSet) {
            const owner = freshOwner.get(al);
            if (owner && owner !== a.uid) drift = true;
          }
          if (drift) {
            skip("identity_changed_since_issue");
            continue;
          }
          // Eligibility titik kedua — semua lookup BARU: upcoming, state
          // dan jadwal kanonik, komponen alias segar, ID tim beku.
          const reason = checkEligibility({
            winnerId: a.winnerId,
            uid: a.uid,
            kickoffMs: a.winner.kickoffMs,
            aliasSet: a.aliasSet,
            frozenTeam: { homeId: a.frozenHomeTeamId, awayId: a.frozenAwayTeamId },
            freshIdentity: true,
          });
          if (reason) {
            skip(reason);
            continue;
          }
          // Jam penerbitan baris ini, dibaca sekarang (sesudah lock).
          const issuedDate = deps.clock();
          const issuedMs = issuedDate.getTime();
          if (!Number.isFinite(issuedMs) || issuedMs < decisionMs) {
            out.exec("ROLLBACK");
            skip("clock_invalid", attempts.length);
            predictedNew = 0;
            batchRolledBack = true;
            break;
          }
          // Syarat pre-match per baris: decision <= issued < kickoff.
          if (issuedMs >= a.winner.kickoffMs) {
            skip("kickoff_passed");
            continue;
          }
          issued_at_utc = issuedDate.toISOString();
          if (issuedMs > maxIssuedMs) maxIssuedMs = issuedMs;
          const mp = matrixProbs(res.lam, res.mu, 0);
          const marker = a.winner.raw.ratings_marker;
          const inserted = insertPitARow(out, {
            eval_version: PIT_A_EVAL_VERSION,
            horizon_id: PIT_A_HORIZON_ID,
            feature_time_status: PIT_A_FEATURE_TIME_STATUS,
            status: PIT_A_DATA_STATUS,
            fixture_uid: a.uid,
            source_match_id: a.winnerId,
            identity_method: a.method,
            aliases_json: JSON.stringify([...a.aliasSet].sort()),
            competition_id: a.winner.raw.competition_canonical_id,
            decision_at_utc,
            issued_at_utc,
            // Field waktu bukti dinormalisasi ke UTC ISO milidetik.
            kickoff_utc: new Date(a.winner.kickoffMs).toISOString(),
            lead_seconds: Math.round((a.winner.kickoffMs - decisionMs) / 1000),
            package_id: a.winner.raw.id,
            package_computed_utc: new Date(a.winner.computedMs).toISOString(),
            package_payload_sha256: sha256Utf8(a.winner.raw.payload_json),
            champion_ratings_marker: marker,
            champion_provenance_status: marker !== null && marker !== "" ? "package_marker" : "unknown",
            candidate_id: execResult.candidateId,
            candidate_manifest_sha256: execResult.candidateManifestSha256,
            home_team_key: a.homeKey,
            away_team_key: a.awayKey,
            home_name: a.homeName,
            away_name: a.awayName,
            slice: a.slice,
            registry_status: a.registryStatus,
            champ_lam: a.winner.raw.lambda as number,
            champ_mu: a.winner.raw.mu as number,
            champ_p_h: a.winner.champP[0],
            champ_p_d: a.winner.champP[1],
            champ_p_a: a.winner.champP[2],
            cand_lam: res.lam,
            cand_mu: res.mu,
            cand_p_h: mp.p[0],
            cand_p_d: mp.p[1],
            cand_p_a: mp.p[2],
            features_json: JSON.stringify(a.featB),
          });
          if (inserted) {
            predictedNew++;
            staged.push({ uid: a.uid, kickoffMs: a.winner.kickoffMs });
            freshByUid.set(a.uid, new Set(a.aliasSet));
            for (const al of a.aliasSet) freshOwner.set(al, a.uid);
          } else {
            skip("already_stored");
          }
        }

        if (!batchRolledBack) {
          // CEK CLOCK AKHIR: baca clock sekali lagi sebelum commit.
          const finalDate = deps.clock();
          const finalMs = finalDate.getTime();
          if (
            !Number.isFinite(finalMs) ||
            finalMs < decisionMs ||
            (staged.length > 0 && finalMs < maxIssuedMs)
          ) {
            out.exec("ROLLBACK");
            skip("clock_invalid", attempts.length);
            predictedNew = 0;
            batchRolledBack = true;
          } else {
            // Buang baris staging yang kickoff-nya sudah lewat/sama pada
            // waktu cek akhir; baris lain tetap commit dalam transaksi ini.
            for (const st of staged) {
              if (st.kickoffMs <= finalMs) {
                out
                  .prepare(
                    "DELETE FROM predictions WHERE eval_version = ? AND fixture_uid = ? AND horizon_id = ?",
                  )
                  .run(PIT_A_EVAL_VERSION, st.uid, PIT_A_HORIZON_ID);
                predictedNew--;
                skip("kickoff_passed");
              }
            }
            out.exec("COMMIT");
          }
        }
      } catch (err) {
        try {
          out.exec("ROLLBACK");
        } catch {
          // Transaksi sudah berakhir.
        }
        throw err;
      }
    }

    return finishSummary();

    function finishSummary(): PitARunSummary {
      return {
        tool: "ml1-prospective-pit-a",
        status: "ok",
        data_status: PIT_A_DATA_STATUS,
        eval_version: PIT_A_EVAL_VERSION,
        horizon_id: PIT_A_HORIZON_ID,
        decision_at_utc,
        issued_at_utc,
        candidates_by_source: candidatesBySource,
        unique_fixtures: uniqueFixtures,
        attempted: attempts.length,
        predicted_new: predictedNew,
        skipped,
      };
    }

  } finally {
    out.close();
  }
}
