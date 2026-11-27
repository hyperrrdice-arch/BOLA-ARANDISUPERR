/**
 * ML1 KOHOR PROSPEKTIF — protokol beku, grader shadow berbasis UID, dan
 * evaluasi berpasangan (Brief ML1 Kohor Prospektif §3–§5).
 *
 * Tahap ini TIDAK mengumpulkan apa pun dan TIDAK menjadwalkan apa pun:
 * ia menyiapkan (1) manifest protokol berversi + hash + cohort_id yang
 * mengacu persis ke manifest, (2) grader append-only di DB shadow yang
 * menilai prediksi PIT B bukti v2 dari revisi hasil otoritatif terbaru
 * yang terlihat pada cutoff grading, dan (3) evaluator berpasangan
 * champion vs ML1-B dengan bootstrap blok pekan. Aktivasi koleksi
 * menunggu persetujuan pemilik atas manifest + hasil preflight.
 *
 * Aturan keras yang dijaga di sini:
 *  - Laporan utama hanya memakai baris bukti v2 yang artefaknya lolos
 *    verifikasi terikat manifest tercatat (verifyPitBArtifacts).
 *  - Grader memakai fixture_uid DARI prediksi dan revisi TERBARU yang
 *    terlihat pada cutoff grading — dipilih SEBELUM memfilter status /
 *    basis skor (getRegulationScore tidak dipakai: ia memfilter
 *    finished+regulation dulu, sehingga bisa menghidupkan kembali skor
 *    lama yang sudah digantikan revisi batal/ET-only).
 *  - Grading append-only + idempoten: koreksi menambah edisi grading
 *    baru; forecast dan laporan beku lama tidak berubah.
 *  - Hasil studi tidak mengubah model saji; tanpa klaim odds/ROI/tiket.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { brierScore, isoWeekKey, logLossClamped, outcomeIndex } from "./chronological-evaluator";
import { blockBootstrapDelta, type BlockBootstrapResult } from "../quant/experiment-stats";
import {
  PIT_B_EVAL_VERSION,
  PIT_B_FEATURE_CODE_VERSION,
  PIT_B_HORIZON_ID,
  PIT_B_RUNNER_VERSION,
  readPitBLinks,
  verifyPitBArtifacts,
  type PitBArtifactVerification,
} from "./ml1-pit-b";
import {
  beginPinnedRead,
  bridgeIdsOf,
  endPinnedRead,
  parseInstant,
  parseKickoff,
  selectPackagesAsOf,
} from "./ml1-pit-a";
import {
  getFixtureByUid,
  getSiblingIds,
  getUidForMatchId,
  identityTablesExist,
  linkSiblingsOf,
} from "../identity/fixture-resolver";

// ============================================================================
// §3 — Manifest protokol
// ============================================================================
export const COHORT_PROTOCOL_VERSION = 1;
export const COHORT_BOOTSTRAP_RESAMPLES = 5000;
export const COHORT_BOOTSTRAP_SEED = 20261124;
/** Marker champion pada baseline repo (data/model-manifest.json ratingsHash). */
export const COHORT_CHAMPION_MARKER_REPO_BASELINE = "sha256:910a9efe3103ffde";

export interface CohortCompetitiveEntry {
  competition_id: string;
  fd_code: string;
  name: string;
  country: string;
  basis: string;
}

/**
 * Daftar awal kompetitif primer: liga domestik reguler yang divisi
 * football-data-nya didukung repo (FD_DIVISIONS) dan ID kanoniknya
 * terverifikasi di data/league-canonical.json. Klasifikasi disimpan
 * dengan alasan/sumbernya; liga di luar daftar = `unknown` sampai
 * terbukti. Kategori ini TERPISAH dari league_calibration, dan field
 * `slice` lama PIT B tidak dipakai.
 */
