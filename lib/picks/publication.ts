import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  computeAgreementSpread,
  getPicksDb,
  type PickMarket,
} from "./ledger";
import {
  getPackagesDb,
  writePackage,
  type PackageTrigger,
} from "./packages";
import {
  normalizeMatchStatus,
  SETTLEMENT_POLICY_VERSION,
} from "../identity/fixture-resolver";

// ============================================================================
// PUBLIKASI RESMI — pilihan yang BEKU saat terbit (PRD bab Data D3, kartu K2)
// ----------------------------------------------------------------------------
// Jalur tulis resmi: slate → paket → ledger, dengan identitas operasi yang
// stabil dan validasi cutoff pada SAAT COMMIT (bukan saat perhitungan mulai).
//
// Alur dua fase (begin → commit) supaya crash di tengah bisa dilanjutkan:
//   1. beginPublication — simpan INTENT (operation_key stabil dari seri +
//      fixture + cutoff terjadwal + fingerprint input) di picks.db, lalu
//      tulis paket ke store paket dengan unique computation key
//      (match_id, trigger, computed_utc) yang deterministik per operasi.
//      Retry menemukan paket yang sama persis.
//   2. commitPublication — SATU transaksi picks.db: lock writer diambil
//      DULU, lalu di dalam lock dibaca keadaan fixture terkini + jam
//      aktual; bacaan jam terakhir itulah nilai verifikasi akhir yang
//      memutuskan cutoff (decision_at ≤ published_at < kickoff, status
//      fixture masih scheduled) SEKALIGUS menjadi cap published_at
//      (review K8 butir 3A — jam statis tangkapan pemanggil tidak pernah
//      cukup, karena waktu bisa melewati kickoff selagi commit menunggu
//      lock atau membaca keadaan). Lalu verifikasi identitas + hash
//      paket, tulis baris pilihan beku, tandai intent committed. Crash
//      sesudah commit → retry mengenali operation key yang sudah sukses
//      dan mengembalikan pick yang sama.
//
// Satu pilihan resmi = keputusan PERTAMA dalam seri produksi pada
// (fixture_uid, market, line, selection, series). Baris resmi berikutnya
// untuk kunci yang sama tidak pernah menimpa yang pertama — ia memakai
// id yang sudah ada. Indeks unik parsial menegakkan ini di level DB.
//
// Angka terbit dibekukan di baris pilihan: published_prob =
// effective_prob ?? model_prob dari nilai yang VALID saat terbit. Nilai
// efektif yang tersedia tetapi invalid TIDAK diganti diam-diam: baris
// terbit dengan published_prob NULL, basis 'invalid_effective', dan
// penanda kesalahan input. Nol adalah nilai sah.
// ============================================================================

/** Versi kebijakan grade yang membekukan ambang engine saat ini. */
export const GRADE_POLICY_VERSION = "market-grade-thresholds-2026-11";
export { SETTLEMENT_POLICY_VERSION };

export type ProbabilityBasis =
  | "effective"
  | "model"
  | "invalid_effective"
  | "unknown_legacy";

/** Label publik untuk baris tanpa bukti peluang terbit (PRD D06). */
export const UNRECORDED_PROB_LABEL = "Peluang terbit tidak tercatat";

// ---------------------------------------------------------------------------
// Skema aditif (idempoten; pola yang sama dengan migrasi kolom ledger lama)
// ---------------------------------------------------------------------------

const PICK_PUBLICATION_COLUMNS: { name: string; ddl: string }[] = [
  { name: "pick_uid", ddl: "TEXT" },
  { name: "fixture_uid", ddl: "TEXT" },
  { name: "line", ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: "series", ddl: "TEXT" },
  { name: "package_key", ddl: "TEXT" },
  { name: "package_hash", ddl: "TEXT" },
  { name: "decision_at_utc", ddl: "TEXT" },
  { name: "published_at_utc", ddl: "TEXT" },
  { name: "kickoff_at_issue_utc", ddl: "TEXT" },
  { name: "model_version", ddl: "TEXT" },
  { name: "ratings_hash", ddl: "TEXT" },
  { name: "grade_policy_version", ddl: "TEXT" },
  { name: "settlement_policy_version", ddl: "TEXT" },
  { name: "code_sha", ddl: "TEXT" },
  { name: "input_snapshot_id", ddl: "TEXT" },
  { name: "published_prob", ddl: "REAL" },
  { name: "probability_basis", ddl: "TEXT" },
  { name: "published_error", ddl: "TEXT" },
  { name: "evidence_quality", ddl: "TEXT" },
  { name: "evidence_source", ddl: "TEXT" },
  { name: "evidence_age_sec", ddl: "INTEGER" },
  { name: "odds_bookmaker", ddl: "TEXT" },
  { name: "odds_period", ddl: "TEXT" },
  { name: "odds_line", ddl: "TEXT" },
  { name: "odds_decimal", ddl: "REAL" },
  { name: "odds_captured_utc", ddl: "TEXT" },
  { name: "odds_note", ddl: "TEXT" },
  { name: "duplicate_of", ddl: "INTEGER" },
];