export const COMPETITIVE_PRIMARY_LIST: CohortCompetitiveEntry[] = [
  { competition_id: "sm:8", fd_code: "E0", name: "Premier League", country: "England", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:564", fd_code: "SP1", name: "La Liga", country: "Spain", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:384", fd_code: "I1", name: "Serie A", country: "Italy", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:82", fd_code: "D1", name: "Bundesliga", country: "Germany", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:301", fd_code: "F1", name: "Ligue 1", country: "France", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:9", fd_code: "E1", name: "Championship", country: "England", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:387", fd_code: "I2", name: "Serie B", country: "Italy", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:85", fd_code: "D2", name: "2. Bundesliga", country: "Germany", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:304", fd_code: "F2", name: "Ligue 2", country: "France", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:72", fd_code: "N1", name: "Eredivisie", country: "Netherlands", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:208", fd_code: "B1", name: "Pro League (First Division A)", country: "Belgium", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:501", fd_code: "SC0", name: "Premiership", country: "Scotland", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:600", fd_code: "T1", name: "Super Lig", country: "Turkey", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:325", fd_code: "G1", name: "Super League", country: "Greece", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:12", fd_code: "E2", name: "League One", country: "England", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:14", fd_code: "E3", name: "League Two", country: "England", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "sm:17", fd_code: "EC", name: "Enterprise National League", country: "England", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "SC1", fd_code: "SC1", name: "Scottish Championship", country: "Scotland", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "SC2", fd_code: "SC2", name: "Scottish League One", country: "Scotland", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
  { competition_id: "SC3", fd_code: "SC3", name: "Scottish League Two", country: "Scotland", basis: "fd_division_supported+domestic_regular; id terverifikasi di league-canonical.json" },
];

const COMPETITIVE_SET = new Set(COMPETITIVE_PRIMARY_LIST.map((e) => e.competition_id));

/** Klasifikasi kompetisi untuk kohor: hanya daftar terverifikasi yang primer. */
export function classifyCompetition(competitionId: string | null | undefined): "competitive_primary" | "unknown" {
  return competitionId !== null && competitionId !== undefined && COMPETITIVE_SET.has(competitionId)
    ? "competitive_primary"
    : "unknown";
}

/**
 * Klasifikasi memakai ALLOWLIST manifest yang dibekukan — bukan
 * konstanta kode (Brief Tindak Lanjut §3.3). Manifest adalah sumber
 * kebenaran klasifikasi + penyebut: mengubah daftar berarti manifest
 * baru + cohort_id baru.
 */
export function classifyCompetitionFor(
  protocol: CohortProtocol,
  competitionId: string | null | undefined,
): "competitive_primary" | "unknown" {
  if (competitionId === null || competitionId === undefined) return "unknown";
  return protocol.competitive_primary.list.some((e) => e.competition_id === competitionId)
    ? "competitive_primary"
    : "unknown";
}

export interface CohortProtocol {
  protocol_version: number;
  status: "PROPOSED_PENDING_OWNER_APPROVAL" | "FROZEN_FOR_COLLECTION";
  study: {
    candidate_id: string;
    candidate_manifest_sha256: string | null;
    eval_version: string;
    feature_code_version: string;
    runner_version: string;
    horizon_id: string;
  };
  unit: { per: string; pair: string };
  horizon: {
    min_lead_seconds_exclusive: number;
    max_lead_seconds: number;
    buckets: { label: string; max_lead_seconds: number }[];
    applied_before_dedupe: boolean;
    first_eligible_prediction_kept: boolean;
  };
  cadence: {
    batches_per_day: number;
    proposed_time_wib: string;
    after_verified_refresh: boolean;
    production_limit: number | null;
    missed_runs_recorded: boolean;
  };
  window: {
    weeks: number;
    t0: string | null;
    t1: string | null;
    grading_cutoff: string | null;
    kickoff_in: string;
    decision_from: string;
    min_blocks_with_graded: number;
  };
  competitive_primary: {
    basis: string;
    separate_from: string;
    legacy_slice_field_used: boolean;
    list: CohortCompetitiveEntry[];
  };
  champion: {
    primary_marker_repo_baseline: string;
    primary_marker: string | null;
    marker_change: string;
    marker_missing: string;
  };
  probability_validation: { finite: boolean; range: [number, number]; sum_tolerance: number };
  gates: {
    min_graded_competitive: number;
    max_mean_delta_ll: number;
    bootstrap_resamples: number;
    bootstrap_seed: number;
    bootstrap_upper_one_sided_95_below: number;
    min_blocks: number;
  };
  review: { formal_review_date: string | null; single_formal_review: boolean };
  policies: {
    reschedule: string;
    version_change: string;
    correction: string;
    rerun: string;
    missed_batch: string;
    protocol_amendment: string;
  };
  funnel: { stages: string[]; denominator: string };
}

/**
 * Manifest protokol dengan USULAN DEFAULT brief §3. Nilai produksi
 * (T0/T1, tanggal tinjauan, marker terverifikasi preflight, SHA manifest
 * kandidat) sengaja null — diisi sesudah preflight dan sebelum koleksi
 * pertama, atas persetujuan pemilik. Jangan mengarang nilai final.
 */
export function buildProposedProtocol(): CohortProtocol {
  return {
    protocol_version: COHORT_PROTOCOL_VERSION,
    status: "PROPOSED_PENDING_OWNER_APPROVAL",
    study: {
      candidate_id: "ml1-b",
      candidate_manifest_sha256: null,
      eval_version: PIT_B_EVAL_VERSION,
      feature_code_version: PIT_B_FEATURE_CODE_VERSION,
      runner_version: PIT_B_RUNNER_VERSION,
      horizon_id: PIT_B_HORIZON_ID,
    },
    unit: {
      per: "satu fixture fisik per fixture_uid dan horizon slate_pre_match",
      pair: "satu pasangan peluang 1X2 dari paket champion aktual dan ML1-B per fixture",
    },
    horizon: {
      min_lead_seconds_exclusive: 0,
      max_lead_seconds: 72 * 3600,
      buckets: [
        { label: "<12h", max_lead_seconds: 12 * 3600 },
        { label: "12-<36h", max_lead_seconds: 36 * 3600 },
        { label: "36-72h", max_lead_seconds: 72 * 3600 },
      ],
      applied_before_dedupe: true,
      first_eligible_prediction_kept: true,
    },
    cadence: {
      batches_per_day: 1,
      proposed_time_wib: "17:30",
      after_verified_refresh: true,
      production_limit: null,
      missed_runs_recorded: true,
    },
    window: {
      weeks: 12,
      t0: null,
      t1: null,
      grading_cutoff: null,
      kickoff_in: "[T0, T1)",
      decision_from: "T0",
      min_blocks_with_graded: 8,
    },
    competitive_primary: {
      basis: "canonical competition ID liga domestik reguler terverifikasi dengan cakupan awal memadai; titik awal = divisi feed yang didukung",
      separate_from: "league_calibration",
      legacy_slice_field_used: false,
      list: COMPETITIVE_PRIMARY_LIST,
    },
    champion: {
      primary_marker_repo_baseline: COHORT_CHAMPION_MARKER_REPO_BASELINE,
      primary_marker: null,
      marker_change: "strata terpisah — tidak tercampur ke primer",
      marker_missing: "diagnostik saja — tidak masuk primer",
    },
    probability_validation: { finite: true, range: [0, 1], sum_tolerance: 0.02 },
    gates: {
      min_graded_competitive: 500,
      max_mean_delta_ll: -0.005,
      bootstrap_resamples: COHORT_BOOTSTRAP_RESAMPLES,
      bootstrap_seed: COHORT_BOOTSTRAP_SEED,
      bootstrap_upper_one_sided_95_below: 0,
      min_blocks: 8,
    },
    review: { formal_review_date: null, single_formal_review: true },
    policies: {
      reschedule:
        "prediksi tetap terikat fixture_uid + kickoff saat issue; kickoff kanonik yang berubah membuat grading pending (kickoff_evidence_conflict) sampai bukti jadwal/hasil konsisten; prediksi tidak diterbitkan ulang dan lead time tidak dihitung ulang",
      version_change:
        "perubahan manifest kandidat / feature code / runner di tengah studi membentuk strata terpisah; strata primer dibekukan ke versi manifest ini",
      correction:
        "grading append-only: koreksi revisi menambah edisi grading baru; forecast dan laporan beku lama tidak berubah dan tetap reproducible dari cutoff laporannya",
      rerun: "rerun tidak menggandakan fixture dan tidak mengganti prediksi lama; edisi pertama yang tercatat adalah yang disimpan",
      missed_batch: "batch terlewat dicatat di funnel (hari batch yang diharapkan vs aktual) dan dilaporkan sebagai deviasi",
      protocol_amendment:
        "perubahan parameter apa pun = versi protokol baru + cohort_id baru; kohor lama ditutup di bawah manifest-nya sendiri",
    },
    funnel: {
      stages: [
        "scheduled_in_scope",
        "stored_predictions",
        "gap_no_prediction",
        "graded",
        "pending",
        "void",
        "invalid",
        "identity_doubtful",
        "evidence_issues",
        "inference_failed_or_skipped_at_issue",
      ],
      denominator: "fixture terjadwal dalam cakupan dari katalog/identitas pada snapshot (canonical_fixtures, kickoff dalam jendela)",
    },
  };
}

/** JSON kanonik: kunci terurut rekursif — hash stabil untuk isi yang sama. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** Hash manifest protokol atas JSON kanoniknya (tanpa field turunan). */
export function protocolHash(p: CohortProtocol): string {
  return sha256Hex(canonicalJson(p));
}

/** cohort_id mengacu persis ke manifest: turunan deterministik dari hash-nya. */
export function cohortIdFor(p: CohortProtocol): string {
  return `ml1b-cohort-${protocolHash(p).slice(0, 16)}`;
}

export interface FinalizedProtocol {
  protocol: CohortProtocol;
  protocol_sha256: string;
  cohort_id: string;
}

export function finalizeProtocol(p: CohortProtocol): FinalizedProtocol {
  return { protocol: p, protocol_sha256: protocolHash(p), cohort_id: cohortIdFor(p) };
}

// ============================================================================
// §3.3 (tindak lanjut) — Penegakan manifest beku
// ============================================================================
export interface ProtocolManifestValidation {
  /** true bila tidak ada error struktural / kelengkapan untuk modenya. */
  ok: boolean;
  /** "official" hanya untuk manifest FROZEN_FOR_COLLECTION yang lengkap. */
  mode: "staging" | "official";
  errors: string[];
  warnings: string[];
}

const isSha256Hex = (s: string | null): s is string => s !== null && /^[0-9a-f]{64}$/.test(s);

/**
 * Validasi manifest protokol. Manifest PROPOSAL hanya sah untuk
 * staging: nilai produksi yang masih kosong tercatat sebagai warning.
 * Gate resmi mensyaratkan manifest FINAL (FROZEN_FOR_COLLECTION) dengan
 * hash kandidat valid dan SEMUA nilai produksi lengkap — kandidat
 * ID/SHA, versi fitur/runner, marker primer, horizon, dan jendela
 * (T0/T1/cutoff grading/tanggal tinjauan) dibekukan di manifest.
 */
export function validateProtocolManifest(p: CohortProtocol): ProtocolManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isFinal = p.status === "FROZEN_FOR_COLLECTION";
  const req = (cond: boolean, msg: string): void => {
    if (!cond) (isFinal ? errors : warnings).push(msg);
  };
  req(isSha256Hex(p.study.candidate_manifest_sha256), "study.candidate_manifest_sha256 belum hash SHA-256 kandidat yang valid");
  req(p.study.candidate_id !== "", "study.candidate_id kosong");
  req(p.study.eval_version === PIT_B_EVAL_VERSION, "study.eval_version tidak sama dengan versi bukti aktif");
  req(p.study.feature_code_version === PIT_B_FEATURE_CODE_VERSION, "study.feature_code_version tidak sama dengan versi kode fitur aktif");
  req(p.study.runner_version === PIT_B_RUNNER_VERSION, "study.runner_version tidak sama dengan versi runner aktif");
  req(p.study.horizon_id === PIT_B_HORIZON_ID, "study.horizon_id tidak sama dengan horizon aktif");
  req(p.champion.primary_marker !== null && p.champion.primary_marker !== "", "champion.primary_marker belum dikunci");
  req(p.window.t0 !== null, "window.t0 belum diisi");
  req(p.window.t1 !== null, "window.t1 belum diisi");
  req(p.window.grading_cutoff !== null, "window.grading_cutoff belum diisi");
  req(p.review.formal_review_date !== null, "review.formal_review_date belum diisi");
  if (p.competitive_primary.list.length === 0) errors.push("competitive_primary.list kosong");
  if (!(p.horizon.max_lead_seconds > p.horizon.min_lead_seconds_exclusive)) {
    errors.push("horizon tidak valid: max_lead_seconds harus > min_lead_seconds_exclusive");
  }
  const t0Ms = p.window.t0 !== null ? parseInstant(p.window.t0) : null;
  const t1Ms = p.window.t1 !== null ? parseInstant(p.window.t1) : null;
  const cutoffMs = p.window.grading_cutoff !== null ? parseInstant(p.window.grading_cutoff) : null;
  if (p.window.t0 !== null && t0Ms === null) errors.push("window.t0 bukan instant yang valid");
  if (p.window.t1 !== null && t1Ms === null) errors.push("window.t1 bukan instant yang valid");
  if (p.window.grading_cutoff !== null && cutoffMs === null) errors.push("window.grading_cutoff bukan instant yang valid");
  if (t0Ms !== null && t1Ms !== null && !(t0Ms < t1Ms)) errors.push("window tidak valid: t0 harus < t1");
  if (t1Ms !== null && cutoffMs !== null && cutoffMs < t1Ms) errors.push("window tidak valid: grading_cutoff sebelum t1");
  return { ok: errors.length === 0, mode: isFinal ? "official" : "staging", errors, warnings };
}

// ============================================================================
// §4 — Grader shadow berbasis UID (append-only, idempoten)
// ============================================================================
export type CohortGradingStatus =
  | "graded"
  | "void"
  | "pending"
  | "invalid"
  | "identity_conflict"
  | "proof_conflict"
  | "evidence_invalid"
  | "diagnostic";

export interface CohortGradingRow {
  id: number;
  prediction_id: number;
  fixture_uid: string;
  cohort_id: string;
  edition: number;
  graded_at_utc: string;
  grading_cutoff_utc: string;
  status: CohortGradingStatus;
  stratum: string;
  reason: string | null;
  home_score: number | null;
  away_score: number | null;
  revision: number | null;
  revision_checksum: string | null;
  outcome_index: number | null;
  ll_champion: number | null;
  ll_candidate: number | null;
  brier_champion: number | null;
  brier_candidate: number | null;
  delta_ll: number | null;
  block_key: string | null;
  evidence_key: string;
}

const COHORT_GRADING_COLUMNS = `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction_id INTEGER NOT NULL,
      fixture_uid TEXT NOT NULL,
      cohort_id TEXT NOT NULL,
      edition INTEGER NOT NULL,
      graded_at_utc TEXT NOT NULL,
      grading_cutoff_utc TEXT NOT NULL,
      status TEXT NOT NULL,
      stratum TEXT NOT NULL DEFAULT 'primary',
      reason TEXT,
      home_score INTEGER,
      away_score INTEGER,
      revision INTEGER,
      revision_checksum TEXT,
      outcome_index INTEGER,
      ll_champion REAL,
      ll_candidate REAL,
      brier_champion REAL,
      brier_candidate REAL,
      delta_ll REAL,
      block_key TEXT,
      evidence_key TEXT NOT NULL`;

const COHORT_GRADING_COLUMN_LIST =
  "id, prediction_id, fixture_uid, cohort_id, edition, graded_at_utc, grading_cutoff_utc, status, stratum, reason, home_score, away_score, revision, revision_checksum, outcome_index, ll_champion, ll_candidate, brier_champion, brier_candidate, delta_ll, block_key, evidence_key";

export function ensureCohortGradingSchema(db: DatabaseSync): void {
  // Migrasi isolasi kohor (Brief Tindak Lanjut §3.1): skema lama memakai
  // UNIQUE (prediction_id, evidence_key) TANPA cohort_id, sehingga
  // grading kohor kedua atas bukti yang sama tertelan sebagai
  // "idempoten" milik kohor pertama. Tabel lama dibangun ulang dengan
  // kunci ter-scope kohor; baris lama dipertahankan apa adanya.
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cohort_gradings'")
    .get() as unknown as { sql: string } | undefined;
  if (existing && !/UNIQUE\s*\(\s*cohort_id\s*,\s*prediction_id\s*,\s*evidence_key\s*\)/.test(existing.sql)) {
    db.exec("ALTER TABLE cohort_gradings RENAME TO cohort_gradings_legacy_unscoped");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cohort_gradings (
${COHORT_GRADING_COLUMNS},
      UNIQUE (cohort_id, prediction_id, evidence_key)
    );
  `);
  const legacy = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cohort_gradings_legacy_unscoped'")
    .get() as unknown as { name: string } | undefined;
  if (legacy) {
    db.exec(`
      INSERT OR IGNORE INTO cohort_gradings (${COHORT_GRADING_COLUMN_LIST})
        SELECT ${COHORT_GRADING_COLUMN_LIST} FROM cohort_gradings_legacy_unscoped;
      DROP TABLE cohort_gradings_legacy_unscoped;
    `);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cohort_gradings_uid ON cohort_gradings(fixture_uid);
    CREATE INDEX IF NOT EXISTS idx_cohort_gradings_cohort ON cohort_gradings(cohort_id);
    CREATE TABLE IF NOT EXISTS cohort_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_id TEXT NOT NULL,
      protocol_sha256 TEXT NOT NULL,
      report_cutoff_utc TEXT NOT NULL,
      created_utc TEXT NOT NULL,
      evaluator_version TEXT NOT NULL,
      report_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cohort_report_gradings (
      report_id INTEGER NOT NULL,
      cohort_id TEXT NOT NULL,
      prediction_id INTEGER NOT NULL,
      grading_id INTEGER NOT NULL,
      edition INTEGER NOT NULL,
      status TEXT NOT NULL,
      delta_ll REAL,
      PRIMARY KEY (report_id, prediction_id)
    );
  `);
}

export const COHORT_EVALUATOR_VERSION = "ml1-cohort-evaluator-v1";

interface CohortPredictionRow {
  id: number;
  eval_version: string;
  horizon_id: string;
  fixture_uid: string;
  source_match_id: string;
  competition_id: string | null;
  decision_at_utc: string;
  issued_at_utc: string;
  kickoff_utc: string;
  lead_seconds: number;
  package_computed_utc: string;
  package_payload_sha256: string;
  champion_ratings_marker: string | null;
  candidate_id: string | null;
  candidate_manifest_sha256: string | null;
  feature_snapshot_id: string;
  home_name: string | null;
  away_name: string | null;
  champ_p_h: number;
  champ_p_d: number;
  champ_p_a: number;
  cand_p_h: number;
  cand_p_d: number;
  cand_p_a: number;
}

interface CanonicalFixtureRow {
  fixture_uid: string;
  home_name: string | null;
  away_name: string | null;
  kickoff_utc: string | null;
  state: string;
  current_revision: number;
}

interface ResultRevisionRow {
  revision: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  score_basis: string;
  observed_at: string;
  checksum: string | null;
}