export function ensurePublicationSchema(db: DatabaseSync): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(picks)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  for (const col of PICK_PUBLICATION_COLUMNS) {
    if (!cols.has(col.name)) {
      db.exec(`ALTER TABLE picks ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS publication_intents (
      operation_key TEXT PRIMARY KEY,
      series TEXT NOT NULL,
      fixture_uid TEXT,
      source_match_id TEXT NOT NULL,
      competition_canonical_id TEXT,
      kickoff_utc TEXT NOT NULL,
      scheduled_cutoff_utc TEXT NOT NULL,
      decision_at_utc TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      input_json TEXT NOT NULL,
      package_computed_utc TEXT,
      package_key TEXT,
      package_id INTEGER,
      package_hash TEXT,
      state TEXT NOT NULL DEFAULT 'intent'
        CHECK (state IN ('intent','package_written','committed','rejected_cutoff','failed')),
      detail TEXT,
      published_pick_ids TEXT,
      created_utc TEXT NOT NULL,
      updated_utc TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_pick_uid
      ON picks(pick_uid) WHERE pick_uid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_picks_official_series
      ON picks(fixture_uid, market, line, selection, series)
      WHERE pick_uid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_picks_fixture_uid ON picks(fixture_uid);
    CREATE INDEX IF NOT EXISTS idx_picks_published_at ON picks(published_at_utc);
  `);
}

// ---------------------------------------------------------------------------
// Identitas: line kanonik, fingerprint, operation key
// ---------------------------------------------------------------------------

/**
 * Line kanonik per pasar. Pasar repo ini mengodekan garis di nama pasar
 * (ou15/ou25/ou35, team_over05_*) sehingga line-nya pasti; pasar tanpa
 * garis memakai nilai kanonik '' (bukan NULL — indeks UNIQUE SQLite
 * melonggar pada NULL).
 */
export function canonicalLineFor(market: string, line?: string | null): string {
  switch (market) {
    case "ou15":
      return "1.5";
    case "ou25":
      return "2.5";
    case "ou35":
      return "3.5";
    default:
      return line?.trim() ?? "";
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Tipe input publikasi
// ---------------------------------------------------------------------------

export interface OddsSnapshot {
  source: string; // 'book' | 'archived_panel' | …
  /** 'prematch' | 'closing' | 'probability' (panel) */
  type: string;
  available_utc: string;
  bookmaker?: string | null;
  line?: string | null;
  /** Harga desimal untuk snapshot harga; null pada snapshot probabilitas. */
  decimal?: number | null;
  /** Probabilitas untuk snapshot panel; null pada snapshot harga. */
  prob?: number | null;
}

export interface PublishLegInput {
  market: PickMarket;
  selection: string;
  line?: string | null;
  model_prob: number;
  effective_prob?: number | null;
  effective_source?: string | null;
  market_prob?: number | null;
  sm_prob?: number | null;
  grade?: string | null;
  gate_status?: string | null;
  evidence_quality?: string | null;
  odds_snapshots?: OddsSnapshot[];
}

export interface PublishPackageInput {
  trigger: PackageTrigger;
  /** Identitas komputasi; default = decision_at_utc operasi. */
  computed_utc?: string;
  fit_source?: string | null;
  gate_status?: string | null;
  cup_delta?: number | null;
  ratings_marker?: string | null;
  odds_captured_utc?: string | null;
  bookmakers?: string[] | null;
  predictions_batch_utc?: string | null;
  lambda?: number | null;
  mu?: number | null;
  rho?: number | null;
  payload: unknown;
  provenance?: Record<string, unknown> | null;
}

export interface PublishFixtureInput {
  /** Seri produksi; kolom source ledger diisi dari nilai ini. */
  series: string;
  source_match_id: string;
  fixture_uid?: string | null;
  competition_canonical_id?: string | null;
  kickoff_utc: string;
  /** Cutoff terjadwal operasi (mis. awal jendela run slate). */
  scheduled_cutoff_utc: string;
  /** Batas informasi: waktu keputusan/computation selesai. */
  decision_at_utc: string;
  model_version?: string | null;
  ratings_hash?: string | null;
  code_sha?: string | null;
  input_snapshot_id?: string | null;
  package: PublishPackageInput;
  legs: PublishLegInput[];
}

export interface IntentRow {
  operation_key: string;
  series: string;
  fixture_uid: string | null;
  source_match_id: string;
  kickoff_utc: string;
  scheduled_cutoff_utc: string;
  decision_at_utc: string;
  input_fingerprint: string;
  package_computed_utc: string | null;
  package_key: string | null;
  package_id: number | null;
  package_hash: string | null;
  state: string;
  detail: string | null;
  published_pick_ids: string | null;
  created_utc: string;
  updated_utc: string;
}

interface StoredInput extends PublishFixtureInput {
  package: PublishPackageInput & { computed_utc: string };
}

function fingerprintOf(input: PublishFixtureInput, computedUtc: string): string {
  return sha256(
    stableStringify({
      series: input.series,
      source_match_id: input.source_match_id,
      fixture_uid: input.fixture_uid ?? null,
      kickoff_utc: input.kickoff_utc,
      scheduled_cutoff_utc: input.scheduled_cutoff_utc,
      decision_at_utc: input.decision_at_utc,
      package: {
        trigger: input.package.trigger,
        computed_utc: computedUtc,
        payload: input.package.payload,
      },
      legs: input.legs.map((l) => ({
        market: l.market,
        line: canonicalLineFor(l.market, l.line),
        selection: l.selection,
        model_prob: l.model_prob,
        effective_prob: l.effective_prob ?? null,
        market_prob: l.market_prob ?? null,
        sm_prob: l.sm_prob ?? null,
        grade: l.grade ?? null,
        gate_status: l.gate_status ?? null,
        odds_snapshots: l.odds_snapshots ?? [],
      })),
    }),
  );
}

export function operationKeyOf(
  input: PublishFixtureInput,
  fingerprint: string,
): string {
  return sha256(
    `${input.series}|${input.fixture_uid ?? input.source_match_id}|${input.scheduled_cutoff_utc}|${fingerprint}`,
  );
}

export function packageKeyOf(
  matchId: string,
  trigger: string,
  computedUtc: string,
): string {
  return `${matchId}|${trigger}|${computedUtc}`;
}

// ---------------------------------------------------------------------------
// Util transaksi: BEGIN IMMEDIATE dengan retry terbatas atas SQLITE_BUSY —
// dua worker yang menerbitkan kombinasi identik harus terserialisasi,
// bukan saling menggagalkan.
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("database is locked") || msg.includes("SQLITE_BUSY");
}

function beginImmediate(db: DatabaseSync): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (err) {
      if (!isBusy(err) || attempt === 199) throw err;
      sleepSync(25);
    }
  }
}