const normName = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function validProbTriple(p: [number, number, number], tol: number): boolean {
  for (const v of p) {
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return Math.abs(p[0] + p[1] + p[2] - 1) <= tol;
}

const isNonNegInt = (v: number | null): v is number =>
  v !== null && typeof v === "number" && Number.isInteger(v) && v >= 0;

export interface CohortGradeDeps {
  /** DB shadow PIT B — satu-satunya yang ditulis grader (tabel cohort_*). */
  shadowDb: DatabaseSync;
  /** Dataset resmi dibuka read-only oleh pemanggil. */
  dataset: DatabaseSync;
  projectionDir: string;
  protocol: CohortProtocol;
  cohortId: string;
  /** Hanya revisi dengan observed_at <= cutoff ini yang terlihat. */
  gradingCutoffUtc: string;
  clock: () => Date;
  /**
   * Mode penegakan manifest. "official" mensyaratkan manifest FINAL
   * yang lengkap dan cutoff grading persis sama dengan cutoff beku
   * manifest. Tanpa mode: manifest FROZEN tetap ditegakkan sebagai
   * official; manifest proposal berjalan sebagai staging.
   */
  mode?: "staging" | "official";
}

export interface CohortGradeSummary {
  cohort_id: string;
  graded_at_utc: string;
  grading_cutoff_utc: string;
  predictions_considered: number;
  new_gradings: number;
  idempotent_skips: number;
  by_status: Record<string, number>;
  verification: { snapshots_ok: number; snapshots_checked: number; rows_ok: number; rows_checked: number };
}

interface GradeDraft {
  status: CohortGradingStatus;
  stratum: string;
  reason: string | null;
  home_score: number | null;
  away_score: number | null;
  revision: number | null;
  revision_checksum: string | null;
  outcome_index: number | null;
  ll_champion: number | null;
  ll_candidate: number | null;
  brier_champion: number | null;
  brier_candidate: number | null;
  delta_ll: number | null;
  block_key: string | null;
}

const draft = (status: CohortGradingStatus, stratum: string, reason: string | null): GradeDraft => ({
  status,
  stratum,
  reason,
  home_score: null,
  away_score: null,
  revision: null,
  revision_checksum: null,
  outcome_index: null,
  ll_champion: null,
  ll_candidate: null,
  brier_champion: null,
  brier_candidate: null,
  delta_ll: null,
  block_key: null,
});

/**
 * Nilai satu prediksi kohor dari bukti yang terlihat pada cutoff grading.
 * Urutan cek: bukti artefak → rantai waktu → pasangan peluang → marker →
 * lead → identitas (UID dari prediksi; alias yang pindah TIDAK diikuti)
 * → revisi otoritatif terbaru (dipilih sebelum filter status/basis) →
 * konsistensi state kanonik.
 */
function gradeOne(
  pred: CohortPredictionRow,
  ctx: {
    protocol: CohortProtocol;
    strictPredIds: Set<number>;
    verifyReasonByPredId: Map<number, string>;
    verifyReasonByUid: Map<string, string>;
    snapVersions: Map<string, { feature_code_version: string; runner_version: string }>;
    dataset: DatabaseSync;
    gradingCutoffMs: number;
  },
): GradeDraft {
  const { protocol } = ctx;
  // 1) Bukti artefak terikat manifest (versi bukti lama = diagnostik).
  if (pred.eval_version !== PIT_B_EVAL_VERSION) {
    return draft("evidence_invalid", "legacy_evidence", "evidence_version_legacy");
  }
  // Ikatan bukti PER BARIS (bukan per UID): baris tersimpan harus lolos
  // verifikasi artefak + ikatan isi terhadap proyeksi beku (§3.2).
  if (!ctx.strictPredIds.has(pred.id)) {
    return draft(
      "evidence_invalid",
      "primary",
      ctx.verifyReasonByPredId.get(pred.id) ?? ctx.verifyReasonByUid.get(pred.fixture_uid) ?? "artifact_not_verified",
    );
  }
  // 1b) Ikatan kandidat + versi ke protokol yang dibekukan: ID kandidat
  // harus sama; SHA manifest kandidat harus sama bila manifest
  // membekukannya; versi fitur/runner snapshot harus sama dengan versi
  // beku protokol. Hasil kandidat tersimpan terikat ke provenance ini.
  if (pred.candidate_id !== protocol.study.candidate_id) {
    return draft("evidence_invalid", "primary", "candidate_id_mismatch");
  }
  if (
    protocol.study.candidate_manifest_sha256 !== null &&
    pred.candidate_manifest_sha256 !== protocol.study.candidate_manifest_sha256
  ) {
    return draft("evidence_invalid", "primary", "candidate_manifest_mismatch");
  }
  const snapV = ctx.snapVersions.get(pred.feature_snapshot_id);
  if (
    !snapV ||
    snapV.feature_code_version !== protocol.study.feature_code_version ||
    snapV.runner_version !== protocol.study.runner_version
  ) {
    return draft("evidence_invalid", "primary", "evidence_version_against_protocol");
  }
  // 2) Rantai waktu: computed <= decision <= issue < kickoff.
  const computedMs = parseInstant(pred.package_computed_utc);
  const decisionMs = parseInstant(pred.decision_at_utc);
  const issuedMs = parseInstant(pred.issued_at_utc);
  const kickoffMs = parseInstant(pred.kickoff_utc);
  if (computedMs === null || decisionMs === null || issuedMs === null || kickoffMs === null ||
      !(computedMs <= decisionMs && decisionMs <= issuedMs && issuedMs < kickoffMs)) {
    return draft("invalid", "primary", "timestamp_chain_invalid");
  }
  // 3) Pasangan peluang: hanya pasangan lengkap yang finite, dalam
  // rentang, dan jumlahnya konsisten dalam toleransi terkunci manifest.
  const tol = protocol.probability_validation.sum_tolerance;
  if (
    !validProbTriple([pred.champ_p_h, pred.champ_p_d, pred.champ_p_a], tol) ||
    !validProbTriple([pred.cand_p_h, pred.cand_p_d, pred.cand_p_a], tol)
  ) {
    return draft("invalid", "primary", "probability_pair_invalid");
  }
  // 4) Marker champion primer (strata terpisah; hilang = diagnostik).
  const primaryMarker = protocol.champion.primary_marker ?? protocol.champion.primary_marker_repo_baseline;
  if (pred.champion_ratings_marker === null || pred.champion_ratings_marker === "") {
    return draft("diagnostic", "marker_missing", "champion_marker_missing");
  }
  if (pred.champion_ratings_marker !== primaryMarker) {
    return draft("diagnostic", "other_marker", "champion_marker_differs");
  }
  // 5) Jendela horizon dari instant aktual.
  const leadSec = (kickoffMs - decisionMs) / 1000;
  if (!(leadSec > protocol.horizon.min_lead_seconds_exclusive && leadSec <= protocol.horizon.max_lead_seconds)) {
    return draft("diagnostic", "out_of_horizon", "lead_out_of_horizon");
  }
  // 6) Klasifikasi kompetisi dari ALLOWLIST manifest (strata, bukan
  // penentu status outcome).
  const stratum = classifyCompetitionFor(protocol, pred.competition_id) === "competitive_primary" ? "primary" : "non_primary_competition";

  // 7) Identitas: UID dari prediksi; orientasi dibekukan saat issue.
  const cf = ctx.dataset
    .prepare("SELECT fixture_uid, home_name, away_name, kickoff_utc, state, current_revision FROM canonical_fixtures WHERE fixture_uid = ?")
    .get(pred.fixture_uid) as unknown as CanonicalFixtureRow | undefined;
  if (!cf) return draft("pending", stratum, "identity_unproven");
  const alias = ctx.dataset
    .prepare("SELECT fixture_uid FROM fixture_aliases WHERE source_match_id = ?")
    .get(pred.source_match_id) as unknown as { fixture_uid: string } | undefined;
  if (!alias) return draft("pending", stratum, "identity_unproven_alias_missing");
  if (alias.fixture_uid !== pred.fixture_uid) {
    return draft("identity_conflict", stratum, "alias_moved_to_other_uid");
  }
  const cfHome = normName(cf.home_name);
  const cfAway = normName(cf.away_name);
  const pHome = normName(pred.home_name);
  const pAway = normName(pred.away_name);
  if (pHome !== "" && pAway !== "" && cfHome === pAway && cfAway === pHome && cfHome !== pHome) {
    return draft("identity_conflict", stratum, "orientation_reversed");
  }
  if (pHome !== "" && cfHome !== "" && (cfHome !== pHome || cfAway !== pAway)) {
    return draft("pending", stratum, "identity_unproven_names_differ");
  }
  if (cf.kickoff_utc) {
    const cfKickoffMs = parseInstant(cf.kickoff_utc);
    if (cfKickoffMs !== null && cfKickoffMs !== kickoffMs) {
      return draft("pending", stratum, "kickoff_evidence_conflict");
    }
  }

  // 8) Revisi otoritatif TERBARU yang terlihat pada cutoff grading —
  // dipilih SEBELUM memfilter status/basis skor (anti-jebakan
  // getRegulationScore: revisi batal/ET-only yang lebih baru MENUTUP
  // skor regulasi lama, bukan diabaikan).
  const revisions = ctx.dataset
    .prepare(
      `SELECT revision, status, home_score, away_score, score_basis, observed_at, checksum
       FROM result_revisions WHERE fixture_uid = ? ORDER BY revision ASC`,
    )
    .all(pred.fixture_uid) as unknown as ResultRevisionRow[];
  const visible = revisions.filter((r) => {
    const obsMs = parseInstant(r.observed_at);
    return obsMs !== null && obsMs <= ctx.gradingCutoffMs;
  });
  if (visible.length === 0) return draft("pending", stratum, "no_revision_visible");
  const latest = visible[visible.length - 1];

  // 9) Konsistensi bukti: state kanonik + current_revision vs revisi —
  // dinilai AS-OF cutoff grading (Brief Validasi Rilis §4.3). Pointer
  // kanonik adalah keadaan SEKARANG; bila ia sudah melewati revisi
  // terbaru yang terlihat pada cutoff DAN revisi yang ditunjuknya
  // teramati SESUDAH cutoff, keadaaan as-of cutoff tetap `latest`:
  // edisi pasca-cutoff dipisahkan ke cutoff grading berikutnya dan
  // TIDAK mencemari laporan formal cutoff ini (sebelumnya, re-grade
  // pada cutoff formal sesudah koreksi tiba menulis proof_conflict
  // yang menelan pair yang sah — hitung ulang laporan lama menjadi
  // 0 pair). Pointer yang majunya tidak dijelaskan revisi pasca-cutoff
  // (revisi penunjuk hilang / teramati sebelum cutoff / pointer mundur)
  // tetap proof_conflict seperti sebelumnya.
  let pointerBeyondCutoff = false;
  if (cf.current_revision !== latest.revision) {
    const pointerRevision = revisions.find((r) => r.revision === cf.current_revision);
    const pointerObsMs = pointerRevision ? parseInstant(pointerRevision.observed_at) : null;
    if (
      cf.current_revision > latest.revision &&
      pointerRevision !== undefined &&
      pointerObsMs !== null &&
      pointerObsMs > ctx.gradingCutoffMs
    ) {
      pointerBeyondCutoff = true;
    } else {
      return draft("proof_conflict", stratum, "current_revision_mismatch");
    }
  }
  // State as-of cutoff: bila pointer sudah dipegang revisi pasca-cutoff,
  // state kanonik saat ini milik revisi itu — state as-of didefinisikan
  // oleh revisi terlihat terbaru itu sendiri, jadi cek state sekarang
  // dilewati (bukan dibuktikan ulang dari keadaan masa depan).
  const stateConsistent =
    pointerBeyondCutoff ||
    (cf.state === "finished" && latest.status === "finished") ||
    (cf.state === "cancelled" && latest.status === "cancelled") ||
    (cf.state === "postponed" && latest.status === "postponed") ||
    (cf.state === "scheduled" && (latest.status === "scheduled" || latest.status === "postponed"));
  if (!stateConsistent) {
    return draft("proof_conflict", stratum, "canonical_state_conflicts_revision");
  }

  // 10) Outcome dari revisi terbaru saja.
  if (latest.status === "cancelled") {
    const d = draft("void", stratum, "cancelled_authoritative");
    d.revision = latest.revision;
    d.revision_checksum = latest.checksum;
    return d;
  }
  if (latest.status === "postponed") {
    const d = draft("pending", stratum, "postponed");
    d.revision = latest.revision;
    d.revision_checksum = latest.checksum;
    return d;
  }
  if (latest.status !== "finished") {
    const d = draft("pending", stratum, `status_${latest.status}`);
    d.revision = latest.revision;
    d.revision_checksum = latest.checksum;
    return d;
  }
  if (latest.score_basis !== "regulation") {
    // ET/penalti atau basis belum pasti tanpa skor regulasi → pending;
    // skor regulasi dari revisi lama TIDAK dihidupkan kembali.
    const d = draft("pending", stratum, "score_basis_not_regulation");
    d.revision = latest.revision;
    d.revision_checksum = latest.checksum;
    return d;
  }
  if (!isNonNegInt(latest.home_score) || !isNonNegInt(latest.away_score)) {
    return draft("invalid", stratum, "anomalous_score");
  }
  const y = outcomeIndex(latest.home_score, latest.away_score);
  const champ: [number, number, number] = [pred.champ_p_h, pred.champ_p_d, pred.champ_p_a];
  const cand: [number, number, number] = [pred.cand_p_h, pred.cand_p_d, pred.cand_p_a];
  const llChamp = logLossClamped(champ, y);
  const llCand = logLossClamped(cand, y);
  const d = draft("graded", stratum, null);
  d.home_score = latest.home_score;
  d.away_score = latest.away_score;
  d.revision = latest.revision;
  d.revision_checksum = latest.checksum;
  d.outcome_index = y;
  d.ll_champion = llChamp;
  d.ll_candidate = llCand;
  d.brier_champion = brierScore(champ, y);
  d.brier_candidate = brierScore(cand, y);
  d.delta_ll = llCand - llChamp;
  d.block_key = isoWeekKey(pred.kickoff_utc);
  return d;
}

/**
 * Jalankan grading kohor: snapshot hasil dipin, waktu grading aktual
 * dicatat dari clock sesudah pin, lalu grading ditulis append-only ke
 * tabel cohort_gradings di DB shadow. Rerun atas bukti yang sama tidak
 * menulis baris baru (idempoten, dalam transaksi).
 */
export function gradeCohort(deps: CohortGradeDeps): CohortGradeSummary {
  const { shadowDb, dataset, protocol } = deps;
  ensureCohortGradingSchema(shadowDb);
  const gradingCutoffMs = parseInstant(deps.gradingCutoffUtc);
  if (gradingCutoffMs === null) {
    throw new Error(`ML1-KOHOR: grading cutoff tidak valid: ${deps.gradingCutoffUtc}`);
  }
  // Penegakan manifest beku (§3.3): mode official — atau manifest yang
  // sudah FROZEN — mensyaratkan manifest final yang lengkap dan cutoff
  // grading persis sama dengan cutoff beku manifest. Manifest proposal
  // hanya berjalan sebagai staging.
  const validation = validateProtocolManifest(protocol);
  const official = deps.mode === "official" || protocol.status === "FROZEN_FOR_COLLECTION";
  if (deps.mode === "official" && protocol.status !== "FROZEN_FOR_COLLECTION") {
    throw new Error("ML1-KOHOR: mode official mensyaratkan manifest FROZEN_FOR_COLLECTION (proposal hanya untuk staging).");
  }
  if (official) {
    if (!validation.ok) {
      throw new Error(`ML1-KOHOR: manifest final tidak lengkap: ${validation.errors.join("; ")}`);
    }
    const frozenCutoffMs = protocol.window.grading_cutoff !== null ? parseInstant(protocol.window.grading_cutoff) : null;
    if (frozenCutoffMs === null || frozenCutoffMs !== gradingCutoffMs) {
      throw new Error("ML1-KOHOR: grading cutoff tidak sama dengan cutoff beku manifest.");
    }
  }
  // Verifikasi artefak per proyeksi unik terhadap manifest tercatat.
  const verification: PitBArtifactVerification = verifyPitBArtifacts(shadowDb, deps.projectionDir);
  const strictPredIds = new Set(verification.strict_prediction_ids);
  const verifyReasonByUid = new Map(verification.rejected.map((r) => [r.fixture_uid, r.reason] as const));
  const verifyReasonByPredId = new Map<number, string>();
  for (const r of verification.rejected) {
    if (r.prediction_id !== undefined && !verifyReasonByPredId.has(r.prediction_id)) {
      verifyReasonByPredId.set(r.prediction_id, r.reason);
    }
  }
  const snapVersions = new Map<string, { feature_code_version: string; runner_version: string }>();
  for (const s of shadowDb
    .prepare("SELECT feature_snapshot_id, feature_code_version, runner_version FROM feature_snapshots")
    .all() as unknown as { feature_snapshot_id: string; feature_code_version: string; runner_version: string }[]) {
    snapVersions.set(s.feature_snapshot_id, { feature_code_version: s.feature_code_version, runner_version: s.runner_version });
  }

  let gradedAtUtc = "";
  const drafts: { pred: CohortPredictionRow; d: GradeDraft; evidenceKey: string }[] = [];
  beginPinnedRead(dataset, "SELECT COUNT(*) AS n FROM canonical_fixtures");
  try {
    const t = deps.clock();
    if (!Number.isFinite(t.getTime())) throw new Error("ML1-KOHOR: clock grading tidak valid.");
    gradedAtUtc = t.toISOString();

    const windowT0 = protocol.window.t0;
    const windowT1 = protocol.window.t1;
    const preds = shadowDb
      .prepare("SELECT * FROM predictions WHERE horizon_id = ? ORDER BY kickoff_utc, fixture_uid")
      .all(protocol.study.horizon_id) as unknown as CohortPredictionRow[];
    for (const pred of preds) {
      if (windowT0 !== null && windowT1 !== null) {
        if (!(pred.kickoff_utc >= windowT0 && pred.kickoff_utc < windowT1)) continue;
        if (pred.decision_at_utc < windowT0) continue;
      }
      const d = gradeOne(pred, { protocol, strictPredIds, verifyReasonByPredId, verifyReasonByUid, snapVersions, dataset, gradingCutoffMs });
      const evidenceKey = sha256Hex(
        canonicalJson([pred.fixture_uid, d.status, d.stratum, d.reason, d.revision, d.home_score, d.away_score, d.revision_checksum]),
      );
      drafts.push({ pred, d, evidenceKey });
    }
  } finally {
    endPinnedRead(dataset);
  }

  let newGradings = 0;
  let idempotentSkips = 0;
  const byStatus: Record<string, number> = {};
  shadowDb.exec("BEGIN IMMEDIATE");
  try {
    for (const { pred, d, evidenceKey } of drafts) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      const existing = shadowDb
        .prepare("SELECT id FROM cohort_gradings WHERE cohort_id = ? AND prediction_id = ? AND evidence_key = ?")
        .get(deps.cohortId, pred.id, evidenceKey) as unknown as { id: number } | undefined;
      if (existing) {
        idempotentSkips++;
        continue;
      }
      const maxEd = shadowDb
        .prepare("SELECT COALESCE(MAX(edition), 0) AS m FROM cohort_gradings WHERE cohort_id = ? AND prediction_id = ?")
        .get(deps.cohortId, pred.id) as unknown as { m: number };
      shadowDb
        .prepare(
          `INSERT INTO cohort_gradings (
             prediction_id, fixture_uid, cohort_id, edition, graded_at_utc, grading_cutoff_utc,
             status, stratum, reason, home_score, away_score, revision, revision_checksum,
             outcome_index, ll_champion, ll_candidate, brier_champion, brier_candidate,
             delta_ll, block_key, evidence_key
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          pred.id, pred.fixture_uid, deps.cohortId, Number(maxEd.m) + 1, gradedAtUtc, deps.gradingCutoffUtc,
          d.status, d.stratum, d.reason, d.home_score, d.away_score, d.revision, d.revision_checksum,
          d.outcome_index, d.ll_champion, d.ll_candidate, d.brier_champion, d.brier_candidate,
          d.delta_ll, d.block_key, evidenceKey,
        );
      newGradings++;
    }
    shadowDb.exec("COMMIT");
  } catch (err) {
    try {
      shadowDb.exec("ROLLBACK");
    } catch {
      // transaksi sudah berakhir
    }
    throw err;
  }

  return {
    cohort_id: deps.cohortId,
    graded_at_utc: gradedAtUtc,
    grading_cutoff_utc: deps.gradingCutoffUtc,
    predictions_considered: drafts.length,
    new_gradings: newGradings,
    idempotent_skips: idempotentSkips,
    by_status: byStatus,
    verification: {
      snapshots_ok: verification.snapshots_ok,
      snapshots_checked: verification.snapshots_checked,
      rows_ok: verification.rows_ok,
      rows_checked: verification.rows_checked,
    },
  };
}

// ============================================================================
// §5 — Evaluasi berpasangan + laporan operasi
// ============================================================================
export type CohortStudyStatus = "COLLECTING" | "INCONCLUSIVE" | "RETAIN_CHAMPION" | "READY_TO_REVIEW";

export interface CohortPair {
  fixture_uid: string;
  kickoff_utc: string;
  competition_id: string | null;
  champion_marker: string | null;
  lead_seconds: number;
  outcome_index: number;
  ll_champion: number;
  ll_candidate: number;
  brier_champion: number;
  brier_candidate: number;
  delta_ll: number;
  block_key: string;
  champ_probs: [number, number, number];
  cand_probs: [number, number, number];
}

export interface ReliabilityBin {
  bin: string;
  n: number;
  mean_predicted: number;
  empirical_frequency: number;
}

function reliabilityBins(pairs: CohortPair[], pick: (p: CohortPair) => [number, number, number]): ReliabilityBin[] {
  const bins = new Map<number, { n: number; sumP: number; hits: number }>();
  for (const p of pairs) {
    const probs = pick(p);
    for (let k = 0; k < 3; k++) {
      const b = Math.min(9, Math.floor(probs[k] * 10));
      const agg = bins.get(b) ?? { n: 0, sumP: 0, hits: 0 };
      agg.n++;
      agg.sumP += probs[k];
      if (p.outcome_index === k) agg.hits++;
      bins.set(b, agg);
    }
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, agg]) => ({
      bin: `${(b / 10).toFixed(1)}-${((b + 1) / 10).toFixed(1)}`,
      n: agg.n,
      mean_predicted: agg.sumP / agg.n,
      empirical_frequency: agg.hits / agg.n,
    }));
}

function groupDelta(pairs: CohortPair[], key: (p: CohortPair) => string): Record<string, { n: number; mean_delta_ll: number }> {
  const groups = new Map<string, { n: number; sum: number }>();
  for (const p of pairs) {
    const k = key(p);
    const agg = groups.get(k) ?? { n: 0, sum: 0 };
    agg.n++;
    agg.sum += p.delta_ll;
    groups.set(k, agg);
  }
  const out: Record<string, { n: number; mean_delta_ll: number }> = {};
  for (const [k, agg] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out[k] = { n: agg.n, mean_delta_ll: agg.sum / agg.n };
  }
  return out;
}

export interface CohortEvaluation {
  cohort_id: string;
  protocol_sha256: string;
  /** Status manifest sumber (PROPOSED… = staging; FROZEN… = resmi). */
  manifest_status: string;
  evaluator_version: string;
  report_cutoff_utc: string;
  window_closed: boolean;
  status: CohortStudyStatus;
  pairs: number;
  blocks: number;
  mean_delta_ll: number | null;
  bootstrap: BlockBootstrapResult | null;
  mean_brier_champion: number | null;
  mean_brier_candidate: number | null;
  gates: { n_ok: boolean; delta_ok: boolean; upper_ok: boolean; blocks_ok: boolean };
  reliability_champion: ReliabilityBin[];
  reliability_candidate: ReliabilityBin[];
  delta_by_marker: Record<string, { n: number; mean_delta_ll: number }>;
  delta_by_lead_bucket: Record<string, { n: number; mean_delta_ll: number }>;
  delta_by_competition: Record<string, { n: number; mean_delta_ll: number }>;
}

export function leadBucketLabel(leadSeconds: number, protocol: CohortProtocol): string {
  for (const b of protocol.horizon.buckets) {
    if (leadSeconds <= b.max_lead_seconds) return b.label;
  }
  return "beyond_horizon";
}

/**
 * Evaluasi murni atas pasangan graded primer: input diurutkan
 * deterministik (kickoff, UID), bootstrap blok isoWeekKey dengan
 * parameter terkunci manifest. Status mengikuti definisi brief §5.
 */
export function evaluatePairs(
  pairsIn: CohortPair[],
  protocol: CohortProtocol,
  opts: { cohortId: string; reportCutoffUtc: string; windowClosed: boolean },
): CohortEvaluation {
  const pairs = [...pairsIn].sort(
    (a, b) => (a.kickoff_utc < b.kickoff_utc ? -1 : a.kickoff_utc > b.kickoff_utc ? 1 : a.fixture_uid < b.fixture_uid ? -1 : 1),
  );
  const n = pairs.length;
  const bootstrap =
    n > 0
      ? blockBootstrapDelta(
          pairs.map((p) => ({ block: p.block_key, delta: p.delta_ll })),
          { resamples: protocol.gates.bootstrap_resamples, seed: protocol.gates.bootstrap_seed },
        )
      : null;
  const meanDelta = bootstrap ? bootstrap.meanDelta : null;
  const gates = {
    n_ok: n >= protocol.gates.min_graded_competitive,
    delta_ok: meanDelta !== null && meanDelta <= protocol.gates.max_mean_delta_ll,
    upper_ok: bootstrap !== null && bootstrap.upperOneSided95 < protocol.gates.bootstrap_upper_one_sided_95_below,
    blocks_ok: bootstrap !== null && bootstrap.nBlocks >= protocol.gates.min_blocks,
  };
  let status: CohortStudyStatus;
  if (!opts.windowClosed) status = "COLLECTING";
  else if (!gates.n_ok || !gates.blocks_ok) status = "INCONCLUSIVE";
  else if (!gates.delta_ok || !gates.upper_ok) status = "RETAIN_CHAMPION";
  else status = "READY_TO_REVIEW";
  const mean = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, v) => a + v, 0) / xs.length);
  return {
    cohort_id: opts.cohortId,
    protocol_sha256: protocolHash(protocol),
    manifest_status: protocol.status,
    evaluator_version: COHORT_EVALUATOR_VERSION,
    report_cutoff_utc: opts.reportCutoffUtc,
    window_closed: opts.windowClosed,
    status,
    pairs: n,
    blocks: bootstrap?.nBlocks ?? 0,
    mean_delta_ll: meanDelta,
    bootstrap,
    mean_brier_champion: mean(pairs.map((p) => p.brier_champion)),
    mean_brier_candidate: mean(pairs.map((p) => p.brier_candidate)),
    gates,
    reliability_champion: reliabilityBins(pairs, (p) => p.champ_probs),
    reliability_candidate: reliabilityBins(pairs, (p) => p.cand_probs),
    delta_by_marker: groupDelta(pairs, (p) => p.champion_marker ?? "(missing)"),
    delta_by_lead_bucket: groupDelta(pairs, (p) => leadBucketLabel(p.lead_seconds, protocol)),
    delta_by_competition: groupDelta(pairs, (p) => p.competition_id ?? "(null)"),
  };
}

export interface CohortOperationsReport {
  latest_gradings: number;
  by_status: Record<string, number>;
  by_reason: Record<string, number>;
  unique_fixtures: number;
}

/**
 * Grading TERBARU per prediksi MILIK SATU KOHOR yang tersedia pada
 * cutoff laporan. Filter cohort_id wajib: tanpa itu laporan satu kohor
 * membaca grading kohor lain di DB shadow yang sama (§3.1).
 */
export function latestGradingsAsOf(shadowDb: DatabaseSync, reportCutoffUtc: string, cohortId: string): CohortGradingRow[] {
  const rows = shadowDb
    .prepare("SELECT * FROM cohort_gradings WHERE cohort_id = ? AND graded_at_utc <= ? ORDER BY prediction_id, edition")
    .all(cohortId, reportCutoffUtc) as unknown as CohortGradingRow[];
  const latest = new Map<number, CohortGradingRow>();
  for (const r of rows) latest.set(r.prediction_id, r);
  return [...latest.values()];
}

/**
 * Inti pembangunan evaluasi dari SATU SET baris grading yang sudah
 * dipilih pemanggil (terbaru-pada-cutoff, atau set beku satu laporan).
 * Dipakai bersama oleh evaluateCohortFromDb dan recomputeFrozenReport
 * supaya kedua jalur menghitung dengan cara yang persis sama.
 */
function buildEvaluationFromGradings(
  shadowDb: DatabaseSync,
  latest: CohortGradingRow[],
  protocol: CohortProtocol,
  opts: { cohortId: string; reportCutoffUtc: string; asOfUtc: string },
): { evaluation: CohortEvaluation; operations: CohortOperationsReport; pairs: CohortPair[] } {
  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const uniqueFixtures = new Set<string>();
  for (const g of latest) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
    if (g.reason) byReason[g.reason] = (byReason[g.reason] ?? 0) + 1;
    uniqueFixtures.add(g.fixture_uid);
  }
  const predById = new Map<number, CohortPredictionRow>();
  for (const p of shadowDb.prepare("SELECT * FROM predictions").all() as unknown as CohortPredictionRow[]) {
    predById.set(p.id, p);
  }
  const pairs: CohortPair[] = [];
  for (const g of latest) {
    if (g.status !== "graded" || g.stratum !== "primary") continue;
    const pred = predById.get(g.prediction_id);
    if (!pred || g.ll_champion === null || g.ll_candidate === null || g.delta_ll === null ||
        g.brier_champion === null || g.brier_candidate === null || g.outcome_index === null || g.block_key === null) {
      continue;
    }
    pairs.push({
      fixture_uid: g.fixture_uid,
      kickoff_utc: pred.kickoff_utc,
      competition_id: pred.competition_id,
      champion_marker: pred.champion_ratings_marker,
      lead_seconds: pred.lead_seconds,
      outcome_index: g.outcome_index,
      ll_champion: g.ll_champion,
      ll_candidate: g.ll_candidate,
      brier_champion: g.brier_champion,
      brier_candidate: g.brier_candidate,
      delta_ll: g.delta_ll,
      block_key: g.block_key,
      champ_probs: [pred.champ_p_h, pred.champ_p_d, pred.champ_p_a],
      cand_probs: [pred.cand_p_h, pred.cand_p_d, pred.cand_p_a],
    });
  }
  const windowClosed =
    protocol.window.grading_cutoff !== null && opts.asOfUtc >= protocol.window.grading_cutoff;
  const evaluation = evaluatePairs(pairs, protocol, {
    cohortId: opts.cohortId,
    reportCutoffUtc: opts.reportCutoffUtc,
    windowClosed,
  });
  return {
    evaluation,
    operations: {
      latest_gradings: latest.length,
      by_status: byStatus,
      by_reason: byReason,
      unique_fixtures: uniqueFixtures.size,
    },
    pairs,
  };
}

/**
 * Bangun pasangan primer + laporan operasi dari DB shadow pada cutoff
 * laporan: set grading yang dipakai adalah edisi TERBARU per prediksi
 * yang tersedia pada cutoff itu. Dengan `persist`, laporan + set baris
 * grading persisnya dibekukan ke cohort_reports/cohort_report_gradings
 * (snapshot formal §3.3) — dari set beku itulah laporan dapat dihitung
 * ulang secara identik sesudah koreksi (recomputeFrozenReport).
 */
export function evaluateCohortFromDb(
  shadowDb: DatabaseSync,
  protocol: CohortProtocol,
  opts: { cohortId: string; reportCutoffUtc: string; asOfUtc: string; persist?: boolean },
): { evaluation: CohortEvaluation; operations: CohortOperationsReport; pairs: CohortPair[] } {
  ensureCohortGradingSchema(shadowDb);
  const latest = latestGradingsAsOf(shadowDb, opts.reportCutoffUtc, opts.cohortId);
  const built = buildEvaluationFromGradings(shadowDb, latest, protocol, opts);
  if (opts.persist) {
    const res = shadowDb
      .prepare(
        "INSERT INTO cohort_reports (cohort_id, protocol_sha256, report_cutoff_utc, created_utc, evaluator_version, report_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        opts.cohortId,
        built.evaluation.protocol_sha256,
        opts.reportCutoffUtc,
        opts.asOfUtc,
        COHORT_EVALUATOR_VERSION,
        canonicalJson({ evaluation: built.evaluation, operations: built.operations }),
      );
    // Snapshot grading formal: baris grading persis yang dipakai
    // laporan ini dibekukan per report_id.
    const reportId = Number(res.lastInsertRowid);
    const insSnap = shadowDb.prepare(
      "INSERT INTO cohort_report_gradings (report_id, cohort_id, prediction_id, grading_id, edition, status, delta_ll) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const g of latest) {
      insSnap.run(reportId, opts.cohortId, g.prediction_id, g.id, g.edition, g.status, g.delta_ll);
    }
  }
  return built;
}

export interface FrozenReportRecompute {
  report_id: number;
  cohort_id: string;
  protocol_sha256: string;
  report_cutoff_utc: string;
  created_utc: string;
  /** report_json persis seperti tersimpan saat laporan dibekukan. */
  stored_report_json: string;
  evaluation: CohortEvaluation;
  operations: CohortOperationsReport;
  pairs: CohortPair[];
}

/**
 * Hitung ulang SATU laporan beku dari set baris grading yang dibekukan
 * bersamanya (cohort_report_gradings), BUKAN dari edisi terbaru saat
 * ini (Brief Validasi Rilis §4.3). Edisi grading yang ditulis sesudah
 * laporan — termasuk edisi milik cutoff grading berikutnya — tidak
 * dapat mengubah hasil hitung ulang ini; evaluasi yang dihasilkan
 * harus identik dengan report_json tersimpan.
 */
export function recomputeFrozenReport(
  shadowDb: DatabaseSync,
  reportId: number,
  protocol: CohortProtocol,
): FrozenReportRecompute | null {
  ensureCohortGradingSchema(shadowDb);
  const report = shadowDb
    .prepare("SELECT id, cohort_id, protocol_sha256, report_cutoff_utc, created_utc, report_json FROM cohort_reports WHERE id = ?")
    .get(reportId) as unknown as {
      id: number; cohort_id: string; protocol_sha256: string; report_cutoff_utc: string; created_utc: string; report_json: string;
    } | undefined;
  if (!report) return null;
  const frozenIds = shadowDb
    .prepare("SELECT grading_id FROM cohort_report_gradings WHERE report_id = ? ORDER BY prediction_id")
    .all(reportId) as unknown as { grading_id: number }[];
  let gradings: CohortGradingRow[] = [];
  if (frozenIds.length > 0) {
    const placeholders = frozenIds.map(() => "?").join(", ");
    gradings = shadowDb
      .prepare(`SELECT * FROM cohort_gradings WHERE id IN (${placeholders}) ORDER BY prediction_id, edition`)
      .all(...frozenIds.map((r) => r.grading_id)) as unknown as CohortGradingRow[];
  }
  const built = buildEvaluationFromGradings(shadowDb, gradings, protocol, {
    cohortId: report.cohort_id,
    reportCutoffUtc: report.report_cutoff_utc,
    asOfUtc: report.created_utc,
  });
  return {
    report_id: report.id,
    cohort_id: report.cohort_id,
    protocol_sha256: report.protocol_sha256,
    report_cutoff_utc: report.report_cutoff_utc,
    created_utc: report.created_utc,
    stored_report_json: report.report_json,
    ...built,
  };
}

// ============================================================================
// Funnel + coverage (§3) dan hitungan preflight (§2D)
// ============================================================================
export interface CohortFunnel {
  scheduled_in_scope: number | null;
  stored_predictions: number;
  gap_no_prediction: number | null;
  graded: number;
  pending: number;
  void: number;
  invalid: number;
  identity_doubtful: number;
  evidence_issues: number;
  diagnostic: number;
  lead_buckets: Record<string, number>;
  coverage_by_competition: Record<string, number>;
  coverage_by_marker: Record<string, number>;
  coverage_by_feature_code_version: Record<string, number>;
  missed_batches: { expected_days: number; actual_days: number; missed: number } | null;
}

export function computeCohortFunnel(
  shadowDb: DatabaseSync,
  dataset: DatabaseSync,
  protocol: CohortProtocol,
  reportCutoffUtc: string,
  cohortId: string,
): CohortFunnel {
  ensureCohortGradingSchema(shadowDb);
  const { t0, t1 } = { t0: protocol.window.t0, t1: protocol.window.t1 };
  let scheduled: number | null = null;
  if (t0 !== null && t1 !== null) {
    // Penyebut funnel = fixture terjadwal dalam ALLOWLIST manifest
    // (§3.3), bukan seluruh katalog.
    const allow = protocol.competitive_primary.list.map((e) => e.competition_id);
    if (allow.length === 0) {
      scheduled = 0;
    } else {
      const placeholders = allow.map(() => "?").join(", ");
      const row = dataset
        .prepare(
          `SELECT COUNT(*) AS n FROM canonical_fixtures WHERE kickoff_utc >= ? AND kickoff_utc < ? AND competition_id IN (${placeholders})`,
        )
        .get(t0, t1, ...allow) as unknown as { n: number };
      scheduled = Number(row.n);
    }
  }
  const preds = shadowDb.prepare("SELECT * FROM predictions WHERE horizon_id = ?").all(protocol.study.horizon_id) as unknown as CohortPredictionRow[];
  const inWindow = preds.filter(
    (p) => t0 === null || t1 === null || (p.kickoff_utc >= t0 && p.kickoff_utc < t1 && p.decision_at_utc >= t0),
  );
  const latest = latestGradingsAsOf(shadowDb, reportCutoffUtc, cohortId);
  const countStatus = (statuses: string[]): number => latest.filter((g) => statuses.includes(g.status)).length;
  const leadBuckets: Record<string, number> = {};
  const byComp: Record<string, number> = {};
  const byMarker: Record<string, number> = {};
  for (const p of inWindow) {
    const b = leadBucketLabel(p.lead_seconds, protocol);
    leadBuckets[b] = (leadBuckets[b] ?? 0) + 1;
    const c = p.competition_id ?? "(null)";
    byComp[c] = (byComp[c] ?? 0) + 1;
    const m = p.champion_ratings_marker ?? "(missing)";
    byMarker[m] = (byMarker[m] ?? 0) + 1;
  }
  const byFeatureVersion: Record<string, number> = {};
  for (const r of shadowDb
    .prepare(
      `SELECT fs.feature_code_version AS v, COUNT(*) AS n FROM predictions p
       JOIN feature_snapshots fs ON fs.feature_snapshot_id = p.feature_snapshot_id
       WHERE p.horizon_id = ? GROUP BY fs.feature_code_version`,
    )
    .all(protocol.study.horizon_id) as unknown as { v: string; n: number }[]) {
    byFeatureVersion[r.v] = Number(r.n);
  }
  let missed: CohortFunnel["missed_batches"] = null;
  if (t0 !== null && t1 !== null) {
    const snapDays = new Set(
      (shadowDb.prepare("SELECT DISTINCT substr(decision_at_utc, 1, 10) AS d FROM feature_snapshots").all() as unknown as { d: string }[]).map((r) => r.d),
    );
    const start = Date.parse(t0);
    const end = Math.min(Date.parse(t1), Date.parse(reportCutoffUtc));
    let expected = 0;
    for (let ms = start; ms < end; ms += 24 * 3600 * 1000) expected++;
    const actual = [...snapDays].filter((d) => {
      const ms = Date.parse(`${d}T00:00:00.000Z`);
      return ms >= start && ms < end;
    }).length;
    missed = { expected_days: expected, actual_days: actual, missed: Math.max(0, expected - actual) };
  }
  return {
    scheduled_in_scope: scheduled,
    stored_predictions: inWindow.length,
    gap_no_prediction: scheduled === null ? null : Math.max(0, scheduled - inWindow.length),
    graded: countStatus(["graded"]),
    pending: countStatus(["pending"]),
    void: countStatus(["void"]),
    invalid: countStatus(["invalid"]),
    identity_doubtful: countStatus(["identity_conflict"]) +
      latest.filter((g) => g.status === "pending" && (g.reason ?? "").startsWith("identity_")).length,
    evidence_issues: countStatus(["evidence_invalid", "proof_conflict"]),
    diagnostic: countStatus(["diagnostic"]),
    lead_buckets: leadBuckets,
    coverage_by_competition: byComp,
    coverage_by_marker: byMarker,
    coverage_by_feature_code_version: byFeatureVersion,
    missed_batches: missed,
  };
}

/**
 * Funnel marker preflight dengan PENYEBUT LAGA FISIK (Brief Validasi
 * Rilis §4.4, menggantikan penghitungan per baris katalog §3.4).
 *
 * Versi sebelumnya menghitung BARIS upcoming_fixtures: satu laga fisik
 * dengan dua alias terhitung dua kali (fixture brief: 2 alias + 1 laga
 * batal → scheduled=3, primary_marker=2), dan laga batal ikut
 * penyebut. Versi ini memakai ulang seleksi as-of KOLEKTOR:
 *  - komponen alias transitif yang sama dengan preparePitCandidates
 *    (sibling store identitas + grup fixture-links + bridge sm_id_map)
 *    → satu komponen = satu laga fisik;
 *  - status dari fixture kanonik (state) + status baris katalog,
 *    semantik checkPitEligibility: non-scheduled tidak masuk penyebut;
 *  - edisi paket dari selectPackagesAsOf (selector as-of PIT yang
 *    sama), pemenang antar-alias diurutkan computed DESC, id DESC
 *    seperti pemenang grup kolektor.
 * Penyebut = laga fisik terjadwal (bukan batal / bukan konflik jadwal /
 * identitas terbukti) DALAM ALLOWLIST. Bucket eksklusi dilaporkan
 * terpisah dengan prioritas: cancelled → identity_unresolved →
 * schedule_conflict → other_state (satu laga masuk tepat satu bucket).
 */
export interface MarkerFunnelLeague {
  competition_id: string;
  /** Laga fisik dalam horizon untuk kompetisi ini. */
  physical: number;
  cancelled: number;
  identity_unresolved: number;
  schedule_conflict: number;
  other_state: number;
  /** Penyebut: laga fisik terjadwal yang lolos semua bucket eksklusi. */
  scheduled: number;
  with_package: number;
  primary_marker: number;
  other_marker: number;
  no_package: number;
}

export interface MarkerFunnelTotals {
  scheduled: number;
  with_package: number;
  primary_marker: number;
  other_marker: number;
  no_package: number;
}

export interface MarkerFunnel {
  as_of_utc: string;
  horizon_seconds: number;
  primary_marker: string;
  /** Baris katalog mentah dalam horizon (sebelum pelipatan alias). */
  catalog_rows: number;
  /** Laga fisik sesudah pelipatan alias. */
  physical_matches: number;
  /** Baris katalog ekstra yang terlipat ke laga fisik yang sama. */
  alias_duplicate_rows: number;
  buckets: { cancelled: number; identity_unresolved: number; schedule_conflict: number; other_state: number };
  leagues: MarkerFunnelLeague[];
  /** Total atas penyebut ALLOWLIST saja. */
  totals: MarkerFunnelTotals;
  /** Total atas penyebut semua kompetisi. */
  totals_all: MarkerFunnelTotals;
  /** Distribusi marker atas paket pemenang penyebut allowlist. */
  marker_distribution_asof: { marker: string | null; packages: number }[];
  /** Laga fisik penyebut allowlist tanpa paket terpilih (UID bila ada). */
  fixtures_without_package: string[];
  fixtures_other_marker: { match_id: string; competition_id: string | null; marker: string | null }[];
}

export function computeMarkerFunnel(
  snapshotsDb: DatabaseSync,
  upcomingDb: DatabaseSync,
  datasetDb: DatabaseSync,
  opts: { asOfUtc: string; horizonSeconds: number; primaryMarker: string; allowlist: string[]; dataDirPath: string },
): MarkerFunnel {
  const asOfMs = parseInstant(opts.asOfUtc);
  if (asOfMs === null) throw new Error(`ML1-KOHOR: as-of preflight tidak valid: ${opts.asOfUtc}`);
  const horizonEndMs = asOfMs + opts.horizonSeconds * 1000;
  const allow = new Set(opts.allowlist);
  const catalog = upcomingDb
    .prepare("SELECT match_id, competition_id, utc_date, status FROM upcoming_fixtures ORDER BY utc_date, match_id")
    .all() as unknown as { match_id: string; competition_id: string | null; utc_date: string; status: string | null }[];
  const inHorizon = catalog.filter((f) => {
    const ms = parseKickoff(f.utc_date) ?? parseInstant(f.utc_date);
    return ms !== null && ms > asOfMs && ms <= horizonEndMs;
  });
  const rowById = new Map(inHorizon.map((f) => [f.match_id, f]));

  // --- Komponen alias transitif (semantik preparePitCandidates) -------
  const identityReady = identityTablesExist(datasetDb);
  const linkGroups = readPitBLinks(opts.dataDirPath).groups;
  const aliasCache = new Map<string, string[]>();
  const aliasSetOf = (matchId: string): string[] => {
    const hit = aliasCache.get(matchId);
    if (hit) return hit;
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (id: string | null | undefined): void => {
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    };
    push(matchId);
    if (identityReady) for (const id of getSiblingIds(datasetDb, matchId)) push(id);
    for (const id of linkSiblingsOf(linkGroups, matchId)) push(id);
    for (const id of bridgeIdsOf(upcomingDb, matchId)) push(id);
    aliasCache.set(matchId, ordered);
    return ordered;
  };
  const components: Set<string>[] = [];
  {
    const assigned = new Set<string>();
    for (const f of inHorizon) {
      if (assigned.has(f.match_id)) continue;
      const comp = new Set<string>();
      const queue = [f.match_id];
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
  const uidCache = new Map<string, string | null>();
  const uidOf = (matchId: string): string | null => {
    if (!identityReady) return null;
    const hit = uidCache.get(matchId);
    if (hit !== undefined) return hit;
    const uid = getUidForMatchId(datasetDb, matchId);
    uidCache.set(matchId, uid);
    return uid;
  };

  // --- Seleksi edisi as-of kolektor (dipakai ulang apa adanya) ---------
  const { selectedRaw } = selectPackagesAsOf(snapshotsDb, asOfMs, opts.asOfUtc);

  const emptyLeague = (competition_id: string): MarkerFunnelLeague => ({
    competition_id, physical: 0, cancelled: 0, identity_unresolved: 0, schedule_conflict: 0,
    other_state: 0, scheduled: 0, with_package: 0, primary_marker: 0, other_marker: 0, no_package: 0,
  });
  const byLeague = new Map<string, MarkerFunnelLeague>();
  const buckets = { cancelled: 0, identity_unresolved: 0, schedule_conflict: 0, other_state: 0 };
  const markerDist = new Map<string | null, number>();
  const withoutPackage: string[] = [];
  const otherMarker: { match_id: string; competition_id: string | null; marker: string | null }[] = [];
  let physicalMatches = 0;

  for (const comp of components) {
    const rows = [...comp].filter((id) => rowById.has(id)).map((id) => rowById.get(id) as (typeof inHorizon)[number]);
    if (rows.length === 0) continue;
    physicalMatches++;
    const uidSet = new Set<string>();
    for (const id of comp) {
      const u = uidOf(id);
      if (u) uidSet.add(u);
    }
    const uid = uidSet.size === 1 ? [...uidSet][0] : null;
    const canonical = uid !== null ? getFixtureByUid(datasetDb, uid) : null;
    const competition = canonical?.competition_id ?? rows[0].competition_id ?? "(null)";
    const league = byLeague.get(competition) ?? emptyLeague(competition);
    byLeague.set(competition, league);
    league.physical++;

    // Bucket eksklusi (prioritas tetap, satu laga = satu bucket).
    const rowStatus = (r: (typeof rows)[number]): string => (typeof r.status === "string" ? r.status.trim().toLowerCase() : "");
    const isCancelled =
      canonical?.state === "cancelled" || rows.some((r) => rowStatus(r) === "cancelled" || rowStatus(r) === "canceled");
    let exclusion: keyof typeof buckets | null = null;
    if (isCancelled) exclusion = "cancelled";
    else if (uid === null) exclusion = "identity_unresolved";
    else {
      const rowKickoffs = new Set(rows.map((r) => parseKickoff(r.utc_date) ?? parseInstant(r.utc_date)));
      let conflict = rowKickoffs.size > 1;
      if (!conflict && canonical?.kickoff_utc) {
        if (canonical.kickoff_precision === "date_only") {
          const cfDate = canonical.kickoff_utc.slice(0, 10);
          conflict = rows.some((r) => (r.utc_date ?? "").slice(0, 10) !== cfDate);
        } else {
          const cfMs = parseInstant(canonical.kickoff_utc);
          conflict = cfMs === null || rows.some((r) => (parseKickoff(r.utc_date) ?? parseInstant(r.utc_date)) !== cfMs);
        }
      }
      if (conflict) exclusion = "schedule_conflict";
      else if (
        (canonical !== null && canonical.state !== "scheduled") ||
        rows.some((r) => rowStatus(r) !== "" && rowStatus(r) !== "scheduled")
      ) {
        exclusion = "other_state";
      }
    }
    if (exclusion !== null) {
      buckets[exclusion]++;
      league[exclusion]++;
      continue;
    }

    // Laga fisik terjadwal → penyebut. Paket: pemenang antar-alias dari
    // edisi terpilih as-of (computed DESC, id paket DESC — semantik
    // pemenang grup kolektor).
    league.scheduled++;
    let winner: { id: number; marker: string | null; computedMs: number } | null = null;
    for (const id of comp) {
      const raw = selectedRaw.get(id);
      if (!raw) continue;
      const ms = parseInstant(raw.computed_utc);
      if (ms === null) continue;
      if (winner === null || ms > winner.computedMs || (ms === winner.computedMs && raw.id > winner.id)) {
        winner = { id: raw.id, marker: raw.ratings_marker, computedMs: ms };
      }
    }
    const inAllowlist = allow.has(competition);
    if (winner === null) {
      league.no_package++;
      if (inAllowlist) withoutPackage.push(uid ?? rows[0].match_id);
    } else {
      league.with_package++;
      if (inAllowlist) markerDist.set(winner.marker, (markerDist.get(winner.marker) ?? 0) + 1);
      if (winner.marker === opts.primaryMarker) {
        league.primary_marker++;
      } else {
        league.other_marker++;
        if (inAllowlist) otherMarker.push({ match_id: uid ?? rows[0].match_id, competition_id: competition, marker: winner.marker });
      }
    }
  }

  const leagues = [...byLeague.values()].sort((a, b) => b.physical - a.physical || (a.competition_id < b.competition_id ? -1 : 1));
  const sumTotals = (rows: MarkerFunnelLeague[]): MarkerFunnelTotals =>
    rows.reduce(
      (acc, l) => ({
        scheduled: acc.scheduled + l.scheduled,
        with_package: acc.with_package + l.with_package,
        primary_marker: acc.primary_marker + l.primary_marker,
        other_marker: acc.other_marker + l.other_marker,
        no_package: acc.no_package + l.no_package,
      }),
      { scheduled: 0, with_package: 0, primary_marker: 0, other_marker: 0, no_package: 0 },
    );
  return {
    as_of_utc: opts.asOfUtc,
    horizon_seconds: opts.horizonSeconds,
    primary_marker: opts.primaryMarker,
    catalog_rows: inHorizon.length,
    physical_matches: physicalMatches,
    alias_duplicate_rows: inHorizon.length - physicalMatches,
    buckets,
    leagues,
    totals: sumTotals(leagues.filter((l) => allow.has(l.competition_id))),
    totals_all: sumTotals(leagues),
    marker_distribution_asof: [...markerDist.entries()]
      .map(([marker, packages]) => ({ marker, packages }))
      .sort((a, b) => b.packages - a.packages),
    fixtures_without_package: withoutPackage,
    fixtures_other_marker: otherMarker,
  };
}

/**
 * Hitung baris skor anomali pada input hasil historis (§2D): baris
 * finished yang skornya BUKAN dua integer nonnegatif (negatif, pecahan,
 * atau NULL). Hanya dua integer nonnegatif yang boleh dipakai fitur /
 * outcome.
 */
export function countAnomalousScores(dataset: DatabaseSync): {
  finished_rows: number;
  anomalous_rows: number;
  examples: { match_id: string; home_score: unknown; away_score: unknown }[];
} {
  const rows = dataset
    .prepare("SELECT match_id, home_score, away_score FROM matches WHERE status = 'finished'")
    .all() as unknown as { match_id: string; home_score: number | null; away_score: number | null }[];
  let anomalous = 0;
  const examples: { match_id: string; home_score: unknown; away_score: unknown }[] = [];
  for (const r of rows) {
    if (!isNonNegInt(r.home_score) || !isNonNegInt(r.away_score)) {
      anomalous++;
      if (examples.length < 10) examples.push({ match_id: r.match_id, home_score: r.home_score, away_score: r.away_score });
    }
  }
  return { finished_rows: rows.length, anomalous_rows: anomalous, examples };
}

/**
 * Hitungan arsip yatim (§2D): file proyeksi di direktori yang tidak
 * direferensikan baris feature_snapshots mana pun. Hanya DILAPORKAN —
 * pembersihan mengikuti kebijakan menjaga proyeksi yang masih
 * direferensikan dan tidak dilakukan fungsi ini.
 */
export function countOrphanProjections(
  shadowDb: DatabaseSync,
  projectionDir: string,
  fsLike: { existsSync: (p: string) => boolean; readdirSync: (p: string) => string[] },
  pathJoin: (...parts: string[]) => string,
): { files_total: number; referenced: number; orphans: number; orphan_files: string[] } {
  const referenced = new Set(
    (shadowDb.prepare("SELECT projection_file FROM feature_snapshots").all() as unknown as { projection_file: string }[]).map(
      (r) => r.projection_file,
    ),
  );
  if (!fsLike.existsSync(projectionDir)) {
    return { files_total: 0, referenced: referenced.size, orphans: 0, orphan_files: [] };
  }
  const files = fsLike.readdirSync(projectionDir).filter((f) => f.startsWith("pitb-projection-") && f.endsWith(".jsonl.gz"));
  const orphanFiles = files.filter((f) => !referenced.has(f));
  void pathJoin;
  return { files_total: files.length, referenced: referenced.size, orphans: orphanFiles.length, orphan_files: orphanFiles };
}