/** ROLLBACK yang tidak menutupi error asli bila transaksi sudah tertutup. */
function safeRollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* tidak ada transaksi aktif — error asli yang berlaku */
  }
}

function loadIntent(
  db: DatabaseSync,
  operationKey: string,
): IntentRow | null {
  const row = db
    .prepare("SELECT * FROM publication_intents WHERE operation_key = ?")
    .get(operationKey) as IntentRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Fase 1 — begin: intent + paket
// ---------------------------------------------------------------------------

export interface BeginResult {
  operation_key: string;
  state: string;
  package_id: number | null;
  package_key: string | null;
  pick_ids: number[];
}

export function beginPublication(
  input: PublishFixtureInput,
  nowUtc: string,
): BeginResult {
  if (input.legs.length === 0) {
    throw new Error("beginPublication: legs kosong — tidak ada yang diterbitkan");
  }
  for (const leg of input.legs) {
    if (
      !Number.isFinite(leg.model_prob) ||
      leg.model_prob < 0 ||
      leg.model_prob > 1
    ) {
      throw new Error(
        `beginPublication: model_prob invalid untuk ${leg.market}/${leg.selection}: ${leg.model_prob}`,
      );
    }
  }
  const db = getPicksDb();
  ensurePublicationSchema(db);
  db.exec("PRAGMA busy_timeout = 10000");

  const computedUtc = input.package.computed_utc ?? input.decision_at_utc;
  const fingerprint = fingerprintOf(input, computedUtc);
  const operationKey = operationKeyOf(input, fingerprint);
  const packageKey = packageKeyOf(
    input.source_match_id,
    input.package.trigger,
    computedUtc,
  );
  const packageHash = sha256(JSON.stringify(input.package.payload));

  // --- Intent dulu, sebelum pekerjaan apa pun (transaksi pendek).
  beginImmediate(db);
  try {
    const existing = loadIntent(db, operationKey);
    if (existing) {
      if (existing.input_fingerprint !== fingerprint) {
        throw new Error(
          `beginPublication: operation_key ${operationKey} sudah ada dengan fingerprint berbeda`,
        );
      }
      if (
        existing.state === "committed" ||
        existing.state === "rejected_cutoff" ||
        existing.state === "failed"
      ) {
        db.exec("COMMIT");
        return {
          operation_key: operationKey,
          state: existing.state,
          package_id: existing.package_id,
          package_key: existing.package_key,
          pick_ids: existing.published_pick_ids
            ? (JSON.parse(existing.published_pick_ids) as number[])
            : [],
        };
      }
      // State 'intent' / 'package_written': intent sudah ada — lanjut ke
      // fase tulis paket di bawah (idempoten), jalur resume sesudah crash.
    } else {
      const stored: StoredInput = {
        ...input,
        package: { ...input.package, computed_utc: computedUtc },
      };
      db.prepare(
        `INSERT INTO publication_intents
           (operation_key, series, fixture_uid, source_match_id,
            competition_canonical_id, kickoff_utc, scheduled_cutoff_utc,
            decision_at_utc, input_fingerprint, input_json,
            package_computed_utc, package_key, package_hash,
            state, created_utc, updated_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?)`,
      ).run(
        operationKey,
        input.series,
        input.fixture_uid ?? null,
        input.source_match_id,
        input.competition_canonical_id ?? null,
        input.kickoff_utc,
        input.scheduled_cutoff_utc,
        input.decision_at_utc,
        fingerprint,
        JSON.stringify(stored),
        computedUtc,
        packageKey,
        packageHash,
        nowUtc,
        nowUtc,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    safeRollback(db);
    throw err;
  }

  // --- Paket ditulis dengan unique computation key; retry menemukan
  // baris yang sama (writePackage idempoten, payload tidak ditimpa).
  const pkg = writePackage({
    match_id: input.source_match_id,
    competition_canonical_id: input.competition_canonical_id ?? null,
    kickoff_utc: input.kickoff_utc,
    computed_utc: computedUtc,
    trigger: input.package.trigger,
    fit_source: input.package.fit_source ?? null,
    gate_status: input.package.gate_status ?? null,
    cup_delta: input.package.cup_delta ?? null,
    ratings_marker: input.package.ratings_marker ?? null,
    odds_captured_utc: input.package.odds_captured_utc ?? null,
    bookmakers: input.package.bookmakers ?? null,
    predictions_batch_utc: input.package.predictions_batch_utc ?? null,
    lambda: input.package.lambda ?? null,
    mu: input.package.mu ?? null,
    rho: input.package.rho ?? null,
    payload: input.package.payload,
    provenance: input.package.provenance ?? null,
  });

  beginImmediate(db);
  try {
    db.prepare(
      `UPDATE publication_intents
       SET package_id = ?, state = 'package_written', updated_utc = ?
       WHERE operation_key = ? AND state = 'intent'`,
    ).run(pkg.id, nowUtc, operationKey);
    db.exec("COMMIT");
  } catch (err) {
    safeRollback(db);
    throw err;
  }

  const intent = loadIntent(db, operationKey);
  return {
    operation_key: operationKey,
    state: intent?.state ?? "package_written",
    package_id: pkg.id,
    package_key: packageKey,
    pick_ids: intent?.published_pick_ids
      ? (JSON.parse(intent.published_pick_ids) as number[])
      : [],
  };
}

// ---------------------------------------------------------------------------
// Fase 2 — commit: verifikasi + validasi cutoff + tulis pilihan beku
// ---------------------------------------------------------------------------

/** Keadaan fixture TERKINI dari sumber otoritatif, dibaca segar di dalam lock commit. */
export interface FixtureStateNow {
  status: string | null;
  /** Kickoff terkini menurut sumber; null = sumber tidak tahu — pakai kickoff intent. */
  kickoff_utc: string | null;
}

export interface CommitOptions {
  /**
   * Jam yang BISA DIBACA ULANG (review K8 butir 3A). Commit mengambil
   * lock writer lebih dulu, membaca keadaan fixture, lalu membaca jam
   * ini TERAKHIR: nilai bacaan akhir itu ("nilai verifikasi akhir")
   * memutuskan cutoff dan menjadi cap published_at. Nilai jam yang
   * ditangkap pemanggil sebelum commit tidak dipakai — waktu bisa
   * melewati kickoff selagi commit tertahan lock penulis lain.
   */
  now: () => string;
  /** Keadaan fixture TERKINI (status + kickoff) dari sumber otoritatif. */
  fixture_state: () => FixtureStateNow | null;
}

export type CommitStatus =
  | "published"
  | "already_committed"
  | "rejected_cutoff"
  | "failed";

export interface CommitResult {
  operation_key: string;
  status: CommitStatus;
  pick_ids: number[];
  package_id: number | null;
  reason?: string;
}

interface FrozenProb {
  published_prob: number | null;
  basis: ProbabilityBasis;
  error: string | null;
}

function freezeProb(leg: PublishLegInput): FrozenProb {
  const eff = leg.effective_prob;
  if (eff !== null && eff !== undefined) {
    if (Number.isFinite(eff) && eff >= 0 && eff <= 1) {
      return { published_prob: eff, basis: "effective", error: null };
    }
    // Tersedia tetapi invalid: tandai, jangan diganti diam-diam.
    return {
      published_prob: null,
      basis: "invalid_effective",
      error: "effective_prob_invalid",
    };
  }
  return { published_prob: leg.model_prob, basis: "model", error: null };
}

interface OfferedQuote {
  bookmaker: string | null;
  period: string | null;
  line: string | null;
  decimal: number | null;
  captured_utc: string | null;
  note: string | null;
}

/**
 * Harga yang ditawarkan saat keputusan: HANYA snapshot prematch dari buku
 * yang tersedia pada/setelah decision_at tidak — tersedia ≤ decision_at.
 * Closing dan panel arsip ber-basis terpisah dan tidak pernah masuk sini.
 * Harga invalid (≤1, NaN) ditolak dengan catatan, bukan dipakai.
 */
function selectOfferedQuote(
  leg: PublishLegInput,
  decisionAtUtc: string,
): OfferedQuote {
  const snaps = leg.odds_snapshots ?? [];
  const prematch = snaps.filter(
    (s) => s.type === "prematch" && s.available_utc <= decisionAtUtc,
  );
  const valid = prematch
    .filter(
      (s) =>
        typeof s.decimal === "number" &&
        Number.isFinite(s.decimal) &&
        s.decimal > 1,
    )
    .sort((a, b) => (a.available_utc < b.available_utc ? 1 : -1));
  if (valid.length > 0) {
    const s = valid[0];
    return {
      bookmaker: s.bookmaker ?? null,
      period: "prematch",
      line: s.line ?? canonicalLineFor(leg.market, leg.line),
      decimal: s.decimal as number,
      captured_utc: s.available_utc,
      note: null,
    };
  }
  return {
    bookmaker: null,
    period: null,
    line: null,
    decimal: null,
    captured_utc: null,
    note: prematch.length > 0 ? "invalid_price_rejected" : "no_prematch_quote",
  };
}

/** Probabilitas panel dari snapshot arsip (basis terpisah dari odds). */
function panelProbOf(leg: PublishLegInput, decisionAtUtc: string): number | null {
  if (leg.sm_prob !== null && leg.sm_prob !== undefined) return leg.sm_prob;
  const panel = (leg.odds_snapshots ?? [])
    .filter(
      (s) =>
        s.type === "probability" &&
        s.available_utc <= decisionAtUtc &&
        typeof s.prob === "number" &&
        Number.isFinite(s.prob) &&
        s.prob >= 0 &&
        s.prob <= 1,
    )
    .sort((a, b) => (a.available_utc < b.available_utc ? 1 : -1));
  return panel.length > 0 ? (panel[0].prob as number) : null;
}

const PICK_PUBLISH_COLUMNS =
  "created_utc, match_id, competition_canonical_id, kickoff_utc, market, selection, " +
  "model_prob, market_prob, sm_prob, agreement_spread, gate_status, grade, source, notes, package_id, " +
  "effective_prob, effective_source, pick_uid, fixture_uid, line, series, package_key, package_hash, " +
  "decision_at_utc, published_at_utc, kickoff_at_issue_utc, model_version, ratings_hash, " +
  "grade_policy_version, settlement_policy_version, code_sha, input_snapshot_id, " +
  "published_prob, probability_basis, published_error, evidence_quality, evidence_source, evidence_age_sec, " +
  "odds_bookmaker, odds_period, odds_line, odds_decimal, odds_captured_utc, odds_note";

export function commitPublication(
  operationKey: string,
  opts: CommitOptions,
): CommitResult {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  db.exec("PRAGMA busy_timeout = 10000");

  const intent0 = loadIntent(db, operationKey);
  if (!intent0) {
    throw new Error(`commitPublication: intent tidak ditemukan: ${operationKey}`);
  }
  if (intent0.state === "committed") {
    return {
      operation_key: operationKey,
      status: "already_committed",
      pick_ids: intent0.published_pick_ids
        ? (JSON.parse(intent0.published_pick_ids) as number[])
        : [],
      package_id: intent0.package_id,
    };
  }
  if (intent0.state === "rejected_cutoff") {
    return {
      operation_key: operationKey,
      status: "rejected_cutoff",
      pick_ids: [],
      package_id: intent0.package_id,
      reason: intent0.detail ?? undefined,
    };
  }

  const input = JSON.parse(
    (db
      .prepare("SELECT input_json FROM publication_intents WHERE operation_key = ?")
      .get(operationKey) as { input_json: string }).input_json,
  ) as StoredInput;

  // --- Paket harus sudah tertulis sebelum isinya bisa diverifikasi.
  if (intent0.package_id === null) {
    return {
      operation_key: operationKey,
      status: "failed",
      pick_ids: [],
      package_id: null,
      reason: "package_not_written",
    };
  }

  // --- Verifikasi paket: identitas + hash isi harus cocok dengan intent.
  // Baris paket immutable sesudah tertulis, jadi bacaan ini aman di luar
  // lock; keputusan cutoff TIDAK dibuat di sini (lihat transaksi di bawah).
  const pkgRow = getPackagesDb()
    .prepare(
      "SELECT match_id, trigger, computed_utc, payload_json FROM packages WHERE id = ?",
    )
    .get(intent0.package_id) as
    | {
        match_id: string;
        trigger: string;
        computed_utc: string;
        payload_json: string;
      }
    | undefined;
  const pkgOk =
    pkgRow !== undefined &&
    pkgRow.match_id === input.source_match_id &&
    pkgRow.trigger === input.package.trigger &&
    pkgRow.computed_utc === intent0.package_computed_utc &&
    sha256(pkgRow.payload_json) === intent0.package_hash &&
    intent0.package_key ===
      packageKeyOf(pkgRow.match_id, pkgRow.trigger, pkgRow.computed_utc);

  // --- SATU transaksi commit (review K8 butir 3A): lock writer diambil
  // DULU, lalu di dalam lock dibaca keadaan fixture terkini dan jam
  // aktual — jam dibaca TERAKHIR, dan bacaan akhir itu (verifiedNow)
  // memutuskan cutoff sekaligus menjadi cap published_at. Penulis kedua
  // yang tertahan lock sampai melewati kickoff membaca jam yang sudah
  // lewat di dalam lock-nya sendiri dan ditolak; tidak ada lagi jalur
  // validasi-dulu-baru-lock dengan cap basi.
  const pickIds: number[] = [];
  let result: CommitResult | null = null;
  beginImmediate(db);
  try {
    const fresh = loadIntent(db, operationKey);
    const intentTx = fresh ?? intent0;
    if (intentTx.state === "committed") {
      result = {
        operation_key: operationKey,
        status: "already_committed",
        pick_ids: intentTx.published_pick_ids
          ? (JSON.parse(intentTx.published_pick_ids) as number[])
          : [],
        package_id: intentTx.package_id,
      };
    } else if (intentTx.state === "rejected_cutoff") {
      result = {
        operation_key: operationKey,
        status: "rejected_cutoff",
        pick_ids: [],
        package_id: intentTx.package_id,
        reason: intentTx.detail ?? undefined,
      };
    } else {
      // Keadaan fixture TERKINI (status + kickoff) dari sumber otoritatif,
      // lalu jam aktual. Urutan ini penting: bacaan status yang lambat
      // tidak boleh menyisakan jam basi — jam dibaca sesudahnya.
      const stateNow = opts.fixture_state();
      const statusNow = normalizeMatchStatus(stateNow?.status ?? null);
      const kickoffNow = stateNow?.kickoff_utc ?? input.kickoff_utc;
      const verifiedNow = opts.now();

      const rejectReason =
        !(input.decision_at_utc <= verifiedNow)
          ? "decision_after_publish"
          : !(verifiedNow < kickoffNow)
            ? "kickoff_reached"
            : statusNow !== "scheduled"
              ? `fixture_not_scheduled:${statusNow}`
              : null;

      if (rejectReason !== null) {
        db.prepare(
          `UPDATE publication_intents SET state = 'rejected_cutoff', detail = ?, updated_utc = ?
           WHERE operation_key = ? AND state NOT IN ('committed','rejected_cutoff')`,
        ).run(rejectReason, verifiedNow, operationKey);
        result = {
          operation_key: operationKey,
          status: "rejected_cutoff",
          pick_ids: [],
          package_id: intentTx.package_id,
          reason: rejectReason,
        };
      } else if (!pkgOk) {
        db.prepare(
          `UPDATE publication_intents SET state = 'failed', detail = 'package_mismatch', updated_utc = ?
           WHERE operation_key = ? AND state NOT IN ('committed','rejected_cutoff')`,
        ).run(verifiedNow, operationKey);
        result = {
          operation_key: operationKey,
          status: "failed",
          pick_ids: [],
          package_id: intentTx.package_id,
          reason: "package_mismatch",
        };
      } else {
        // --- Bukti: sumber + umur pada waktu verifikasi akhir.
        const evidenceStamps = [
          input.package.odds_captured_utc,
          input.package.predictions_batch_utc,
        ].filter(
          (t): t is string => typeof t === "string" && t <= verifiedNow,
        );
        const evidenceAgeSec =
          evidenceStamps.length > 0
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(verifiedNow) -
                    Date.parse(evidenceStamps.sort().slice(-1)[0])) /
                    1000,
                ),
              )
            : null;

        const findOfficialByUid = db.prepare(
          `SELECT id FROM picks WHERE fixture_uid = ? AND market = ? AND line = ?
             AND selection = ? AND series = ? AND pick_uid IS NOT NULL`,
        );
        const findOfficialByMatch = db.prepare(
          `SELECT id FROM picks WHERE match_id = ? AND market = ? AND line = ?
             AND selection = ? AND series = ? AND pick_uid IS NOT NULL`,
        );
        const findAnyByMatch = db.prepare(
          `SELECT id FROM picks WHERE match_id = ? AND market = ? AND selection = ? AND source = ?`,
        );
        const insert = db.prepare(
          `INSERT OR IGNORE INTO picks (${PICK_PUBLISH_COLUMNS})
           VALUES (${PICK_PUBLISH_COLUMNS.split(",").map(() => "?").join(", ")})`,
        );

        for (const leg of input.legs) {
          const line = canonicalLineFor(leg.market, leg.line);
          // Keputusan pertama dalam seri menang: baris resmi yang sudah ada
          // dipakai apa adanya, tidak ditimpa versi yang lebih baru.
          const existing =
            (input.fixture_uid
              ? (findOfficialByUid.get(
                  input.fixture_uid,
                  leg.market,
                  line,
                  leg.selection,
                  input.series,
                ) as { id: number } | undefined)
              : undefined) ??
            (findOfficialByMatch.get(
              input.source_match_id,
              leg.market,
              line,
              leg.selection,
              input.series,
            ) as { id: number } | undefined);
          if (existing) {
            pickIds.push(existing.id);
            continue;
          }

          const frozen = freezeProb(leg);
          const quote = selectOfferedQuote(leg, input.decision_at_utc);
          const smProb = panelProbOf(leg, input.decision_at_utc);
          const spread = computeAgreementSpread({
            match_id: input.source_match_id,
            market: leg.market,
            selection: leg.selection,
            model_prob: leg.model_prob,
            market_prob: leg.market_prob ?? null,
            sm_prob: smProb,
            source: input.series,
          });
          const evidenceParts: string[] = [];
          if (leg.market_prob !== null && leg.market_prob !== undefined)
            evidenceParts.push("market");
          if (smProb !== null) evidenceParts.push("panel");
          const evidenceSource =
            evidenceParts.length > 0 ? evidenceParts.join("+") : "model-only";
          const pickUid = `pk_${sha256(
            `${operationKey}|${leg.market}|${line}|${leg.selection}`,
          ).slice(0, 32)}`;

          const res = insert.run(
            verifiedNow, // created_utc = published_at untuk baris resmi
            input.source_match_id,
            input.competition_canonical_id ?? null,
            input.kickoff_utc,
            leg.market,
            leg.selection,
            leg.model_prob,
            leg.market_prob ?? null,
            smProb,
            spread,
            leg.gate_status ?? input.package.gate_status ?? null,
            leg.grade ?? null,
            input.series, // source
            null, // notes — bukti terbit kini terstruktur, bukan teks bebas
            intentTx.package_id,
            leg.effective_prob ?? null,
            leg.effective_source ?? null,
            pickUid,
            input.fixture_uid ?? null,
            line,
            input.series,
            intentTx.package_key,
            intentTx.package_hash,
            input.decision_at_utc,
            verifiedNow,
            input.kickoff_utc,
            input.model_version ?? null,
            input.ratings_hash ?? input.package.ratings_marker ?? null,
            GRADE_POLICY_VERSION,
            SETTLEMENT_POLICY_VERSION,
            input.code_sha ?? null,
            input.input_snapshot_id ?? operationKey,
            frozen.published_prob,
            frozen.basis,
            frozen.error,
            leg.evidence_quality ?? evidenceSource,
            evidenceSource,
            evidenceAgeSec,
            quote.bookmaker,
            quote.period,
            quote.line,
            quote.decimal,
            quote.captured_utc,
            quote.note,
          );
          if (Number(res.changes) > 0) {
            pickIds.push(Number(res.lastInsertRowid));
          } else {
            // Terhalang indeks unik lain (baris warisan pra-K2 pada
            // match/market/selection/source, atau kunci resmi alias): baris
            // yang sudah ada adalah keputusan pertama — pakai id-nya.
            const fallback =
              (findAnyByMatch.get(
                input.source_match_id,
                leg.market,
                leg.selection,
                input.series,
              ) as { id: number } | undefined) ??
              (input.fixture_uid
                ? (findOfficialByUid.get(
                    input.fixture_uid,
                    leg.market,
                    line,
                    leg.selection,
                    input.series,
                  ) as { id: number } | undefined)
                : undefined);
            if (!fallback) {
              throw new Error(
                `commitPublication: INSERT ter-ignore tanpa baris existing untuk ${input.source_match_id}/${leg.market}/${leg.selection}`,
              );
            }
            pickIds.push(fallback.id);
          }
        }

        db.prepare(
          `UPDATE publication_intents
           SET state = 'committed', published_pick_ids = ?, updated_utc = ?
           WHERE operation_key = ?`,
        ).run(JSON.stringify(pickIds), verifiedNow, operationKey);
        result = {
          operation_key: operationKey,
          status: "published",
          pick_ids: pickIds,
          package_id: intentTx.package_id,
        };
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    safeRollback(db);
    throw err;
  }

  if (result === null) {
    throw new Error("commitPublication: hasil commit kosong (bug internal)");
  }
  return result;
}

/** Publikasi satu fase penuh: begin lalu commit. */
export function publishPicks(
  input: PublishFixtureInput,
  commitOpts: CommitOptions,
): CommitResult & { package_id: number | null } {
  const begun = beginPublication(input, commitOpts.now());
  if (begun.state === "committed") {
    return {
      operation_key: begun.operation_key,
      status: "already_committed",
      pick_ids: begun.pick_ids,
      package_id: begun.package_id,
    };
  }
  if (begun.state === "rejected_cutoff") {
    const intent = loadIntent(getPicksDb(), begun.operation_key);
    return {
      operation_key: begun.operation_key,
      status: "rejected_cutoff",
      pick_ids: [],
      package_id: begun.package_id,
      reason: intent?.detail ?? undefined,
    };
  }
  const committed = commitPublication(begun.operation_key, commitOpts);
  return { ...committed, package_id: begun.package_id };
}

// ---------------------------------------------------------------------------
// Rekonsiliasi + pembaca beku
// ---------------------------------------------------------------------------

/** Intent yang belum selesai (bukan committed / rejected) — untuk rekonsiliasi read-only. */
export function listPendingIntents(): IntentRow[] {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  return db
    .prepare(
      `SELECT * FROM publication_intents
       WHERE state IN ('intent','package_written','failed')
       ORDER BY created_utc ASC`,
    )
    .all() as unknown as IntentRow[];
}

export function getIntent(operationKey: string): IntentRow | null {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  return loadIntent(db, operationKey);
}

export interface PublishedPickView {
  pick_id: number;
  pick_uid: string | null;
  fixture_uid: string | null;
  source_match_id: string;
  market: string;
  line: string;
  selection: string;
  series: string | null;
  package_id: number | null;
  package_key: string | null;
  decision_at_utc: string | null;
  published_at_utc: string | null;
  kickoff_at_issue_utc: string | null;
  model_prob: number;
  effective_prob: number | null;
  published_prob: number | null;
  probability_basis: ProbabilityBasis | null;
  published_error: string | null;
  /** Angka terbit untuk tampilan; label bila tak tercatat (D06). */
  published_display: number | string;
  grade: string | null;
  gate_status: string | null;
  model_version: string | null;
  grade_policy_version: string | null;
  settlement_policy_version: string | null;
  odds_bookmaker: string | null;
  odds_period: string | null;
  odds_decimal: number | null;
  odds_captured_utc: string | null;
}

/** Baris pilihan beku apa adanya — jawaban "berapa peluang saat terbit?". */
export function getPickPublication(pickId: number): PublishedPickView | null {
  const db = getPicksDb();
  ensurePublicationSchema(db);
  const r = db
    .prepare("SELECT * FROM picks WHERE id = ?")
    .get(pickId) as Record<string, unknown> | undefined;
  if (!r) return null;
  const publishedProb = (r.published_prob as number | null) ?? null;
  const basis = (r.probability_basis as ProbabilityBasis | null) ?? null;
  return {
    pick_id: r.id as number,
    pick_uid: (r.pick_uid as string | null) ?? null,
    fixture_uid: (r.fixture_uid as string | null) ?? null,
    source_match_id: r.match_id as string,
    market: r.market as string,
    line: (r.line as string | null) ?? "",
    selection: r.selection as string,
    series: (r.series as string | null) ?? null,
    package_id: (r.package_id as number | null) ?? null,
    package_key: (r.package_key as string | null) ?? null,
    decision_at_utc: (r.decision_at_utc as string | null) ?? null,
    published_at_utc: (r.published_at_utc as string | null) ?? null,
    kickoff_at_issue_utc: (r.kickoff_at_issue_utc as string | null) ?? null,
    model_prob: r.model_prob as number,
    effective_prob: (r.effective_prob as number | null) ?? null,
    published_prob: publishedProb,
    probability_basis: basis,
    published_error: (r.published_error as string | null) ?? null,
    published_display:
      publishedProb !== null
        ? publishedProb
        : basis === "unknown_legacy" || basis === null
          ? UNRECORDED_PROB_LABEL
          : (r.published_error as string | null) ?? UNRECORDED_PROB_LABEL,
    grade: (r.grade as string | null) ?? null,
    gate_status: (r.gate_status as string | null) ?? null,
    model_version: (r.model_version as string | null) ?? null,
    grade_policy_version: (r.grade_policy_version as string | null) ?? null,
    settlement_policy_version:
      (r.settlement_policy_version as string | null) ?? null,
    odds_bookmaker: (r.odds_bookmaker as string | null) ?? null,
    odds_period: (r.odds_period as string | null) ?? null,
    odds_decimal: (r.odds_decimal as number | null) ?? null,
    odds_captured_utc: (r.odds_captured_utc as string | null) ?? null,
  };
}
